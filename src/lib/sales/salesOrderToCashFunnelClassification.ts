/**
 * Motor puro — classificação Funil Pedido → Caixa.
 *
 * Um estágio principal por pedido + alertas auxiliares.
 * Não usa Proposal nem Comissões. Sem I/O, write ou migration.
 *
 * @see docs/sales/sales-order-to-cash-funnel-requirements.md
 */

export const SALES_ORDER_TO_CASH_FUNNEL_STAGES = [
  "CLIENTE_COM_HISTORICO",
  "PEDIDO_EMITIDO",
  "PEDIDO_FUTURO_SAUDAVEL",
  "PEDIDO_PROXIMO_ATENCAO",
  "PEDIDO_ATRASADO_SEM_DOCUMENTO",
  "PEDIDO_PARCIALMENTE_ATENDIDO",
  "PEDIDO_TOTALMENTE_ATENDIDO",
  "PEDIDO_ATENDIDO_COM_EXCEDENTE",
  "DOCUMENTO_SEM_NF",
  "NF_SEM_CR",
  "CR_ABERTO",
  "RECEBIDO",
  "BLOQUEADO_REVISAO",
  "CANCELADO",
  "SEM_EVIDENCIA",
] as const;

export type SalesOrderToCashFunnelStage =
  (typeof SALES_ORDER_TO_CASH_FUNNEL_STAGES)[number];

export type SalesOrderToCashStageGroup =
  | "COMERCIAL"
  | "OPERACIONAL"
  | "FISCAL"
  | "FINANCEIRO"
  | "CAIXA"
  | "RISCO";

export type SalesOrderToCashTemperature =
  | "QUENTE"
  | "MORNO"
  | "FRIO"
  | "CONGELADO";

export type SalesOrderToCashConfidenceLabel =
  | "ALTA"
  | "MEDIA"
  | "BAIXA"
  | "MUITO_BAIXA";

export type SalesOrderToCashAlert =
  | "ENTREGA_VENCIDA_SEM_DOCUMENTO"
  | "RECEBIMENTO_PREVISTO_SEM_CR"
  | "DOCUMENTO_PARCIAL"
  | "DOCUMENTO_COM_EXCEDENTE"
  | "PRODUTO_FORA_DO_PEDIDO"
  | "NF_SEM_CR"
  | "CR_VENCIDO"
  | "BAIXA_NAO_ENCONTRADA"
  | "FORECAST_EM_RISCO"
  | "PEDIDO_ANTIGO_SEM_EVOLUCAO";

export type SalesOrderToCashResponsibleArea =
  | "COMERCIAL"
  | "PCP_PRODUCAO"
  | "FATURAMENTO"
  | "FINANCEIRO"
  | "DIRETORIA"
  | "TI";

export type SalesOrderToCashEvidenceSource =
  | "RECEIPT"
  | "RECEIVABLE"
  | "NFE"
  | "STOCK_DOCUMENT"
  | "FULFILLMENT_MAP"
  | "ORDER_DATES"
  | "ORDER_STATUS"
  | "INSUFFICIENT";

export const DEFAULT_FUNNEL_OPTIONS = {
  diasProximoEntrega: 7,
  diasRecemVencido: 15,
  diasBloqueio: 60,
  diasAntigoCritico: 90,
  highValueThreshold: 100_000,
  /** MVP: estágio CLIENTE_COM_HISTORICO preparado, não usado na classificação de pedido. */
  enableClienteComHistorico: false,
} as const;

export type SalesOrderToCashFunnelOptions = {
  diasProximoEntrega?: number;
  diasRecemVencido?: number;
  diasBloqueio?: number;
  diasAntigoCritico?: number;
  highValueThreshold?: number;
  enableClienteComHistorico?: boolean;
};

export type SalesOrderToCashFunnelOrderInput = {
  id: string;
  orderCode?: string | null;
  totalNetValue?: number | null;
  issueDate?: Date | string | null;
  expectedDeliveryDate?: Date | string | null;
  status?: string | null;
  canceled?: boolean | null;
  customerId?: string | null;
  customerName?: string | null;
  sellerId?: string | null;
  sellerName?: string | null;
};

export type SalesOrderToCashFunnelItemInput = {
  id?: string;
  externalProductId?: number | null;
  quantity?: number | null;
  unitPrice?: number | null;
};

