/**
 * Status Logístico BI — reprodução da medida DAX do Power BI.
 *
 * ```DAX
 * (C) Status Logístico =
 * VAR DataPlanejada = 'PedidosVenda'[dataEntregaPadrao]
 * VAR DataReal = 'PedidosVenda'[nfes.dataProcessamento]
 * VAR StatusItem = VALUE('PedidosVenda'[itensPedido.status])
 * RETURN
 * IF(NOT(ISBLANK(DataReal)),
 *   IF(DataReal <= DataPlanejada, "Entregue no Prazo", "Entregue com Atraso"),
 *   IF(StatusItem IN {1, 2, 3},
 *     IF(DataPlanejada < TODAY(), "Atrasado (Pendente)", "No Prazo (Pendente)"),
 *     "Finalizado/Cancelado"))
 * ```
 *
 * Consolidação no nível do pedido (Gestão de Pedidos):
 * 1. NF processada → classifica por DataReal vs DataPlanejada do pedido.
 * 2. Sem NF + ao menos um item com status numérico ∈ {1,2,3} → pendente por prazo.
 * 3. Sem NF + nenhum item ∈ {1,2,3} (numérico) → Finalizado/Cancelado.
 * 4. Dados insuficientes/conflitantes → Revisar dados.
 */
import {
  diffCalendarDays,
  extractNomusRawItems,
  extractNomusRawNfes,
  parseNomusBrOrIsoDate,
  startOfLocalDay,
} from "./salesOrderNomusRaw.js";
import type { SalesOrderLinkedNfeContext } from "./salesOrderLinkedNfe.js";

/** Códigos pendentes da fórmula BI: VALUE(status) IN {1, 2, 3}. */
export const NOMUS_PENDING_ITEM_STATUS_CODES = new Set<number>([1, 2, 3]);

/** Evidência em produção: código 6 = Cancelado (PD 02130). */
export const NOMUS_CANCELLED_ITEM_STATUS_CODES = new Set<number>([6]);

export type SalesOrderBiLogisticStatusLabel =
  | "Entregue no Prazo"
  | "Entregue com Atraso"
  | "Atrasado (Pendente)"
  | "No Prazo (Pendente)"
  | "Finalizado/Cancelado"
  | "Revisar dados";

export const BI_LOGISTIC_STATUS_CARD_IDS = [
  "deliveredOnTime",
  "deliveredLate",
  "overduePending",
  "onTimePending",
  "finishedOrCancelled",
  "reviewData",
] as const;

export type BiLogisticStatusCardId = (typeof BI_LOGISTIC_STATUS_CARD_IDS)[number];

export const BI_LOGISTIC_STATUS_CARDS: Array<{
  id: BiLogisticStatusCardId;
  label: SalesOrderBiLogisticStatusLabel;
  hint: string;
}> = [
  {
    id: "deliveredOnTime",
    label: "Entregue no Prazo",
    hint: "NF processada até a data planejada de entrega (DataReal ≤ DataPlanejada).",
  },
  {
    id: "deliveredLate",
    label: "Entregue com Atraso",
    hint: "NF processada após a data planejada de entrega (DataReal > DataPlanejada).",
  },
  {
    id: "overduePending",
    label: "Atrasado (Pendente)",
    hint: "Sem NF processada; item com status 1/2/3 e data planejada anterior a hoje.",
  },
  {
    id: "onTimePending",
    label: "No Prazo (Pendente)",
    hint: "Sem NF processada; item com status 1/2/3 e data planejada igual ou posterior a hoje.",
  },
  {
    id: "finishedOrCancelled",
    label: "Finalizado/Cancelado",
    hint: "Sem NF processada e nenhum item com status numérico 1, 2 ou 3.",
  },
  {
    id: "reviewData",
    label: "Revisar dados",
    hint: "Dados insuficientes ou ambíguos para aplicar a regra BI com segurança.",
  },
];

const LABEL_TO_CARD_ID: Record<SalesOrderBiLogisticStatusLabel, BiLogisticStatusCardId> = {
  "Entregue no Prazo": "deliveredOnTime",
  "Entregue com Atraso": "deliveredLate",
  "Atrasado (Pendente)": "overduePending",
  "No Prazo (Pendente)": "onTimePending",
  "Finalizado/Cancelado": "finishedOrCancelled",
  "Revisar dados": "reviewData",
};

