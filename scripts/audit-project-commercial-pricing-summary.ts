#!/usr/bin/env npx tsx
/**
 * Auditoria do resumo da precificação comercial do projeto.
 *
 * Uso:
 *   npx tsx scripts/audit-project-commercial-pricing-summary.ts
 *   npx tsx scripts/audit-project-commercial-pricing-summary.ts --projectId=<uuid>
 */
import { prisma } from "../src/lib/prisma.js";
import {
  buildProjectCommercialPricingSummary,
  buildProjectPricingView,
  resolveProjectCommercialPricingWeights,
  serializeTaxRulesForProjectPricing,
} from "../src/lib/projectsPricing.js";
import { loadProjectCostAmortizations } from "../src/lib/projectsCostAmortizationService.js";
import { loadProjectDetail } from "../src/lib/projectsService.js";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function nearlyEqual(a: number | null, b: number | null, epsilon = 0.0001): boolean {
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

  const [taxRulesRaw, amortizations, configRow] = await Promise.all([
    prisma.taxRule.findMany({
      where: { status: "ACTIVE" },
      include: { TaxComponent: true },
      orderBy: { name: "asc" },
    }),
    loadProjectCostAmortizations(projectId),
    prisma.projectPricingConfig.findUnique({ where: { projectId } }),
  ]);

  const taxRules = serializeTaxRulesForProjectPricing(taxRulesRaw);
  const view = buildProjectPricingView({
    detail,
    taxRules,
    config: {
      fiscalRuleId: configRow?.fiscalRuleId ?? null,
      defaultMarginPercent:
        configRow?.defaultMarginPercent != null
          ? Number(configRow.defaultMarginPercent)
          : detail.targetMarginPercent,
    },
    savedItems: [],
    savedAmortizations: amortizations,
  });

  const summary = buildProjectCommercialPricingSummary({
    items: view.items,
    weightsByTargetId: resolveProjectCommercialPricingWeights(detail),
    defaultMarginPercent:
      configRow?.defaultMarginPercent != null
        ? Number(configRow.defaultMarginPercent)
        : detail.targetMarginPercent,
  });

  const calculated = view.items.filter((item) => item.status === "CALCULATED");

  if (calculated.length > 0) {
    if (summary.isEmpty) {
      statuses.push("BLOQUEANTE");
      notes.push("Grid tem itens calculados, mas resumo está vazio.");
    }
    if (
      summary.averageSuggestedPriceWithAmortization == null ||
      summary.averageSuggestedPriceWithAmortization <= 0
    ) {
      statuses.push("BLOQUEANTE");
      notes.push("Preço médio c/ amortização zerado/indisponível com itens calculados.");
    }
    if (summary.averageFinalUnitCost == null || summary.averageFinalUnitCost <= 0) {
      statuses.push("BLOQUEANTE");
      notes.push("Custo final médio zerado/indisponível com itens calculados.");
    }

    const expectedFinal = calculated.reduce((sum, item) => sum + item.finalUnitCost, 0) / calculated.length;
    if (
      summary.aggregationMode === "simple" &&
      !nearlyEqual(summary.averageFinalUnitCost, expectedFinal)
    ) {
      statuses.push("BLOQUEANTE");
      notes.push("Custo final médio não bate com média simples dos itens.");
    }

    const expectedPrice =
      calculated.reduce(
        (sum, item) => sum + (item.suggestedPriceWithAmortization ?? item.suggestedPrice ?? 0),
        0
      ) / calculated.length;
    if (
      summary.aggregationMode === "simple" &&
      !nearlyEqual(summary.averageSuggestedPriceWithAmortization, expectedPrice)
    ) {
      statuses.push("BLOQUEANTE");
      notes.push("Preço médio c/ amortização não bate com média simples dos itens.");
    }

    const expectedPending = view.items.filter((item) => item.status !== "CALCULATED").length;
    if (summary.pendingItems !== expectedPending && expectedPending > 0) {
      statuses.push("ALERTA");
      notes.push("Contagem de pendentes pode divergir da regra expandida de pendência.");
    }
  }

  if (statuses.includes("BLOQUEANTE")) return { status: "BLOQUEANTE" as const, notes };
  if (statuses.includes("ALERTA")) return { status: "ALERTA" as const, notes };
  return {
    status: "OK" as const,
    notes: notes.length ? notes : [`${calculated.length} item(ns) calculado(s) validado(s).`],
  };
}

async function main() {
  const projectId = parseArg("projectId");
  console.log("Auditoria resumo precificação comercial\n");

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
    for (const note of result.notes.slice(0, 2)) console.log(`  - ${note}`);
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
