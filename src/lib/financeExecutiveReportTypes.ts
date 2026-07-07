/**
 * Contrato central do Relatório Presidencial (Financeiro → Relatório Presidencial).
 *
 * Regra fundamental: este módulo define tipos e referências de fontes oficiais.
 * NÃO implementa cálculos divergentes de AR/AP/Fluxo/Faturamento/Pedidos.
 * A montagem do payload (fase posterior) deve delegar aos builders listados em
 * `FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES`.
 */
import type { FinanceDataSanitization } from "./financeInternalGroupExclusions.js";
import type { FinanceArDashboardPayload } from "./financeAccountsReceivableDashboardTypes.js";
import type { FinanceApDashboardPayload } from "./financeAccountsPayableDashboardTypes.js";
import type { FinanceCashFlowDashboardPayload } from "./financeCashFlowDashboardTypes.js";
import type { FinanceCashFlowCalendarPayload } from "./financeCashFlowCalendar.js";
import type { FinanceCashFlowExecutiveSummary } from "./financeCashFlowExecutiveSummary.js";
import type { FinanceBillingDashboardPayload } from "./financeBillingDashboardTypes.js";
import type {
  BillingDashboardTab,
  SalesOrdersDashboardTab,
} from "./executiveDashboardTypes.js";
import type { FinanceBillingSource } from "./financeBillingSourceTypes.js";
import type { FinanceCashFlowAnnualComparisonPayload } from "./financeCashFlowAnnualComparison.js";
import type {
  ExecutiveReportApSectionKpis,
  ExecutiveReportArSectionKpis,
} from "./financeExecutiveReportSectionKpis.js";
import type { FinanceExecutiveReportCashRadar } from "./financeExecutiveReportCashRadar.js";

/** Modo de geração — snapshot reservado para persistência futura. */
export type FinanceExecutiveReportMode = "live" | "snapshot";

/** Filtros globais do relatório presidencial. */
export type FinanceExecutiveReportFilters = {
  /** Ano de referência (ex.: 2026). */
  year: number;
  /** Mês calendário 1–12; omitir/null = visão anual ou mês corrente conforme seção. */
  month?: number | null;
  /** Data de corte para leitura executiva (ISO date ou Date serializado). */
  asOfDate: string;
  /** Empresa/filial quando aplicável (Nomus companyName). */
  company?: string;
  /** Segmentação de clientes — reservado; hoje faturamento usa filtro de mercado interno. */
  customerType?: "all" | "external" | "market" | "internal";
  /** Incluir contrapartes do grupo econômico (default false nas visões gerenciais). */
  includeInternalCompanies?: boolean;
  /** Fonte de faturamento oficial — default recomendado: NF-e fiscal. */
  nfeFilter?: FinanceBillingSource;
  /** Filtro AR/Fluxo por emissão de NF-e (with-nfe / without-nfe / all). */
  invoiceIssuedFilter?: "all" | "with-nfe" | "without-nfe";
  /** Limite de linhas em rankings (clientes, fornecedores, títulos críticos). */
  topN?: number;
  mode: FinanceExecutiveReportMode;
};

/** Referência documentada a um builder oficial — não executa nada por si só. */
export type FinanceExecutiveReportDataSourceRef = {
  module: string;
  builder: string;
  description: string;
};

/**
 * Mapa das fontes oficiais que o assembler do relatório DEVE reutilizar.
 * Alterações de cálculo devem ocorrer apenas nos módulos referenciados.
 */
