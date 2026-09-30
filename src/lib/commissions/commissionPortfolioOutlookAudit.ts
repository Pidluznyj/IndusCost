/**
 * Auditoria pura da Previsão de comissões, CR a CR (somente leitura).
 *
 * Compara a regra ANTIGA da tela — comissão atribuída − realizada pelos eventos
 * de recebimento, contando também schedules de versões substituídas do pedido —
 * com a regra NOVA: só a versão vigente do pedido, um schedule por título e
 * comissão futura proporcional ao saldo em aberto do título na origem.
 *
 * Não grava nada. É usada por scripts/auditCommissionOutlookOpenBalance.ts.
 */
import { roundMoney } from "./commission-money.shared.js";
import {
  buildCommissionPortfolioOutlook,
  projectCommissionPortfolioOutlookLines,
  type OutlookCards,
  type OutlookLine,
  type OutlookScheduleInput,
  type OutlookTitleFacts,
} from "./commissionPortfolioOutlook.js";

export type OutlookAuditRow = {
  fact: OutlookScheduleInput;
  title: OutlookTitleFacts | null;
  /** Linha pela regra nova. */
  line: OutlookLine;
  legacyAllocated: number;
  legacyRealized: number;
  /** Previsão da regra antiga para o título, sem filtro de período. */
  legacyForecast: number;
  receiptsSum: number;
  /** (original − saldo) − eventos recebidos. Positivo = o título baixou mais do que os eventos mostram. */
  receiptGap: number | null;
  /** O vencimento cai no período consultado (só estes entram nos totais da tela). */
  inPeriod: boolean;
  /** Previsão antiga − previsão nova, dentro do período. */
  difference: number;
  classification: string;
};

export type OutlookAudit = {
  rows: OutlookAuditRow[];
  legacyForecastTotal: number;
  newForecastTotal: number;
  difference: number;
  byCause: Array<{ cause: string; count: number; difference: number }>;
  bySeller: Array<{ seller: string; legacy: number; next: number }>;
  /** Os universos pela regra nova, com o mesmo cálculo da tela. */
  cards: OutlookCards;
  /** Informativo: comissão futura de títulos em aberto vencidos antes do início do período. */
  forecastBeforePeriod: number;
};

function monthInRange(month: string | null, from: string | null, to: string | null): boolean {
  if (!month) return false;
  if (from && month < from) return false;
  if (to && month > to) return false;
  return true;
}

/** Regra ANTIGA da tela, reproduzida só para medir a diferença. */
function legacyProjection(fact: OutlookScheduleInput, title: OutlookTitleFacts | null) {
  const excluded = ["CUSTOMER_EXCLUDED", "SUPERSEDED", "STALE", "ORPHAN", "CANCELLED"].includes(fact.scheduleStatus);
  const sellerMissing =
    !excluded &&
    (fact.sellerResolutionStatus === "NO_SELLER" ||
      fact.sellerResolutionStatus === "SELLER_UNRESOLVED" ||
      (fact.canonicalSellerId == null && fact.rawSellerId == null));
  const allocated = excluded || sellerMissing ? 0 : roundMoney(Math.max(0, fact.allocatedCommission));
  const nominal = roundMoney(Math.max(0, fact.nominalAmount));
  const seen = new Set<number>();
  let receiptsSum = 0;
  for (const receipt of fact.receipts) {
    if (seen.has(receipt.externalId)) continue;
    seen.add(receipt.externalId);
    receiptsSum = roundMoney(receiptsSum + Math.max(0, receipt.receivedAmount));
  }
  const settledWithoutReceipt = seen.size === 0 && title?.balanceRaw === 0 && roundMoney(title?.amountReceived ?? 0) > 0;
  const eligible = Math.min(receiptsSum, nominal);
  const realized =
    settledWithoutReceipt || nominal <= 0 ? 0 : roundMoney(Math.min(allocated, (allocated * eligible) / nominal));
  const forecast = settledWithoutReceipt ? 0 : roundMoney(Math.max(0, allocated - realized));
  return { allocated, realized, forecast, receiptsSum };
}

