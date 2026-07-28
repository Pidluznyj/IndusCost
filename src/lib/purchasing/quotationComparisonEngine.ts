/**
 * Comparação de fornecedores / negociações (OP-18) — puro, sem Prisma.
 * Não escolhe vencedor automaticamente pelo menor preço.
 */

import type { NegotiationSavingsResult } from "./negotiationSavingsEngine.js";

export type ComparisonAlertCode =
  | "CURRENCY_MISMATCH"
  | "INCOTERM_MIX"
  | "NO_NEGOTIATED_ROUND"
  | "QTY_MISMATCH"
  | "MISSING_VALIDITY"
  | "INCOMPLETE_OFFER"
  | "COST_INCREASED"
  | "NOT_COMPARABLE_BASE";

export type ComparisonAlert = {
  code: ComparisonAlertCode;
  severity: "info" | "warning" | "error";
  message: string;
};

export type SupplierComparisonInput = {
  offerId: string;
  supplierId: string;
  supplierName: string;
  supplierDocument: string | null;
  offerStatus: string;
  currency: string;
  initialUnitPriceAvg: number | null;
  negotiatedUnitPriceAvg: number | null;
  initialComparableCost: number | null;
  negotiatedComparableCost: number | null;
  totalGain: number | null;
  percentGain: number | null;
  freightValue: number | null;
  freightIncoterm: string | null;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  minOrderQty: number | null;
  validityDate: string | null;
  quantityOffered: number | null;
  quantityDemanded: number | null;
  evidenceCount: number;
  hasNegotiatedRound: boolean;
  isWinner: boolean;
};

export type SupplierComparisonRow = SupplierComparisonInput & {
  alerts: ComparisonAlert[];
  comparable: boolean;
};

export type ComparisonSummaryCards = {
  initialTotal: number | null;
  negotiatedTotal: number | null;
  gainedTotal: number | null;
  currency: string | null;
  comparableOfferCount: number;
  incomparableOfferCount: number;
};

export type RoundTimelineEntry = {
  roundId: string;
  roundNumber: number;
  status: string;
  openedAt: string;
  closedAt: string | null;
  responsibleUserName: string | null;
  buyerReport: string | null;
  lineCount: number;
};

export function assertHumanWinnerSelection(input: {
  selectionJustification: string | null | undefined;
  autoPickByLowestPrice?: boolean;
}): string {
  if (input.autoPickByLowestPrice) {
    throw new Error("AUTO_PICK_FORBIDDEN: escolha de vencedor deve ser humana e justificada.");
  }
  const text = String(input.selectionJustification ?? "").trim();
  if (text.length < 10) {
    throw new Error(
      "JUSTIFICATION_REQUIRED: registre justificativa humana da escolha (mín. 10 caracteres)."
    );
  }
  return text;
}

export function buildOfferAlerts(row: SupplierComparisonInput, baseCurrency: string | null): ComparisonAlert[] {
  const alerts: ComparisonAlert[] = [];

  if (!row.currency || (baseCurrency && row.currency.toUpperCase() !== baseCurrency.toUpperCase())) {
    alerts.push({
      code: "CURRENCY_MISMATCH",
      severity: "error",
      message: `Moeda ${row.currency || "—"} incompatível com a base ${baseCurrency || "—"}.`,
    });
  }
  if (!row.hasNegotiatedRound) {
    alerts.push({
      code: "NO_NEGOTIATED_ROUND",
      severity: "warning",
      message: "Sem rodada negociada — custo final = inicial.",
    });
  }
  if (
    row.quantityDemanded != null &&
    row.quantityOffered != null &&
    Math.abs(row.quantityDemanded - row.quantityOffered) > 1e-6
  ) {
    alerts.push({
      code: "QTY_MISMATCH",
      severity: "warning",
      message: `Quantidade ofertada (${row.quantityOffered}) ≠ demanda (${row.quantityDemanded}).`,
    });
  }
  if (!row.validityDate) {
    alerts.push({
      code: "MISSING_VALIDITY",
      severity: "info",
      message: "Validade da proposta não informada.",
    });
  }
  if (row.initialUnitPriceAvg == null || row.initialComparableCost == null) {
    alerts.push({
      code: "INCOMPLETE_OFFER",
      severity: "error",
      message: "Oferta incompleta para comparação.",
    });
  }
  if (row.totalGain != null && row.totalGain < -1e-9) {
    alerts.push({
      code: "COST_INCREASED",
      severity: "warning",
      message: "Custo negociado maior que o inicial.",
    });
  }
  return alerts;
}

