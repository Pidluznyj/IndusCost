/**
 * Analytics / KPIs do Funil Pedido → Caixa.
 *
 * Agrega linhas já classificadas (`ClassifiedSalesOrderFunnelRow`).
 * Um valor por estágio principal — alertas não duplicam carteira.
 * Não usa Proposal nem Comissões. Sem I/O / write / migration.
 *
 * @see docs/sales/sales-order-to-cash-funnel-requirements.md
 */

import {
  getSalesOrderToCashFunnelStageLabel,
  SALES_ORDER_TO_CASH_FUNNEL_STAGES,
  type ClassifiedSalesOrderFunnelRow,
  type SalesOrderToCashAlert,
  type SalesOrderToCashFunnelStage,
  type SalesOrderToCashStageGroup,
  type SalesOrderToCashTemperature,
} from "./salesOrderToCashFunnelClassification.js";

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function round1(n: number): number {
  return Number(n.toFixed(1));
}

function toNumber(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value;
}

function pct(part: number, whole: number): number | null {
  if (!Number.isFinite(whole) || whole <= 0) return null;
  return round1((part / whole) * 100);
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return round1(nums.reduce((s, n) => s + n, 0) / nums.length);
}

/** Confiança média ponderada pelo valor do estágio (sem remuneração). */
function weightedConfidenceAvg(
  rows: readonly ClassifiedSalesOrderFunnelRow[]
): number | null {
  let weight = 0;
  let sum = 0;
  for (const row of rows) {
    const w = stageValue(row);
    if (w <= 0) continue;
    weight += w;
    sum += row.confidenceScore * w;
  }
  if (weight <= 0) return avg(rows.map((r) => r.confidenceScore));
  return round1(sum / weight);
}

export const ORDER_TO_CASH_SELLER_UNAVAILABLE_LABEL = "Sem vendedor informado";
export const ORDER_TO_CASH_CUSTOMER_UNAVAILABLE_LABEL = "Cliente sem nome";

export function displayOrderToCashSellerName(
  sellerId: string | null | undefined,
  sellerName: string | null | undefined
): string {
  const name = String(sellerName ?? "").trim();
  if (name) return name;
  const id = String(sellerId ?? "").trim();
  if (id) return `Vendedor ${id}`;
  return ORDER_TO_CASH_SELLER_UNAVAILABLE_LABEL;
}

export function displayOrderToCashCustomerName(
  customerId: string | null | undefined,
  customerName: string | null | undefined
): string {
  const name = String(customerName ?? "").trim();
  if (name) return name;
  const id = String(customerId ?? "").trim();
  if (id) return `Cliente ${id}`;
  return ORDER_TO_CASH_CUSTOMER_UNAVAILABLE_LABEL;
}

const RISK_STAGES: ReadonlySet<SalesOrderToCashFunnelStage> = new Set([
  "BLOQUEADO_REVISAO",
  "PEDIDO_ATRASADO_SEM_DOCUMENTO",
  "SEM_EVIDENCIA",
]);

const NO_DOCUMENT_STAGES: ReadonlySet<SalesOrderToCashFunnelStage> = new Set([
  "PEDIDO_EMITIDO",
  "PEDIDO_FUTURO_SAUDAVEL",
  "PEDIDO_PROXIMO_ATENCAO",
  "PEDIDO_ATRASADO_SEM_DOCUMENTO",
  "PEDIDO_PARCIALMENTE_ATENDIDO",
  "PEDIDO_TOTALMENTE_ATENDIDO",
  "PEDIDO_ATENDIDO_COM_EXCEDENTE",
  "BLOQUEADO_REVISAO",
  "SEM_EVIDENCIA",
]);

const OLD_ORDER_DAYS = 90;

function sumStage(
  rows: readonly ClassifiedSalesOrderFunnelRow[],
  stages: readonly SalesOrderToCashFunnelStage[]
): number {
  const set = new Set(stages);
  return round2(
    rows.filter((r) => set.has(r.funnelStage)).reduce((s, r) => s + stageValue(r), 0)
  );
}

function resolveRecommendedAction(
  rows: readonly ClassifiedSalesOrderFunnelRow[],
  bottleneck: SalesOrderToCashFunnelStage | null
): string {
  if (!bottleneck) return "Manter acompanhamento da carteira.";
  const hit = rows.find((r) => r.funnelStage === bottleneck);
  if (hit?.actionRecommendation?.trim()) return hit.actionRecommendation.trim();
  return `Priorizar pedidos em ${getSalesOrderToCashFunnelStageLabel(bottleneck)}.`;
}

function hasCrOrBeyond(row: ClassifiedSalesOrderFunnelRow): boolean {
  return (
    row.hasOpenCr ||
    row.hasReceipt ||
    row.funnelStage === "CR_ABERTO" ||
    row.funnelStage === "RECEBIDO"
  );
}