export type SalesOrderLogisticStatusResult = {
  label: SalesOrderBiLogisticStatusLabel;
  cardId: BiLogisticStatusCardId;
  source: "power_bi_dax";
  ruleExplanation: string;
  evidence: {
    plannedDeliveryDate: string | null;
    invoiceProcessingDate: string | null;
    itemStatusCodes: string[];
    hasPendingItem: boolean;
    summary: string;
  };
};

/** @deprecated Use SalesOrderBiLogisticStatusLabel */
export type SalesOrderLogisticStatusLabel = SalesOrderBiLogisticStatusLabel;

function parseItemStatusCode(status: unknown): number | null {
  if (typeof status === "number" && Number.isFinite(status)) return Math.trunc(status);
  if (typeof status === "string" && /^\d+$/.test(status.trim())) {
    return Number.parseInt(status.trim(), 10);
  }
  return null;
}

function collectItemStatusCodes(nomusRawResponse: unknown): string[] {
  const items = extractNomusRawItems(nomusRawResponse);
  const codes = new Set<string>();
  for (const item of items) {
    const code = parseItemStatusCode(item.status);
    if (code != null) codes.add(String(code));
    else if (item.status != null && String(item.status).trim()) {
      codes.add(String(item.status).trim());
    }
  }
  return [...codes];
}

function resolveInvoiceProcessingDates(input: {
  linkedNfeContext?: SalesOrderLinkedNfeContext | null;
  nomusRawResponse?: unknown;
}): { first: Date | null; last: Date | null; hasNfe: boolean; isFullyInvoiced: boolean; isPartiallyInvoiced: boolean } {
  const linked = input.linkedNfeContext;
  if (linked && linked.source === "linked") {
    return {
      first: linked.firstNfeProcessingDate,
      last: linked.lastNfeProcessingDate,
      hasNfe: linked.hasNfe,
      isFullyInvoiced: linked.isFullyInvoiced,
      isPartiallyInvoiced: linked.isPartiallyInvoiced,
    };
  }
  if (linked) {
    return {
      first: linked.firstNfeProcessingDate,
      last: linked.lastNfeProcessingDate ?? linked.firstNfeProcessingDate,
      hasNfe: linked.hasNfe,
      isFullyInvoiced: linked.isFullyInvoiced,
      isPartiallyInvoiced: linked.isPartiallyInvoiced,
    };
  }
  const nfes = extractNomusRawNfes(input.nomusRawResponse);
  const dates: Date[] = [];
  for (const nfe of nfes) {
    const d = parseNomusBrOrIsoDate(nfe.dataProcessamento);
    if (d) dates.push(d);
  }
  dates.sort((a, b) => a.getTime() - b.getTime());
  return {
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
    hasNfe: dates.length > 0,
    isFullyInvoiced: dates.length > 0,
    isPartiallyInvoiced: false,
  };
}

function resolveFirstInvoiceProcessingDate(nomusRawResponse: unknown): Date | null {
  const nfes = extractNomusRawNfes(nomusRawResponse);
  const dates: Date[] = [];
  for (const nfe of nfes) {
    const d = parseNomusBrOrIsoDate(nfe.dataProcessamento);
    if (d) dates.push(d);
  }
  dates.sort((a, b) => a.getTime() - b.getTime());
  return dates[0] ?? null;
}

function resolvePlannedDeliveryDate(input: {
  expectedDeliveryDate?: Date | string | null;
  nomusRawResponse?: unknown;
}): Date | null {
  if (input.expectedDeliveryDate != null) {
    const parsed =
      input.expectedDeliveryDate instanceof Date
        ? input.expectedDeliveryDate
        : parseNomusBrOrIsoDate(input.expectedDeliveryDate);
    if (parsed) return startOfLocalDay(parsed);
  }
  const raw = input.nomusRawResponse;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of [
      "dataEntregaPadrao",
      "dataEntrega",
      "dataEntregaPrevista",
      "dataPrevisaoEntrega",
      "expectedDeliveryDate",
    ]) {
      const d = parseNomusBrOrIsoDate(obj[key]);
      if (d) return startOfLocalDay(d);
    }
  }
  return null;
}

function formatYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatBr(d: Date): string {
  return d.toLocaleDateString("pt-BR");
}

type ItemStatusAnalysis = {
  hasPendingNumeric: boolean;
  hasNonNumericOrMissing: boolean;
  hasNumericOutsidePending: boolean;
  itemStatusCodes: string[];
};

function analyzeItemStatuses(nomusRawResponse: unknown): ItemStatusAnalysis {
  const rawItems = extractNomusRawItems(nomusRawResponse);
  const itemStatusCodes = collectItemStatusCodes(nomusRawResponse);
  let hasPendingNumeric = false;
  let hasNonNumericOrMissing = false;
  let hasNumericOutsidePending = false;

  if (rawItems.length === 0) {
    return {
      hasPendingNumeric: false,
      hasNonNumericOrMissing: true,
      hasNumericOutsidePending: false,
      itemStatusCodes,
    };
  }

  for (const item of rawItems) {
    const code = parseItemStatusCode(item.status);
    if (code == null) {
      hasNonNumericOrMissing = true;
      continue;
    }
    if (NOMUS_PENDING_ITEM_STATUS_CODES.has(code)) {
      hasPendingNumeric = true;
    } else {
      hasNumericOutsidePending = true;
    }
  }

  return {
    hasPendingNumeric,
    hasNonNumericOrMissing,
    hasNumericOutsidePending,
    itemStatusCodes,
  };
}

function buildReviewResult(
  evidence: Omit<SalesOrderLogisticStatusResult["evidence"], "summary">,
  summary: string,
  ruleExplanation: string
): SalesOrderLogisticStatusResult {
  return {
    label: "Revisar dados",
    cardId: "reviewData",
    source: "power_bi_dax",
    ruleExplanation,
    evidence: { ...evidence, summary },
  };
}

/**
 * Reproduz a medida DAX do Power BI no nível do pedido.
 */