export const FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES = {
  accountsReceivable: {
    module: "financeAccountsReceivableManagement.ts",
    builder: "loadFinanceArManagementRowsFromPrisma → buildFinanceAccountsReceivableDashboard",
    description:
      "Base saneada Nomus AR com syncCutoff, exclusão de stale/fantasma/intercompany e filtros gerenciais.",
  },
  accountsPayable: {
    module: "financeAccountsPayableDashboard.ts",
    builder: "filterFinanceApManagementReportRows → buildFinanceAccountsPayableDashboard",
    description:
      "Base saneada Nomus AP com exclusão de intercompany, pedido de compra na agenda e freshness AP.",
  },
  cashFlow: {
    module: "financeCashFlowDashboard.ts",
    builder: "buildFinanceCashFlowDashboard",
    description:
      "Motor único de entradas/saídas, posição líquida, cenários e reconciliação AR/AP × fluxo.",
  },
  cashFlowCalendar: {
    module: "financeCashFlowCalendar.ts",
    builder: "buildFinanceCashFlowCalendar",
    description: "Agenda/calendário financeiro mensal com saldo, fluxo líquido e acumulado.",
  },
  cashFlowExecutiveSummary: {
    module: "financeCashFlowExecutiveSummary.ts",
    builder: "buildCashFlowExecutiveSummary (via buildFinanceCashFlowDashboard)",
    description: "Visão YTD/projeção anual de caixa — complemento do dashboard de fluxo.",
  },
  billing: {
    module: "financeBillingDashboard.ts",
    builder: "buildFinanceBillingDashboard → buildBillingDashboardFromNfes | buildBillingDashboardTab",
    description:
      "Faturamento oficial NF-e (recomendado) ou fallback pedidos; comparativos multi-ano e projeções.",
  },
  billingMetrics: {
    module: "billingDashboardMetrics.ts",
    builder: "buildBillingDashboardTab",
    description: "Métricas de faturamento de mercado, metas (+30%), média diária e projeção.",
  },
  salesOrders: {
    module: "salesOrderRulesAdapter.ts",
    builder: "buildSalesOrdersDashboardTab → resolveOfficialSalesOrderExecutiveMetrics",
    description:
      "Pedidos de venda — motor oficial salesOrderRulesEngine; metas, projeção e carteira; não usa Proposta comercial.",
  },
  salesOrderRules: {
    module: "salesOrderDashboardRules.ts",
    builder: "computeAchievementPercent, computeMonthProjection, computeGrowthTarget, …",
    description: "Regras puras compartilhadas entre faturamento e pedidos (metas +30%).",
  },
  costCenterDashboard: {
    module: "financeCostCenterDashboard.ts",
    builder: "buildFinanceCostCenterDashboardDefault → buildExecutiveReportCostCenterTopCards",
    description:
      "AP gerencial alocado por centro de custo — mesma base da Visão Gerencial de Centro de Custo.",
  },
  cashFlowDailyRadar: {
    module: "financeCashFlowDailyRadar.ts",
    builder: "buildCashFlowDailyRadarData → buildFinanceCashFlowDailyRadar",
    description:
      "Radar Diário de Caixa — horizonte AR/AP aberto com data operacional; filtros do relatório quando aplicável.",
  },
  executiveSummary: {
    module: "executiveDashboardService.ts",
    builder: "buildExecutiveDashboardSummary",
    description: "Agregador existente de abas Pedidos + Faturamento + Funil (referência, não substituto do relatório).",
  },
} as const satisfies Record<string, FinanceExecutiveReportDataSourceRef>;

export type FinanceExecutiveReportOfficialSourceKey =
  keyof typeof FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES;

/** Lacunas conhecidas na montagem do relatório — auditoria inicial. */
export type FinanceExecutiveReportKnownGap = {
  id: string;
  label: string;
  status: "available" | "partial" | "missing";
  notes: string;
};

export const FINANCE_EXECUTIVE_REPORT_KNOWN_GAPS: FinanceExecutiveReportKnownGap[] = [
  {
    id: "billing-multi-year-comparison",
    label: "Comparativo mensal 2024/2025/2026 (faturamento)",
    status: "available",
    notes: "BillingDashboardTab.multiYearMonthly / multiYearSummary em financeBillingChartData.ts.",
  },
  {
    id: "billing-target-achievement",
    label: "% atingimento meta do mês (faturamento)",
    status: "available",
    notes: "DashboardTargetBlock.achievementPercent via billingDashboardMetrics / salesOrderDashboardRules.",
  },
  {
    id: "billing-projection",
    label: "Média diária, faturado, projetado, meta anual",
    status: "available",
    notes: "BillingProjectionBlock + BillingYearComparison + BillingRealizedVsProjected.",
  },
  {
    id: "ar-ap-cards-charts",
    label: "Cards e gráficos AR/AP no formato presidencial",
    status: "partial",
    notes: "Payloads oficiais existem; layout/ seleção de KPIs para print ainda não definidos neste contrato.",
  },
  {
    id: "calendar-agenda",
    label: "Agenda financeira mensal (saldo, líquido, acumulado)",
    status: "available",
    notes: "FinanceCashFlowCalendarPayload.monthSummary + days/weeks.",
  },
  {
    id: "sales-orders-projection",
    label: "Pedidos — meta mês e projeção comercial",
    status: "available",
    notes: "SalesOrdersDashboardTab.targets + projection.",
  },
  {
    id: "persisted-snapshot",
    label: "Modo snapshot persistido",
    status: "missing",
    notes: "Filtro mode=snapshot previsto; storage/API não implementados nesta etapa.",
  },
  {
    id: "custom-meta-table",
    label: "Metas cadastradas em tabela/config",
    status: "missing",
    notes: "Metas atuais são derivadas (+30% sobre período anterior) — não há tabela de metas editável.",
  },
  {
    id: "executive-narrative-ai",
    label: "Narrativa executiva automática",
    status: "partial",
    notes: "Frases determinísticas geradas a partir dos números oficiais; sem IA generativa.",
  },
];

