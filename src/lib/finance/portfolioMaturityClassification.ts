/**
 * Classificação de maturidade por pedido (Conciliação de Carteira — camada paralela).
 *
 * Read-only / puro: não altera AR, Fluxo, Comissões, Presidencial nem a tabela fato.
 * Um status principal por pedido; tags múltiplas; confiança evidencial 0–100.
 *
 * @see docs/finance/portfolio-intelligence-requirements.md
 */

export const PORTFOLIO_INFO_UNAVAILABLE =
  "Informação não disponível na importação atual.";

export type PortfolioMaturityStatus =
  | "RECEBIDO"
  | "CR_ABERTO"
  | "FATURADO_SEM_CR"
  | "CARTEIRA_FUTURA_PROVAVEL"
  | "CARTEIRA_PRESENTE_ATENCAO"
  | "CARTEIRA_VENCIDA_BLOQUEADA"
  | "SEM_EVIDENCIA";

export type PortfolioMaturityAlertTag =
  | "DIVERGENCIA_TECNICA"
  | "NF_SEM_DOCUMENTO"
  | "DOCUMENTO_SEM_CR"
  | "NF_CABECALHO_MAIOR_PEDIDO"
  | "DIVERGENCIA_PRECO"
  | "SEM_CONDICAO_PAGAMENTO"
  | "VINCULO_INCOMPLETO"
  | "PEDIDO_ANTIGO_SEM_EVOLUCAO"
  | "QUANTIDADE_EXCEDENTE_DOCUMENTO"
  | "PRODUTO_FORA_DO_PEDIDO";

export type PortfolioConfidenceLabel = "ALTA" | "MEDIA" | "BAIXA" | "MUITO_BAIXA";

export type PortfolioMaturityOrderInput = {
  orderCode: string;
  orderValue: number;
  /** ISO yyyy-mm-dd */
  orderIssueDate?: string | null;
  /** ISO yyyy-mm-dd — previsão agregada do pedido (calendário/CR/NF) */
  forecastDate?: string | null;
  forecastSource?: "RECEIVABLE" | "NFE" | "ORDER" | "UNRESOLVED" | string | null;

  receivedValue: number;
  openReceivableValue: number;
  receivableTotalValue?: number | null;

  hasNfe: boolean;
  hasStockDocument: boolean;
  hasAllocation: boolean;
  itemizedAllocatedValue?: number | null;
  nfeHeaderValue?: number | null;

  /** Status dominante da fato (ex.: ORDER_ONLY, PRICE_MISMATCH). */
  factStatus?: string | null;
  /** Confiança da fato: HIGH | MEDIUM | LOW | BLOCKED */
  factConfidenceLevel?: string | null;
  alerts?: readonly string[] | null;

  /**
   * true = condição presente; false/null = ausente na importação.
   * Ausência gera tag SEM_CONDICAO_PAGAMENTO.
   */
  paymentTermsAvailable?: boolean | null;

  /** ISO yyyy-mm-dd — default: hoje (local). */
  asOfDate?: string | null;
};

export type PortfolioOrderEvidenceSignals = {
  hasReceipt: boolean;
  hasOpenReceivable: boolean;
  hasReceivable: boolean;
  hasNfe: boolean;
  hasStockDocument: boolean;
  hasAllocation: boolean;
  hasReliableForecastDate: boolean;
  daysUntilForecast: number | null;
  daysOverdueForecast: number | null;
  daysSinceOrderIssue: number | null;
  headerExceedsOrder: boolean;
  technicalDivergence: boolean;
  paymentTermsAvailable: boolean;
};

export type PortfolioMaturityClassification = {
  orderCode: string;
  statusPrincipal: PortfolioMaturityStatus;
  tagsAlerta: PortfolioMaturityAlertTag[];
  confidenceScore: number;
  confidenceLabel: PortfolioConfidenceLabel;
  motivosConfianca: string[];
  acaoRecomendada: string;
  resumoExecutivo: string;
  sinaisEvidencia: PortfolioOrderEvidenceSignals;
};

/** Janela “futura relevante” (dias à frente). */
export const MATURITY_FUTURE_HORIZON_DAYS = 30;
/** Até quantos dias de atraso de previsão ainda é “presente/atenção”. */
export const MATURITY_PRESENT_OVERDUE_GRACE_DAYS = 60;
/** Pedido sem evolução considerado antigo (dias desde emissão). */
export const MATURITY_STALE_ORDER_DAYS = 90;

const TECHNICAL_STATUSES = new Set([
  "OVER_LINKED_BY_HEADER",
  "DATA_QUALITY_ISSUE",
  "AMBIGUOUS_ALLOCATION",
  "QUANTITY_SURPLUS_IN_NFE",
  "HEADER_ONLY_LINK",
]);