export function buildSalesOrderBiLogisticStatus(input: {
  expectedDeliveryDate?: Date | string | null;
  nomusRawResponse?: unknown;
  referenceDate?: Date;
  linkedNfeContext?: SalesOrderLinkedNfeContext | null;
  totalNetValue?: number | null;
}): SalesOrderLogisticStatusResult {
  const referenceDate = startOfLocalDay(input.referenceDate ?? new Date());
  const plannedDate = resolvePlannedDeliveryDate(input);
  const invoiceMeta = resolveInvoiceProcessingDates(input);
  const linked = input.linkedNfeContext;
  const itemAnalysis = analyzeItemStatuses(input.nomusRawResponse ?? null);

  if (linked?.needsDataReview && (!plannedDate || linked.reviewReasons.some((r) => r.includes("Valor líquido")))) {
    return buildReviewResult(
      {
        plannedDeliveryDate: plannedDate ? formatYmd(plannedDate) : null,
        invoiceProcessingDate: invoiceMeta.last ? formatYmd(invoiceMeta.last) : null,
        itemStatusCodes: itemAnalysis.itemStatusCodes,
        hasPendingItem: itemAnalysis.hasPendingNumeric,
      },
      linked.reviewReasons.join(" "),
      linked.reviewReasons.join(" ")
    );
  }

  const invoiceDate =
    invoiceMeta.isFullyInvoiced && invoiceMeta.last
      ? invoiceMeta.last
      : invoiceMeta.isFullyInvoiced
        ? invoiceMeta.first
        : invoiceMeta.hasNfe && !invoiceMeta.isPartiallyInvoiced
          ? invoiceMeta.first
          : null;

  const baseEvidence = {
    plannedDeliveryDate: plannedDate ? formatYmd(plannedDate) : null,
    invoiceProcessingDate: invoiceDate ? formatYmd(invoiceDate) : null,
    itemStatusCodes: itemAnalysis.itemStatusCodes,
    hasPendingItem: itemAnalysis.hasPendingNumeric,
  };

  if (invoiceDate) {
    if (!plannedDate) {
      return buildReviewResult(
        baseEvidence,
        "NF processada, mas data planejada ausente para comparar com a regra BI.",
        "Não há DataPlanejada (dataEntregaPadrao) para comparar com a NF processada."
      );
    }
    const onTime = diffCalendarDays(invoiceDate, plannedDate) >= 0;
    if (onTime) {
      return {
        label: "Entregue no Prazo",
        cardId: "deliveredOnTime",
        source: "power_bi_dax",
        ruleExplanation: `NF processada em ${formatBr(invoiceDate)} e entrega planejada para ${formatBr(plannedDate)}. Como DataReal ≤ DataPlanejada, o pedido foi classificado como Entregue no Prazo.`,
        evidence: {
          ...baseEvidence,
          summary: `NF em ${formatBr(invoiceDate)}; planejado ${formatBr(plannedDate)}.`,
        },
      };
    }
    return {
      label: "Entregue com Atraso",
      cardId: "deliveredLate",
      source: "power_bi_dax",
      ruleExplanation: `NF processada em ${formatBr(invoiceDate)} e entrega planejada para ${formatBr(plannedDate)}. Como DataReal > DataPlanejada, o pedido foi classificado como Entregue com Atraso.`,
      evidence: {
        ...baseEvidence,
        summary: `NF em ${formatBr(invoiceDate)} após planejado ${formatBr(plannedDate)}.`,
      },
    };
  }

  if (!plannedDate) {
    return buildReviewResult(
      baseEvidence,
      "Sem NF e sem data planejada para aplicar a regra pendente.",
      "Não há DataPlanejada (dataEntregaPadrao) nem NF processada."
    );
  }

  if (itemAnalysis.hasPendingNumeric) {
    const overdue = diffCalendarDays(referenceDate, plannedDate) < 0;
    if (overdue) {
      return {
        label: "Atrasado (Pendente)",
        cardId: "overduePending",
        source: "power_bi_dax",
        ruleExplanation:
          "Não há NF processada. Pelo menos um item está com status numérico 1, 2 ou 3 e a data planejada é anterior a hoje.",
        evidence: {
          ...baseEvidence,
          summary: `Sem NF; item(s) 1/2/3; planejado ${formatBr(plannedDate)} vencido.`,
        },
      };
    }
    return {
      label: "No Prazo (Pendente)",
      cardId: "onTimePending",
      source: "power_bi_dax",
      ruleExplanation:
        "Não há NF processada. Pelo menos um item está com status numérico 1, 2 ou 3 e a data planejada é igual ou posterior a hoje.",
      evidence: {
        ...baseEvidence,
        summary: `Sem NF; item(s) 1/2/3; planejado ${formatBr(plannedDate)} no prazo.`,
      },
    };
  }

  if (itemAnalysis.hasNonNumericOrMissing && !itemAnalysis.hasNumericOutsidePending) {
    return buildReviewResult(
      baseEvidence,
      "Status de item não numérico ou ausente — impossível avaliar IN {1,2,3}.",
      "Não há NF processada e o status do item não é numérico ou está ausente."
    );
  }

  return {
    label: "Finalizado/Cancelado",
    cardId: "finishedOrCancelled",
    source: "power_bi_dax",
    ruleExplanation:
      "Não há NF processada e nenhum item está com status numérico 1, 2 ou 3.",
    evidence: {
      ...baseEvidence,
      summary: "Sem NF; itens fora do conjunto pendente 1/2/3.",
    },
  };
}

/** Alias mantido para compatibilidade interna. */
export function buildSalesOrderLogisticStatus(
  input: Parameters<typeof buildSalesOrderBiLogisticStatus>[0]
): SalesOrderLogisticStatusResult {
  return buildSalesOrderBiLogisticStatus(input);
}

export function biLogisticLabelToCardId(
  label: SalesOrderBiLogisticStatusLabel
): BiLogisticStatusCardId {
  return LABEL_TO_CARD_ID[label];
}

export function getBiLogisticCardLabel(cardId: BiLogisticStatusCardId): string {
  return BI_LOGISTIC_STATUS_CARDS.find((c) => c.id === cardId)?.label ?? cardId;
}