function classify(
  fact: OutlookScheduleInput,
  line: OutlookLine,
  title: OutlookTitleFacts | null,
  receiptsSum: number,
  titleDifference: number
): string {
  if (fact.orderSnapshotStatus !== "ACTIVE") return "duplicidade: schedule de versão substituída do pedido";
  if (line.inconsistency?.includes("mais de um schedule")) return "duplicidade: mais de um schedule vigente no título";
  if (fact.scheduleStatus === "CUSTOMER_EXCLUDED") return "excluído (cliente sem comissão)";
  if (fact.groupCompany) return "excluído: empresa do grupo";
  if (fact.customerExcludedByActiveRule) return "excluído: regra ativa em Exceções por cliente (schedule anterior à regra)";
  if (["SUPERSEDED", "STALE", "ORPHAN", "CANCELLED"].includes(fact.scheduleStatus)) return "schedule stale";
  if (fact.titleCancelled) return "título cancelado na origem";
  if (fact.titleSuspended) return "título com cobrança suspensa";
  if (line.status === "SEM_VENDEDOR") return "sem vendedor";
  if (!title) return "título sem registro em NomusAccountsReceivable";
  if (title.balance == null) return "título removido na origem (ausência confirmada)";
  if (line.status === "INCONSISTENCIA_SEM_RECEBIMENTO") return "título baixado sem receipt";
  if (titleDifference > 0.01 && (line.openPrincipal ?? 0) <= 0) {
    return "provável inflação: título quitado com eventos < original (desconto ou falta de receipt)";
  }
  if (titleDifference > 0.01) {
    return "provável inflação: saldo menor que o implícito pelos eventos (provável falta de receipt)";
  }
  const settledByTitle = roundMoney((title.amountReceivable ?? fact.nominalAmount) - (title.balance ?? 0));
  if (receiptsSum > settledByTitle + 0.01) {
    return "saldo divergente: eventos recebidos > baixa do título (juros ou saldo defasado)";
  }
  return "OK";
}

/**
 * `facts` deve incluir os schedules de versões substituídas
 * (loadCommissionPortfolioOutlookFacts com includeSupersededSnapshots), porque a
 * regra antiga os contava.
 */
export function auditCommissionPortfolioOutlook(
  facts: readonly OutlookScheduleInput[],
  titles: ReadonlyMap<number, OutlookTitleFacts>,
  options: { fromMonth: string | null; toMonth: string | null; today: string }
): OutlookAudit {
  const { fromMonth, toMonth, today } = options;
  const newLines = new Map(projectCommissionPortfolioOutlookLines(facts, today).map((line) => [line.scheduleId, line]));

  const rows: OutlookAuditRow[] = facts.map((fact) => {
    const title = titles.get(fact.receivableId) ?? null;
    const line = newLines.get(fact.scheduleId)!;
    const legacy = legacyProjection(fact, title);
    const inPeriod = monthInRange(fact.dueDate ? fact.dueDate.slice(0, 7) : null, fromMonth, toMonth);
    const titleDifference = roundMoney(legacy.forecast - line.forecastCommission);
    const settledByTitle = title ? roundMoney((title.amountReceivable ?? fact.nominalAmount) - (title.balanceRaw ?? 0)) : null;
    return {
      fact,
      title,
      line,
      legacyAllocated: legacy.allocated,
      legacyRealized: legacy.realized,
      legacyForecast: legacy.forecast,
      receiptsSum: legacy.receiptsSum,
      receiptGap: settledByTitle == null ? null : roundMoney(settledByTitle - legacy.receiptsSum),
      inPeriod,
      difference: inPeriod ? titleDifference : 0,
      classification: classify(fact, line, title, legacy.receiptsSum, titleDifference),
    };
  });

  const sum = (pick: (row: OutlookAuditRow) => number) => roundMoney(rows.reduce((total, row) => total + pick(row), 0));
  const legacyForecastTotal = sum((row) => (row.inPeriod ? row.legacyForecast : 0));
  const newForecastTotal = sum((row) => (row.inPeriod ? row.line.forecastCommission : 0));

  const causes = new Map<string, { count: number; difference: number }>();
  const sellers = new Map<string, { legacy: number; next: number }>();
  for (const row of rows) {
    if (Math.abs(row.difference) > 0.01) {
      const cause = causes.get(row.classification) ?? { count: 0, difference: 0 };
      cause.count += 1;
      cause.difference = roundMoney(cause.difference + row.difference);
      causes.set(row.classification, cause);
    }
    if (!row.inPeriod) continue;
    const name =
      row.fact.canonicalSellerName ?? (row.fact.rawSellerId != null ? `Nomus ${row.fact.rawSellerId}` : "sem vendedor");
    const seller = sellers.get(name) ?? { legacy: 0, next: 0 };
    seller.legacy = roundMoney(seller.legacy + row.legacyForecast);
    seller.next = roundMoney(seller.next + row.line.forecastCommission);
    sellers.set(name, seller);
  }

  const cards = buildCommissionPortfolioOutlook(
    facts,
    {
      fromMonth,
      toMonth,
      canonicalSellerId: null,
      customerId: null,
      orderCode: null,
      status: null,
      page: 1,
      pageSize: 1,
      ownNomusSellerId: null,
      sellerLocked: false,
    },
    today
  ).cards;

  return {
    rows,
    legacyForecastTotal,
    newForecastTotal,
    difference: roundMoney(legacyForecastTotal - newForecastTotal),
    byCause: [...causes].map(([cause, entry]) => ({ cause, ...entry })).sort((a, b) => b.difference - a.difference),
    bySeller: [...sellers].map(([seller, entry]) => ({ seller, ...entry })).sort((a, b) => b.legacy - a.legacy),
    cards,
    forecastBeforePeriod: sum((row) =>
      fromMonth && row.fact.dueDate && row.fact.dueDate.slice(0, 7) < fromMonth ? row.line.forecastCommission : 0
    ),
  };
}