export type FinanceExecutiveReportDataQuality = {
  sanitization: FinanceDataSanitization | null;
  warnings: string[];
  unavailableSections: string[];
  /** Metas derivadas (+30% sobre período anterior) — não há cadastro editável. */
  targetsDerived: boolean;
  sync: {
    accountsReceivableLastSyncAt: string | null;
    accountsPayableLastSyncAt: string | null;
    nfeLastSyncAt: string | null;
    salesOrdersLastSyncAt: string | null;
  };
  freshness: {
    arStaleExcluded: boolean;
    apStaleExcluded: boolean;
  };
};

export type FinanceExecutiveReportCover = {
  title: string;
  subtitle?: string;
  reportDateLabel: string;
  periodLabel: string;
  companyLabel?: string;
};

export type FinanceExecutiveReportExecutiveSummary = {
  headlineMetrics: Array<{
    id: string;
    label: string;
    value: number | null;
    formatted: string;
    source: FinanceExecutiveReportOfficialSourceKey;
  }>;
  highlights: string[];
};

/** Seção 2–4: faturamento comparativo e projeção — espelha BillingDashboardTab oficial. */
export type FinanceExecutiveReportBillingComparison = {
  source: typeof FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.billing;
  payload: Pick<
    FinanceBillingDashboardPayload,
    "selectedYear" | "previousYear" | "currentMonth" | "billingSource" | "periodLabel"
  >;
  tab: Pick<
    BillingDashboardTab,
    | "summaryCards"
    | "target"
    | "yearComparison"
    | "monthlySeries"
    | "chartSeries"
    | "multiYearMonthly"
    | "multiYearSummary"
    | "cumulativeBilling"
  >;
};

export type FinanceExecutiveReportBillingProjection = {
  source: typeof FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.billing;
  tab: Pick<
    BillingDashboardTab,
    "projection" | "realizedVsProjected" | "accumulatedEvolution" | "forecast"
  >;
};

/** Seção 7: Contas a Receber — payload oficial completo ou subconjunto documentado. */
export type FinanceExecutiveReportAccountsReceivable = {
  source: typeof FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.accountsReceivable;
  metricsSource: "official-accounts-receivable-engine";
  kpis: ExecutiveReportArSectionKpis;
  payload: Pick<
    FinanceArDashboardPayload,
    | "cards"
    | "agingBuckets"
    | "topDebtors"
    | "monthlyDueSchedule"
    | "scheduleBuckets"
    | "criticalTitles"
    | "dataSanitization"
    | "financialHorizon"
  >;
};

/** Seção 8: Contas a Pagar — payload oficial. */
export type FinanceExecutiveReportAccountsPayable = {
  source: typeof FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.accountsPayable;
  metricsSource: "official-accounts-payable-engine";
  kpis: ExecutiveReportApSectionKpis;
  payload: Pick<
    FinanceApDashboardPayload,
    | "cards"
    | "agingBuckets"
    | "topSuppliers"
    | "monthlyDueSchedule"
    | "criticalTitles"
    | "dataSanitization"
    | "financialHorizon"
    | "purchaseOrderScheduleAudit"
  >;
};

/** Seção 8 (continuação): Fluxo de Caixa — motor saneado. */
export type FinanceExecutiveReportCashFlow = {
  source: typeof FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.cashFlow;
  payload: Pick<
    FinanceCashFlowDashboardPayload,
    | "cards"
    | "executiveSummary"
    | "executiveYtd"
    | "monthlySeries"
    | "cashForecast"
    | "dataSanitization"
    | "reconciliation"
    | "executiveReading"
  >;
};