function hasReceiptStage(row: ClassifiedSalesOrderFunnelRow): boolean {
  return row.hasReceipt || row.funnelStage === "RECEBIDO";
}

export type FunnelAnalyticsCardSeverity =
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "neutral";

export type SalesOrderToCashFunnelSummaryCard = {
  key: string;
  title: string;
  value: number;
  count: number;
  percent: number | null;
  group: SalesOrderToCashStageGroup | "RESUMO" | "RISCO_REF";
  severity: FunnelAnalyticsCardSeverity;
  explanation: string;
  /** Quando true, o valor é referenciado e NÃO soma carteira ativa. */
  doesNotSumPortfolio?: boolean;
};

export type SalesOrderToCashFunnelStageAnalytics = {
  stage: SalesOrderToCashFunnelStage;
  label: string;
  count: number;
  value: number;
  percentOfTotal: number | null;
  confidenceAvg: number | null;
  topCustomers: Array<{ customerId: string | null; customerName: string | null; value: number; count: number }>;
  topSellers: Array<{ sellerId: string | null; sellerName: string | null; value: number; count: number }>;
  actionRecommendation: string;
};

export type SalesOrderToCashStageGroupAnalytics = {
  group: SalesOrderToCashStageGroup;
  count: number;
  value: number;
  percentOfTotal: number | null;
};

export type SalesOrderToCashTemperatureSummary = {
  temperature: SalesOrderToCashTemperature;
  count: number;
  value: number;
  percentOfTotal: number | null;
};

export type SalesOrderToCashRiskItem = {
  orderId: string;
  orderCode: string | null;
  customerName: string | null;
  sellerName: string | null;
  funnelStage: SalesOrderToCashFunnelStage;
  value: number;
  alerts: SalesOrderToCashAlert[];
  reason: string;
};

export type SalesOrderToCashRiskSummary = {
  valorBloqueado: number;
  valorAtrasadoSemDocumento: number;
  valorDocumentoNfSemCr: number;
  valorComExcesso: number;
  valorComProdutoForaDoPedido: number;
  /** Referências de alerta — não somam carteira. */
  note: string;
  topRisks: SalesOrderToCashRiskItem[];
};

export type SalesOrderToCashSellerSummary = {
  sellerId: string | null;
  /** Nome comercial do pedido; sem nome → “Sem vendedor informado”. */
  sellerName: string;
  orderCount: number;
  valorTotal: number;
  valorFuturoSaudavel: number;
  /** @deprecated alias de valorFuturoSaudavel (compat). */
  valorSaudavel: number;
  valorEmAtencao: number;
  valorBloqueado: number;
  valorParcialmenteAtendido: number;
  valorCrAberto: number;
  valorRecebido: number;
  /** Bloqueado + atrasado sem documento + sem evidência (não duplica estágio). */
  valorEmRisco: number;
  /** % valor pedido → CR (CR aberto ou recebido) / valor total. */
  taxaPedidoParaCr: number | null;
  /** % valor pedido → recebido / valor total. */
  taxaPedidoParaRecebido: number | null;
  /** @deprecated alias de taxaPedidoParaCr (compat). */
  taxaConversaoParaCr: number | null;
  /** Confiança média ponderada pelo valor do estágio. */
  confiancaMedia: number | null;
  principalGargalo: SalesOrderToCashFunnelStage | null;
  principalGargaloLabel: string | null;
  acaoRecomendada: string;
};

export type SalesOrderToCashCustomerSummary = {
  customerId: string | null;
  /** Sem nome → “Cliente sem nome”. */
  customerName: string;
  orderCount: number;
  valorTotal: number;
  valorBloqueado: number;
  valorSemDocumento: number;
  valorDocumentoNfSemCr: number;
  valorCrAberto: number;
  valorRecebido: number;
  valorEmRisco: number;
  taxaPedidoParaCr: number | null;
  confiancaMedia: number | null;
  pedidosAntigosCount: number;
  principalGargalo: SalesOrderToCashFunnelStage | null;
  principalGargaloLabel: string | null;
  acaoRecomendada: string;
};

export type SalesOrderToCashConversionMetrics = {
  pedidoParaDocumento: { count: number; total: number; percent: number | null };
  pedidoParaNf: { count: number; total: number; percent: number | null };
  pedidoParaCr: { count: number; total: number; percent: number | null };
  crParaBaixa: { count: number; total: number; percent: number | null };
  documentoNfParaCr: { count: number; total: number; percent: number | null };
  pedidoTotalOuParcialAtendido: { count: number; total: number; percent: number | null };
};