export type SalesOrderToCashFulfillmentMapInput = {
  operationalStatus?:
    | "OP_TOTALMENTE_ATENDIDO"
    | "OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE"
    | "OP_PARCIALMENTE_ATENDIDO"
    | "OP_NAO_ATENDIDO"
    | "OP_DOCUMENTO_SEM_ITEMIZACAO"
    | "OP_VINCULO_APENAS_CABECALHO"
    | string
    | null;
  financialStatus?:
    | "FIN_RECEBIDO"
    | "FIN_CR_ABERTO"
    | "FIN_FATURADO_SEM_CR"
    | "FIN_SEM_CR"
    | string
    | null;
  fulfillmentSummary?: {
    orderValue?: number | null;
    receivedValue?: number | null;
    openReceivableValue?: number | null;
    receivableTotalValue?: number | null;
    isFullyFulfilledByItems?: boolean | null;
    hasExcessQuantity?: boolean | null;
    hasProductsOutsideOrder?: boolean | null;
    fulfillmentPercent?: number | null;
    attributedOrderValueByOrderPrice?: number | null;
  } | null;
  technicalAlerts?: readonly string[] | null;
};

export type SalesOrderToCashNfeInput = {
  externalId?: number | null;
  numero?: string | null;
  valorLiquido?: number | null;
};

export type SalesOrderToCashStockDocumentInput = {
  id?: string;
  externalId?: number | null;
  idNfe?: number | null;
  dataDocumento?: Date | string | null;
};

export type SalesOrderToCashReceivableInput = {
  receivableId?: number | null;
  dueDate?: Date | string | null;
  settlementDate?: Date | string | null;
  totalValue?: number | null;
  receivedValue?: number | null;
  openValue?: number | null;
};

export type SalesOrderToCashPaymentInput = {
  settlementDate?: Date | string | null;
  receivedValue?: number | null;
};

export type ClassifySalesOrderToCashFunnelInput = {
  order?: SalesOrderToCashFunnelOrderInput | null;
  orderItems?: readonly SalesOrderToCashFunnelItemInput[] | null;
  fulfillmentMap?: SalesOrderToCashFulfillmentMapInput | null;
  nfes?: readonly SalesOrderToCashNfeInput[] | null;
  stockDocuments?: readonly SalesOrderToCashStockDocumentInput[] | null;
  receivables?: readonly SalesOrderToCashReceivableInput[] | null;
  payments?: readonly SalesOrderToCashPaymentInput[] | null;
  today?: Date | string | null;
  options?: SalesOrderToCashFunnelOptions | null;
};

export type SalesOrderToCashFunnelClassification = {
  funnelStage: SalesOrderToCashFunnelStage;
  funnelStageLabel: string;
  stageGroup: SalesOrderToCashStageGroup;
  temperature: SalesOrderToCashTemperature;
  confidenceScore: number;
  confidenceLabel: SalesOrderToCashConfidenceLabel;
  valueForStage: number;
  evidenceSource: SalesOrderToCashEvidenceSource;
  alerts: SalesOrderToCashAlert[];
  actionRecommendation: string;
  responsibleArea: SalesOrderToCashResponsibleArea;
  explanation: string;
};

/** Linha classificada pronta para analytics (identidade + sinais). */
export type ClassifiedSalesOrderFunnelRow = SalesOrderToCashFunnelClassification & {
  orderId: string;
  orderCode: string | null;
  customerId: string | null;
  customerName: string | null;
  sellerId: string | null;
  sellerName: string | null;
  /** Valor oficial do pedido (eixo comercial) — não soma Pedido+NF+CR. */
  orderValue: number;
  daysSinceIssue: number | null;
  daysSinceExpectedDelivery: number | null;
  daysSinceLastAdvance: number | null;
  hasStockDocument: boolean;
  hasNfe: boolean;
  hasOpenCr: boolean;
  hasReceipt: boolean;
  isCanceled: boolean;
};

const STAGE_LABEL: Record<SalesOrderToCashFunnelStage, string> = {
  CLIENTE_COM_HISTORICO: "Cliente com histórico",
  PEDIDO_EMITIDO: "Pedido emitido",
  PEDIDO_FUTURO_SAUDAVEL: "Pedido futuro saudável",
  PEDIDO_PROXIMO_ATENCAO: "Pedido próximo / atenção",
  PEDIDO_ATRASADO_SEM_DOCUMENTO: "Atrasado sem documento",
  PEDIDO_PARCIALMENTE_ATENDIDO: "Parcialmente atendido",
  PEDIDO_TOTALMENTE_ATENDIDO: "Totalmente atendido",
  PEDIDO_ATENDIDO_COM_EXCEDENTE: "Atendido com excedente",
  DOCUMENTO_SEM_NF: "Documento sem NF",
  NF_SEM_CR: "NF sem CR",
  CR_ABERTO: "CR aberto",
  RECEBIDO: "Recebido / caixa",
  BLOQUEADO_REVISAO: "Bloqueado / revisão",
  CANCELADO: "Cancelado",
  SEM_EVIDENCIA: "Sem evidência suficiente",
};

