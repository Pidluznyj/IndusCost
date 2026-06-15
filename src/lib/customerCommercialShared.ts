/**
 * Tipos e utilitários compartilhados da inteligência comercial por cliente.
 * Fonte principal de métricas: Pedidos de Venda — ver customerCommercialSalesOrderView.ts.
 */

export const COMMERCIAL_INTEL_VERSION = 2;

export const ABC_METHODOLOGY_GENERIC_PT =
  "Curva ABC pela soma do valor líquido por cliente, ordenados do maior para o menor: clientes que compõem os primeiros 80% da receita da carteira = A; até 95% = B; restante = C.";

export type CommercialHealthLevel = "SAUDAVEL" | "ATENCAO" | "EM_RISCO" | "INATIVO";

export const HEALTH_LEVEL_LABEL_PT: Record<CommercialHealthLevel, string> = {
  SAUDAVEL: "Saudável",
  ATENCAO: "Atenção",
  EM_RISCO: "Em risco",
  INATIVO: "Inativo",
};

export type RepurchaseWindowStatus =
  | "INSUFICIENTE"
  | "DENTRO_JANELA"
  | "PROXIMA"
  | "ATRASADO";

export const REPURCHASE_WINDOW_LABEL_PT: Record<RepurchaseWindowStatus, string> = {
  INSUFICIENTE: "Histórico insuficiente",
  DENTRO_JANELA: "Dentro da janela",
  PROXIMA: "Próximo da janela",
  ATRASADO: "Atrasado vs. padrão",
};

export type CommercialSegment =
  | "ESTRATEGICO"
  | "RECORRENTE"
  | "OPORTUNIDADE"
  | "EM_RISCO"
  | "INATIVO";

export interface PortfolioAbcResult {
  basisLabel: string;
  portfolioApprovedTotal: number;
  customerApprovedNet: number;
  shareOfPortfolioPct: number;
  rank: number | null;
  customerCount: number;
  abcClass: "A" | "B" | "C" | null;
  abcEligible: boolean;
  methodologyNote: string;
}

export interface CustomerAbcRow {
  customerId: string;
  companyName: string;
  revenue: number;
  rank: number;
  abcClass: "A" | "B" | "C";
  /** Participação do cliente na receita total da carteira (%) */
  shareOfPortfolioPct: number;
  /** Acumulado da receita após incluir este cliente (Pareto, %) */
  cumulativeRevenuePct: number;
}

export interface Phase2IntelResult {
  version: number;
  proxyNote: string;
  health: {
    level: CommercialHealthLevel;
    score: number;
    reasons: string[];
  };
  repurchase: {
    basis: string;
    medianDaysBetweenApprovals: number | null;
    meanDaysBetweenApprovals: number | null;
    lastApprovalDate: string | null;
    daysSinceLastApproval: number | null;
    predictedNextApprovalDate: string | null;
    windowStatus: RepurchaseWindowStatus;
    windowDetail: string;
  };
  segment: {
    primary: CommercialSegment;
    labelsPt: Record<CommercialSegment, string>;
    reasons: string[];
  };
  portfolioAbc: PortfolioAbcResult;
  crossSell: string[];
  nextActions: { text: string; kind: "follow_up" | "expansion" | "risk" }[];
  strategicAlerts: { level: "info" | "warn" | "danger"; text: string }[];
  trend: {
    recent180dApprovedNet: number;
    prior180dApprovedNet: number;
    note: string | null;
  };
  managerial: {
    summary: string;
  };
}

export type PortfolioAbcLabels = {
  basisLabel?: string;
  methodologyNote?: string;
};

/** Monta ABC a partir de receita por cliente (já agregada). Reutilizável em dashboards. */
export function buildPortfolioAbcForCustomer(
  rows: Array<{ customerId: string; revenue: number }>,
  customerId: string,
  labels: PortfolioAbcLabels = {}
): PortfolioAbcResult {
  const positive = rows.filter((r) => r.revenue > 0);
  const total = positive.reduce((a, r) => a + r.revenue, 0);
  const sorted = [...positive].sort((a, b) => b.revenue - a.revenue);
  const portfolioApprovedTotal = total;
  const customerRow = sorted.find((r) => r.customerId === customerId);
  const customerApprovedNet = customerRow?.revenue ?? 0;
  const abcEligible = customerApprovedNet > 0 && total > 0;
  const shareOfPortfolioPct = total > 0 ? (customerApprovedNet / total) * 100 : 0;

  let rank: number | null = null;
  let abcClass: "A" | "B" | "C" | null = null;

  if (abcEligible) {
    const idx = sorted.findIndex((r) => r.customerId === customerId);
    rank = idx >= 0 ? idx + 1 : null;
    let cum = 0;
    for (const r of sorted) {
      const startPct = cum / total;
      if (r.customerId === customerId) {
        abcClass = startPct < 0.8 ? "A" : startPct < 0.95 ? "B" : "C";
        break;
      }
      cum += r.revenue;
    }
  }

  return {
    basisLabel: labels.basisLabel ?? "Soma de receita por cliente (agregação Pareto)",
    portfolioApprovedTotal,
    customerApprovedNet,
    shareOfPortfolioPct,
    rank,
    customerCount: sorted.length,
    abcClass,
    abcEligible,
    methodologyNote: labels.methodologyNote ?? ABC_METHODOLOGY_GENERIC_PT,
  };
}

/** Lista completa da curva ABC por cliente. Para relatórios e dashboard de carteira. */
export function buildCustomerAbcRanking(
  revenueByCustomer: Array<{ customerId: string; revenue: number }>,
  nameByCustomerId: Map<string, string>
): CustomerAbcRow[] {
  const positive = revenueByCustomer.filter((r) => r.revenue > 0);
  const total = positive.reduce((a, r) => a + r.revenue, 0);
  const sorted = [...positive].sort((a, b) => b.revenue - a.revenue);
  let cum = 0;
  return sorted.map((row, index) => {
    const startPct = total > 0 ? cum / total : 0;
    const abcClass: "A" | "B" | "C" =
      startPct < 0.8 ? "A" : startPct < 0.95 ? "B" : "C";
    cum += row.revenue;
    const cumPct = total > 0 ? (cum / total) * 100 : 0;
    return {
      customerId: row.customerId,
      companyName: nameByCustomerId.get(row.customerId) || "—",
      revenue: row.revenue,
      rank: index + 1,
      abcClass,
      shareOfPortfolioPct: total > 0 ? (row.revenue / total) * 100 : 0,
      cumulativeRevenuePct: cumPct,
    };
  });
}

/** Enriquecimento de cross-sell usando mix de SKUs por produto. */
export function enrichCrossSellFromMix(
  mix: Array<{ sku: string; type: string; revenue: number }>,
  closedOrderCount: number
): string[] {
  const hints: string[] = [];
  const types = new Set(mix.map((m) => m.type).filter(Boolean));
  if (mix.length >= 1 && types.size === 1 && closedOrderCount >= 2) {
    hints.push(
      `Mix concentrado no tipo de item "${[...types][0]}" — avaliar introdução de outras linhas já vendidas à base.`
    );
  }
  if (mix.length <= 2 && closedOrderCount >= 3) {
    hints.push(
      "Poucos SKUs distintos com vários pedidos — oportunidade de cross-sell ampliando mix."
    );
  }
  const top = mix[0];
  if (top && mix.length > 3) {
    const share = top.revenue / mix.reduce((a, m) => a + m.revenue, 0);
    if (share > 0.65) {
      hints.push(
        `Alta concentração no SKU ${top.sku} — diversificar reduz risco de volume.`
      );
    }
  }
  return hints;
}
