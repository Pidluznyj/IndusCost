/**
 * Visão comercial do cliente — base principal: Pedidos de Venda (SalesOrder).
 */

import type { SalesOrderLinkStatus } from "@/src/types/commercial";
import {
  buildPortfolioAbcForCustomer,
  enrichCrossSellFromMix,
  type CommercialHealthLevel,
  type CommercialSegment,
  type Phase2IntelResult,
  type PortfolioAbcResult,
  type RepurchaseWindowStatus,
  HEALTH_LEVEL_LABEL_PT,
  REPURCHASE_WINDOW_LABEL_PT,
  COMMERCIAL_INTEL_VERSION,
} from "@/src/lib/customerCommercialShared";
import {
  isCancelledSalesOrderStatus,
  isOpenPortfolioOrder,
} from "@/src/lib/salesOrderDashboardRules";

export const COMMERCIAL_SALES_ORDER_BASIS_NOTE =
  "Indicadores calculados com base nos Pedidos de Venda do cliente. Pedidos cancelados e com erro são desconsiderados dos indicadores comerciais principais.";

export const ABC_METHODOLOGY_SALES_ORDERS_PT =
  "Curva ABC pela soma do valor líquido de pedidos de venda válidos por cliente, ordenados do maior para o menor: clientes que compõem os primeiros 80% da receita de pedidos da carteira = A; até 95% = B; restante = C.";

export const SALES_ORDER_STATUS_LABELS: Record<SalesOrderLinkStatus, string> = {
  DRAFT: "Rascunho",
  READY_TO_SEND: "Pronto para envio",
  SENT_TO_NOMUS: "Enviado ao Nomus",
  CANCELLED: "Cancelado",
  ERROR: "Erro",
};

const SEGMENT_LABELS_PT: Record<CommercialSegment, string> = {
  ESTRATEGICO: "Estratégico",
  RECORRENTE: "Recorrente",
  OPORTUNIDADE: "Oportunidade",
  EM_RISCO: "Em risco",
  INATIVO: "Inativo",
};

const EXCLUDED_METRICS_STATUSES = new Set<SalesOrderLinkStatus>(["CANCELLED", "ERROR"]);

export type SalesOrderIntelSlice = {
  id: string;
  orderCode: string;
  status: SalesOrderLinkStatus;
  issueDate: string;
  updatedAt: string;
  totalNetValue: unknown;
  totalMarginPerc: unknown;
  responsible?: string | null;
  hasInvoicing: boolean;
};