export function getBiLogisticCardHint(cardId: BiLogisticStatusCardId): string {
  return BI_LOGISTIC_STATUS_CARDS.find((c) => c.id === cardId)?.hint ?? "";
}

export function isBiLogisticStatusCardId(value: string): value is BiLogisticStatusCardId {
  return (BI_LOGISTIC_STATUS_CARD_IDS as readonly string[]).includes(value);
}

export function emptyBiLogisticStatusCardCounts(): Record<BiLogisticStatusCardId, number> {
  return {
    deliveredOnTime: 0,
    deliveredLate: 0,
    overduePending: 0,
    onTimePending: 0,
    finishedOrCancelled: 0,
    reviewData: 0,
  };
}

export function emptyBiLogisticStatusCardAmounts(): Record<BiLogisticStatusCardId, number> {
  return { ...emptyBiLogisticStatusCardCounts() };
}

export type BiLogisticDashboardCard = {
  key: string;
  label: string;
  count: number;
  totalNetValue: number;
  percentOfTotal?: number;
  tooltip: string;
  logisticStatus?: BiLogisticStatusCardId;
  isTotal?: boolean;
};

export type BiLogisticCardReconciliation = {
  countMatches: boolean;
  valueMatches: boolean;
  countDifference: number;
  valueDifference: number;
  statusCardsTotalCount: number;
  statusCardsTotalValue: number;
};

export function buildBiLogisticStatusCardMetrics(
  rows: Array<{ logisticStatusCardId: BiLogisticStatusCardId; totalNetValue: number | null | undefined }>
): {
  counts: Record<BiLogisticStatusCardId, number>;
  amounts: Record<BiLogisticStatusCardId, number>;
} {
  const counts = emptyBiLogisticStatusCardCounts();
  const amounts = emptyBiLogisticStatusCardAmounts();
  for (const row of rows) {
    counts[row.logisticStatusCardId] += 1;
    const value = row.totalNetValue;
    if (value != null && Number.isFinite(value)) {
      amounts[row.logisticStatusCardId] += value;
    }
  }
  return { counts, amounts };
}

export function reconcileBiLogisticStatusCards(input: {
  totalOrders: number;
  totalNetValue: number;
  counts: Record<BiLogisticStatusCardId, number>;
  amounts: Record<BiLogisticStatusCardId, number>;
}): BiLogisticCardReconciliation {
  const statusCardsTotalCount = sumBiLogisticCardCounts(input.counts);
  const statusCardsTotalValue = sumBiLogisticCardAmounts(input.amounts);
  const countDifference = input.totalOrders - statusCardsTotalCount;
  const valueDifference =
    Math.round((input.totalNetValue - statusCardsTotalValue) * 100) / 100;
  return {
    statusCardsTotalCount,
    statusCardsTotalValue,
    countMatches: countDifference === 0,
    valueMatches: Math.abs(valueDifference) < 0.01,
    countDifference,
    valueDifference,
  };
}

const TOTAL_CARD_TOOLTIP =
  "Total de pedidos e valor líquido dentro dos filtros atuais (exceto filtro de Status Logístico BI).";

export function sumBiLogisticCardCounts(
  counts: Record<BiLogisticStatusCardId, number>
): number {
  return BI_LOGISTIC_STATUS_CARD_IDS.reduce((sum, id) => sum + counts[id], 0);
}

export function sumBiLogisticCardAmounts(
  amounts: Record<BiLogisticStatusCardId, number>
): number {
  return BI_LOGISTIC_STATUS_CARD_IDS.reduce((sum, id) => {
    const v = amounts[id];
    return sum + (v != null && Number.isFinite(v) ? v : 0);
  }, 0);
}

