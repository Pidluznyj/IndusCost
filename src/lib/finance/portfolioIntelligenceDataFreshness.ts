/**
 * Frescor dos dados da Central de Inteligência (read-only).
 * Não dispara sync nem rebuild — só explica o que a run materializada contém.
 */

import type { PortfolioReconciliationFactApiRow } from "./portfolioReconciliationApi.js";
import type { PortfolioReconciliationRunMeta } from "./portfolioReconciliationApi.js";

export const PORTFOLIO_INTELLIGENCE_SYNC_REBUILD_NOTICE =
  "Valores de recebimento dependem da última sincronização do Contas a Receber e rebuild da conciliação.";

export const PORTFOLIO_INTELLIGENCE_FRESHNESS_LAYMAN =
  "Se o cliente pagou hoje ou ontem, o valor só aparece aqui após sincronizar o Contas a Receber e reconstruir a conciliação.";

export const PORTFOLIO_INTELLIGENCE_DATA_SOURCE =
  "Conciliação de Carteira materializada (run) + fatos Pedido × NF × Doc. × CR. Não é o Contas a Receber ao vivo.";

export type PortfolioIntelligenceDataFreshness = {
  runId: string;
  runCreatedAt: string | null;
  runUpdatedAt: string | null;
  runFinishedAt: string | null;
  /** true quando a run usada é a SUCCESS mais recente conhecida. */
  isLatestRun: boolean;
  latestRunId: string | null;
  /** Última data em settlementDatesJson / receivableSettlementDate nos fatos. */
  lastSettlementAt: string | null;
  /** Última evidência de CR (vencimento, settlement ou presença de título). */
  lastReceivableEvidenceAt: string | null;
  /** Última atualização do pedido (enrichment) ou evidência operacional nos fatos. */
  lastOrderOrFactUpdatedAt: string | null;
  receivedValue: number;
  openReceivableValue: number;
  hasReceivable: boolean;
  hasSettlementEvidence: boolean;
  sourceLabel: string;
  syncRebuildNotice: string;
  laymanNotice: string;
  warnings: string[];
};

