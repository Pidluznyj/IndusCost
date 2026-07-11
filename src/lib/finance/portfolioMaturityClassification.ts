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
  | "PEDIDO_ANTIGO_SEM_EVOLUCAO";

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
  | "CONFIDENCE_SCORE"
  | "RISCO_SUPERESTIMACAO";

export type PortfolioMetricExplanation = {
  metricKey: PortfolioMaturityMetricKey | string;
  oQueSignifica: string;
  comoCalculamos: string;
  oQueEntra: string;
  oQueNaoEntra: string;
  comoInterpretar: string;
};

const METRIC_EXPLANATIONS: Record<string, PortfolioMetricExplanation> = {
  RECEBIDO: {
    metricKey: "RECEBIDO",
    oQueSignifica: "Pedido com recebimento/baixa identificado na conciliação.",
    comoCalculamos:
      "Status principal RECEBIDO quando receivedValue > 0 e openReceivableValue ≈ 0 (ou factStatus RECEIVED).",
    oQueEntra: "Valores rateados de baixa/recebimento na fato do pedido.",
    oQueNaoEntra: "Cabeçalho de NF; forecastValue bruto; comissões.",
    comoInterpretar: "Não há saldo em aberto deste pedido na carteira projetada.",
  },
  CR_ABERTO: {
    metricKey: "CR_ABERTO",
    oQueSignifica: "Pedido com Contas a Receber aberto rateado.",
    comoCalculamos: "openReceivableValue > 0; prioridade sobre faturado/carteira.",
    oQueEntra: "CR rateado por alocação itemizada.",
    oQueNaoEntra: "CR bruto de NF sem rateio; pedido sem título.",
    comoInterpretar:
      "É o que o financeiro já enxerga como título. Divergência técnica vira tag, não muda o status.",
  },
  FATURADO_SEM_CR: {
    metricKey: "FATURADO_SEM_CR",
    oQueSignifica: "Há NF e/ou documento de saída, mas ainda sem CR.",
    comoCalculamos: "hasNfe/hasStockDocument/hasAllocation e sem CR aberto/recebido.",
    oQueEntra: "Evidência de faturamento/saída na fato.",
    oQueNaoEntra: "Soma de cabeçalhos NF como valor do pedido.",
    comoInterpretar: "Gap operacional entre faturamento e financeiro.",
  },
  CARTEIRA_FUTURA_PROVAVEL: {
    metricKey: "CARTEIRA_FUTURA_PROVAVEL",
    oQueSignifica: "Só pedido em carteira com previsão > 30 dias.",
    comoCalculamos: "Sem NF/doc/CR; daysUntilForecast > 30.",
    oQueEntra: "Valor oficial do pedido / saldo ORDER.",
    oQueNaoEntra: "CR; cabeçalho NF; probabilidade inventada.",
    comoInterpretar: "Carteira futura — não é atraso de cliente.",
  },
  CARTEIRA_PRESENTE_ATENCAO: {
    metricKey: "CARTEIRA_PRESENTE_ATENCAO",
    oQueSignifica: "Só pedido; previsão nos próximos 30 dias ou atraso ≤ 60 dias.",
    comoCalculamos: "Sem NF/doc/CR; janela presente/atenção.",
    oQueEntra: "Pedido oficial com forecastDate na janela.",
    oQueNaoEntra: "Título CR vencido (esse é outro conceito).",
    comoInterpretar: "Priorizar faturamento ou atualizar previsão.",
  },
  CARTEIRA_VENCIDA_BLOQUEADA: {
    metricKey: "CARTEIRA_VENCIDA_BLOQUEADA",
    oQueSignifica: "Pedido antigo/sem evolução, sem NF/documento/CR.",
    comoCalculamos: "Sem NF/doc/CR; atraso de previsão > 60 dias ou pedido stale.",
    oQueEntra: "Pedidos ORDER_ONLY antigos (ex.: Britânia críticos).",
    oQueNaoEntra: "Títulos CR abertos vencidos (usar OPEN_OVERDUE_RECEIVABLE).",
    comoInterpretar:
      "Baixa confiança; não acusar cliente de inadimplência sem CR aberto vencido.",
  },
  SEM_EVIDENCIA: {
    metricKey: "SEM_EVIDENCIA",
    oQueSignifica: "Dados insuficientes para classificar.",
    comoCalculamos: "Nenhuma regra anterior casou com segurança.",
    oQueEntra: "Pedidos sem forecast/evidência mínima.",
    oQueNaoEntra: "Valores inventados.",
    comoInterpretar: PORTFOLIO_INFO_UNAVAILABLE,
  },
  DIVERGENCIA_TECNICA: {
    metricKey: "DIVERGENCIA_TECNICA",
    oQueSignifica: "Alerta técnico (vínculo/alocação/qualidade), não status de carteira.",
    comoCalculamos: "Tags a partir de factStatus/alerts; status principal permanece o financeiro.",
    oQueEntra: "OVER_LINKED, DATA_QUALITY, AMBIGUOUS, alertas de cabeçalho, etc.",
    oQueNaoEntra: "Não move o pedido para outro card de maturidade.",
    comoInterpretar: "Revisar vínculo; o valor do pedido não deve ser duplicado.",
  },
  CONFIDENCE_SCORE: {
    metricKey: "CONFIDENCE_SCORE",
    oQueSignifica: "Índice 0–100 da qualidade evidencial do pedido.",
    comoCalculamos: "Faixa por status + ajustes (divergência, cabeçalho, condição, fato LOW/BLOCKED).",
    oQueEntra: "Sinais de recebimento, CR, NF, documento, alocação, datas.",
    oQueNaoEntra: "Score de comissão; probabilidade comercial inventada.",
    comoInterpretar: "ALTA ≥80; MEDIA 60–79; BAIXA 30–59; MUITO_BAIXA <30.",
  },
  RISCO_SUPERESTIMACAO: {
    metricKey: "RISCO_SUPERESTIMACAO",
    oQueSignifica: "Risco de inflar a carteira se usar cabeçalho de NF.",
    comoCalculamos: "nfeHeaderValue > orderValue (deduplicado por NF).",
    oQueEntra: "Diferença cabeçalho − pedido como risco.",
    oQueNaoEntra: "Cabeçalho como saldo projetado.",
    comoInterpretar: "Sempre limitar ao valor oficial do pedido.",
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
