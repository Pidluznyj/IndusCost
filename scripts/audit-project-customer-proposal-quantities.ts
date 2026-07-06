#!/usr/bin/env npx tsx
/**
 * Auditoria das quantidades da proposta comercial ao cliente.
 *
 * Uso:
 *   npx tsx scripts/audit-project-customer-proposal-quantities.ts
 *   npx tsx scripts/audit-project-customer-proposal-quantities.ts --projectId=<uuid>
 */
import { prisma } from "../src/lib/prisma.js";
import {
  applyProjectClientReportQuantities,
  buildProjectClientReport,
  computeProjectClientReportFinalSetPrice,
  normalizeClientProposalQuantityPerSet,
  resolveClientProposalQuantityPerSet,
} from "../src/lib/projectsClientReport.js";
import { loadProjectClientProposalQuantities } from "../src/lib/projectsClientProposalService.js";
import { loadProjectClientReport } from "../src/lib/projectsClientReportService.js";
import { loadProjectDetail } from "../src/lib/projectsService.js";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function nearlyEqual(a: number | null, b: number | null, epsilon = 0.01): boolean {
  if (a == null || b == null) return a === b;
  return Math.abs(a - b) <= epsilon;
}

type AuditStatus = "OK" | "ALERTA" | "BLOQUEANTE";

async function auditProject(projectId: string) {
  const notes: string[] = [];
  const statuses: AuditStatus[] = [];

  const detail = await loadProjectDetail(projectId);
  if (!detail) {
    return { status: "BLOQUEANTE" as const, notes: [`Projeto ${projectId} não encontrado.`] };
  }

  const saved = await loadProjectClientProposalQuantities(projectId);
  const report = buildProjectClientReport(detail, saved);

  if (report.products.length === 0) {
    return { status: "ALERTA" as const, notes: ["Projeto sem produtos na proposta cliente."] };
  }

  for (const product of report.products) {
    const quantity = resolveClientProposalQuantityPerSet(product.id, saved);
    if (normalizeClientProposalQuantityPerSet(quantity) == null) {
      statuses.push("BLOQUEANTE");
      notes.push(`${product.name}: quantidade inválida.`);
    }
    if (
      product.finalUnitPrice != null &&
      product.finalTotalPrice != null &&
      !nearlyEqual(product.finalTotalPrice, product.finalUnitPrice * product.quantityPerSet)
    ) {
      statuses.push("BLOQUEANTE");
      notes.push(`${product.name}: preço total não bate com quantidade × unitário.`);
    }
    if (
      product.finalUnitPrice != null &&
      product.quantityPerSet > 1 &&
      product.finalTotalPrice === product.finalUnitPrice
    ) {
      statuses.push("BLOQUEANTE");
      notes.push(`${product.name}: quantidade > 1 mas preço total igual ao unitário.`);
    }
  }

  const expectedSetPrice = computeProjectClientReportFinalSetPrice(report.products);
  if (!nearlyEqual(report.summary.finalSetPrice, expectedSetPrice)) {
    statuses.push("BLOQUEANTE");
    notes.push("Preço final do conjunto não bate com soma dos itens.");
  }

  const loaded = await loadProjectClientReport(projectId);
  if (!loaded) {
    statuses.push("BLOQUEANTE");
    notes.push("loadProjectClientReport retornou nulo.");
  } else {
    for (const product of loaded.products) {
      const savedQty = saved.get(product.id);
      if (savedQty != null && product.quantityPerSet !== savedQty) {
        statuses.push("BLOQUEANTE");
        notes.push(`${product.name}: quantidade salva não refletida no relatório.`);
      }
    }
  }

  const sample = report.products[0];
  if (sample?.finalUnitPrice != null) {
    const edited = applyProjectClientReportQuantities(report, {
      [sample.id]: Math.max(2, sample.quantityPerSet + 1),
    });
    const editedProduct = edited.products.find((row) => row.id === sample.id);
    if (editedProduct?.finalUnitPrice !== sample.finalUnitPrice) {
      statuses.push("BLOQUEANTE");
      notes.push("Preço unitário mudou ao alterar quantidade.");
    }
  }

  if (statuses.includes("BLOQUEANTE")) return { status: "BLOQUEANTE" as const, notes };
  if (statuses.includes("ALERTA")) return { status: "ALERTA" as const, notes };
  return {
    status: "OK" as const,
    notes: notes.length ? notes : [`${report.products.length} item(ns) validado(s).`],
  };
}

async function main() {
  const projectId = parseArg("projectId");
  console.log("Auditoria quantidades — Proposta Cliente\n");

  if (projectId) {
    const result = await auditProject(projectId);
    console.log(`Projeto: ${projectId}`);
    for (const note of result.notes) console.log(`- ${note}`);
    console.log(`\nResultado: ${result.status}`);
    if (result.status === "BLOQUEANTE") process.exitCode = 1;
    return;
  }

  const projects = await prisma.project.findMany({
    select: { id: true, code: true, title: true },
    take: 20,
    orderBy: { updatedAt: "desc" },
  });

  let worst: AuditStatus = "OK";
  for (const project of projects) {
    const result = await auditProject(project.id);
    console.log(`${project.code} — ${project.title}: ${result.status}`);
    if (result.status === "BLOQUEANTE") worst = "BLOQUEANTE";
    else if (result.status === "ALERTA" && worst === "OK") worst = "ALERTA";
  }
  console.log(`\nResultado geral: ${worst}`);
  if (worst === "BLOQUEANTE") process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
