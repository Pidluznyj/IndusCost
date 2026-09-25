#!/usr/bin/env npx tsx
/**
 * Auditoria de cobertura de comissão por evento de recebimento — SOMENTE LEITURA.
 *
 * Responde, por recebimento: data, competência natural, se já foi contemplado,
 * por quem (Nomus legado / fechamento IndusCost), em qual competência e fechamento,
 * por que não, e se há risco de duplicidade. Não grava nada.
 *
 * Uso:
 *   npm run audit:commission:coverage -- --year=2026 --month=8
 *   npm run audit:commission:coverage -- --ids=19236,19413
 *   npm run audit:commission:coverage -- --year=2026 --month=10 --seller="Fulano" --json
 *
 * Sem --year/--month/--ids: todos os recebimentos desde o início da janela de
 * conciliação legada (COMMISSION_LEGACY_RECONCILIATION_START_DATE).
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma.ts";
import {
  buildCommissionCoverageAudit,
  type CommissionCoverageAuditRow,
} from "../src/lib/commissions/commissionCoverageAudit.server.ts";
import {
  COMMISSION_LEGACY_RECONCILIATION_START_DATE,
  COMMISSION_OFFICIAL_CUTOVER_DATE,
} from "../src/lib/commissions/commissionCoverageCutover.ts";
import { csvLine, fmtBrl, hasFlag, parseArgValue, requireDatabaseUrl } from "./commission-script-utils.ts";

const COLUMNS = [
  "CR",
  "NF",
  "receiptId",
  "receiptDate",
  "settlementDate",
  "naturalCompetence",
  "coverageSource",
  "coverageStatus",
  "coveredYear",
  "coveredMonth",
  "closingId",
  "schedule",
  "commissionAmount",
  "reason",
] as const;

function toColumns(row: CommissionCoverageAuditRow): unknown[] {
  return [
    row.receivableExternalId,
    row.nfeNumber ?? "",
    row.receiptExternalId,
    row.receiptDate,
    row.settlementDate ?? "",
    row.naturalCompetence,
    row.coverageSource ?? "",
    row.coverageStatus ?? row.state,
    row.coveredYear ?? "",
    row.coveredMonth ?? "",
    row.closingId ?? "",
    row.scheduleStatus
      ? `${row.scheduleStatus}${row.installmentNumber != null ? ` parcela ${row.installmentNumber}` : ""}`
      : "sem schedule",
    row.commissionAmount ?? "",
    row.reason,
  ];
}

function parseIds(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(/[,;\s]+/)
    .map((part) => Number.parseInt(part, 10))
    .filter((id) => Number.isInteger(id) && id > 0);
}

async function main(): Promise<void> {
  requireDatabaseUrl();
  const yearArg = parseArgValue("year");
  const monthArg = parseArgValue("month");
  const year = yearArg ? Number.parseInt(yearArg, 10) : null;
  const month = monthArg ? Number.parseInt(monthArg, 10) : null;
  if ((year == null) !== (month == null)) {
    throw new Error("Informe --year e --month juntos (ou use --ids).");
  }
  if (month != null && (!Number.isInteger(month) || month < 1 || month > 12)) {
    throw new Error("Mês inválido em --month (1-12).");
  }
  const receivableIds = parseIds(parseArgValue("ids") ?? parseArgValue("cr"));
  const seller = parseArgValue("seller") ?? null;

  const report = await buildCommissionCoverageAudit(prisma, { year, month, receivableIds, seller });

  if (hasFlag("json")) {
    const suffix =
      receivableIds.length > 0
        ? `ids-${receivableIds.join("-")}`
        : year && month
          ? `${year}-${String(month).padStart(2, "0")}`
          : "janela";
    const payload = { mode: "audit-read-only", ...report };
    writeFileSync(`commission-coverage-audit-${suffix}.json`, JSON.stringify(payload, null, 2), "utf8");
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("=== Auditoria de cobertura de comissão (somente leitura) ===");
  console.log(`Cutover oficial IndusCost: ${COMMISSION_OFFICIAL_CUTOVER_DATE}`);
  console.log(`Janela de conciliação legada desde: ${COMMISSION_LEGACY_RECONCILIATION_START_DATE}`);
  if (year && month) console.log(`Competência natural filtrada: ${String(month).padStart(2, "0")}/${year}`);
  if (receivableIds.length > 0) console.log(`CRs: ${receivableIds.join(", ")}`);
  if (seller) console.log(`Vendedor contém: ${seller}`);
  console.log();
  console.log(csvLine([...COLUMNS]));
  for (const row of report.rows) console.log(csvLine(toColumns(row)));

  const t = report.totals;
  console.log();
  console.log(`Recebimentos: ${t.receipts}`);
  console.log(`Cobertos pelo Nomus: ${t.coveredByNomus}`);
  console.log(`Cobertos pelo IndusCost: ${t.coveredByInduscost}`);
  console.log(`Pendentes: ${t.pending} (legado candidato ${t.legacyPendingCandidates}, pós-cutover ${t.postCutoverPending})`);
  console.log(`Ambíguos: ${t.ambiguous}`);
  console.log(`Fora da janela legada: ${t.outsideWindow}`);
  console.log(`Recebimentos sem schedule ACTIVE: ${t.receiptsWithoutSchedule}`);
  if (receivableIds.length > 0) console.log(`Schedules ACTIVE sem recebimento: ${t.schedulesWithoutReceipt}`);
  console.log(`Riscos de duplicidade: ${t.duplicityRisks}`);
  if (report.legacyImportRowsNotCovered.length > 0) {
    console.log();
    console.log("Linhas do relatório Nomus sem cobertura (não associadas / ambíguas):");
    for (const item of report.legacyImportRowsNotCovered) {
      console.log(
        `  • ${item.reference} linha ${item.rowNumber} [${item.status}] CR ${item.cr ?? "—"} NF ${item.nf ?? "—"}: ${item.message}`
      );
    }
  }
  const received = report.rows.reduce((sum, row) => sum + row.receivedAmount, 0);
  console.log();
  console.log(`Valor recebido no escopo: ${fmtBrl(received)}`);
  console.log("Nada foi gravado.");
}

main()
  .catch((error) => {
    console.error("[audit-commission-coverage] falhou:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
