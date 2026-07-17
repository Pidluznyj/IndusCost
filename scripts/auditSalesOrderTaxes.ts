/**
 * TRIB-07 — Auditoria read-only dos tributos de um Pedido.
 *
 * Uso:
 *   npm run audit:sales-order:taxes -- --order=PD02781
 *
 * Não escreve no banco, não chama o Nomus e não imprime DATABASE_URL.
 * Pedido ausente/sem NF é resultado de negócio (exit code 0).
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  SALES_ORDER_TAXES_AUDIT_LOG_PREFIX,
  parseSalesOrderTaxesAuditArgs,
  resolveSalesOrderTaxesAuditExitCode,
  sanitizeSalesOrderTaxesDatabaseUrl,
} from "../src/lib/sales-orders/salesOrderTaxesAudit.js";
import { loadSalesOrderTaxesAudit } from "../src/lib/sales-orders/salesOrderTaxesAudit.server.js";

const LOG = SALES_ORDER_TAXES_AUDIT_LOG_PREFIX;

async function main(): Promise<void> {
  let args;
  try {
    args = parseSalesOrderTaxesAuditArgs(process.argv.slice(2));
  } catch (error) {
    console.error(
      `${LOG} falha técnica nos argumentos: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exitCode = resolveSalesOrderTaxesAuditExitCode("technical_error");
    return;
  }

  const database = sanitizeSalesOrderTaxesDatabaseUrl(process.env.DATABASE_URL);
  if (!database) {
    console.error(`${LOG} falha técnica: DATABASE_URL ausente ou inválida.`);
    process.exitCode = resolveSalesOrderTaxesAuditExitCode("technical_error");
    return;
  }

  console.warn(`${LOG} modo READ_ONLY`);
  console.warn(`${LOG} banco: ${database.display}`);
  console.warn(`${LOG} pedido solicitado: ${args.order}`);

  const prisma = new PrismaClient();
  try {
    const report = await loadSalesOrderTaxesAudit(prisma, args.order);
    console.log(JSON.stringify(report, null, 2));
    if (!report.orderFound) {
      console.warn(`${LOG} ${report.exactUnavailableReason}`);
      process.exitCode = resolveSalesOrderTaxesAuditExitCode("order_not_found");
      return;
    }
    console.warn(
      `${LOG} concluído: status=${report.status} nfes=${report.counts.uniqueNfes} ` +
        `duplicidadesEliminadas=${report.counts.duplicatesEliminated}`
    );
    process.exitCode = resolveSalesOrderTaxesAuditExitCode("ok");
  } catch (error) {
    console.error(
      `${LOG} falha técnica: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exitCode = resolveSalesOrderTaxesAuditExitCode("technical_error");
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

void main();
