#!/usr/bin/env npx tsx
/**
 * @deprecated Preferir scripts/generate-chatgpt-diagnostic-report.ts
 * Wrapper fino — delega para generateChatGptDiagnosticReport (mesmos services do botão).
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
        `[generate-diagnostic-bundle] DATABASE_URL ausente — configure .env para ${args.scope}.`
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
}

main().catch((error) => {
  console.error("[generate-diagnostic-bundle]", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