const PRICE_STATUSES = new Set(["PRICE_MISMATCH"]);

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round0(n: number): number {
  return Math.round(n);
}

function toNumber(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value;
}

function toIsoDate(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return startOfDayIso(d);
}

function startOfDayIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = parseIso(fromIso).getTime();
  const b = parseIso(toIso).getTime();
  return Math.round((b - a) / 86_400_000);
}

function resolveAsOf(input: PortfolioMaturityOrderInput): string {
  return toIsoDate(input.asOfDate) ?? startOfDayIso(new Date());
}

function hasTechnicalDivergence(input: PortfolioMaturityOrderInput): boolean {
  const status = (input.factStatus ?? "").toUpperCase();
  if (TECHNICAL_STATUSES.has(status)) return true;
  const alerts = input.alerts ?? [];
  return alerts.some((a) =>
    /diverg|sobrevincul|ambígu|ambigu|qualidade|cabeçalho|header|surplus|excedente/i.test(a)
  );
}

function hasPriceDivergence(input: PortfolioMaturityOrderInput): boolean {
  const status = (input.factStatus ?? "").toUpperCase();
  if (PRICE_STATUSES.has(status)) return true;
  return (input.alerts ?? []).some((a) => /preço|preco|price|mismatch/i.test(a));
}

function headerExceedsOrder(input: PortfolioMaturityOrderInput): boolean {
  const header = toNumber(input.nfeHeaderValue);
  const order = toNumber(input.orderValue);
  return header > 0 && order > 0 && header > order + 0.01;
}

/**
 * Sinais evidenciais derivados do input agregado (sem I/O).
 */
export function buildOrderEvidenceSignals(
  input: PortfolioMaturityOrderInput
): PortfolioOrderEvidenceSignals {
  const asOf = resolveAsOf(input);
  const forecastDate = toIsoDate(input.forecastDate);
  const issueDate = toIsoDate(input.orderIssueDate);
  const received = toNumber(input.receivedValue);
  const open = toNumber(input.openReceivableValue);
  const receivableTotal = toNumber(input.receivableTotalValue);
  const hasReceivable = open > 0 || receivableTotal > 0 || received > 0;

  let daysUntilForecast: number | null = null;
  let daysOverdueForecast: number | null = null;
  if (forecastDate) {
    const delta = daysBetween(asOf, forecastDate);
    if (delta >= 0) daysUntilForecast = delta;
    else daysOverdueForecast = -delta;
  }

  return {
    hasReceipt: received > 0 && open <= 0.01,
    hasOpenReceivable: open > 0.01,
    hasReceivable,
    hasNfe: Boolean(input.hasNfe),
    hasStockDocument: Boolean(input.hasStockDocument),
    hasAllocation:
      Boolean(input.hasAllocation) || toNumber(input.itemizedAllocatedValue) > 0,
    hasReliableForecastDate: forecastDate != null,
    daysUntilForecast,
    daysOverdueForecast,
    daysSinceOrderIssue: issueDate ? daysBetween(issueDate, asOf) : null,
    headerExceedsOrder: headerExceedsOrder(input),
    technicalDivergence: hasTechnicalDivergence(input),
    paymentTermsAvailable: input.paymentTermsAvailable === true,
  };
}

function hasFulfillmentEvidence(signals: PortfolioOrderEvidenceSignals): boolean {
  return signals.hasNfe || signals.hasStockDocument || signals.hasAllocation;
}

/**
 * Status principal único — prioridade fixa (não soma o pedido em dois cards).
 */