export type SalesOrderToCashAgingMetrics = {
  idadeMediaPedidoDias: number | null;
  idadeMediaPorEstagio: Array<{
    stage: SalesOrderToCashFunnelStage;
    label: string;
    avgDaysSinceIssue: number | null;
  }>;
  avgDaysSinceIssue: number | null;
  avgDaysSinceExpectedDelivery: number | null;
  avgDaysSinceLastAdvance: number | null;
};

export type SalesOrderToCashRecommendedAction = {
  priority: number;
  stage: SalesOrderToCashFunnelStage;
  title: string;
  count: number;
  value: number;
  actionRecommendation: string;
};

export type SalesOrderToCashFunnelAnalytics = {
  summaryCards: SalesOrderToCashFunnelSummaryCard[];
  funnelStages: SalesOrderToCashFunnelStageAnalytics[];
  stageGroups: SalesOrderToCashStageGroupAnalytics[];
  temperatureSummary: SalesOrderToCashTemperatureSummary[];
  riskSummary: SalesOrderToCashRiskSummary;
  sellerSummary: SalesOrderToCashSellerSummary[];
  customerSummary: SalesOrderToCashCustomerSummary[];
  conversionMetrics: SalesOrderToCashConversionMetrics;
  agingMetrics: SalesOrderToCashAgingMetrics;
  recommendedActions: SalesOrderToCashRecommendedAction[];
  /** Totais de auditoria (sem cancelados no forecast). */
  totals: {
    orderCount: number;
    activeOrderCount: number;
    canceledOrderCount: number;
    activeStageValueSum: number;
    canceledCount: number;
  };
};

export type BuildSalesOrderToCashFunnelAnalyticsInput = {
  rows: readonly ClassifiedSalesOrderFunnelRow[];
};

const FORECAST_EXCLUDED: ReadonlySet<SalesOrderToCashFunnelStage> = new Set([
  "CANCELADO",
  "CLIENTE_COM_HISTORICO",
]);

const ACTIVE_PIPELINE_EXCLUDED: ReadonlySet<SalesOrderToCashFunnelStage> = new Set([
  "CANCELADO",
  "RECEBIDO",
  "CLIENTE_COM_HISTORICO",
]);

const BOTTLENECK_PRIORITY: Record<SalesOrderToCashFunnelStage, number> = {
  BLOQUEADO_REVISAO: 100,
  PEDIDO_ATRASADO_SEM_DOCUMENTO: 90,
  SEM_EVIDENCIA: 85,
  NF_SEM_CR: 80,
  DOCUMENTO_SEM_NF: 75,
  PEDIDO_ATENDIDO_COM_EXCEDENTE: 70,
  PEDIDO_PARCIALMENTE_ATENDIDO: 65,
  PEDIDO_PROXIMO_ATENCAO: 60,
  CR_ABERTO: 55,
  PEDIDO_TOTALMENTE_ATENDIDO: 40,
  PEDIDO_EMITIDO: 30,
  PEDIDO_FUTURO_SAUDAVEL: 20,
  RECEBIDO: 5,
  CANCELADO: 0,
  CLIENTE_COM_HISTORICO: 0,
};

function isForecastEligible(row: ClassifiedSalesOrderFunnelRow): boolean {
  return !row.isCanceled && !FORECAST_EXCLUDED.has(row.funnelStage);
}

function stageValue(row: ClassifiedSalesOrderFunnelRow): number {
  return round2(toNumber(row.valueForStage));
}

function topEntities<T extends { value: number; count: number }>(
  map: Map<string, T>,
  limit = 5
): T[] {
  return [...map.values()].sort((a, b) => b.value - a.value || b.count - a.count).slice(0, limit);
}