export function buildBiLogisticDashboardCards(
  rows: Array<{ logisticStatusCardId: BiLogisticStatusCardId; totalNetValue: number | null | undefined }>
): {
  cards: BiLogisticDashboardCard[];
  reconciliation: BiLogisticCardReconciliation;
  totalOrders: number;
  totalNetValue: number;
  validPortfolioCount: number;
  validPortfolioValue: number;
} {
  const { counts, amounts } = buildBiLogisticStatusCardMetrics(rows);
  const totalOrders = rows.length;
  const totalNetValue = rows.reduce((sum, row) => {
    const v = row.totalNetValue;
    return sum + (v != null && Number.isFinite(v) ? v : 0);
  }, 0);
  const reconciliation = reconcileBiLogisticStatusCards({
    totalOrders,
    totalNetValue,
    counts,
    amounts,
  });

  const statusCards: BiLogisticDashboardCard[] = BI_LOGISTIC_STATUS_CARDS.map((card) => ({
    key: card.id,
    label: card.label,
    count: counts[card.id],
    totalNetValue: amounts[card.id],
    percentOfTotal:
      totalOrders > 0 ? Math.round((counts[card.id] / totalOrders) * 1000) / 10 : 0,
    tooltip: card.hint,
    logisticStatus: card.id,
  }));

  const cards: BiLogisticDashboardCard[] = [
    {
      key: "total",
      label: "Total no filtro",
      count: totalOrders,
      totalNetValue,
      percentOfTotal: totalOrders > 0 ? 100 : 0,
      tooltip: TOTAL_CARD_TOOLTIP,
      isTotal: true,
    },
    ...statusCards,
  ];

  return {
    cards,
    reconciliation,
    totalOrders,
    totalNetValue,
    validPortfolioCount: totalOrders - counts.finishedOrCancelled,
    validPortfolioValue: totalNetValue - amounts.finishedOrCancelled,
  };
}

export function buildBiLogisticDashboardCardsFromAggregates(
  counts: Record<BiLogisticStatusCardId, number>,
  amounts: Record<BiLogisticStatusCardId, number>,
  totals?: { totalOrders?: number; totalNetValue?: number }
): BiLogisticDashboardCard[] {
  const totalOrders = totals?.totalOrders ?? sumBiLogisticCardCounts(counts);
  const totalNetValue = totals?.totalNetValue ?? sumBiLogisticCardAmounts(amounts);
  const statusCards: BiLogisticDashboardCard[] = BI_LOGISTIC_STATUS_CARDS.map((card) => ({
    key: card.id,
    label: card.label,
    count: counts[card.id],
    totalNetValue: amounts[card.id],
    percentOfTotal:
      totalOrders > 0 ? Math.round((counts[card.id] / totalOrders) * 1000) / 10 : 0,
    tooltip: card.hint,
    logisticStatus: card.id,
  }));
  return [
    {
      key: "total",
      label: "Total no filtro",
      count: totalOrders,
      totalNetValue,
      percentOfTotal: totalOrders > 0 ? 100 : 0,
      tooltip: TOTAL_CARD_TOOLTIP,
      isTotal: true,
    },
    ...statusCards,
  ];
}

export function compareLogisticToExecutiveStatus(
  logistic: SalesOrderLogisticStatusResult,
  executiveStatusLabel: string
): { diverges: boolean; message: string | null } {
  const executive = executiveStatusLabel.trim();
  const alignedByLabel: Partial<Record<SalesOrderBiLogisticStatusLabel, readonly string[]>> = {
    "Entregue no Prazo": ["Faturado total no prazo", "Entregue", "Enviado"],
    "Entregue com Atraso": ["Faturado total com atraso"],
    "Atrasado (Pendente)": ["Atrasado sem NF"],
    "No Prazo (Pendente)": ["Aguardando liberação", "Liberado", "Em andamento"],
    "Finalizado/Cancelado": ["Cancelado", "Devolvido totalmente", "Devolvido parcialmente"],
    "Revisar dados": ["Divergente — revisar", "Status desconhecido"],
  };
  const aligned = alignedByLabel[logistic.label] ?? [];
  if (aligned.includes(executive)) {
    return { diverges: false, message: null };
  }
  return {
    diverges: true,
    message: `Divergência entre status logístico BI (${logistic.label}) e status gerencial (${executive}) — revisar regra.`,
  };
}

export function formatLogisticEvidenceLine(logistic: SalesOrderLogisticStatusResult): string {
  return logistic.ruleExplanation || logistic.evidence.summary;
}