export function resolveMaturityStatus(
  input: PortfolioMaturityOrderInput,
  signals: PortfolioOrderEvidenceSignals = buildOrderEvidenceSignals(input)
): PortfolioMaturityStatus {
  const received = toNumber(input.receivedValue);
  const open = toNumber(input.openReceivableValue);
  const factStatus = (input.factStatus ?? "").toUpperCase();

  // 1. RECEBIDO
  if (factStatus === "RECEIVED" || (received > 0.01 && open <= 0.01)) {
    return "RECEBIDO";
  }

  // 2. CR_ABERTO (mesmo com divergência técnica)
  if (open > 0.01 || (signals.hasReceivable && open > 0.01)) {
    return "CR_ABERTO";
  }
  if (
    (input.forecastSource ?? "").toUpperCase() === "RECEIVABLE" &&
    open > 0.01
  ) {
    return "CR_ABERTO";
  }

  // 3. FATURADO_SEM_CR
  if (hasFulfillmentEvidence(signals) && open <= 0.01 && !(received > 0.01 && open <= 0.01)) {
    // Tem NF/doc/alocação e não está em CR aberto nem totalmente recebido
    if (!signals.hasOpenReceivable && received <= 0.01) {
      return "FATURADO_SEM_CR";
    }
  }

  const noFulfillment = !hasFulfillmentEvidence(signals) && !signals.hasOpenReceivable;

  if (noFulfillment) {
    const until = signals.daysUntilForecast;
    const overdue = signals.daysOverdueForecast;
    const staleOrder =
      signals.daysSinceOrderIssue != null &&
      signals.daysSinceOrderIssue > MATURITY_STALE_ORDER_DAYS;

    // 4. Futura
    if (until != null && until > MATURITY_FUTURE_HORIZON_DAYS) {
      return "CARTEIRA_FUTURA_PROVAVEL";
    }

    // 5. Presente / atenção (próximos 30d ou atraso ≤ 60d)
    if (
      (until != null && until >= 0 && until <= MATURITY_FUTURE_HORIZON_DAYS) ||
      (overdue != null && overdue > 0 && overdue <= MATURITY_PRESENT_OVERDUE_GRACE_DAYS)
    ) {
      return "CARTEIRA_PRESENTE_ATENCAO";
    }

    // 6. Vencida / bloqueada (atraso longo ou pedido antigo sem evolução)
    if (
      (overdue != null && overdue > MATURITY_PRESENT_OVERDUE_GRACE_DAYS) ||
      (staleOrder && !signals.hasReliableForecastDate) ||
      (staleOrder && overdue != null) ||
      (factStatus === "ORDER_ONLY" &&
        (overdue != null && overdue > MATURITY_PRESENT_OVERDUE_GRACE_DAYS))
    ) {
      return "CARTEIRA_VENCIDA_BLOQUEADA";
    }

    // Sem data: pedido antigo → bloqueada; senão evidência fraca
    if (staleOrder) return "CARTEIRA_VENCIDA_BLOQUEADA";
    if (!signals.hasReliableForecastDate) return "SEM_EVIDENCIA";
  }

  // 7. Sem evidência
  return "SEM_EVIDENCIA";
}

/**
 * Tags de alerta — múltiplas; nunca substituem o status principal.
 */
export function buildOrderEvidenceTags(
  input: PortfolioMaturityOrderInput,
  signals: PortfolioOrderEvidenceSignals = buildOrderEvidenceSignals(input)
): PortfolioMaturityAlertTag[] {
  const tags = new Set<PortfolioMaturityAlertTag>();
  const factStatus = (input.factStatus ?? "").toUpperCase();
  const status = resolveMaturityStatus(input, signals);

  if (signals.technicalDivergence || TECHNICAL_STATUSES.has(factStatus)) {
    tags.add("DIVERGENCIA_TECNICA");
  }
  if (hasPriceDivergence(input)) {
    tags.add("DIVERGENCIA_PRECO");
  }
  if (signals.hasNfe && !signals.hasStockDocument) {
    tags.add("NF_SEM_DOCUMENTO");
  }
  if (
    (signals.hasStockDocument || signals.hasAllocation) &&
    !signals.hasOpenReceivable &&
    toNumber(input.receivedValue) <= 0.01 &&
    status === "FATURADO_SEM_CR"
  ) {
    tags.add("DOCUMENTO_SEM_CR");
  }
  if (signals.headerExceedsOrder) {
    tags.add("NF_CABECALHO_MAIOR_PEDIDO");
  }
  if (
    factStatus === "QUANTITY_SURPLUS_IN_NFE" ||
    (input.alerts ?? []).some((a) =>
      /QUANTIDADE_EXCEDENTE|QUANTITY_SURPLUS|quantidade excedente/i.test(a)
    )
  ) {
    tags.add("QUANTIDADE_EXCEDENTE_DOCUMENTO");
  }
  if (
    (input.alerts ?? []).some((a) =>
      /PRODUTO_FORA|STOCK_PRODUCT_NOT_IN_ORDER|produto fora/i.test(a)
    )
  ) {
    tags.add("PRODUTO_FORA_DO_PEDIDO");
  }
  if (input.paymentTermsAvailable !== true) {
    tags.add("SEM_CONDICAO_PAGAMENTO");
  }
  if (
    factStatus === "HEADER_ONLY_LINK" ||
    factStatus === "PARTIALLY_ALLOCATED" ||
    factStatus === "AMBIGUOUS_ALLOCATION" ||
    (signals.hasNfe && !signals.hasAllocation && !signals.hasStockDocument)
  ) {
    tags.add("VINCULO_INCOMPLETO");
  }
  if (
    status === "CARTEIRA_VENCIDA_BLOQUEADA" ||
    (signals.daysSinceOrderIssue != null &&
      signals.daysSinceOrderIssue > MATURITY_STALE_ORDER_DAYS &&
      !hasFulfillmentEvidence(signals) &&
      !signals.hasOpenReceivable)
  ) {
    tags.add("PEDIDO_ANTIGO_SEM_EVOLUCAO");
  }

  return [...tags];
}

