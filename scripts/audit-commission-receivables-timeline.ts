#!/usr/bin/env npx tsx
/**
 * Timeline anual/mensal — comissão a pagar por settlementDate + snapshot previsão (dueDate).
 *
 * Uso:
 *   npx tsx scripts/audit-commission-receivables-timeline.ts --from=2026-01 --to=2026-12
 *   npx tsx scripts/audit-commission-receivables-timeline.ts --from=2026-01 --to=2026-12 --json
 */
import "dotenv/config";
import { getCommissionMonthlyPayableSummary } from "../src/lib/commissions/commissionMonthlyPayable.server.ts";
import { aggregateReceivableForecastFromRows } from "../src/lib/commissions/commissionReceivableForecast.ts";
import { listForecastVisualAuditRows } from "../src/lib/commissions/commissionVisualAudit.server.ts";
import {
  buildCommissionReceivablesTimeline,
  enumerateMonthKeys,
  findTimelineMonth,
} from "../src/lib/commissions/commissionReceivablesTimeline.ts";
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
  const from = parseArg("from") ?? "2026-01";
  const to = parseArg("to") ?? "2026-12";
  const asJson = process.argv.includes("--json");
  const sellerId = parseArg("seller");

  const months = enumerateMonthKeys(from, to);
  const payableSummaries = [];

  for (const { year, month } of months) {
    const summary = await getCommissionMonthlyPayableSummary(
      { year, month, sellerId: sellerId ?? null },
      GLOBAL_SCOPE
    );
    payableSummaries.push(summary);
  }

  const forecastRows = await listForecastVisualAuditRows(
    {
      commissionPersonId: sellerId ?? null,
      customer: null,
      orderCode: null,
      nfeNumber: null,
      nomusReceivableId: null,
      receivableTitleStatus: null,
      commissionStatus: null,
      dueDateFrom: null,
      dueDateTo: null,
      onlyDivergences: false,
    },
    GLOBAL_SCOPE
  );
  const forecast = aggregateReceivableForecastFromRows(forecastRows, {
    commissionPersonId: sellerId ?? null,
  });

  const timeline = buildCommissionReceivablesTimeline({
    fromMonthKey: from,
    toMonthKey: to,
    payableSummaries,
    forecast,
  });

  if (asJson) {
    console.log(JSON.stringify(timeline, null, 2));
    return;
  }

  console.log("=== Timeline Comissões — Pagamento (settlementDate) + Previsão (dueDate) ===");
  console.log(`Período pagamento: ${from} a ${to}`);
  console.log(`Total comissão a pagar no período: ${fmtBrl(timeline.payableYearTotal)}`);
  console.log(`Total base rateada no período: ${fmtBrl(timeline.payableYearBase)}`);
  console.log("");

  console.log("--- Comissão a pagar por mês ---");
  for (const row of timeline.payableByMonth) {
    console.log(
      `${row.monthLabelPt}: ${fmtBrl(row.payableCommissionTotal)} | ` +
        `base ${fmtBrl(row.allocatedBaseAmountTotal)} | ` +
        `${row.uniqueReceivablesCount} CR | ${row.uniqueSellersCount} vendedor(es)`
    );
  }

  const june = findTimelineMonth(timeline, 2026, 6);
  if (june) {
    console.log("");
    console.log(`Comissão a pagar em Junho/2026: ${fmtBrl(june.payableCommissionTotal)}`);
    if (june.sellers.length > 0) {
      console.log("--- Por vendedor (jun/2026) ---");
      for (const s of june.sellers) {
        console.log(`${s.sellerName}: ${fmtBrl(s.payableCommission)} (${s.titlesCount} título(s))`);
      }
    }
  }

  if (timeline.forecastSnapshot) {
    console.log("");
    console.log("--- Previsão (títulos em aberto, dueDate) ---");
    console.log(
      `Comissão prevista futura: ${fmtBrl(timeline.forecastSnapshot.futureCommissionTotal)}`
    );
    console.log(
      `Comissão vencida pendente: ${fmtBrl(timeline.forecastSnapshot.overdueCommissionTotal)}`
    );
    console.log(`Títulos em aberto: ${timeline.forecastSnapshot.titleCount}`);
    console.log(`Buckets mensais: ${timeline.forecastSnapshot.monthlyBuckets}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