/** Seção 9: Agenda financeira mensal. */
export type FinanceExecutiveReportCashFlowAnnualChart = {
  year: number;
  highlightMonth: number;
  points: Array<{
    month: number;
    monthLabel: string;
    isCurrentMonth: boolean;
    inflow: number;
    outflow: number;
    netFlow: number;
    accumulated: number;
    isNegative: boolean;
  }>;
  hasData: boolean;
};

/** Seção 9: Agenda financeira mensal. */
export type FinanceExecutiveReportCalendarAgenda = {
  source: typeof FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.cashFlowCalendar;
  calendar: FinanceCashFlowCalendarPayload;
  executiveSummary?: Pick<
    FinanceCashFlowExecutiveSummary,
    "monthlyTimeline" | "period" | "net"
  >;
  /** Gráfico Jan–Dez do ano — ignora filtro de mês (cards usam period). */
  annualChart: FinanceExecutiveReportCashFlowAnnualChart;
};

/** Comparativo anual realizado/aberto — motor oficial do Fluxo de Caixa com filtros do relatório. */
export type FinanceExecutiveReportAnnualComparison = {
  source: typeof FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.cashFlow;
  currentYear: FinanceCashFlowAnnualComparisonPayload;
  previousYear: FinanceCashFlowAnnualComparisonPayload;
};

/** Seção 10: Pedidos de venda — SalesOrder, não Propostas. */
export type FinanceExecutiveReportSalesOrders = {
  source: typeof FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.salesOrders;
  tab: Pick<
    SalesOrdersDashboardTab,
    | "summaryCards"
    | "targets"
    | "target"
    | "projection"
    | "monthlySeries"
    | "chartSeries"
    | "accumulatedEvolution"
    | "statusBreakdown"
    | "overdueOrders"
    | "periodLabel"
  >;
};

/** Gastos por centro de custo — Visão Gerencial CC / alocação AP oficial. */
export type FinanceExecutiveReportCostCenterSpending = {
  source: typeof FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.costCenterDashboard;
  topCards: import("./financeExecutiveReportCostCenterTopCards.js").FinanceExecutiveReportCostCenterTopCard[];
  summary: import("./financeExecutiveReportCostCenterTopCards.js").FinanceExecutiveReportCostCenterTopCardsSummary;
  totals: import("./financeCostCenterExpenseMap.js").CostCenterExpenseMapAggregateTotals;
};

/** Narrativa executiva — reservada; preenchimento futuro (manual ou assistida). */
export type FinanceExecutiveReportNarrative = {
  sections: Array<{
    id: string;
    title: string;
    body: string;
    sourceRefs: FinanceExecutiveReportOfficialSourceKey[];
  }>;
};

/** Radar Diário de Caixa — motor oficial do Fluxo de Caixa com filtros do relatório. */
export type FinanceExecutiveReportCashFlowDailyRadar = FinanceExecutiveReportCashRadar;

/**
 * Payload completo do Relatório Presidencial.
 * Montagem: fase posterior — consumir builders oficiais e mapear para este contrato.
 */
export type FinanceExecutiveReport = {
  generatedAt: string;
  asOfDate: string;
  year: number;
  month: number | null;
  company: string | null;
  filters: FinanceExecutiveReportFilters;
  mode: FinanceExecutiveReportMode;
  dataSources: typeof FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES;
  dataQuality: FinanceExecutiveReportDataQuality;
  knownGaps: FinanceExecutiveReportKnownGap[];
  cover: FinanceExecutiveReportCover;
  executiveSummary: FinanceExecutiveReportExecutiveSummary;
  billingComparison: FinanceExecutiveReportBillingComparison;
  billingProjection: FinanceExecutiveReportBillingProjection;
  accountsReceivable: FinanceExecutiveReportAccountsReceivable;
  accountsPayable: FinanceExecutiveReportAccountsPayable;
  cashFlow: FinanceExecutiveReportCashFlow;
  calendarAgenda: FinanceExecutiveReportCalendarAgenda;
  annualComparison: FinanceExecutiveReportAnnualComparison;
  salesOrders: FinanceExecutiveReportSalesOrders;
  costCenterSpending: FinanceExecutiveReportCostCenterSpending;
  cashRadar: FinanceExecutiveReportCashFlowDailyRadar;
  executiveNarrative: FinanceExecutiveReportNarrative | null;
};