function confidenceLabelFromScore(score: number): PortfolioConfidenceLabel {
  if (score >= 80) return "ALTA";
  if (score >= 60) return "MEDIA";
  if (score >= 30) return "BAIXA";
  return "MUITO_BAIXA";
}

/**
 * Confiança evidencial 0–100 (faixas por maturidade + ajustes).
 */
export function calculateOrderConfidence(
  input: PortfolioMaturityOrderInput,
  signals: PortfolioOrderEvidenceSignals = buildOrderEvidenceSignals(input),
  status: PortfolioMaturityStatus = resolveMaturityStatus(input, signals)
): { score: number; label: PortfolioConfidenceLabel; motivos: string[] } {
  const motivos: string[] = [];
  let score: number;

  switch (status) {
    case "RECEBIDO":
      score = 100;
      motivos.push("Recebimento/baixa identificado.");
      break;
    case "CR_ABERTO":
      score = 90;
      motivos.push("Contas a Receber em aberto rateado ao pedido.");
      if (signals.hasAllocation) {
        score = 95;
        motivos.push("Alocação itemizada presente.");
      } else {
        score = 85;
        motivos.push("CR presente; alocação itemizada limitada.");
      }
      break;
    case "FATURADO_SEM_CR":
      score = 68;
      motivos.push("NF/documento de saída sem Contas a Receber.");
      if (signals.hasAllocation && signals.hasStockDocument) {
        score = 75;
        motivos.push("Documento de estoque e alocação itemizada.");
      } else if (signals.hasNfe && !signals.hasStockDocument) {
        score = 60;
        motivos.push("NF sem documento de saída itemizado.");
      }
      break;
    case "CARTEIRA_FUTURA_PROVAVEL":
      score = 62;
      motivos.push("Pedido em carteira com previsão futura (sem NF/CR).");
      if (signals.hasReliableForecastDate) {
        score = 70;
        motivos.push("Data de previsão disponível.");
      } else {
        score = 55;
      }
      break;
    case "CARTEIRA_PRESENTE_ATENCAO":
      score = 50;
      motivos.push("Pedido em carteira na janela presente/atenção (sem NF/CR).");
      if (
        signals.daysOverdueForecast != null &&
        signals.daysOverdueForecast > 0
      ) {
        score = 40;
        motivos.push(
          `Previsão ultrapassada há ${signals.daysOverdueForecast} dia(s) — não é título CR vencido.`
        );
      } else if (signals.daysUntilForecast != null) {
        score = 55;
        motivos.push(`Previsão em ${signals.daysUntilForecast} dia(s).`);
      }
      break;
    case "CARTEIRA_VENCIDA_BLOQUEADA":
      score = 20;
      motivos.push("Pedido antigo/sem evolução e sem NF/documento/CR.");
      if (
        signals.daysOverdueForecast != null &&
        signals.daysOverdueForecast > MATURITY_PRESENT_OVERDUE_GRACE_DAYS
      ) {
        score = clamp(30 - Math.floor(signals.daysOverdueForecast / 30), 5, 30);
        motivos.push(
          `Previsão ultrapassada há ${signals.daysOverdueForecast} dia(s).`
        );
      } else {
        score = 10;
      }
      break;
    case "SEM_EVIDENCIA":
    default:
      score = 5;
      motivos.push("Evidência insuficiente para classificar com segurança.");
      break;
  }

  if (signals.technicalDivergence) {
    score -= 10;
    motivos.push("Divergência técnica reduz a confiança.");
  }
  if (signals.headerExceedsOrder) {
    score -= 8;
    motivos.push("Cabeçalho de NF maior que o pedido (risco de inflação).");
  }
  if (!signals.paymentTermsAvailable) {
    score -= 3;
    motivos.push(PORTFOLIO_INFO_UNAVAILABLE + " (condição de pagamento).");
  }
  if ((input.factConfidenceLevel ?? "").toUpperCase() === "BLOCKED") {
    score -= 15;
    motivos.push("Confiança da fato BLOCKED.");
  } else if ((input.factConfidenceLevel ?? "").toUpperCase() === "LOW") {
    score -= 5;
    motivos.push("Confiança da fato LOW.");
  }

  score = clamp(round0(score), 0, 100);
  return { score, label: confidenceLabelFromScore(score), motivos };
}

