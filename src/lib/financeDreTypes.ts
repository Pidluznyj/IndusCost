/**
 * DRE Gerencial Mensal — contrato do payload (não contábil).
 * Fontes oficiais documentadas em FINANCE_DRE_OFFICIAL_SOURCES.
 */

export const FINANCE_DRE_OFFICIAL_SOURCES = {
  revenue: {
    module: "financeBillingNfeDashboard.ts",
    functions: ["queryMonthlyFiscalNfe", "fiscalNfeWhereSql", "nfeCompetenceDateSql"],
    note: "Receita bruta = SUM(valorLiquido) NF-e MARKET_REVENUE autorizada (mesma regra do Faturamento).",
  },
  deductions: {
    module: "financeDreNfeQueries.server.ts",
    functions: ["queryMonthlyFiscalNfeDeductions"],
    note: "Impostos destacados (NomusNfeFiscalSummary) + devoluções (finalidade=4) no mesmo universo fiscal.",
  },
  costCenters: {
    module: "financeCostCenterDashboard.ts",
    functions: ["buildFinanceCostCenterDashboardDefault"],
    note: "Despesas/fretes via monthlySeries.byCostCenter do dashboard oficial de CC.",
  },
  cmv: {
    module: "salesOrderMarginService.server.ts + SalesOrderNfeLink",
    functions: ["calculateSalesOrderMarginsForOrders"],
    note: "CMV = custo gerencial oficial alocado ao mês da NF-e emitida (não issueDate do pedido).",
  },
} as const;

export type FinanceDreCompany = "all" | "lazarios" | "koppetel" | "sm";

export type FinanceDreFilters = {
  year: number;
  /** Mês em destaque (1–12); série sempre traz os 12 meses. */
  highlightMonth: number;
  company: FinanceDreCompany;
  /** Sempre emissão — alinhado à receita real do mês. */
  dateBase: "emissao";
};

export type FinanceDreLineKind =
  | "section"
  | "total"
  | "detail"
  | "informative"
  | "result";

export type FinanceDreLineId =
  | "receita_bruta"
  | "venda_mercadorias"
  | "deducoes"
  | "cofins"
  | "icms"
  | "icms_st"
  | "ipi"
  | "pis"
  | "devolucoes"
  | "receita_liquida"
  | "custos"
  | "cmv"
  | "fretes"
  | "lucro_bruto"
  | "despesas_operacionais"
  | "despesas_administrativas"
  | "despesas_pessoal_info"
  | "resultado_operacional"
  | "lucro_liquido_aproximado";

export type FinanceDreMonthValues = {
  /** Índices 1–12 */
  byMonth: number[];
  ytd: number;
  /** Valor do mês em destaque */
  highlight: number;
};

export type FinanceDreLine = {
  id: FinanceDreLineId;
  label: string;
  kind: FinanceDreLineKind;
  parentId: FinanceDreLineId | null;
  /** Valores negativos já aplicados (despesas/deduções como número negativo). */
  values: FinanceDreMonthValues;
  /** % sobre receita líquida do mesmo período (highlight). */
  pctOfNetRevenue: number | null;
  expandable: boolean;
  informativeOnly?: boolean;
  sourceNote?: string;
};

export type FinanceDreQualityAlert = {
  code:
    | "CMV_UNLINKED_NFE"
    | "CC_UNCLASSIFIED"
    | "TAX_SUMMARY_GAP"
    | "PARTIAL_FISCAL";
  severity: "info" | "warning" | "critical";
  message: string;
  count?: number;
  amount?: number;
};

export type FinanceDreKpis = {
  receitaLiquida: number;
  lucroBruto: number;
  margemBrutaPct: number | null;
  resultadoOperacional: number;
  margemOperacionalPct: number | null;
  lucroLiquidoAproximado: number;
};

export type FinanceDreReport = {
  schemaVersion: 1;
  title: string;
  subtitle: string;
  disclaimer: string;
  generatedAt: string;
  filters: FinanceDreFilters;
  companyLabel: string;
  monthLabels: string[];
  kpis: FinanceDreKpis;
  lines: FinanceDreLine[];
  qualityAlerts: FinanceDreQualityAlert[];
  sources: typeof FINANCE_DRE_OFFICIAL_SOURCES;
};
