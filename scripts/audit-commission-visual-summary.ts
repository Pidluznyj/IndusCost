#!/usr/bin/env npx tsx
/**
 * Auditoria dos cards da Comissões > Auditoria Visual por CR.
 *
 * Uso:
 *   npx tsx scripts/audit-commission-visual-summary.ts --year=2026 --month=6 --mode=payable
 *   npx tsx scripts/audit-commission-visual-summary.ts --year=2026 --month=6 --mode=generated --json
 *   npx tsx scripts/audit-commission-visual-summary.ts --year=2026 --month=6 --mode=payable --nomus-base=808107.32 --nomus-commission=20926.56
 */
import "dotenv/config";
import { listCommissionVisualAuditPage } from "../src/lib/commissions/commissionVisualAudit.server.ts";
import { parseCommissionVisualAuditQuery } from "../src/lib/commissions/commissionQuery.ts";
import type { CommissionAccessScope } from "../src/lib/commissions/commissionAccessScope.ts";
import { fmtBrl, parseArg, requireDatabaseUrl } from "./commission-script-utils.ts";

const GLOBAL_SCOPE: CommissionAccessScope = {
  dataScope: "global",
  sellerLocked: false,
  nomusSellerId: null,
  sellerResponsibleName: null,
  blockedReason: null,
  blockedMessage: null,
};

async function main(): Promise<void> {
  requireDatabaseUrl();

  const year = Number.parseInt(parseArg("year") ?? String(new Date().getFullYear()), 10);
  const month = Number.parseInt(parseArg("month") ?? String(new Date().getMonth() + 1), 10);
  const mode = parseArg("mode") ?? "generated";
  const seller = parseArg("seller");
  const nomusBaseRaw = parseArg("nomus-base");
  const nomusCommissionRaw = parseArg("nomus-commission");
  const asJson = process.argv.includes("--json");

  const query = parseCommissionVisualAuditQuery({
    year,
    month,
    appraisalMode: mode,
    page: 1,
    pageSize: 100000,
    nomusReferenceBase: nomusBaseRaw,
    nomusReferenceCommission: nomusCommissionRaw,
    commissionPersonId: seller,
  });

  const payload = await listCommissionVisualAuditPage(query, GLOBAL_SCOPE);
  const { cards, rows, nomusReference } = payload;

  const output = {
    mode: cards.appraisalMode,
    year,
    month,
    lineCount: rows.length,
    uniqueDocuments: cards.documentCount,
    uniqueReceivables: cards.receivableCount,
    uniqueSchedules: cards.scheduleCount,
    documentAmountTotal: cards.documentAmountTotal,
    receivableAmountTotal: cards.receivableAmountTotal,
    receivedAmountTotal: cards.receivedAmountTotal,
    commissionableBaseTotal: cards.commissionableBaseTotal,
    commissionExpectedTotal: cards.commissionExpectedTotal,
    commissionReleasedTotal: cards.commissionReleasedTotal,
    commissionPendingTotal: cards.commissionPendingTotal,
    averageRatePercent: cards.averageRatePercent,
    nomusReference,
  };

  if (asJson) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log("=== Auditoria Visual de Comissões ===");
  console.log(`Período: ${month}/${year} | Modo: ${cards.appraisalMode}`);
  console.log(`Linhas: ${rows.length}`);
  console.log(`NFs únicas: ${cards.documentCount} | CRs únicos: ${cards.receivableCount} | Parcelas: ${cards.scheduleCount}`);
  console.log(`Valor NF único: ${fmtBrl(cards.documentAmountTotal)}`);
  console.log(`Valor CR único: ${fmtBrl(cards.receivableAmountTotal)}`);
  console.log(`Valor recebido: ${fmtBrl(cards.receivedAmountTotal)}`);
  console.log(`Base rateada: ${fmtBrl(cards.commissionableBaseTotal)}`);
  console.log(`Comissão prevista: ${fmtBrl(cards.commissionExpectedTotal)}`);
  console.log(`Comissão liberada: ${fmtBrl(cards.commissionReleasedTotal)}`);
  console.log(`Comissão pendente: ${fmtBrl(cards.commissionPendingTotal)}`);
  console.log(`% médio: ${cards.averageRatePercent.toFixed(4)}%`);

  if (nomusReference.base != null || nomusReference.commission != null) {
    console.log("\n--- Comparação Nomus ---");
    console.log(`Comparável: ${nomusReference.comparable ? "sim (modo a pagar)" : "não"}`);
    if (nomusReference.baseDiff != null) {
      console.log(`Diferença base: ${fmtBrl(nomusReference.baseDiff)}`);
    }
    if (nomusReference.commissionDiff != null) {
      console.log(`Diferença comissão: ${fmtBrl(nomusReference.commissionDiff)}`);
    }
    if (nomusReference.nomusAverageRatePercent != null) {
      console.log(`% médio Nomus: ${nomusReference.nomusAverageRatePercent.toFixed(4)}%`);
    }
    console.log(`% médio IndusCost: ${nomusReference.indusAverageRatePercent.toFixed(4)}%`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