function recommendedAction(
  status: PortfolioMaturityStatus,
  tags: readonly PortfolioMaturityAlertTag[]
): string {
  if (tags.includes("DIVERGENCIA_TECNICA") || tags.includes("NF_CABECALHO_MAIOR_PEDIDO")) {
    return "Revisar vínculo Pedido×NF×documento antes de usar o valor na carteira.";
  }
  switch (status) {
    case "RECEBIDO":
      return "Nenhuma ação financeira pendente neste pedido.";
    case "CR_ABERTO":
      return "Acompanhar títulos de Contas a Receber em aberto.";
    case "FATURADO_SEM_CR":
      return "Verificar por que a NF/documento ainda não gerou Contas a Receber.";
    case "CARTEIRA_FUTURA_PROVAVEL":
      return "Monitorar faturamento futuro; não tratar como CR.";
    case "CARTEIRA_PRESENTE_ATENCAO":
      return "Priorizar faturamento/atualização da previsão neste horizonte.";
    case "CARTEIRA_VENCIDA_BLOQUEADA":
      return "Investigar pedido antigo sem NF/documento/CR; não acusar atraso de título sem CR aberto.";
    case "SEM_EVIDENCIA":
    default:
      return "Completar evidências na importação/conciliação antes de decidir.";
  }
}

/**
 * Resumo executivo curto para gestor.
 */
export function buildOrderExecutiveSummary(
  input: PortfolioMaturityOrderInput,
  signals: PortfolioOrderEvidenceSignals = buildOrderEvidenceSignals(input),
  status: PortfolioMaturityStatus = resolveMaturityStatus(input, signals),
  tags: readonly PortfolioMaturityAlertTag[] = buildOrderEvidenceTags(input, signals)
): string {
  const code = input.orderCode || "Pedido";
  const value = toNumber(input.orderValue).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const tagNote =
    tags.length > 0 ? ` Alertas: ${tags.join(", ")}.` : "";

  switch (status) {
    case "RECEBIDO":
      return `${code} (${value}): recebimento identificado; carteira deste pedido está baixada.${tagNote}`;
    case "CR_ABERTO":
      return `${code} (${value}): já virou Contas a Receber em aberto (R$ ${toNumber(input.openReceivableValue).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).${tagNote}`;
    case "FATURADO_SEM_CR":
      return `${code} (${value}): há NF/documento de saída, mas ainda sem Contas a Receber.${tagNote}`;
    case "CARTEIRA_FUTURA_PROVAVEL":
      return `${code} (${value}): só pedido em carteira com previsão futura; ainda não é CR nem NF.${tagNote}`;
    case "CARTEIRA_PRESENTE_ATENCAO":
      return `${code} (${value}): só pedido em carteira na janela presente/atenção; revisar faturamento ou previsão.${tagNote}`;
    case "CARTEIRA_VENCIDA_BLOQUEADA":
      return `${code} (${value}): pedido antigo/sem evolução e sem NF/documento/CR — baixa confiança; não confundir com título vencido de CR.${tagNote}`;
    case "SEM_EVIDENCIA":
    default:
      return `${code} (${value}): ${PORTFOLIO_INFO_UNAVAILABLE} Evidência insuficiente para maturidade.${tagNote}`;
  }
}

/**
 * Classifica um pedido agregado (entrada tipada — UI/API só renderizam).
 */
export function classifyPortfolioOrder(
  input: PortfolioMaturityOrderInput
): PortfolioMaturityClassification {
  const signals = buildOrderEvidenceSignals(input);
  const statusPrincipal = resolveMaturityStatus(input, signals);
  const tagsAlerta = buildOrderEvidenceTags(input, signals);
  const confidence = calculateOrderConfidence(input, signals, statusPrincipal);
  const resumoExecutivo = buildOrderExecutiveSummary(
    input,
    signals,
    statusPrincipal,
    tagsAlerta
  );

  return {
    orderCode: input.orderCode,
    statusPrincipal,
    tagsAlerta,
    confidenceScore: confidence.score,
    confidenceLabel: confidence.label,
    motivosConfianca: confidence.motivos,
    acaoRecomendada: recommendedAction(statusPrincipal, tagsAlerta),
    resumoExecutivo,
    sinaisEvidencia: signals,
  };
}