function resolveBottleneck(
  rows: ClassifiedSalesOrderFunnelRow[]
): SalesOrderToCashFunnelStage | null {
  const eligible = rows.filter((r) => isForecastEligible(r) && r.funnelStage !== "RECEBIDO");
  if (eligible.length === 0) return null;
  let best: ClassifiedSalesOrderFunnelRow | null = null;
  let bestScore = -1;
  for (const row of eligible) {
    const score =
      (BOTTLENECK_PRIORITY[row.funnelStage] ?? 0) * 1_000_000 + stageValue(row);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  return best?.funnelStage ?? null;
}

function buildFunnelStages(
  rows: readonly ClassifiedSalesOrderFunnelRow[],
  totalActiveValue: number
): SalesOrderToCashFunnelStageAnalytics[] {
  return SALES_ORDER_TO_CASH_FUNNEL_STAGES.map((stage) => {
    const stageRows = rows.filter((r) => r.funnelStage === stage);
    const value = round2(stageRows.reduce((s, r) => s + stageValue(r), 0));
    const customers = new Map<
      string,
      { customerId: string | null; customerName: string | null; value: number; count: number }
    >();
    const sellers = new Map<
      string,
      { sellerId: string | null; sellerName: string | null; value: number; count: number }
    >();
    for (const row of stageRows) {
      const ck = row.customerId ?? row.customerName ?? "unknown";
      const c = customers.get(ck) ?? {
        customerId: row.customerId,
        customerName: row.customerName,
        value: 0,
        count: 0,
      };
      c.value = round2(c.value + stageValue(row));
      c.count += 1;
      customers.set(ck, c);

      const sk = row.sellerId ?? row.sellerName ?? "unknown";
      const s = sellers.get(sk) ?? {
        sellerId: row.sellerId,
        sellerName: row.sellerName,
        value: 0,
        count: 0,
      };
      s.value = round2(s.value + stageValue(row));
      s.count += 1;
      sellers.set(sk, s);
    }
    const confidences = stageRows.map((r) => r.confidenceScore);
    const action =
      stageRows[0]?.actionRecommendation ??
      `Revisar pedidos em ${getSalesOrderToCashFunnelStageLabel(stage)}.`;
    return {
      stage,
      label: getSalesOrderToCashFunnelStageLabel(stage),
      count: stageRows.length,
      value,
      percentOfTotal: pct(value, totalActiveValue),
      confidenceAvg: avg(confidences),
      topCustomers: topEntities(customers),
      topSellers: topEntities(sellers),
      actionRecommendation: action,
    };
  });
}

function buildSummaryCards(
  rows: readonly ClassifiedSalesOrderFunnelRow[],
  activeValue: number
): SalesOrderToCashFunnelSummaryCard[] {
  const forecastRows = rows.filter(isForecastEligible);
  const byStage = (stages: SalesOrderToCashFunnelStage[]) =>
    forecastRows.filter((r) => stages.includes(r.funnelStage));

  const activePipeline = forecastRows.filter(
    (r) => !ACTIVE_PIPELINE_EXCLUDED.has(r.funnelStage)
  );
  const futuro = byStage(["PEDIDO_FUTURO_SAUDAVEL"]);
  const atencao = byStage(["PEDIDO_PROXIMO_ATENCAO"]);
  const bloqueado = byStage(["BLOQUEADO_REVISAO"]);
  const parcial = byStage(["PEDIDO_PARCIALMENTE_ATENDIDO"]);
  const total = byStage(["PEDIDO_TOTALMENTE_ATENDIDO", "PEDIDO_ATENDIDO_COM_EXCEDENTE"]);
  const docNfSemCr = byStage(["DOCUMENTO_SEM_NF", "NF_SEM_CR"]);
  const crAberto = byStage(["CR_ABERTO"]);
  const recebido = rows.filter((r) => r.funnelStage === "RECEBIDO");
  const forecastRisco = byStage([
    "BLOQUEADO_REVISAO",
    "PEDIDO_ATRASADO_SEM_DOCUMENTO",
    "SEM_EVIDENCIA",
  ]);

  const card = (
    key: string,
    title: string,
    list: ClassifiedSalesOrderFunnelRow[],
    group: SalesOrderToCashFunnelSummaryCard["group"],
    severity: FunnelAnalyticsCardSeverity,
    explanation: string,
    doesNotSumPortfolio?: boolean
  ): SalesOrderToCashFunnelSummaryCard => {
    const value = round2(list.reduce((s, r) => s + stageValue(r), 0));
    return {
      key,
      title,
      value,
      count: list.length,
      percent: pct(value, activeValue),
      group,
      severity,
      explanation,
      doesNotSumPortfolio,
    };
  };

  return [
    card(
      "valor_pedidos_ativos",
      "Valor em pedidos ativos",
      activePipeline,
      "RESUMO",
      "info",
      "Soma do valueForStage dos pedidos não cancelados e ainda não recebidos (um estágio principal por pedido)."
    ),
    card(
      "pedido_futuro_saudavel",
      "Pedido futuro saudável",
      futuro,
      "COMERCIAL",
      "success",
      "Pedidos com previsão à frente da janela de atenção, sem documento/NF/CR."
    ),
    card(
      "pedido_em_atencao",
      "Pedido em atenção",
      atencao,
      "COMERCIAL",
      "warning",
      "Pedidos na janela próxima da entrega ou recém vencidos, ainda sem evidência fiscal/financeira."
    ),
    card(
      "pedido_bloqueado_revisao",
      "Pedido bloqueado para revisão",
      bloqueado,
      "RISCO",
      "danger",
      "Pedidos antigos/vencidos sem evolução (sem documento, NF ou CR). Temperatura CONGELADO."
    ),
    card(
      "pedido_parcialmente_atendido",
      "Pedido parcialmente atendido",
      parcial,
      "OPERACIONAL",
      "warning",
      "Cobertura parcial no mapa de atendimento — valor no estágio operacional, sem somar alerta."
    ),
    card(
      "pedido_totalmente_atendido",
      "Pedido totalmente atendido",
      total,
      "OPERACIONAL",
      "info",
      "Atendimento total (com ou sem excedente). Excedente gera alerta auxiliar, não card duplicado."
    ),
    card(
      "documento_nf_sem_cr",
      "Documento/NF sem CR",
      docNfSemCr,
      "FISCAL",
      "warning",
      "Há documento de saída e/ou NF, ainda sem Contas a Receber aberto."
    ),
    card(
      "cr_aberto",
      "CR aberto",
      crAberto,
      "FINANCEIRO",
      "info",
      "Direito financeiro formalizado sem baixa total. Não duplica valor do pedido comercial."
    ),
    card(
      "recebido",
      "Recebido",
      recebido,
      "CAIXA",
      "success",
      "Baixa materializada. Não entra em pedidos ativos nem em CR aberto."
    ),
    card(
      "forecast_em_risco",
      "Forecast em risco",
      forecastRisco,
      "RISCO_REF",
      "danger",
      "Referência de risco (bloqueado + atrasado sem documento + sem evidência). Não soma carteira além dos estágios principais já contabilizados.",
      true
    ),
  ];
}

function buildRiskSummary(rows: readonly ClassifiedSalesOrderFunnelRow[]): SalesOrderToCashRiskSummary {
  const forecastRows = rows.filter(isForecastEligible);
  const sumStage = (stage: SalesOrderToCashFunnelStage) =>
    round2(
      forecastRows
        .filter((r) => r.funnelStage === stage)
        .reduce((s, r) => s + stageValue(r), 0)
    );

  const valorBloqueado = sumStage("BLOQUEADO_REVISAO");
  const valorAtrasadoSemDocumento = sumStage("PEDIDO_ATRASADO_SEM_DOCUMENTO");
  const valorDocumentoNfSemCr = round2(
    sumStage("DOCUMENTO_SEM_NF") + sumStage("NF_SEM_CR")
  );

  // Alertas: referenciam orderValue UMA vez por pedido (não somam carteira)
  const withExcess = forecastRows.filter((r) =>
    r.alerts.includes("DOCUMENTO_COM_EXCEDENTE")
  );
  const withOutside = forecastRows.filter((r) =>
    r.alerts.includes("PRODUTO_FORA_DO_PEDIDO")
  );

  const riskCandidates = forecastRows
    .filter(
      (r) =>
        r.funnelStage === "BLOQUEADO_REVISAO" ||
        r.funnelStage === "PEDIDO_ATRASADO_SEM_DOCUMENTO" ||
        r.funnelStage === "SEM_EVIDENCIA" ||
        r.alerts.includes("FORECAST_EM_RISCO") ||
        r.alerts.includes("DOCUMENTO_COM_EXCEDENTE") ||
        r.alerts.includes("PRODUTO_FORA_DO_PEDIDO")
    )
    .map((r) => ({
      orderId: r.orderId,
      orderCode: r.orderCode,
      customerName: r.customerName,
      sellerName: r.sellerName,
      funnelStage: r.funnelStage,
      value: stageValue(r),
      alerts: r.alerts,
      reason:
        r.funnelStage === "BLOQUEADO_REVISAO"
          ? "Pedido bloqueado para revisão"
          : r.funnelStage === "PEDIDO_ATRASADO_SEM_DOCUMENTO"
            ? "Atrasado sem documento"
            : r.alerts.includes("DOCUMENTO_COM_EXCEDENTE")
              ? "Alerta de excedente (não soma carteira)"
              : r.alerts.includes("PRODUTO_FORA_DO_PEDIDO")
                ? "Alerta de produto fora (não soma carteira)"
                : "Forecast em risco",
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  return {
    valorBloqueado,
    valorAtrasadoSemDocumento,
    valorDocumentoNfSemCr,
    valorComExcesso: round2(withExcess.reduce((s, r) => s + toNumber(r.orderValue), 0)),
    valorComProdutoForaDoPedido: round2(
      withOutside.reduce((s, r) => s + toNumber(r.orderValue), 0)
    ),
    note:
      "Valores de excesso/produto fora são referências de alerta e não duplicam a soma por estágio principal.",
    topRisks: riskCandidates,
  };
}

function buildSellerSummary(
  rows: readonly ClassifiedSalesOrderFunnelRow[]
): SalesOrderToCashSellerSummary[] {
  const bySeller = new Map<string, ClassifiedSalesOrderFunnelRow[]>();
  for (const row of rows) {
    if (row.isCanceled) continue;
    const key = (row.sellerId ?? row.sellerName?.trim()) || "sem-vendedor";
    const list = bySeller.get(key) ?? [];
    list.push(row);
    bySeller.set(key, list);
  }

  const result: SalesOrderToCashSellerSummary[] = [];
  for (const list of bySeller.values()) {
    const first = list[0]!;
    const eligible = list.filter(isForecastEligible);
    const valorTotal = round2(eligible.reduce((s, r) => s + stageValue(r), 0));
    const valorFuturoSaudavel = sumStage(eligible, ["PEDIDO_FUTURO_SAUDAVEL"]);
    const valorEmAtencao = sumStage(eligible, ["PEDIDO_PROXIMO_ATENCAO"]);
    const valorBloqueado = sumStage(eligible, ["BLOQUEADO_REVISAO"]);
    const valorParcialmenteAtendido = sumStage(eligible, [
      "PEDIDO_PARCIALMENTE_ATENDIDO",
    ]);
    const valorCrAberto = sumStage(eligible, ["CR_ABERTO"]);
    const valorRecebido = sumStage(list, ["RECEBIDO"]);
    const valorEmRisco = round2(
      eligible
        .filter((r) => RISK_STAGES.has(r.funnelStage))
        .reduce((s, r) => s + stageValue(r), 0)
    );
    const valorComCr = round2(
      eligible.filter(hasCrOrBeyond).reduce((s, r) => s + stageValue(r), 0)
    );
    const valorComRecebido = round2(
      list.filter(hasReceiptStage).reduce((s, r) => s + stageValue(r), 0)
    );
    const taxaPedidoParaCr = pct(valorComCr, valorTotal);
    const taxaPedidoParaRecebido = pct(valorComRecebido, valorTotal);
    const bottleneck = resolveBottleneck(list);
    result.push({
      sellerId: first.sellerId,
      sellerName: displayOrderToCashSellerName(first.sellerId, first.sellerName),
      orderCount: list.length,
      valorTotal,
      valorFuturoSaudavel,
      valorSaudavel: valorFuturoSaudavel,
      valorEmAtencao,
      valorBloqueado,
      valorParcialmenteAtendido,
      valorCrAberto,
      valorRecebido,
      valorEmRisco,
      taxaPedidoParaCr,
      taxaPedidoParaRecebido,
      taxaConversaoParaCr: taxaPedidoParaCr,
      confiancaMedia: weightedConfidenceAvg(eligible),
      principalGargalo: bottleneck,
      principalGargaloLabel: bottleneck
        ? getSalesOrderToCashFunnelStageLabel(bottleneck)
        : null,
      acaoRecomendada: resolveRecommendedAction(list, bottleneck),
    });
  }
  return result.sort((a, b) => b.valorTotal - a.valorTotal || b.orderCount - a.orderCount);
}

function buildCustomerSummary(
  rows: readonly ClassifiedSalesOrderFunnelRow[]
): SalesOrderToCashCustomerSummary[] {
  const byCustomer = new Map<string, ClassifiedSalesOrderFunnelRow[]>();
  for (const row of rows) {
    if (row.isCanceled) continue;
    const key = (row.customerId ?? row.customerName?.trim()) || "sem-cliente";
    const list = byCustomer.get(key) ?? [];
    list.push(row);
    byCustomer.set(key, list);
  }

  const result: SalesOrderToCashCustomerSummary[] = [];
  for (const list of byCustomer.values()) {
    const first = list[0]!;
    const eligible = list.filter(isForecastEligible);
    const valorTotal = round2(eligible.reduce((s, r) => s + stageValue(r), 0));
    const valorBloqueado = sumStage(eligible, ["BLOQUEADO_REVISAO"]);
    const valorSemDocumento = round2(
      eligible
        .filter(
          (r) =>
            NO_DOCUMENT_STAGES.has(r.funnelStage) &&
            !r.hasStockDocument &&
            !r.hasNfe
        )
        .reduce((s, r) => s + stageValue(r), 0)
    );
    const valorDocumentoNfSemCr = sumStage(eligible, [
      "DOCUMENTO_SEM_NF",
      "NF_SEM_CR",
    ]);
    const valorCrAberto = sumStage(eligible, ["CR_ABERTO"]);
    const valorRecebido = sumStage(list, ["RECEBIDO"]);
    const valorEmRisco = round2(
      eligible
        .filter((r) => RISK_STAGES.has(r.funnelStage))
        .reduce((s, r) => s + stageValue(r), 0)
    );
    const valorComCr = round2(
      eligible.filter(hasCrOrBeyond).reduce((s, r) => s + stageValue(r), 0)
    );
    const bottleneck = resolveBottleneck(list);
    const pedidosAntigosCount = list.filter(
      (r) =>
        !r.isCanceled &&
        ((r.daysSinceIssue != null && r.daysSinceIssue >= OLD_ORDER_DAYS) ||
          r.funnelStage === "BLOQUEADO_REVISAO")
    ).length;

    result.push({
      customerId: first.customerId,
      customerName: displayOrderToCashCustomerName(
        first.customerId,
        first.customerName
      ),
      orderCount: list.length,
      valorTotal,
      valorBloqueado,
      valorSemDocumento,
      valorDocumentoNfSemCr,
      valorCrAberto,
      valorRecebido,
      valorEmRisco,
      taxaPedidoParaCr: pct(valorComCr, valorTotal),
      confiancaMedia: weightedConfidenceAvg(eligible),
      pedidosAntigosCount,
      principalGargalo: bottleneck,
      principalGargaloLabel: bottleneck
        ? getSalesOrderToCashFunnelStageLabel(bottleneck)
        : null,
      acaoRecomendada: resolveRecommendedAction(list, bottleneck),
    });
  }
  return result.sort((a, b) => b.valorTotal - a.valorTotal || b.orderCount - a.orderCount);
}

function buildConversionMetrics(
  rows: readonly ClassifiedSalesOrderFunnelRow[]
): SalesOrderToCashConversionMetrics {
  const base = rows.filter((r) => !r.isCanceled);
  const total = base.length;
  const withDoc = base.filter((r) => r.hasStockDocument || r.hasNfe).length;
  const withNf = base.filter((r) => r.hasNfe).length;
  const withCr = base.filter(
    (r) => r.hasOpenCr || r.hasReceipt || r.funnelStage === "CR_ABERTO" || r.funnelStage === "RECEBIDO"
  ).length;
  const withReceipt = base.filter((r) => r.hasReceipt || r.funnelStage === "RECEBIDO").length;
  const withDocOrNf = base.filter((r) => r.hasStockDocument || r.hasNfe);
  const docNfToCr = withDocOrNf.filter(
    (r) => r.hasOpenCr || r.hasReceipt || r.funnelStage === "CR_ABERTO" || r.funnelStage === "RECEBIDO"
  ).length;
  const attended = base.filter((r) =>
    [
      "PEDIDO_PARCIALMENTE_ATENDIDO",
      "PEDIDO_TOTALMENTE_ATENDIDO",
      "PEDIDO_ATENDIDO_COM_EXCEDENTE",
      "DOCUMENTO_SEM_NF",
      "NF_SEM_CR",
      "CR_ABERTO",
      "RECEBIDO",
    ].includes(r.funnelStage)
  ).length;
  const crBase = base.filter(
    (r) =>
      r.hasOpenCr ||
      r.hasReceipt ||
      r.funnelStage === "CR_ABERTO" ||
      r.funnelStage === "RECEBIDO"
  );

  return {
    pedidoParaDocumento: { count: withDoc, total, percent: pct(withDoc, total) },
    pedidoParaNf: { count: withNf, total, percent: pct(withNf, total) },
    pedidoParaCr: { count: withCr, total, percent: pct(withCr, total) },
    crParaBaixa: {
      count: withReceipt,
      total: crBase.length,
      percent: pct(withReceipt, crBase.length),
    },
    documentoNfParaCr: {
      count: docNfToCr,
      total: withDocOrNf.length,
      percent: pct(docNfToCr, withDocOrNf.length),
    },
    pedidoTotalOuParcialAtendido: {
      count: attended,
      total,
      percent: pct(attended, total),
    },
  };
}

function buildAgingMetrics(
  rows: readonly ClassifiedSalesOrderFunnelRow[]
): SalesOrderToCashAgingMetrics {
  const eligible = rows.filter((r) => !r.isCanceled);
  const issueDays = eligible
    .map((r) => r.daysSinceIssue)
    .filter((d): d is number => d != null && Number.isFinite(d));
  const deliveryDays = eligible
    .map((r) => r.daysSinceExpectedDelivery)
    .filter((d): d is number => d != null && Number.isFinite(d));
  const advanceDays = eligible
    .map((r) => r.daysSinceLastAdvance)
    .filter((d): d is number => d != null && Number.isFinite(d));

  const idadeMediaPorEstagio = SALES_ORDER_TO_CASH_FUNNEL_STAGES.map((stage) => {
    const days = eligible
      .filter((r) => r.funnelStage === stage)
      .map((r) => r.daysSinceIssue)
      .filter((d): d is number => d != null && Number.isFinite(d));
    return {
      stage,
      label: getSalesOrderToCashFunnelStageLabel(stage),
      avgDaysSinceIssue: avg(days),
    };
  });

  return {
    idadeMediaPedidoDias: avg(issueDays),
    idadeMediaPorEstagio,
    avgDaysSinceIssue: avg(issueDays),
    avgDaysSinceExpectedDelivery: avg(deliveryDays),
    avgDaysSinceLastAdvance: avg(advanceDays),
  };
}

function buildRecommendedActions(
  funnelStages: SalesOrderToCashFunnelStageAnalytics[]
): SalesOrderToCashRecommendedAction[] {
  const actionable: SalesOrderToCashFunnelStage[] = [
    "BLOQUEADO_REVISAO",
    "PEDIDO_ATRASADO_SEM_DOCUMENTO",
    "NF_SEM_CR",
    "DOCUMENTO_SEM_NF",
    "PEDIDO_PARCIALMENTE_ATENDIDO",
    "PEDIDO_PROXIMO_ATENCAO",
    "CR_ABERTO",
    "SEM_EVIDENCIA",
  ];
  return funnelStages
    .filter((s) => actionable.includes(s.stage) && s.count > 0)
    .map((s, idx) => ({
      priority: BOTTLENECK_PRIORITY[s.stage] ?? 50 - idx,
      stage: s.stage,
      title: s.label,
      count: s.count,
      value: s.value,
      actionRecommendation: s.actionRecommendation,
    }))
    .sort((a, b) => b.priority - a.priority || b.value - a.value);
}

/**
 * Calcula KPIs e agregações do Funil Pedido → Caixa a partir de linhas classificadas.
 */
export function buildSalesOrderToCashFunnelAnalytics(
  input: BuildSalesOrderToCashFunnelAnalyticsInput
): SalesOrderToCashFunnelAnalytics {
  const rows = [...(input.rows ?? [])];
  const forecastRows = rows.filter(isForecastEligible);
  const activeStageValueSum = round2(
    forecastRows.reduce((s, r) => s + stageValue(r), 0)
  );
  const activePipelineValue = round2(
    forecastRows
      .filter((r) => !ACTIVE_PIPELINE_EXCLUDED.has(r.funnelStage))
      .reduce((s, r) => s + stageValue(r), 0)
  );

  const funnelStages = buildFunnelStages(rows, activeStageValueSum);
  const stageGroupMap = new Map<SalesOrderToCashStageGroup, { count: number; value: number }>();
  for (const row of forecastRows) {
    const g = row.stageGroup;
    const cur = stageGroupMap.get(g) ?? { count: 0, value: 0 };
    cur.count += 1;
    cur.value = round2(cur.value + stageValue(row));
    stageGroupMap.set(g, cur);
  }
  const stageGroups: SalesOrderToCashStageGroupAnalytics[] = [
    "COMERCIAL",
    "OPERACIONAL",
    "FISCAL",
    "FINANCEIRO",
    "CAIXA",
    "RISCO",
  ].map((group) => {
    const cur = stageGroupMap.get(group as SalesOrderToCashStageGroup) ?? {
      count: 0,
      value: 0,
    };
    return {
      group: group as SalesOrderToCashStageGroup,
      count: cur.count,
      value: cur.value,
      percentOfTotal: pct(cur.value, activeStageValueSum),
    };
  });

  const tempMap = new Map<SalesOrderToCashTemperature, { count: number; value: number }>();
  for (const row of forecastRows) {
    const cur = tempMap.get(row.temperature) ?? { count: 0, value: 0 };
    cur.count += 1;
    cur.value = round2(cur.value + stageValue(row));
    tempMap.set(row.temperature, cur);
  }
  const temperatureSummary: SalesOrderToCashTemperatureSummary[] = (
    ["QUENTE", "MORNO", "FRIO", "CONGELADO"] as SalesOrderToCashTemperature[]
  ).map((temperature) => {
    const cur = tempMap.get(temperature) ?? { count: 0, value: 0 };
    return {
      temperature,
      count: cur.count,
      value: cur.value,
      percentOfTotal: pct(cur.value, activeStageValueSum),
    };
  });

  const canceledOrderCount = rows.filter((r) => r.isCanceled || r.funnelStage === "CANCELADO")
    .length;

  return {
    summaryCards: buildSummaryCards(rows, activePipelineValue || activeStageValueSum),
    funnelStages,
    stageGroups,
    temperatureSummary,
    riskSummary: buildRiskSummary(rows),
    sellerSummary: buildSellerSummary(rows),
    customerSummary: buildCustomerSummary(rows),
    conversionMetrics: buildConversionMetrics(rows),
    agingMetrics: buildAgingMetrics(rows),
    recommendedActions: buildRecommendedActions(funnelStages),
    totals: {
      orderCount: rows.length,
      activeOrderCount: forecastRows.length,
      canceledOrderCount,
      activeStageValueSum,
      canceledCount: canceledOrderCount,
    },
  };
}