export function markIncomparability(
  rows: SupplierComparisonInput[],
  opts?: { preferredCurrency?: string | null }
): SupplierComparisonRow[] {
  const currencies = [
    ...new Set(rows.map((r) => (r.currency || "").toUpperCase()).filter(Boolean)),
  ];
  const baseCurrency =
    opts?.preferredCurrency?.toUpperCase() ||
    (currencies.length === 1 ? currencies[0] : null);

  const incoterms = [
    ...new Set(rows.map((r) => (r.freightIncoterm || "FOB").toUpperCase()).filter(Boolean)),
  ];
  const mixedIncoterm = incoterms.length > 1;

  return rows.map((row) => {
    const alerts = buildOfferAlerts(row, baseCurrency);
    if (mixedIncoterm) {
      alerts.push({
        code: "INCOTERM_MIX",
        severity: "warning",
        message: `Incoterms mistos na comparação (${incoterms.join(", ")}).`,
      });
    }
    if (!baseCurrency && currencies.length > 1) {
      alerts.push({
        code: "NOT_COMPARABLE_BASE",
        severity: "error",
        message: "Sem moeda base única — linhas não entram no total dos cards.",
      });
    }
    const hasBlocking = alerts.some(
      (a) =>
        a.code === "CURRENCY_MISMATCH" ||
        a.code === "INCOMPLETE_OFFER" ||
        a.code === "NOT_COMPARABLE_BASE"
    );
    return {
      ...row,
      alerts,
      comparable: !hasBlocking,
    };
  });
}

export function buildComparisonSummaryCards(
  rows: SupplierComparisonRow[],
  baseCurrency: string | null
): ComparisonSummaryCards {
  const comparable = rows.filter((r) => r.comparable);
  if (comparable.length === 0) {
    return {
      initialTotal: null,
      negotiatedTotal: null,
      gainedTotal: null,
      currency: baseCurrency,
      comparableOfferCount: 0,
      incomparableOfferCount: rows.length,
    };
  }
  const initialTotal = comparable.reduce((s, r) => s + (r.initialComparableCost ?? 0), 0);
  const negotiatedTotal = comparable.reduce((s, r) => s + (r.negotiatedComparableCost ?? 0), 0);
  return {
    initialTotal,
    negotiatedTotal,
    gainedTotal: initialTotal - negotiatedTotal,
    currency: baseCurrency || comparable[0]?.currency || null,
    comparableOfferCount: comparable.length,
    incomparableOfferCount: rows.length - comparable.length,
  };
}

/** Não usar para auto-seleção — apenas ranking informativo. */
export function rankByNegotiatedCostInformative(rows: SupplierComparisonRow[]): string[] {
  return [...rows]
    .filter((r) => r.comparable && r.negotiatedComparableCost != null)
    .sort((a, b) => (a.negotiatedComparableCost ?? 0) - (b.negotiatedComparableCost ?? 0))
    .map((r) => r.offerId);
}

export function filterComparisonRows(
  rows: SupplierComparisonRow[],
  filter: {
    q?: string;
    status?: string;
    onlyComparable?: boolean;
    onlyWithEvidence?: boolean;
  }
): SupplierComparisonRow[] {
  const q = (filter.q ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (filter.onlyComparable && !r.comparable) return false;
    if (filter.onlyWithEvidence && r.evidenceCount <= 0) return false;
    if (filter.status && r.offerStatus !== filter.status) return false;
    if (!q) return true;
    const hay = `${r.supplierName} ${r.supplierDocument ?? ""} ${r.paymentTerms ?? ""}`.toLowerCase();
    return hay.includes(q);
  });
}

export function avgUnitPriceFromSavings(savings: NegotiationSavingsResult | null): number | null {
  if (!savings || savings.totalQuantity <= 0) return null;
  return savings.itemsSubtotalNegotiated / savings.totalQuantity;
}