export type PortfolioMaturityMetricKey =
  | "RECEBIDO"
  | "CR_ABERTO"
  | "FATURADO_SEM_CR"
  | "CARTEIRA_FUTURA_PROVAVEL"
  | "CARTEIRA_PRESENTE_ATENCAO"
  | "CARTEIRA_VENCIDA_BLOQUEADA"
  | "SEM_EVIDENCIA"
  | "DIVERGENCIA_TECNICA"
  | "NF_CABECALHO_MAIOR_PEDIDO"
  | "QUANTIDADE_EXCEDENTE_DOCUMENTO"
  | "PRODUTO_FORA_DO_PEDIDO"
  | "CONFIDENCE_SCORE"
  | "CONFIANCA_MEDIA_CARTEIRA"
  | "RISCO_SUPERESTIMACAO"
  | "CARTEIRA_TOTAL_ANALISADA"
  | "CONVERSAO_PEDIDOS_CR_QTD"
  | "CONVERSAO_PEDIDOS_CR_VALOR"
  | "CONVERSAO_DOC_SAIDA_QTD"
  | "CONVERSAO_DOC_SAIDA_VALOR"
  | "TAXA_RECEBIMENTO_CR";

export type PortfolioMetricExplanation = {
  metricKey: PortfolioMaturityMetricKey | string;
  oQueSignifica: string;
  comoCalculamos: string;
  oQueEntra: string;
  oQueNaoEntra: string;
  comoInterpretar: string;
};