function toIsoDateTime(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00.000Z`;
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) {
      if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
      return null;
    }
    return d.toISOString();
  }
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

function toIsoDateOnly(value: Date | string | null | undefined): string | null {
  const full = toIsoDateTime(value);
  return full ? full.slice(0, 10) : null;
}

function maxIso(dates: Array<string | null | undefined>): string | null {
  const sorted = dates.filter((d): d is string => Boolean(d)).sort();
  return sorted.length ? sorted[sorted.length - 1]! : null;
}

function toNumber(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value;
}

/**
 * Extrai datas de frescor a partir dos fatos materializados (sem inventar baixa).
 */
export function extractReceivableFreshnessFromFacts(
  facts: readonly PortfolioReconciliationFactApiRow[]
): {
  lastSettlementAt: string | null;
  lastReceivableEvidenceAt: string | null;
  lastOperationalEvidenceAt: string | null;
  receivedValue: number;
  openReceivableValue: number;
  receivableTotalValue: number;
  hasReceivable: boolean;
  hasSettlementEvidence: boolean;
} {
  const settlements: string[] = [];
  const dueDates: string[] = [];
  const operational: string[] = [];
  let receivedValue = 0;
  let openReceivableValue = 0;
  let receivableTotalValue = 0;
  let sawReceivableIds = false;

  for (const fact of facts) {
    if (Array.isArray(fact.settlementDatesJson)) {
      for (const s of fact.settlementDatesJson) {
        const iso = toIsoDateOnly(s as string | Date | null);
        if (iso) settlements.push(iso);
      }
    }
    if (Array.isArray(fact.dueDatesJson)) {
      for (const d of fact.dueDatesJson) {
        const iso = toIsoDateOnly(d as string | Date | null);
        if (iso) dueDates.push(iso);
      }
    }
    const nfeAt = toIsoDateOnly(fact.nfeProcessedAt);
    if (nfeAt) operational.push(nfeAt);
    const stockAt = toIsoDateOnly(fact.stockDocumentDate);
    if (stockAt) operational.push(stockAt);

    receivedValue = Math.max(receivedValue, toNumber(fact.receivedValue));
    openReceivableValue = Math.max(openReceivableValue, toNumber(fact.openReceivableValue));
    receivableTotalValue = Math.max(
      receivableTotalValue,
      toNumber(fact.receivableTotalValue)
    );
    if (
      Array.isArray(fact.receivableIdsJson) &&
      fact.receivableIdsJson.length > 0
    ) {
      sawReceivableIds = true;
    }
  }

  const lastSettlementAt = maxIso(settlements);
  const hasReceivable =
    sawReceivableIds ||
    receivableTotalValue > 0.01 ||
    receivedValue > 0.01 ||
    openReceivableValue > 0.01;
  const lastReceivableEvidenceAt = maxIso([
    lastSettlementAt,
    ...dueDates,
    hasReceivable ? lastSettlementAt : null,
  ]);

  return {
    lastSettlementAt,
    lastReceivableEvidenceAt: lastReceivableEvidenceAt ?? (hasReceivable ? maxIso(dueDates) : null),
    lastOperationalEvidenceAt: maxIso(operational),
    receivedValue,
    openReceivableValue,
    receivableTotalValue,
    hasReceivable,
    hasSettlementEvidence: lastSettlementAt != null && receivedValue > 0.01,
  };
}

export function buildPortfolioIntelligenceDataFreshness(args: {
  run: PortfolioReconciliationRunMeta;
  facts?: readonly PortfolioReconciliationFactApiRow[] | null;
  orderUpdatedAt?: Date | string | null;
  receivedValueOverride?: number | null;
  openReceivableValueOverride?: number | null;
  /** Id da SUCCESS mais recente (quando conhecido). */
  latestRunId?: string | null;
  /** list = aviso só de run/sync; order = avisos de baixa do pedido. */
  scope?: "list" | "order";
}): PortfolioIntelligenceDataFreshness {
  const scope = args.scope ?? "order";
  const fromFacts = extractReceivableFreshnessFromFacts(args.facts ?? []);
  const receivedValue =
    args.receivedValueOverride != null && Number.isFinite(args.receivedValueOverride)
      ? args.receivedValueOverride
      : fromFacts.receivedValue;
  const openReceivableValue =
    args.openReceivableValueOverride != null &&
    Number.isFinite(args.openReceivableValueOverride)
      ? args.openReceivableValueOverride
      : fromFacts.openReceivableValue;

  const runCreatedAt = toIsoDateTime(args.run.createdAt);
  const runUpdatedAt = toIsoDateTime(
    (args.run as { updatedAt?: Date | string | null }).updatedAt ??
      args.run.finishedAt ??
      args.run.createdAt
  );
  const runFinishedAt = toIsoDateTime(args.run.finishedAt);
  const latestRunId = args.latestRunId ?? args.run.id;
  const isLatestRun = latestRunId === args.run.id;

  const lastOrderOrFactUpdatedAt = maxIso([
    toIsoDateTime(args.orderUpdatedAt),
    toIsoDateOnly(args.orderUpdatedAt),
    fromFacts.lastOperationalEvidenceAt,
    fromFacts.lastReceivableEvidenceAt,
  ]);

  const warnings: string[] = [PORTFOLIO_INTELLIGENCE_SYNC_REBUILD_NOTICE];

  if (!isLatestRun) {
    warnings.push(
      "A run exibida não é a conciliação SUCCESS mais recente. Os valores podem estar desatualizados até você abrir a run mais nova ou reconstruir a conciliação."
    );
  }

  if (scope === "order") {
    if (
      fromFacts.hasReceivable &&
      receivedValue <= 0.01 &&
      openReceivableValue > 0.01 &&
      !fromFacts.lastSettlementAt
    ) {
      warnings.push(
        "Há Contas a Receber em aberto nesta materialização, mas nenhuma baixa/settlement aparece nos fatos desta run."
      );
    }

    if (!fromFacts.hasReceivable && receivedValue <= 0.01) {
      warnings.push(
        "Nenhuma baixa encontrada nos fatos desta run para este pedido."
      );
    }
  }

  return {
    runId: args.run.id,
    runCreatedAt,
    runUpdatedAt,
    runFinishedAt,
    isLatestRun,
    latestRunId,
    lastSettlementAt: fromFacts.lastSettlementAt,
    lastReceivableEvidenceAt: fromFacts.lastReceivableEvidenceAt,
    lastOrderOrFactUpdatedAt,
    receivedValue,
    openReceivableValue,
    hasReceivable: fromFacts.hasReceivable || receivedValue > 0.01 || openReceivableValue > 0.01,
    hasSettlementEvidence: Boolean(
      fromFacts.lastSettlementAt && receivedValue > 0.01
    ),
    sourceLabel: PORTFOLIO_INTELLIGENCE_DATA_SOURCE,
    syncRebuildNotice: PORTFOLIO_INTELLIGENCE_SYNC_REBUILD_NOTICE,
    laymanNotice: PORTFOLIO_INTELLIGENCE_FRESHNESS_LAYMAN,
    warnings,
  };
}
