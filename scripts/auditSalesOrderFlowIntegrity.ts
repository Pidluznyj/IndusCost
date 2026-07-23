/**
 * Auditoria em lote read-only: vínculos PV→OP→DS→NF vs snapshot Kanban.
 *
 * Uso:
 *   npm run audit:sales-order:flow:integrity --
 *   npm run audit:sales-order:flow:integrity -- --from=2025-01-01 --to=2026-12-31
 *   npm run audit:sales-order:flow:integrity -- --exclude-completed
 *
 * Não escreve no banco e não chama Nomus.
 * Exit 1 se houver achados acionáveis (FALSE_WAITING_OP / STALE / MISSING_LINKS).
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  formatSalesOrderFlowIntegrityMarkdown,
  parseSalesOrderFlowIntegrityAuditArgs,
  printSalesOrderFlowIntegrityAuditHelp,
  resolveSalesOrderFlowIntegrityExitCode,
  SALES_ORDER_FLOW_INTEGRITY_AUDIT_LOG_PREFIX,
} from "../src/lib/sales/salesOrderFlowIntegrityAudit.js";
import { runSalesOrderFlowIntegrityAudit } from "../src/lib/sales/salesOrderFlowIntegrityAudit.server.js";
import { sanitizeSalesOrderTaxesDatabaseUrl } from "../src/lib/sales-orders/salesOrderTaxesAudit.js";

const LOG = SALES_ORDER_FLOW_INTEGRITY_AUDIT_LOG_PREFIX;

function writeTextFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

async function main(): Promise<void> {
  let args;
  try {
    args = parseSalesOrderFlowIntegrityAuditArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof Error && error.message === "HELP") {
      console.log(printSalesOrderFlowIntegrityAuditHelp());
      process.exitCode = 0;
      return;
    }
    console.error(
      `${LOG} falha técnica nos argumentos: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    console.error(printSalesOrderFlowIntegrityAuditHelp());
    process.exitCode = 1;
    return;
  }

  const database = sanitizeSalesOrderTaxesDatabaseUrl(process.env.DATABASE_URL);
  if (!database) {
    console.error(`${LOG} falha técnica: DATABASE_URL ausente ou inválida.`);
    process.exitCode = 1;
    return;
  }

  console.warn(`${LOG} modo READ_ONLY`);
  console.warn(`${LOG} banco: ${database.display}`);
  console.warn(
    `${LOG} filtro: from=${args.fromDate?.toISOString().slice(0, 10) ?? "—"} to=${args.toDate?.toISOString().slice(0, 10) ?? "—"} includeCompleted=${args.includeCompleted}`
  );

  const prisma = new PrismaClient();
  try {
    const report = await runSalesOrderFlowIntegrityAudit(prisma, args);
    const jsonPath = resolve(
      args.jsonOutput ??
        "docs/generated/sales-order-flow-integrity-audit.json"
    );
    const mdPath = resolve(
      args.markdownOutput ??
        "docs/generated/sales-order-flow-integrity-audit.md"
    );
    writeTextFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    writeTextFile(mdPath, formatSalesOrderFlowIntegrityMarkdown(report));

    console.log(`${LOG} ${report.summary}`);
    console.log(
      `${LOG} contagens: FALSE_WAITING_OP=${report.counts.FALSE_WAITING_OP} STALE=${report.counts.STALE_SNAPSHOT} MISSING_LINKS=${report.counts.MISSING_FISCAL_LINKS} LEGITIMATE_OP=${report.counts.LEGITIMATE_WAITING_OP} OK=${report.counts.OK}`
    );
    console.log(`${LOG} JSON: ${jsonPath}`);
    console.log(`${LOG} Markdown: ${mdPath}`);

    const actionableFindings = report.findings.filter(
      (f) =>
        f.kind === "FALSE_WAITING_OP" ||
        f.kind === "STALE_SNAPSHOT" ||
        f.kind === "MISSING_FISCAL_LINKS"
    );
    for (const f of actionableFindings.slice(0, 40)) {
      console.log(
        `${LOG} · ${f.orderCode} [${f.kind}] calc=${f.calculatedStage} snap=${f.persistedStage ?? "—"}`
      );
    }
    if (actionableFindings.length > 40) {
      console.log(
        `${LOG} … +${actionableFindings.length - 40} achados (ver JSON/MD)`
      );
    }

    process.exitCode = resolveSalesOrderFlowIntegrityExitCode({
      actionable: report.counts.actionable,
    });
  } catch (error) {
    console.error(
      `${LOG} falha técnica: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
