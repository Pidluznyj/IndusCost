/**
 * DRE Gerencial Mensal — contrato do payload (não contábil).
 * Fontes oficiais documentadas em FINANCE_DRE_OFFICIAL_SOURCES.
 */

import type { FinanceDreEstimatedCorporateTaxesBlock } from "@/src/lib/financeDreEstimatedCorporateTaxes.js";

export type { FinanceDreEstimatedCorporateTaxesBlock };

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
    module: "financeDreCmvFromNfe.server.ts + productionCostTables.server.ts",
    functions: [
      "loadMonthlyCmvFromNfeProductCosts",
      "getEffectiveProductProductionCostsForPairs",
    ],
    note: "CMV = quantidade do item da NF-e × unitProductionCost vigente na data de emissão da nota.",
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
  | "embalagens"
  | "lucro_bruto"
  | "despesas_operacionais"
  | "despesas_administrativas"
  | "resultado_operacional"
  | "provisoes_estimadas_irpj_csll"
  | "csll_estimada"
  | "irpj_estimado"
  | "lucro_liquido_aproximado";

/** Itens do relatório informativo (não entram no resultado). */
export type FinanceDreInformativeItemId =
  | "pessoal_cc"
  | "impostos_cc"
  | "materia_prima_cc"
  | "nfe_sem_itens"
  | "item_sem_produto"
  | "item_sem_custo"
  | "receita_sem_cmv"
  | "ap_sem_cc_provisorio"
  | "resultado_financeiro_fora_escopo"
  | "ir_csll_estimativa_gerencial";

export type FinanceDreSourceCheck = {
  id: string;
  label: string;
  officialMotor: string;
  appliedToResult: boolean;
  status: "ok" | "gap" | "info";
  note: string;
};

export type FinanceDreInformativeItem = {
  id: FinanceDreInformativeItemId;
  label: string;
  reason: string;
  source: string;
  /** true = valor entra no resultado (só nota); false = fora do resultado */
  appliedToResult: boolean;
  highlightAmount: number;
  ytdAmount: number;
  count?: number;
};

export type FinanceDreCostCenterRole =
  | "logistics"
  | "packaging"
  | "payroll"
  | "benefits"
  | "assembly"
  | "labor"
  | "tax"
  | "raw_material"
  | "admin";

export type FinanceDreCostCenterBreakdownRow = {
  costCenterId: string;
  code: string;
  name: string;
  role: FinanceDreCostCenterRole;
  roleLabel: string;
  highlightAmount: number;
  ytdAmount: number;
};

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
    | "CMV_GAP"
    | "CMV_MISSING_ITEMS"
    | "CMV_MISSING_PRODUCT"
    | "CMV_MISSING_COST"
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
  /** % da receita líquida sobre si mesma (100 quando há receita). */
  receitaLiquidaPct: number | null;
  lucroBruto: number;
  margemBrutaPct: number | null;
  resultadoOperacional: number;
  margemOperacionalPct: number | null;
  /** Lucro líquido após provisões estimadas de IRPJ e CSLL. */
  lucroLiquidoAproximado: number;
  /** % do lucro líquido aproximado sobre a receita líquida. */
  margemLiquidaAproximadaPct: number | null;
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
  /** Detalhamento das provisões estimadas (mês e YTD) — não recalcular no frontend. */
  estimatedCorporateTaxes: FinanceDreEstimatedCorporateTaxesBlock;
  /** Checklist: cada bloco do DRE e se a fonte oficial está aplicada. */
  sourceChecks: FinanceDreSourceCheck[];
  /** Relatório final: custos/itens não aplicados (ou provisórios) ao resultado. */
  informativeReport: {
    title: string;
    subtitle: string;
    items: FinanceDreInformativeItem[];
    totalNotAppliedHighlight: number;
    totalNotAppliedYtd: number;
  };
  /** Mapa de CCs usados no DRE (mês destaque + YTD) para auditoria. */
  costCenterBreakdown: FinanceDreCostCenterBreakdownRow[];
  qualityAlerts: FinanceDreQualityAlert[];
  sources: typeof FINANCE_DRE_OFFICIAL_SOURCES;
};
