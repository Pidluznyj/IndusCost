#!/usr/bin/env npx tsx
/**
 * Auditoria de exclusão de comissão por cliente (somente leitura).
 *
 * Uso:
 *   npx tsx scripts/audit-commission-customer-exclusion.ts --customer="ESMALTEC" --from=2026-01-01 --to=2026-12-31
 *   npx tsx scripts/audit-commission-customer-exclusion.ts --customer="ESMALTEC" --from=2026-01-01 --to=2026-12-31 --json
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma.ts";
import { auditCustomerCommissionExclusion } from "../src/lib/commissions/commissionCustomerExclusionAudit.server.ts";
import {
  buildCustomerExclusionAuditCsv,
  buildCustomerExclusionAuditMarkdown,
} from "../src/lib/commissions/commissionCustomerExclusionAudit.ts";
import {
  parseExclusionReprocessCustomerFilter,
  parseExclusionReprocessDateRange,
} from "../src/lib/commissions/commissionCustomerExclusionReprocess.ts";
import {
  fmtBrl,
  hasFlag,
  parseArg,
  requireDatabaseUrl,
} from "./commission-script-utils.ts";

function printHuman(
  report: Awaited<ReturnType<typeof auditCustomerCommissionExclusion>>,
  customerLabel: string
): void {
  console.log("=== Auditoria — exclusão de comissão por cliente ===");
  console.log(`Cliente (filtro): ${customerLabel}`);
  console.log(`Período: ${report.dateRange.label}`);
  console.log(`Regra cadastrada (ACTIVE): ${report.ruleRegistered ? "SIM" : "NAO"}`);
  console.log("Modo: READ-ONLY — AP/Nomus não são alterados\n");

  if (report.rules.length > 0) {
    console.log("--- Regras no cadastro ---");
    for (const rule of report.rules) {
      console.log(
        `  • ${rule.customerNameSnapshot} | id=${rule.id} | ${rule.effectiveFrom} → ${rule.effectiveTo ?? "∞"} | ${rule.status}`
      );
      console.log(`    Motivo: ${rule.reason}`);
    }
    console.log("");
  } else {
    console.log("⚠ Nenhuma regra ACTIVE encontrada para o cliente informado.\n");
  }

  for (const warning of report.warnings) {
    console.log(`⚠ ${warning}`);
  }

  console.log("\n--- Vendas / documentos ---");
  console.log(`Linhas de venda: ${report.summary.salesLineCount}`);
  console.log(`Pedidos: ${report.summary.ordersCount}`);
  console.log(`NFs: ${report.summary.nfesCount}`);
  console.log(`CRs: ${report.summary.receivablesCount}`);
  console.log(`Base vendida: ${fmtBrl(report.summary.soldBaseTotal)}`);
  console.log(`Valor recebido: ${fmtBrl(report.summary.receivedAmountTotal)}`);
  console.log(`Base comissionável (preservada): ${fmtBrl(report.summary.commissionableBaseTotal)}`);

  console.log("\n--- Comissão ---");
  console.log(`Antes (sem exclusão / simulado): ${fmtBrl(report.summary.commissionBeforeTotal)}`);
  console.log(`Atual (persistida): ${fmtBrl(report.summary.commissionCurrentTotal)}`);
  console.log(`Após exclusão (esperada): ${fmtBrl(report.summary.commissionAfterTotal)}`);
  console.log(`Diferença: ${fmtBrl(report.summary.commissionDiffTotal)}`);
  console.log(`Liberado atual → após: ${fmtBrl(report.summary.releasedCurrentTotal)} → ${fmtBrl(report.summary.releasedAfterTotal)}`);

  if (report.byReferenceMonth.length > 0) {
    console.log("\n--- Impacto por mês (NF/pedido) ---");
    for (const month of report.byReferenceMonth) {
      console.log(
        `  ${month.monthKey}: ${month.lineCount} linha(s) | base ${fmtBrl(month.soldBaseAmount)} | comissão ${fmtBrl(month.commissionBefore)} → ${fmtBrl(month.commissionAfter)}`
      );
    }
  }

  if (report.bySettlementMonth.length > 0) {
    console.log("\n--- Impacto por mês (settlementDate) ---");
    for (const month of report.bySettlementMonth) {
      console.log(
        `  ${month.monthKey}: ${month.lineCount} linha(s) | diff comissão ${fmtBrl(month.commissionDiff)}`
      );
    }
  }

  console.log("\n--- Validação de telas (fixture lógico) ---");
  const ui = report.uiValidation;
  console.log(`Auditoria visual — comissão zero: ${ui.visualAudit.commissionZero ? "OK" : "FALHA"}`);
  console.log(`Auditoria visual — base preservada: ${ui.visualAudit.basePreserved ? "OK" : "FALHA"}`);
  console.log(`Auditoria visual — motivo visível: ${ui.visualAudit.reasonVisible ? "OK" : "FALHA"}`);
  console.log(`Fechamento mensal — total liberado zero: ${ui.monthlyClosing.releasedCommissionZero ? "OK" : "FALHA"}`);
  console.log(`Previsão — comissão prevista zero: ${ui.forecast.forecastCommissionZero ? "OK" : "FALHA"}`);
  console.log(`Gerada — comissão prevista zero: ${ui.generated.generatedCommissionZero ? "OK" : "FALHA"}`);
  console.log(`CSV — coluna motivoExclusao: ${ui.csv.hasMotivoExclusaoColumn ? "OK" : "FALHA"}`);

  const sample = report.lines.slice(0, 20);
  if (sample.length > 0) {
    console.log("\n--- Amostra de linhas ---");
    for (const line of sample) {
      console.log(
        `  • ${line.orderCode ?? "—"} | NF ${line.nfeNumber ?? "—"} | ${line.sellerName} | base ${fmtBrl(line.soldBaseAmount)} | comissão ${fmtBrl(line.commissionCurrent)} → ${fmtBrl(line.commissionAfter)} | ${line.exclusionReason ?? "—"}`
      );
    }
  }

  console.log("\n--- Limitações ---");
  for (const item of report.limitations) {
    console.log(`  • ${item}`);
  }

  console.log("\nAuditoria concluída. Nenhuma alteração foi feita.");
}

async function main(): Promise<void> {
  requireDatabaseUrl();

  const customerFilter = parseExclusionReprocessCustomerFilter({
    customer: parseArg("customer"),
    customerExternalId: parseArg("customerExternalId"),
  });
  const dateRange = parseExclusionReprocessDateRange({
    from: parseArg("from"),
    to: parseArg("to"),
  });
  const customerLabel =
    customerFilter.customerName ??
    (customerFilter.customerExternalId != null
      ? String(customerFilter.customerExternalId)
      : "cliente");

  const report = await auditCustomerCommissionExclusion(prisma, {
    customerFilter,
    dateRange,
  });

  if (hasFlag("json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (hasFlag("csv")) {
    console.log(buildCustomerExclusionAuditCsv(report));
    return;
  }

  if (hasFlag("write-doc")) {
    const docPath = join(
      process.cwd(),
      "docs",
      "commission-esmaltec-exclusion-validation.md"
    );
    writeFileSync(docPath, buildCustomerExclusionAuditMarkdown(report, customerLabel), "utf8");
    console.log(`Documento gerado: ${docPath}`);
  }

  printHuman(report, customerLabel);
}

main()
  .catch((err) => {
    console.error("Erro na auditoria:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
