#!/usr/bin/env npx tsx
/**
 * Gera o mesmo ZIP "Gerar Relatório Analisável" do botão — útil quando a tela estiver quebrada.
 * Read-only; usa os mesmos services do POST /api/diagnostics/report.
 *
 * Exemplos:
 *   npx tsx scripts/generate-chatgpt-diagnostic-report.ts --scope=SYSTEM
 *   npx tsx scripts/generate-chatgpt-diagnostic-report.ts --scope=PRODUCT_ENGINEERING --sku=618.08AA
 *   npx tsx scripts/generate-chatgpt-diagnostic-report.ts --scope=PUBLISHED_PRICE --sku=618.08AA --table-code=VAREJO_2
 *   npx tsx scripts/generate-chatgpt-diagnostic-report.ts --scope=COMMISSION_RECEIPT_CLOSING --year=2026 --month=6 --seller=GISLENE
 *   npx tsx scripts/generate-chatgpt-diagnostic-report.ts --scope=COST_TO_CASH --sku=618.08AA --year=2026 --month=6
 *   npx tsx scripts/generate-chatgpt-diagnostic-report.ts --scope=SYSTEM --json-summary
 */
import "dotenv/config";
import {
  generateChatGptDiagnosticReport,
  parseChatGptDiagnosticReportCliArgs,
  printChatGptDiagnosticReportResult,
  scopeRequiresDatabase,
} from "../src/lib/diagnostics/generateChatGptDiagnosticReport.server.ts";
import { prisma } from "../src/lib/prisma.ts";

async function main(): Promise<void> {
  const args = parseChatGptDiagnosticReportCliArgs(process.argv.slice(2));

  let db: typeof prisma | null = null;
  if (scopeRequiresDatabase(args.scope)) {
    if (!process.env.DATABASE_URL?.trim()) {
      console.error(
        `[generate-chatgpt-diagnostic-report] DATABASE_URL ausente — configure .env para ${args.scope}.`
      );
      process.exit(1);
    }
    await prisma.$connect();
    db = prisma;
  } else if (process.env.DATABASE_URL?.trim()) {
    await prisma.$connect();
    db = prisma;
  }

  const report = await generateChatGptDiagnosticReport(db, args);
  printChatGptDiagnosticReportResult(report, args);

  if (report.summary.status === "ERROR") {
    process.exitCode = 2;
  } else if (report.summary.status === "WARNING") {
    process.exitCode = 0;
  }
}

main().catch((error) => {
  console.error(
    "[generate-chatgpt-diagnostic-report]",
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});