const METRIC_EXPLANATIONS: Record<string, PortfolioMetricExplanation> = {
  CARTEIRA_TOTAL_ANALISADA: {
    metricKey: "CARTEIRA_TOTAL_ANALISADA",
    oQueSignifica:
      "Soma do valor oficial de todos os pedidos no filtro atual — a base 100% da carteira analisada.",
    comoCalculamos: "Somamos o valor de cada pedido uma única vez (sem duplicar).",
    oQueEntra: "Valor oficial do pedido de venda.",
    oQueNaoEntra: "Cabeçalho de NF, previsões inventadas e valores de comissão.",
    comoInterpretar:
      "É o denominador dos percentuais. Métrica operacional da inteligência — não substitui o caixa oficial.",
  },
  RECEBIDO: {
    metricKey: "RECEBIDO",
    oQueSignifica: "Pedidos em que já identificamos baixa/recebimento na conciliação.",
    comoCalculamos: "Pedidos com recebimento e sem saldo aberto relevante de CR.",
    oQueEntra: "Evidência de baixa/recebimento ligada ao pedido.",
    oQueNaoEntra: "Cabeçalho de NF e comissões.",
    comoInterpretar: "Parte da carteira que já virou dinheiro recebido.",
  },
  CR_ABERTO: {
    metricKey: "CR_ABERTO",
    oQueSignifica: "Pedidos que já têm Contas a Receber em aberto.",
    comoCalculamos: "Pedidos com título de CR ainda não totalmente baixado.",
    oQueEntra: "CR vinculado e rateado ao pedido.",
    oQueNaoEntra: "Pedido sem título e CR sem vínculo confiável.",
    comoInterpretar:
      "Já está no financeiro. Divergência técnica pode aparecer como alerta, sem mudar este status.",
  },
  FATURADO_SEM_CR: {
    metricKey: "FATURADO_SEM_CR",
    oQueSignifica: "Há NF e/ou documento de saída, mas ainda não há Contas a Receber.",
    comoCalculamos: "Pedidos com evidência de faturamento/saída e sem CR.",
    oQueEntra: "NF e/ou documento de saída vinculados.",
    oQueNaoEntra: "Soma de cabeçalhos de NF como se fosse o valor do pedido.",
    comoInterpretar: "Gap entre faturamento e financeiro — vale acompanhar.",
  },
  CARTEIRA_FUTURA_PROVAVEL: {
    metricKey: "CARTEIRA_FUTURA_PROVAVEL",
    oQueSignifica: "Pedidos só em carteira, com previsão ainda distante (mais de 30 dias).",
    comoCalculamos: "Sem NF, documento ou CR; previsão além de 30 dias.",
    oQueEntra: "Valor oficial do pedido.",
    oQueNaoEntra: "CR, cabeçalho de NF e probabilidade inventada de recebimento.",
    comoInterpretar: "Carteira futura — não é atraso de cliente.",
  },
  CARTEIRA_PRESENTE_ATENCAO: {
    metricKey: "CARTEIRA_PRESENTE_ATENCAO",
    oQueSignifica:
      "Pedidos só em carteira com previsão próxima (até 30 dias) ou recentemente ultrapassada.",
    comoCalculamos: "Sem NF/documento/CR; janela de atenção comercial.",
    oQueEntra: "Pedidos com data prevista nessa janela.",
    oQueNaoEntra: "Título de CR vencido (isso é outro conceito).",
    comoInterpretar: "Priorizar faturamento ou atualizar a previsão.",
  },
  CARTEIRA_VENCIDA_BLOQUEADA: {
    metricKey: "CARTEIRA_VENCIDA_BLOQUEADA",
    oQueSignifica:
      "Pedidos que passaram da data prevista e ainda não possuem NF, documento de saída ou CR.",
    comoCalculamos:
      "Sem NF/documento/CR e com previsão ultrapassada há mais de 60 dias (ou pedido antigo sem evolução).",
    oQueEntra: "Pedidos antigos ainda só em pedido.",
    oQueNaoEntra: "Títulos de CR abertos vencidos (inadimplência financeira é outro indicador).",
    comoInterpretar:
      "Não devem ser tratados como caixa confiável até validação comercial.",
  },
  SEM_EVIDENCIA: {
    metricKey: "SEM_EVIDENCIA",
    oQueSignifica: "Pedidos sem evidência suficiente para classificar com segurança.",
    comoCalculamos: "Nenhuma regra de maturidade casou de forma confiável.",
    oQueEntra: "Pedidos com dados incompletos na importação.",
    oQueNaoEntra: "Valores inventados.",
    comoInterpretar: "Revisar cadastro/importação antes de usar no caixa.",
  },
  DIVERGENCIA_TECNICA: {
    metricKey: "DIVERGENCIA_TECNICA",
    oQueSignifica:
      "Alerta de inconsistência técnica (vínculo, alocação ou qualidade de dados) — não é um status de carteira.",
    comoCalculamos: "Tags a partir de alertas da conciliação; o status principal permanece o financeiro.",
    oQueEntra: "Alertas como vínculo incompleto, alocação ambígua ou cabeçalho maior que o pedido.",
    oQueNaoEntra: "Não move o pedido para outro card de maturidade nem duplica valor.",
    comoInterpretar: "Revisar o vínculo; o valor do pedido continua em um único status principal.",
  },
  NF_CABECALHO_MAIOR_PEDIDO: {
    metricKey: "NF_CABECALHO_MAIOR_PEDIDO",
    oQueSignifica:
      "A soma dos cabeçalhos de NF vinculadas supera o valor oficial do pedido — risco de leitura inflada.",
    comoCalculamos:
      "Pedidos com esse alerta. O valor do card é o valor do pedido (não a soma dos cabeçalhos).",
    oQueEntra: "Pedidos com cabeçalho de NF maior que o pedido.",
    oQueNaoEntra: "Soma dos cabeçalhos de NF como se fosse o pedido.",
    comoInterpretar:
      "Alerta técnico — não some carteira. Use o mapa de atendimento para ver o que pertence ao pedido.",
  },
  QUANTIDADE_EXCEDENTE_DOCUMENTO: {
    metricKey: "QUANTIDADE_EXCEDENTE_DOCUMENTO",
    oQueSignifica:
      "Documento de saída/NF traz quantidade acima do saldo do pedido — excedente separado do atendimento.",
    comoCalculamos:
      "Pedidos com tag de quantidade excedente. O valor do card é o valor do pedido (não o excedente).",
    oQueEntra: "Pedidos com excedente de quantidade nos documentos vinculados.",
    oQueNaoEntra: "Não aumenta o valor oficial do pedido nem soma carteira extra.",
    comoInterpretar:
      "Alerta — pode coexistir com CR aberto. Não some carteira; revise o mapa de atendimento.",
  },
  PRODUTO_FORA_DO_PEDIDO: {
    metricKey: "PRODUTO_FORA_DO_PEDIDO",
    oQueSignifica:
      "Há produto no documento que não pertence a este pedido — valor fora do pedido.",
    comoCalculamos:
      "Pedidos com tag de produto fora. O valor do card é o valor do pedido (não o valor fora).",
    oQueEntra: "Pedidos com itens de documento não atribuídos ao pedido.",
    oQueNaoEntra: "Não soma o valor fora como se fosse carteira deste pedido.",
    comoInterpretar:
      "Alerta técnico — pode coexistir com outro status. Não some carteira.",
  },
  CONFIDENCE_SCORE: {
    metricKey: "CONFIDENCE_SCORE",
    oQueSignifica:
      "Nota de 0 a 100 que mostra quanta evidência existe de que o pedido virou ou vai virar dinheiro.",
    comoCalculamos:
      "Partimos do status do pedido e ajustamos conforme NF, documento, CR, recebimento e alertas.",
    oQueEntra: "Sinais de recebimento, CR, NF, documento, alocação e datas.",
    oQueNaoEntra: "Score de comissão ou probabilidade comercial inventada.",
    comoInterpretar:
      "Importante: não é previsão perfeita; é indicador operacional/evidencial. Alta ≥80; média 60–79; baixa 30–59; muito baixa <30.",
  },
  CONFIANCA_MEDIA_CARTEIRA: {
    metricKey: "CONFIANCA_MEDIA_CARTEIRA",
    oQueSignifica:
      "Nota média de confiança da carteira no filtro, ponderada pelo valor dos pedidos.",
    comoCalculamos: "Média das notas de confiança, pesada pelo valor de cada pedido.",
    oQueEntra: "Todos os pedidos do filtro.",
    oQueNaoEntra: "Comissões e metas comerciais externas.",
    comoInterpretar:
      "Importante: não é previsão perfeita; é indicador operacional/evidencial da qualidade da evidência.",
  },
  RISCO_SUPERESTIMACAO: {
    metricKey: "RISCO_SUPERESTIMACAO",
    oQueSignifica:
      "Valor de pedidos antigos, sem NF/documento/CR, que podem estar inflando a carteira.",
    comoCalculamos: "Soma do valor dos pedidos em carteira vencida/bloqueada.",
    oQueEntra: "Pedidos antigos ainda só em pedido, sem evolução comercial.",
    oQueNaoEntra: "CR aberto, pedidos futuros/presentes e cabeçalho de NF como se fosse caixa.",
    comoInterpretar: "Precisa validação antes de entrar no caixa.",
  },
  CONVERSAO_PEDIDOS_CR_QTD: {
    metricKey: "CONVERSAO_PEDIDOS_CR_QTD",
    oQueSignifica: "Mostra quanto dos pedidos de venda já virou Contas a Receber.",
    comoCalculamos: "Pedidos com CR dividido pelo total de pedidos do filtro.",
    oQueEntra: "Pedidos com Contas a Receber (aberto ou recebido).",
    oQueNaoEntra: "Pedidos ainda só em carteira ou só com NF sem título.",
    comoInterpretar:
      "Quanto maior, mais a carteira comercial está virando financeiro real.",
  },
  CONVERSAO_PEDIDOS_CR_VALOR: {
    metricKey: "CONVERSAO_PEDIDOS_CR_VALOR",
    oQueSignifica:
      "Mostra, em valor, quanto dos pedidos de venda já virou Contas a Receber.",
    comoCalculamos: "Valor dos pedidos com CR dividido pelo valor total do filtro.",
    oQueEntra: "Valor oficial dos pedidos que já têm CR.",
    oQueNaoEntra: "Cabeçalho de NF e pedidos sem título.",
    comoInterpretar:
      "Quanto maior, mais a carteira comercial está virando financeiro real.",
  },
  CONVERSAO_DOC_SAIDA_QTD: {
    metricKey: "CONVERSAO_DOC_SAIDA_QTD",
    oQueSignifica: "Percentual de pedidos que já têm documento de saída.",
    comoCalculamos: "Pedidos com documento de saída dividido pelo total de pedidos.",
    oQueEntra: "Pedidos com evidência de documento de estoque/saída.",
    oQueNaoEntra: "NF só de cabeçalho, sem documento.",
    comoInterpretar: "Sinal de que o pedido avançou na operação de atendimento.",
  },
  CONVERSAO_DOC_SAIDA_VALOR: {
    metricKey: "CONVERSAO_DOC_SAIDA_VALOR",
    oQueSignifica: "Participação em valor dos pedidos com documento de saída.",
    comoCalculamos: "Valor dos pedidos com documento dividido pelo valor total.",
    oQueEntra: "Valor oficial dos pedidos com documento.",
    oQueNaoEntra: "Cabeçalho de NF sem documento.",
    comoInterpretar: "Quanto da carteira já tem evidência física/operacional de saída.",
  },
  TAXA_RECEBIMENTO_CR: {
    metricKey: "TAXA_RECEBIMENTO_CR",
    oQueSignifica: "Quanto do Contas a Receber já foi efetivamente recebido/baixado.",
    comoCalculamos: "Valor recebido dividido pelo valor total de CR do filtro.",
    oQueEntra: "Baixas e CR rateados aos pedidos.",
    oQueNaoEntra: "CR sem vínculo confiável ao pedido.",
    comoInterpretar: "Eficiência de recebimento sobre o que já é financeiro.",
  },
};

/**
 * Explicação padronizada de métrica/card (UI só exibe).
 */
export function getMetricExplanation(
  metricKey: string
): PortfolioMetricExplanation {
  const found = METRIC_EXPLANATIONS[metricKey];
  if (found) return found;
  return {
    metricKey,
    oQueSignifica: PORTFOLIO_INFO_UNAVAILABLE,
    comoCalculamos: PORTFOLIO_INFO_UNAVAILABLE,
    oQueEntra: PORTFOLIO_INFO_UNAVAILABLE,
    oQueNaoEntra: PORTFOLIO_INFO_UNAVAILABLE,
    comoInterpretar: PORTFOLIO_INFO_UNAVAILABLE,
  };
}