export function normalizeCustomerDocument(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function normalizeCustomerName(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function salesOrderMatchesCustomer(
  orderCustomerId: string,
  customer: { id: string; taxId?: string | null },
  orderCustomerTaxId?: string | null
): boolean {
  if (orderCustomerId === customer.id) return true;
  const doc = normalizeCustomerDocument(customer.taxId);
  const orderDoc = normalizeCustomerDocument(orderCustomerTaxId);
  return doc.length > 0 && doc === orderDoc;
}

export function safeCommercialNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function salesOrderHasInvoicing(nomusRawResponse: unknown): boolean {
  if (!nomusRawResponse || typeof nomusRawResponse !== "object") return false;
  const nfes = (nomusRawResponse as { nfes?: unknown }).nfes;
  if (!Array.isArray(nfes)) return false;
  return nfes.some((nfe) => {
    if (!nfe || typeof nfe !== "object") return false;
    const dp = String((nfe as { dataProcessamento?: unknown }).dataProcessamento ?? "").trim();
    return dp.length > 0;
  });
}

export function isCommercialMetricsSalesOrder(status: string): boolean {
  return !isCancelledSalesOrderStatus(status) && status !== "ERROR";
}

export function isCommercialOpenSalesOrder(order: Pick<SalesOrderIntelSlice, "status" | "hasInvoicing">): boolean {
  return isOpenPortfolioOrder({
    status: order.status,
    hasNfeDataProcessamento: order.hasInvoicing,
  });
}

export function buildPortfolioAbcFromSalesOrders(
  rows: Array<{ customerId: string; revenue: number }>,
  customerId: string
): PortfolioAbcResult {
  const abc = buildPortfolioAbcForCustomer(rows, customerId);
  return {
    ...abc,
    basisLabel: "Soma de totalNetValue em pedidos de venda válidos (exclui cancelados e erro)",
    methodologyNote: ABC_METHODOLOGY_SALES_ORDERS_PT,
  };
}

function daysBetweenIso(a: string, b: Date): number {
  const t1 = new Date(a).getTime();
  const t2 = b.getTime();
  return Math.floor((t2 - t1) / 86400000);
}

function medianSorted(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}

export function computeCommercialPhase2FromSalesOrders(
  orders: SalesOrderIntelSlice[],
  portfolioAbc: PortfolioAbcResult,
  now = new Date()
): Phase2IntelResult {
  const valid = orders
    .filter((o) => isCommercialMetricsSalesOrder(o.status))
    .sort((a, b) => new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime());

  const intervals: number[] = [];
  for (let i = 1; i < valid.length; i++) {
    intervals.push(daysBetweenIso(valid[i - 1]!.issueDate, new Date(valid[i]!.issueDate)));
  }
  const intervalsSorted = [...intervals].sort((a, b) => a - b);
  const medianDays = medianSorted(intervalsSorted);
  const meanDays =
    intervals.length > 0 ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;

  const lastOrder = valid.length ? valid[valid.length - 1]! : null;
  const lastOrderDate = lastOrder?.issueDate ?? null;
  const daysSinceLastOrder = lastOrderDate ? daysBetweenIso(lastOrderDate, now) : null;

  let predictedNextOrderDate: string | null = null;
  if (lastOrderDate && medianDays != null && medianDays > 0) {
    const d = new Date(lastOrderDate);
    d.setDate(d.getDate() + Math.round(medianDays));
    predictedNextOrderDate = d.toISOString();
  }

  let windowStatus: RepurchaseWindowStatus = "INSUFICIENTE";
  let windowDetail = "";
  if (valid.length < 2 || medianDays == null || medianDays <= 0) {
    windowStatus = "INSUFICIENTE";
    windowDetail = "É necessário ao menos dois pedidos válidos para estimar intervalo entre compras.";
  } else if (daysSinceLastOrder == null) {
    windowStatus = "INSUFICIENTE";
    windowDetail = "Sem data de último pedido.";
  } else {
    const ratio = daysSinceLastOrder / medianDays;
    if (ratio <= 0.85) {
      windowStatus = "DENTRO_JANELA";
      windowDetail = `Último pedido há ${daysSinceLastOrder} dias; mediana histórica entre pedidos ≈ ${Math.round(medianDays)} dias.`;
    } else if (ratio <= 1.15) {
      windowStatus = "PROXIMA";
      windowDetail = `Próximo da janela típica de novo pedido (mediana ≈ ${Math.round(medianDays)} dias).`;
    } else {
      windowStatus = "ATRASADO";
      windowDetail = "Acima do intervalo típico desde o último pedido — priorizar contato comercial.";
    }
  }

  const allSortedByUpdate = [...orders].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  const lastMove = allSortedByUpdate[0];
  const daysSinceAnyUpdate = lastMove ? daysBetweenIso(lastMove.updatedAt, now) : null;

  const openOrders = valid.filter((o) => isCommercialOpenSalesOrder(o));
  const openNet = openOrders.reduce((a, o) => a + safeCommercialNumber(o.totalNetValue), 0);
  const ordersNetTotal = valid.reduce((a, o) => a + safeCommercialNumber(o.totalNetValue), 0);

  const marginSamples = valid.map((o) => safeCommercialNumber(o.totalMarginPerc));
  const marginAvg =
    marginSamples.length > 0
      ? marginSamples.reduce((x, y) => x + y, 0) / marginSamples.length
      : 0;

  const t180 = new Date(now);
  t180.setDate(t180.getDate() - 180);
  const t360 = new Date(now);
  t360.setDate(t360.getDate() - 360);

  const recent180 = valid.filter((o) => new Date(o.issueDate) >= t180);
  const prior180 = valid.filter((o) => {
    const c = new Date(o.issueDate);
    return c < t180 && c >= t360;
  });
  const recent180dApprovedNet = recent180.reduce(
    (a, o) => a + safeCommercialNumber(o.totalNetValue),
    0
  );
  const prior180dApprovedNet = prior180.reduce(
    (a, o) => a + safeCommercialNumber(o.totalNetValue),
    0
  );

  let trendNote: string | null = null;
  if (prior180.length >= 1 && recent180.length >= 1) {
    if (prior180dApprovedNet > 0 && recent180dApprovedNet < prior180dApprovedNet * 0.7) {
      trendNote =
        "Volume de pedidos nos últimos 180 dias caiu em relação aos 180 dias anteriores — revisar demanda ou relacionamento.";
    }
  } else if (valid.length >= 3 && prior180dApprovedNet === 0 && recent180dApprovedNet > 0) {
    trendNote = "Crescimento recente de pedidos após período mais fraco — monitorar sustentabilidade.";
  }

  let score = 50;
  const healthReasons: string[] = [];

  if (valid.length === 0) {
    score = 8;
    healthReasons.push("Nenhum pedido de venda válido registrado para este cliente.");
  } else {
    if (daysSinceAnyUpdate != null && daysSinceAnyUpdate <= 30) {
      score += 18;
      healthReasons.push("Movimentação comercial recente (atualização de pedido ≤ 30 dias).");
    }
    if (openOrders.length > 0) {
      score += 14;
      healthReasons.push(`Carteira em aberto: ${openOrders.length} pedido(s) sem faturamento processado.`);
    }
    if (daysSinceLastOrder != null && medianDays != null && medianDays > 0) {
      if (daysSinceLastOrder <= medianDays * 1.05) {
        score += 12;
        healthReasons.push("Último pedido alinhado à mediana de intervalo entre compras.");
      } else if (daysSinceLastOrder > medianDays * 1.5) {
        score -= 22;
        healthReasons.push("Tempo desde o último pedido acima do intervalo típico.");
      }
    }
    if (daysSinceLastOrder != null && daysSinceLastOrder > 180) {
      score -= 18;
      healthReasons.push("Mais de 180 dias sem novo pedido.");
    }
    if (daysSinceAnyUpdate != null && daysSinceAnyUpdate > 120) {
      score -= 16;
      healthReasons.push("Sem atualização em pedidos há mais de 120 dias.");
    }
    if (marginAvg >= 12 && valid.length > 0) {
      score += 8;
      healthReasons.push(`Margem média nos pedidos favorável (~${marginAvg.toFixed(1)}%).`);
    }
    if (
      portfolioAbc.abcClass === "A" &&
      openNet === 0 &&
      daysSinceLastOrder != null &&
      daysSinceLastOrder > 45
    ) {
      score -= 10;
      healthReasons.push("Cliente relevante na carteira (ABC A) sem carteira aberta e sem pedido recente.");
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let level: CommercialHealthLevel = "ATENCAO";
  if (valid.length === 0 || (daysSinceAnyUpdate != null && daysSinceAnyUpdate > 365)) {
    level = "INATIVO";
  } else if (score >= 72) {
    level = "SAUDAVEL";
  } else if (score >= 42) {
    level = "ATENCAO";
  } else if (score >= 18) {
    level = "EM_RISCO";
  } else {
    level = "INATIVO";
  }

  const strategicAlerts: Phase2IntelResult["strategicAlerts"] = [];
  if (windowStatus === "ATRASADO") {
    strategicAlerts.push({
      level: "warn",
      text: "Janela de recompra em atraso — agendar abordagem comercial.",
    });
  }
  openOrders.forEach((o) => {
    const du = daysBetweenIso(o.updatedAt, now);
    if (du > 30) {
      strategicAlerts.push({
        level: "warn",
        text: `Pedido ${o.orderCode} em carteira há ${du} dias sem faturamento processado.`,
      });
    }
  });

  const crossSell: string[] = [];
  if (valid.length >= 2) {
    crossSell.push(
      "Revise o mix de SKUs nos pedidos do cliente — diversificação reduz concentração de receita."
    );
  }

  const nextActions: Phase2IntelResult["nextActions"] = [];
  if (openOrders.length > 0) {
    nextActions.push({
      text: `Acompanhar ${openOrders.length} pedido(s) em carteira (R$ ${openNet.toFixed(0)}).`,
      kind: "follow_up",
    });
  }
  if (windowStatus === "ATRASADO" || windowStatus === "PROXIMA") {
    nextActions.push({
      text: "Contatar cliente alinhando próximo pedido (base: histórico de compras).",
      kind: "follow_up",
    });
  }
  if (portfolioAbc.abcClass === "A" && openNet === 0) {
    nextActions.push({
      text: "Cliente classe A sem carteira aberta: priorizar visita ou novo pedido para proteger a carteira.",
      kind: "risk",
    });
  }

  let primary: CommercialSegment = "OPORTUNIDADE";
  const segReasons: string[] = [];

  if (level === "INATIVO") {
    primary = "INATIVO";
    segReasons.push("Pouca ou nenhuma atividade comercial recente em pedidos.");
  } else if (level === "EM_RISCO") {
    primary = "EM_RISCO";
    segReasons.push("Health score e sinais de tempo indicam risco de esfriamento.");
  } else if (portfolioAbc.abcClass === "A" && ordersNetTotal > 0) {
    primary = "ESTRATEGICO";
    segReasons.push("Peso na carteira (ABC A) com histórico de pedidos.");
  } else if (openNet > 0 && valid.length <= 1) {
    primary = "OPORTUNIDADE";
    segReasons.push("Carteira ativa com histórico curto — foco em conversão e recorrência.");
  } else if (valid.length >= 3 && medianDays != null && medianDays < 130) {
    primary = "RECORRENTE";
    segReasons.push("Intervalo típico entre pedidos sugere compra recorrente.");
  } else if (level === "SAUDAVEL" && valid.length >= 2) {
    primary = "RECORRENTE";
    segReasons.push("Relacionamento saudável com histórico de pedidos.");
  } else {
    primary = "OPORTUNIDADE";
    segReasons.push("Potencial a desenvolver com mais histórico ou maior participação na carteira.");
  }

  const sharePctStr =
    portfolioAbc.portfolioApprovedTotal > 0
      ? portfolioAbc.shareOfPortfolioPct.toFixed(1)
      : "0";
  const managerial = {
    summary: `Carteira: este cliente representa ~${sharePctStr}% da receita de pedidos da carteira (${portfolioAbc.customerCount} clientes com pedidos). ABC: ${portfolioAbc.abcClass ?? "—"}. Segmento: ${SEGMENT_LABELS_PT[primary]}.`,
  };

  return {
    version: COMMERCIAL_INTEL_VERSION,
    proxyNote: COMMERCIAL_SALES_ORDER_BASIS_NOTE,
    health: { level, score, reasons: healthReasons },
    repurchase: {
      basis: "Intervalos entre datas de emissão de pedidos de venda válidos",
      medianDaysBetweenApprovals: medianDays,
      meanDaysBetweenApprovals: meanDays,
      lastApprovalDate: lastOrderDate,
      daysSinceLastApproval: daysSinceLastOrder,
      predictedNextApprovalDate: predictedNextOrderDate,
      windowStatus,
      windowDetail,
    },
    segment: {
      primary,
      labelsPt: SEGMENT_LABELS_PT,
      reasons: segReasons,
    },
    portfolioAbc,
    crossSell,
    nextActions: nextActions.slice(0, 8),
    strategicAlerts: strategicAlerts.slice(0, 14),
    trend: {
      recent180dApprovedNet,
      prior180dApprovedNet,
      note: trendNote,
    },
    managerial,
  };
}

export function enrichCrossSellFromSalesOrderMix(
  mix: Array<{ sku: string; type: string; revenue: number }>,
  orderCount: number
): string[] {
  return enrichCrossSellFromMix(mix, orderCount);
}

export function computeCustomerSalesOrderTicketAverage(
  revenue: number,
  orderCount: number
): number {
  if (!Number.isFinite(revenue) || !Number.isFinite(orderCount) || orderCount <= 0) return 0;
  const ticket = revenue / orderCount;
  return Number.isFinite(ticket) ? ticket : 0;
}

export { HEALTH_LEVEL_LABEL_PT, REPURCHASE_WINDOW_LABEL_PT };
