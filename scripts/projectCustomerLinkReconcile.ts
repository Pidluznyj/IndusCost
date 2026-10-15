#!/usr/bin/env npx tsx
/**
 * Conciliação Projeto → cadastro oficial de Clientes, SOMENTE por CNPJ/CPF idêntico.
 *
 * Dry-run (padrão, não grava nada):
 *   npx tsx scripts/projectCustomerLinkReconcile.ts [--report=conciliacao.json]
 *
 * Aplicar (exige o token impresso pelo dry-run — garante que se grava o plano revisado):
 *   npx tsx scripts/projectCustomerLinkReconcile.ts --apply --confirm=<token>
 *
 * Nunca vincula por semelhança de nome. Não altera o nome/documento gravados no projeto.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  RECONCILIATION_STATUS_LABELS,
  summarizeReconciliation,
  type ReconciliationStatus,
} from "../src/lib/projectsCustomerLink.ts";
import {
  applyProjectCustomerReconciliation,
  buildProjectCustomerReconciliationPlan,
  reconciliationConfirmToken,
} from "../src/lib/projectsCustomerReconciliation.server.ts";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL ausente.");
    process.exit(1);
  }
  const plan = await buildProjectCustomerReconciliationPlan(prisma as never);
  const summary = summarizeReconciliation(plan);
  const token = reconciliationConfirmToken(plan);

  console.log(`Conciliação Projeto → Cliente (por CNPJ/CPF) — ${plan.length} projeto(s)`);
  for (const status of Object.keys(summary) as ReconciliationStatus[]) {
    console.log(`  ${RECONCILIATION_STATUS_LABELS[status]}: ${summary[status]}`);
  }
  console.log("");
  for (const e of plan.filter((x) => x.status !== "ALREADY_LINKED")) {
    const target = e.customerCompanyName ? ` → ${e.customerCompanyName}` : "";
    const note = e.nameDiffers ? " [nome do cadastro difere do projeto — revisar]" : "";
    const amb = e.status === "AMBIGUOUS" ? ` (${e.candidates.map((c) => c.companyName).join(" | ")})` : "";
    console.log(`${e.projectCode}  ${e.status.padEnd(17)} ${e.projectCustomerName} [${e.projectDocument ?? "sem documento"}]${target}${amb}${note}`);
  }
  const report = arg("report");
  if (report) {
    writeFileSync(report, JSON.stringify({ generatedAt: new Date().toISOString(), token, summary, plan }, null, 2));
    console.log(`\nRelatório gravado em ${report}`);
  }

  if (!process.argv.includes("--apply")) {
    console.log(`\nDry-run: nada foi gravado. Para aplicar os ${summary.LINK} vínculo(s): --apply --confirm=${token}`);
    return;
  }
  if (arg("confirm") !== token) {
    console.error("\nApply recusado: o token não confere com o plano atual. Rode o dry-run e revise de novo.");
    process.exit(1);
  }
  const result = await applyProjectCustomerReconciliation(prisma as never, plan);
  console.log(`\nVinculados: ${result.linked}.`);
  if (result.skippedChanged.length) {
    console.log(`Ignorados (vínculo alterado durante a execução): ${result.skippedChanged.join(", ")}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
