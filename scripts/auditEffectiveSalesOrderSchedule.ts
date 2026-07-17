/**
 * FIN-10 — Auditoria read-only da agenda financeira efetiva de um Pedido.
 *
 * Uso:
 *   npm run audit:sales-order:effective-schedule -- --order="PD 02596"
 *
 * Não escreve no banco, não chama o Nomus e não imprime senha/DATABASE_URL completa.
 * Pedido ausente é resultado de negócio (exit code 0).
 * Falha técnica → exit code 1.
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  EFFECTIVE_SCHEDULE_AUDIT_LOG_PREFIX,
  formatEffectiveScheduleAuditMarkdown,
  parseEffectiveScheduleAuditArgs,
  resolveEffectiveScheduleAuditExitCode,
  sanitizeSalesOrderTaxesDatabaseUrl,
  stringifyEffectiveScheduleAuditReport,
} from "../src/lib/finance/effectiveSalesOrderScheduleAudit.js";
import { loadEffectiveSalesOrderScheduleAudit } from "../src/lib/finance/effectiveSalesOrderScheduleAudit.server.js";

const LOG = EFFECTIVE_SCHEDULE_AUDIT_LOG_PREFIX;

function defaultOutputPaths(orderCode: string): {
  jsonOutput: string;
  markdownOutput: string;
} {
  const safe = orderCode.replace(/\s+/g, "");
  return {
    jsonOutput: resolve(
      `docs/generated/effective-schedule-audit-${safe}.json`
    ),
    markdownOutput: resolve(
      `docs/generated/effective-schedule-audit-${safe}.md`
    ),
  };
}

function writeTextFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

async function main(): Promise<void> {
  let args;
  try {
    args = parseEffectiveScheduleAuditArgs(process.argv.slice(2));
  } catch (error) {
    console.error(
      `${LOG} falha técnica nos argumentos: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exitCode = resolveEffectiveScheduleAuditExitCode("technical_error");
    return;
  }

  const database = sanitizeSalesOrderTaxesDatabaseUrl(process.env.DATABASE_URL);
  if (!database) {
    console.error(`${LOG} falha técnica: DATABASE_URL ausente ou inválida.`);
    process.exitCode = resolveEffectiveScheduleAuditExitCode("technical_error");
    return;
  }

  console.warn(`${LOG} modo READ_ONLY`);
  console.warn(`${LOG} banco: ${database.display}`);
  console.warn(`${LOG} pedido solicitado: ${args.order}`);

  const defaults = defaultOutputPaths(args.order);
  const jsonPath = args.jsonOutput
    ? resolve(args.jsonOutput)
    : defaults.jsonOutput;
  const mdPath = args.markdownOutput
    ? resolve(args.markdownOutput)
    : defaults.markdownOutput;

  const prisma = new PrismaClient();
  try {
    const report = await loadEffectiveSalesOrderScheduleAudit(prisma, args.order);
    const json = stringifyEffectiveScheduleAuditReport(report);
    const markdown = formatEffectiveScheduleAuditMarkdown(report);

    writeTextFile(jsonPath, `${json}\n`);
    writeTextFile(mdPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`);

    console.log(json);
    console.log("");
    console.log(markdown);

    console.warn(`${LOG} JSON: ${jsonPath}`);
    console.warn(`${LOG} Markdown: ${mdPath}`);

    if (!report.orderFound) {
      console.warn(`${LOG} ${report.exactUnavailableReason}`);
      process.exitCode = resolveEffectiveScheduleAuditExitCode("order_not_found");
      return;
    }

    console.warn(
      `${LOG} concluído: status=${report.status} itens=${report.items.length} ` +
        `crs=${report.realReceivables.length} inconsistencias=${report.inconsistencies.length}`
    );
    process.exitCode = resolveEffectiveScheduleAuditExitCode("ok");
  } catch (error) {
    console.error(
      `${LOG} falha técnica: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exitCode = resolveEffectiveScheduleAuditExitCode("technical_error");
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

void main();