const STAGE_GROUP: Record<SalesOrderToCashFunnelStage, SalesOrderToCashStageGroup> = {
  CLIENTE_COM_HISTORICO: "COMERCIAL",
  PEDIDO_EMITIDO: "COMERCIAL",
  PEDIDO_FUTURO_SAUDAVEL: "COMERCIAL",
  PEDIDO_PROXIMO_ATENCAO: "COMERCIAL",
  PEDIDO_ATRASADO_SEM_DOCUMENTO: "OPERACIONAL",
  PEDIDO_PARCIALMENTE_ATENDIDO: "OPERACIONAL",
  PEDIDO_TOTALMENTE_ATENDIDO: "OPERACIONAL",
  PEDIDO_ATENDIDO_COM_EXCEDENTE: "OPERACIONAL",
  DOCUMENTO_SEM_NF: "FISCAL",
  NF_SEM_CR: "FISCAL",
  CR_ABERTO: "FINANCEIRO",
  RECEBIDO: "CAIXA",
  BLOQUEADO_REVISAO: "RISCO",
  CANCELADO: "COMERCIAL",
  SEM_EVIDENCIA: "RISCO",
};

const BASE_CONFIDENCE: Partial<Record<SalesOrderToCashFunnelStage, number>> = {
  RECEBIDO: 100,
  CR_ABERTO: 90,
  NF_SEM_CR: 75,
  DOCUMENTO_SEM_NF: 75,
  PEDIDO_TOTALMENTE_ATENDIDO: 75,
  PEDIDO_ATENDIDO_COM_EXCEDENTE: 70,
  PEDIDO_PARCIALMENTE_ATENDIDO: 60,
  PEDIDO_FUTURO_SAUDAVEL: 65,
  PEDIDO_EMITIDO: 55,
  PEDIDO_PROXIMO_ATENCAO: 50,
  PEDIDO_ATRASADO_SEM_DOCUMENTO: 25,
  CANCELADO: 100,
  SEM_EVIDENCIA: 10,
  CLIENTE_COM_HISTORICO: 40,
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round0(n: number): number {
  return Math.round(n);
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function toNumber(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const [y, m, d] = trimmed.slice(0, 10).split("-").map(Number);
    return new Date(y!, m! - 1, d!);
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(from: Date, to: Date): number {
  return Math.round(
    (startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000
  );
}

function resolveOptions(
  options?: SalesOrderToCashFunnelOptions | null
): Required<SalesOrderToCashFunnelOptions> {
  return {
    diasProximoEntrega:
      options?.diasProximoEntrega ?? DEFAULT_FUNNEL_OPTIONS.diasProximoEntrega,
    diasRecemVencido:
      options?.diasRecemVencido ?? DEFAULT_FUNNEL_OPTIONS.diasRecemVencido,
    diasBloqueio: options?.diasBloqueio ?? DEFAULT_FUNNEL_OPTIONS.diasBloqueio,
    diasAntigoCritico:
      options?.diasAntigoCritico ?? DEFAULT_FUNNEL_OPTIONS.diasAntigoCritico,
    highValueThreshold:
      options?.highValueThreshold ?? DEFAULT_FUNNEL_OPTIONS.highValueThreshold,
    enableClienteComHistorico:
      options?.enableClienteComHistorico ??
      DEFAULT_FUNNEL_OPTIONS.enableClienteComHistorico,
  };
}

function isCanceledOrder(order: SalesOrderToCashFunnelOrderInput | null | undefined): boolean {
  if (!order) return false;
  if (order.canceled === true) return true;
  const status = String(order.status ?? "").trim().toUpperCase();
  return status === "CANCELLED" || status === "CANCELED" || status === "CANCELADO";
}

function confidenceLabelFor(score: number): SalesOrderToCashConfidenceLabel {
  if (score >= 85) return "ALTA";
  if (score >= 60) return "MEDIA";
  if (score >= 30) return "BAIXA";
  return "MUITO_BAIXA";
}

type EvidenceSignals = {
  hasReceipt: boolean;
  hasOpenCr: boolean;
  hasReceivable: boolean;
  hasNfe: boolean;
  hasStockDocument: boolean;
  receivedValue: number;
  openReceivableValue: number;
  orderValue: number;
  operationalStatus: string | null;
  isFullyFulfilled: boolean;
  hasExcess: boolean;
  hasProductsOutside: boolean;
  isPartialFulfillment: boolean;
  daysUntilDelivery: number | null;
  daysOverdueDelivery: number | null;
  daysSinceIssue: number | null;
  overdueReceivable: boolean;
  lastAdvanceDate: Date | null;
};

function buildEvidenceSignals(
  input: ClassifySalesOrderToCashFunnelInput,
  today: Date
): EvidenceSignals {
  const map = input.fulfillmentMap;
  const summary = map?.fulfillmentSummary;
  const orderValue = toNumber(summary?.orderValue ?? input.order?.totalNetValue);
  const financial = String(map?.financialStatus ?? "").toUpperCase();
  const operationalStatus = map?.operationalStatus
    ? String(map.operationalStatus)
    : null;

  let receivedValue = toNumber(summary?.receivedValue);
  let openReceivableValue = toNumber(summary?.openReceivableValue);
  let receivableTotal = toNumber(summary?.receivableTotalValue);

  if ((input.receivables?.length ?? 0) > 0) {
    receivedValue = round2(
      (input.receivables ?? []).reduce((s, r) => s + toNumber(r.receivedValue), 0)
    );
    openReceivableValue = round2(
      (input.receivables ?? []).reduce((s, r) => s + toNumber(r.openValue), 0)
    );
    receivableTotal = round2(
      (input.receivables ?? []).reduce((s, r) => s + toNumber(r.totalValue), 0)
    );
  }

  if ((input.payments?.length ?? 0) > 0) {
    const paySum = round2(
      (input.payments ?? []).reduce((s, p) => s + toNumber(p.receivedValue), 0)
    );
    if (paySum > receivedValue) receivedValue = paySum;
  }

  if (financial === "FIN_RECEBIDO") {
    if (receivedValue <= 0.01) receivedValue = Math.max(orderValue, 0.02);
    openReceivableValue = 0;
  }
  if (financial === "FIN_CR_ABERTO" && openReceivableValue <= 0.01) {
    openReceivableValue = Math.max(orderValue, 0.02);
  }

  const hasNfe = (input.nfes?.length ?? 0) > 0;
  const hasStockDocument =
    (input.stockDocuments?.length ?? 0) > 0 ||
    operationalStatus === "OP_DOCUMENTO_SEM_ITEMIZACAO" ||
    operationalStatus === "OP_VINCULO_APENAS_CABECALHO" ||
    operationalStatus === "OP_PARCIALMENTE_ATENDIDO" ||
    operationalStatus === "OP_TOTALMENTE_ATENDIDO" ||
    operationalStatus === "OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE" ||
    summary?.isFullyFulfilledByItems === true ||
    (summary?.fulfillmentPercent != null && summary.fulfillmentPercent > 0);

  const isFullyFulfilled =
    summary?.isFullyFulfilledByItems === true ||
    operationalStatus === "OP_TOTALMENTE_ATENDIDO" ||
    operationalStatus === "OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE";
  const hasExcess =
    summary?.hasExcessQuantity === true ||
    operationalStatus === "OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE" ||
    Boolean(map?.technicalAlerts?.some((a) => /EXCEDENTE|EXCESS/i.test(String(a))));
  const hasProductsOutside =
    summary?.hasProductsOutsideOrder === true ||
    Boolean(map?.technicalAlerts?.some((a) => /PRODUTO_FORA|OUTSIDE/i.test(String(a))));
  const isPartialFulfillment =
    operationalStatus === "OP_PARCIALMENTE_ATENDIDO" ||
    (summary?.fulfillmentPercent != null &&
      summary.fulfillmentPercent > 0 &&
      summary.fulfillmentPercent < 99.9 &&
      !isFullyFulfilled);

  const expected = toDate(input.order?.expectedDeliveryDate);
  const issue = toDate(input.order?.issueDate);
  let daysUntilDelivery: number | null = null;
  let daysOverdueDelivery: number | null = null;
  if (expected) {
    const delta = daysBetween(today, expected);
    if (delta >= 0) daysUntilDelivery = delta;
    else daysOverdueDelivery = -delta;
  }

  const overdueReceivable = (input.receivables ?? []).some((r) => {
    if (toNumber(r.openValue) <= 0.01) return false;
    const due = toDate(r.dueDate);
    return due != null && daysBetween(due, today) > 0;
  });

  let lastAdvanceDate: Date | null = null;
  for (const doc of input.stockDocuments ?? []) {
    const d = toDate(doc.dataDocumento);
    if (d && (!lastAdvanceDate || d > lastAdvanceDate)) lastAdvanceDate = d;
  }
  for (const r of input.receivables ?? []) {
    const d = toDate(r.settlementDate) ?? toDate(r.dueDate);
    if (d && (!lastAdvanceDate || d > lastAdvanceDate)) lastAdvanceDate = d;
  }
  for (const p of input.payments ?? []) {
    const d = toDate(p.settlementDate);
    if (d && (!lastAdvanceDate || d > lastAdvanceDate)) lastAdvanceDate = d;
  }

  const hasReceipt =
    financial === "FIN_RECEBIDO" ||
    (receivedValue > 0.01 && openReceivableValue <= 0.01);
  const hasOpenCr = financial === "FIN_CR_ABERTO" || openReceivableValue > 0.01;
  const hasReceivable =
    hasOpenCr || hasReceipt || receivableTotal > 0.01 || (input.receivables?.length ?? 0) > 0;

  // Flag fiscal explícita: NF sem CR via financialStatus quando não há array de NF
  const fiscalNfeWithoutCr = financial === "FIN_FATURADO_SEM_CR";

  return {
    hasReceipt,
    hasOpenCr,
    hasReceivable,
    hasNfe: hasNfe || fiscalNfeWithoutCr,
    hasStockDocument,
    receivedValue,
    openReceivableValue,
    orderValue,
    operationalStatus,
    isFullyFulfilled,
    hasExcess,
    hasProductsOutside,
    isPartialFulfillment,
    daysUntilDelivery,
    daysOverdueDelivery,
    daysSinceIssue: issue ? daysBetween(issue, today) : null,
    overdueReceivable,
    lastAdvanceDate,
  };
}

function resolvePrimaryStage(
  signals: EvidenceSignals,
  opts: Required<SalesOrderToCashFunnelOptions>,
  canceled: boolean
): { stage: SalesOrderToCashFunnelStage; evidenceSource: SalesOrderToCashEvidenceSource } {
  if (canceled) {
    return { stage: "CANCELADO", evidenceSource: "ORDER_STATUS" };
  }

  if (signals.hasReceipt) {
    return { stage: "RECEBIDO", evidenceSource: "RECEIPT" };
  }

  if (signals.hasOpenCr) {
    return { stage: "CR_ABERTO", evidenceSource: "RECEIVABLE" };
  }

  // NF sem CR tem prioridade fiscal sobre atendimento operacional
  if (signals.hasNfe && !signals.hasOpenCr && !signals.hasReceipt) {
    return { stage: "NF_SEM_CR", evidenceSource: "NFE" };
  }

  if (signals.isFullyFulfilled && signals.hasExcess) {
    return { stage: "PEDIDO_ATENDIDO_COM_EXCEDENTE", evidenceSource: "FULFILLMENT_MAP" };
  }

  if (signals.isFullyFulfilled) {
    return { stage: "PEDIDO_TOTALMENTE_ATENDIDO", evidenceSource: "FULFILLMENT_MAP" };
  }

  if (signals.isPartialFulfillment) {
    return { stage: "PEDIDO_PARCIALMENTE_ATENDIDO", evidenceSource: "FULFILLMENT_MAP" };
  }

  // Documento de saída sem NF e sem classificação de atendimento itemizado
  if (
    signals.hasStockDocument &&
    !signals.hasNfe &&
    !signals.hasOpenCr &&
    !signals.hasReceipt
  ) {
    return { stage: "DOCUMENTO_SEM_NF", evidenceSource: "STOCK_DOCUMENT" };
  }

  const noDownstream =
    !signals.hasStockDocument &&
    !signals.hasNfe &&
    !signals.hasOpenCr &&
    !signals.hasReceipt &&
    !signals.isFullyFulfilled &&
    !signals.isPartialFulfillment;

  if (noDownstream) {
    const until = signals.daysUntilDelivery;
    const overdue = signals.daysOverdueDelivery;
    const age = signals.daysSinceIssue;

    // Bloqueio: atraso longo (>= diasBloqueio) OU pedido crítico antigo (>= diasAntigoCritico)
    if (
      (overdue != null && overdue >= opts.diasBloqueio) ||
      (age != null && age >= opts.diasAntigoCritico)
    ) {
      return { stage: "BLOQUEADO_REVISAO", evidenceSource: "ORDER_DATES" };
    }

    if (overdue != null && overdue > opts.diasRecemVencido) {
      return { stage: "PEDIDO_ATRASADO_SEM_DOCUMENTO", evidenceSource: "ORDER_DATES" };
    }

    if (
      (until != null && until <= opts.diasProximoEntrega) ||
      (overdue != null && overdue <= opts.diasRecemVencido)
    ) {
      return { stage: "PEDIDO_PROXIMO_ATENCAO", evidenceSource: "ORDER_DATES" };
    }

    if (until != null && until > opts.diasProximoEntrega) {
      return { stage: "PEDIDO_FUTURO_SAUDAVEL", evidenceSource: "ORDER_DATES" };
    }

    // Pedido existe sem data de entrega fina
    if (age != null) {
      return { stage: "PEDIDO_EMITIDO", evidenceSource: "ORDER_DATES" };
    }

    return { stage: "SEM_EVIDENCIA", evidenceSource: "INSUFFICIENT" };
  }

  return { stage: "SEM_EVIDENCIA", evidenceSource: "INSUFFICIENT" };
}

function collectAlerts(
  stage: SalesOrderToCashFunnelStage,
  signals: EvidenceSignals,
  opts: Required<SalesOrderToCashFunnelOptions>
): SalesOrderToCashAlert[] {
  const alerts = new Set<SalesOrderToCashAlert>();

  if (
    signals.daysOverdueDelivery != null &&
    signals.daysOverdueDelivery > 0 &&
    !signals.hasStockDocument &&
    !signals.hasNfe
  ) {
    alerts.add("ENTREGA_VENCIDA_SEM_DOCUMENTO");
  }

  if (
    (stage === "PEDIDO_FUTURO_SAUDAVEL" || stage === "PEDIDO_PROXIMO_ATENCAO") &&
    !signals.hasReceivable
  ) {
    alerts.add("RECEBIMENTO_PREVISTO_SEM_CR");
  }

  if (signals.isPartialFulfillment || stage === "PEDIDO_PARCIALMENTE_ATENDIDO") {
    alerts.add("DOCUMENTO_PARCIAL");
  }

  if (signals.hasExcess || stage === "PEDIDO_ATENDIDO_COM_EXCEDENTE") {
    alerts.add("DOCUMENTO_COM_EXCEDENTE");
  }

  if (signals.hasProductsOutside) {
    alerts.add("PRODUTO_FORA_DO_PEDIDO");
  }

  if (stage === "NF_SEM_CR" || (signals.hasNfe && !signals.hasOpenCr && !signals.hasReceipt)) {
    alerts.add("NF_SEM_CR");
  }

  if (signals.overdueReceivable && stage === "CR_ABERTO") {
    alerts.add("CR_VENCIDO");
  }

  if (
    signals.hasOpenCr === false &&
    signals.hasReceivable &&
    signals.receivedValue <= 0.01 &&
    stage !== "RECEBIDO"
  ) {
    // título existe mas baixa não materializada — só se houver expectativa
  }

  if (
    (signals.hasNfe || signals.hasStockDocument) &&
    !signals.hasReceipt &&
    signals.hasOpenCr === false &&
    stage !== "RECEBIDO" &&
    signals.receivedValue <= 0.01 &&
    stage === "CR_ABERTO"
  ) {
    alerts.add("BAIXA_NAO_ENCONTRADA");
  }

  if (
    stage === "BLOQUEADO_REVISAO" ||
    stage === "PEDIDO_ATRASADO_SEM_DOCUMENTO" ||
    stage === "SEM_EVIDENCIA" ||
    (signals.daysSinceIssue != null &&
      signals.daysSinceIssue >= opts.diasAntigoCritico &&
      !signals.hasReceipt)
  ) {
    alerts.add("FORECAST_EM_RISCO");
  }

  if (
    signals.daysSinceIssue != null &&
    signals.daysSinceIssue >= opts.diasAntigoCritico &&
    !signals.hasStockDocument &&
    !signals.hasNfe &&
    !signals.hasOpenCr
  ) {
    alerts.add("PEDIDO_ANTIGO_SEM_EVOLUCAO");
  }

  // Alertas auxiliares NÃO substituem estágio — apenas listados
  void stage;
  return [...alerts];
}

function resolveTemperature(
  stage: SalesOrderToCashFunnelStage,
  signals: EvidenceSignals
): SalesOrderToCashTemperature {
  if (stage === "BLOQUEADO_REVISAO" || stage === "SEM_EVIDENCIA") return "CONGELADO";
  if (stage === "CANCELADO") return "FRIO";
  if (stage === "RECEBIDO") return "QUENTE";
  if (stage === "PEDIDO_FUTURO_SAUDAVEL") return "QUENTE";
  if (stage === "PEDIDO_EMITIDO" && (signals.daysSinceIssue ?? 999) <= 30) return "QUENTE";
  if (
    stage === "PEDIDO_PROXIMO_ATENCAO" ||
    stage === "PEDIDO_PARCIALMENTE_ATENDIDO" ||
    stage === "CR_ABERTO" ||
    stage === "NF_SEM_CR" ||
    stage === "DOCUMENTO_SEM_NF"
  ) {
    return "MORNO";
  }
  if (
    stage === "PEDIDO_ATRASADO_SEM_DOCUMENTO" ||
    stage === "PEDIDO_ATENDIDO_COM_EXCEDENTE"
  ) {
    return "FRIO";
  }
  if (stage === "PEDIDO_TOTALMENTE_ATENDIDO") return "MORNO";
  return "MORNO";
}

function resolveConfidence(
  stage: SalesOrderToCashFunnelStage,
  signals: EvidenceSignals,
  opts: Required<SalesOrderToCashFunnelOptions>
): number {
  if (stage === "BLOQUEADO_REVISAO") {
    const age = signals.daysSinceIssue ?? opts.diasBloqueio;
    // 5–20: quanto mais antigo, menor a confiança
    const t = clamp(
      (age - opts.diasBloqueio) / Math.max(1, opts.diasAntigoCritico - opts.diasBloqueio),
      0,
      1
    );
    return round0(20 - t * 15);
  }
  return BASE_CONFIDENCE[stage] ?? 40;
}

function resolveValueForStage(
  stage: SalesOrderToCashFunnelStage,
  signals: EvidenceSignals
): number {
  if (stage === "RECEBIDO") {
    return round2(signals.receivedValue > 0 ? signals.receivedValue : signals.orderValue);
  }
  if (stage === "CR_ABERTO") {
    return round2(
      signals.openReceivableValue > 0 ? signals.openReceivableValue : signals.orderValue
    );
  }
  if (stage === "CANCELADO" || stage === "CLIENTE_COM_HISTORICO") {
    return 0;
  }
  return round2(signals.orderValue);
}

function resolveActionAndOwner(
  stage: SalesOrderToCashFunnelStage,
  signals: EvidenceSignals,
  opts: Required<SalesOrderToCashFunnelOptions>
): { action: string; owner: SalesOrderToCashResponsibleArea } {
  switch (stage) {
    case "RECEBIDO":
      return { action: "Caixa confirmado — nenhuma ação operacional.", owner: "FINANCEIRO" };
    case "CR_ABERTO":
      return {
        action: signals.overdueReceivable
          ? "Cobrar título vencido e acompanhar baixa."
          : "Acompanhar vencimento do CR e baixa.",
        owner: "FINANCEIRO",
      };
    case "NF_SEM_CR":
      return {
        action: "Gerar ou vincular Contas a Receber à NF.",
        owner: "FATURAMENTO",
      };
    case "DOCUMENTO_SEM_NF":
      return {
        action: "Emitir ou vincular NF ao documento de saída.",
        owner: "FATURAMENTO",
      };
    case "PEDIDO_ATENDIDO_COM_EXCEDENTE":
      return {
        action: "Revisar vínculo/quantidade excedente no documento.",
        owner: "FATURAMENTO",
      };
    case "PEDIDO_TOTALMENTE_ATENDIDO":
      return {
        action: "Formalizar NF/CR se ainda faltarem.",
        owner: "FATURAMENTO",
      };
    case "PEDIDO_PARCIALMENTE_ATENDIDO":
      return {
        action: "Completar remessa / documento de saída restante.",
        owner: "PCP_PRODUCAO",
      };
    case "PEDIDO_FUTURO_SAUDAVEL":
      return {
        action: "Acompanhar PCP e janela de faturamento.",
        owner: "COMERCIAL",
      };
    case "PEDIDO_PROXIMO_ATENCAO":
      return {
        action: "Priorizar documento de saída / faturamento.",
        owner: "PCP_PRODUCAO",
      };
    case "PEDIDO_ATRASADO_SEM_DOCUMENTO":
      return {
        action: "Gerar saída ou revisar prazo do pedido.",
        owner: "PCP_PRODUCAO",
      };
    case "BLOQUEADO_REVISAO": {
      const high = signals.orderValue >= opts.highValueThreshold;
      return {
        action: high
          ? "Validar, cancelar ou empurrar pedido de alto valor com diretoria."
          : "Validar pedido antigo sem evolução (cancelar ou reativar).",
        owner: high ? "DIRETORIA" : "COMERCIAL",
      };
    }
    case "CANCELADO":
      return { action: "Não tratar como carteira/forecast.", owner: "COMERCIAL" };
    case "PEDIDO_EMITIDO":
      return {
        action: "Classificar maturidade e coletar evidências de atendimento.",
        owner: "COMERCIAL",
      };
    case "SEM_EVIDENCIA":
      return {
        action: "Revisar importação Nomus / dados mínimos do pedido.",
        owner: "TI",
      };
    case "CLIENTE_COM_HISTORICO":
      return {
        action: "Usar apenas como contexto de cliente (sem valor de carteira).",
        owner: "COMERCIAL",
      };
    default:
      return { action: "Revisar evidências do pedido.", owner: "COMERCIAL" };
  }
}

function buildExplanation(
  stage: SalesOrderToCashFunnelStage,
  signals: EvidenceSignals,
  alerts: SalesOrderToCashAlert[]
): string {
  const parts: string[] = [
    `Estágio principal: ${STAGE_LABEL[stage]}.`,
    `Evidências: recibo=${signals.hasReceipt ? "sim" : "não"}, CR aberto=${signals.hasOpenCr ? "sim" : "não"}, NF=${signals.hasNfe ? "sim" : "não"}, documento=${signals.hasStockDocument ? "sim" : "não"}.`,
  ];
  if (signals.daysUntilDelivery != null) {
    parts.push(`Entrega em ${signals.daysUntilDelivery} dia(s).`);
  }
  if (signals.daysOverdueDelivery != null) {
    parts.push(`Entrega vencida há ${signals.daysOverdueDelivery} dia(s).`);
  }
  if (alerts.length > 0) {
    parts.push(`Alertas auxiliares (não alteram estágio): ${alerts.join(", ")}.`);
  }
  return parts.join(" ");
}

/**
 * Classifica um pedido em um único estágio do Funil Pedido → Caixa.
 */
export function classifySalesOrderToCashFunnel(
  input: ClassifySalesOrderToCashFunnelInput
): SalesOrderToCashFunnelClassification {
  const opts = resolveOptions(input.options);
  const today = startOfDay(toDate(input.today) ?? new Date());
  const order = input.order;
  const canceled = isCanceledOrder(order);

  if (!order && !input.fulfillmentMap) {
    return {
      funnelStage: "SEM_EVIDENCIA",
      funnelStageLabel: STAGE_LABEL.SEM_EVIDENCIA,
      stageGroup: STAGE_GROUP.SEM_EVIDENCIA,
      temperature: "CONGELADO",
      confidenceScore: 10,
      confidenceLabel: "MUITO_BAIXA",
      valueForStage: 0,
      evidenceSource: "INSUFFICIENT",
      alerts: ["FORECAST_EM_RISCO"],
      actionRecommendation: "Revisar importação Nomus / dados mínimos do pedido.",
      responsibleArea: "TI",
      explanation:
        "Estágio principal: Sem evidência suficiente. Pedido ausente na entrada.",
    };
  }

  const signals = buildEvidenceSignals(input, today);
  const { stage, evidenceSource } = resolvePrimaryStage(signals, opts, canceled);
  const alerts = canceled ? [] : collectAlerts(stage, signals, opts);
  const confidenceScore = resolveConfidence(stage, signals, opts);
  const { action, owner } = resolveActionAndOwner(stage, signals, opts);
  const temperature = resolveTemperature(stage, signals);
  const valueForStage = resolveValueForStage(stage, signals);

  return {
    funnelStage: stage,
    funnelStageLabel: STAGE_LABEL[stage],
    stageGroup: STAGE_GROUP[stage],
    temperature,
    confidenceScore,
    confidenceLabel: confidenceLabelFor(confidenceScore),
    valueForStage,
    evidenceSource,
    alerts,
    actionRecommendation: action,
    responsibleArea: owner,
    explanation: buildExplanation(stage, signals, alerts),
  };
}

/**
 * Classifica e monta linha completa para analytics.
 */
export function classifySalesOrderToCashFunnelRow(
  input: ClassifySalesOrderToCashFunnelInput
): ClassifiedSalesOrderFunnelRow {
  const classification = classifySalesOrderToCashFunnel(input);
  const opts = resolveOptions(input.options);
  const today = startOfDay(toDate(input.today) ?? new Date());
  const signals = buildEvidenceSignals(input, today);
  const order = input.order;
  const issue = toDate(order?.issueDate);
  const expected = toDate(order?.expectedDeliveryDate);

  let daysSinceLastAdvance: number | null = null;
  if (signals.lastAdvanceDate) {
    daysSinceLastAdvance = daysBetween(signals.lastAdvanceDate, today);
  } else if (issue) {
    daysSinceLastAdvance = daysBetween(issue, today);
  }

  void opts;

  return {
    ...classification,
    orderId: order?.id ?? "unknown",
    orderCode: order?.orderCode ?? null,
    customerId: order?.customerId ?? null,
    customerName: order?.customerName ?? null,
    sellerId: order?.sellerId ?? null,
    sellerName: order?.sellerName ?? null,
    orderValue: round2(toNumber(order?.totalNetValue ?? signals.orderValue)),
    daysSinceIssue: issue ? daysBetween(issue, today) : signals.daysSinceIssue,
    daysSinceExpectedDelivery: expected
      ? daysBetween(expected, today)
      : signals.daysOverdueDelivery != null
        ? signals.daysOverdueDelivery
        : signals.daysUntilDelivery != null
          ? -signals.daysUntilDelivery
          : null,
    daysSinceLastAdvance,
    hasStockDocument: signals.hasStockDocument,
    hasNfe: signals.hasNfe,
    hasOpenCr: signals.hasOpenCr,
    hasReceipt: signals.hasReceipt,
    isCanceled: isCanceledOrder(order),
  };
}

export function getSalesOrderToCashFunnelStageLabel(
  stage: SalesOrderToCashFunnelStage
): string {
  return STAGE_LABEL[stage];
}

export function getSalesOrderToCashFunnelStageGroup(
  stage: SalesOrderToCashFunnelStage
): SalesOrderToCashStageGroup {
  return STAGE_GROUP[stage];
}
