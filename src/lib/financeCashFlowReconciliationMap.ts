/**
 * Mapa técnico de reconciliação do Fluxo de Caixa.
 *
 * Documenta, para cada número exibido na tela, a função de origem, a base saneada
 * (AR/AP oficial ou motor do Fluxo), equivalências cross-módulo e exceções conceituais.
 *
 * Etapa de auditoria — não altera cálculos. Use como referência para futuras correções.
 *
 * Oráculo interno do Fluxo (referência validada pelo usuário):
 * - Série mensal do período: `buildFinanceCashFlowMonthlySeries` + `sumPeriodAmounts`
 * - Linha do tempo executiva anual: `buildExecutiveMonthlyTimeline`
 * Ambos usam motores saneados; divergem em escopo (viewMode, alocação de realizado).
 */

export type FinanceCashFlowRowScope =
  | "portfolio"
  | "period"
  | "ytd_period"
  | "executive_timeline"
  | "load_only";

export type FinanceCashFlowOfficialBase =
  | "ar_management"
  | "ap_management"
  | "cash_flow_motor"
  | "mixed";

export type FinanceCashFlowReconciliationEntry = {
  /** Identificador estável para testes e auditoria. */
  id: string;
  /** Bloco visual na UI (componente ou seção). */
  uiBlock: string;
  /** Aba ativa quando aplicável. */
  uiTab: "overview" | "calendar" | "risk" | "export" | "audit" | "all";
  /** Caminho no payload JSON (`FinanceCashFlowDashboardPayload`). */
  payloadPath: string;
  /** Rótulo gerencial exibido ao usuário. */
  label: string;
  /** Arquivo principal do motor. */
  sourceModule: string;
  /** Função que produz o valor. */
  sourceFunction: string;
  /** Escopo de linhas AR/AP usado no cálculo. */
  rowScope: FinanceCashFlowRowScope;
  /** Base oficial predominante. */
  officialBase: FinanceCashFlowOfficialBase;
  usesArOfficial: boolean;
  usesApOfficial: boolean;
  /** Usa `buildFinanceCashFlowMonthlySeries` (série do período filtrado). */
  usesMonthlyTimeline: boolean;
  /** Usa `buildExecutiveMonthlyTimeline` (linha do tempo executiva anual). */
  usesExecutiveTimeline: boolean;
  /** Consulta Prisma diretamente (além do load inicial). */
  usesPrismaDirect: boolean;
  freshnessExcluded: boolean;
  arOverdueNfRule: boolean | "n/a";
  apIntercompanyExcluded: boolean | "n/a";
  apPurchaseOrderExcluded: boolean | "n/a";
  apOperationalDate: boolean | "n/a";
  respectsAppliedFilters: boolean;
  /** Equivalência com Contas a Receber oficial, quando aplicável. */
  arEquivalent?: string;
  /** Equivalência com Contas a Pagar oficial, quando aplicável. */
  apEquivalent?: string;
  /** Oráculo interno do Fluxo (timeline, ledger, portfolio). */
  cashFlowInternalOracle?: string;
  /** Exceção conceitual documentada — regra diferente da AR/AP pura. */
  conceptualException?: string;
  /** Caminho alternativo que pode divergir (risco de inconsistência). */
  alternatePath?: string;
};

/** Funções canônicas de base saneada (referência cruzada). */
export const FINANCE_CASH_FLOW_OFFICIAL_AR_BASE =
  "filterFinanceArManagementReportRows / filterCashFlowArPortfolioRows (stale + dedup + isFinanceArAllowedInManagementReport)";

export const FINANCE_CASH_FLOW_OFFICIAL_AP_BASE =
  "filterFinanceApManagementReportRows / filterCashFlowApPortfolioRows (stale + intercompany + pedido de compra/type=2)";

/** Oráculos internos do Fluxo de Caixa. */
export const FINANCE_CASH_FLOW_TIMELINE_ORACLE = {
  periodMonthlySeries: {
    builder: "buildFinanceCashFlowMonthlySeries",
    module: "financeCashFlowDashboard.ts",
    rowFilter: "filterCashFlowArRowsScoped / filterCashFlowApRowsScoped",
    respectsViewMode: true,
    cardsDerivedVia: "sumPeriodAmounts(monthlySeries)",
    note: "Referência para entradas/saídas do período filtrado e cards.inflowAmount/outflowAmount.",
  },
  executiveMonthlyTimeline: {
    builder: "buildExecutiveMonthlyTimeline",
    module: "financeCashFlowExecutiveSummary.ts",
    rowFilter:
      "filterArRowsForYtdReceived (filterFinanceArManagementReportRows) + filterApRowsForCashFlowExecutiveTimeline (filterFinanceApManagementReportRows)",
    respectsViewMode: false,
    note: "Referência validada visualmente — gráfico/tabela de linha do tempo anual na Visão Geral.",
  },
  ledgerPeriodTotals: {
    builder: "computeCashFlowLedgerPeriodTotals",
    module: "financeCashFlowLedger.ts",
    note: "Conferência do período em reconciliation.* — deve bater com monthlySeries (ε=0.01).",
  },
  portfolioBlocks: {
    builder: "buildBlocksFromPortfolio",
    module: "financeCashFlowDataset.ts",
    rowFilter: "filterCashFlowArPortfolioRows / filterCashFlowApPortfolioRows",
    note: "Carteira aberta, vencidos, rankings e listas críticas — sem filtro de mês/ano.",
  },
} as const;

/** Equivalências formais entre conceitos do Fluxo e módulos AR/AP. */
export const FINANCE_CASH_FLOW_CONCEPT_EQUIVALENCES = [
  {
    cashFlowConcept: "cards.inflowAmount / period.inflowAmount",
    equivalent: "AR em aberto + AR recebido no período (conforme viewMode)",
    motor: "buildFinanceCashFlowMonthlySeries → shouldIncludeCashFlowArMovement",
    arOfficial: "filterCashFlowArRowsScoped (base AR gerencial)",
  },
  {
    cashFlowConcept: "cards.outflowAmount / period.outflowAmount",
    equivalent: "AP em aberto + AP pago no período (conforme viewMode)",
    motor: "buildFinanceCashFlowMonthlySeries",
    apOfficial: "filterCashFlowApRowsScoped; AP aberto usa data operacional",
  },
  {
    cashFlowConcept: "blocks.totalReceivableOpen / cards.totalReceivableOpen",
    equivalent: "AR cards.totalOpenAmount (carteira aberta gerencial)",
    motor: "buildBlocksFromPortfolio",
    arOfficial: "buildFinanceAccountsReceivableDashboard com filtros equivalentes",
  },
  {
    cashFlowConcept: "blocks.totalPayableOpen / cards.totalPayableOpen",
    equivalent: "AP cards.totalOpenAmount",
    motor: "buildBlocksFromPortfolio",
    apOfficial: "buildFinanceAccountsPayableDashboard com filtros equivalentes",
  },
  {
    cashFlowConcept: "overdueReceivables / overdueReceivableAmount",
    equivalent: "AR Atrasados saneado (isFinanceArOverdueRow)",
    motor: "buildBlocksFromPortfolio",
    arOfficial: "buildFinanceArOverduePayload / sumFinanceArOverdueOpenAmount",
  },
  {
    cashFlowConcept: "overduePayables / overduePayableAmount",
    equivalent: "AP vencidos gerenciais (isFinanceCashFlowApOverdueRow)",
    motor: "buildBlocksFromPortfolio",
    apOfficial: "classifyFinanceApTitle overdue + data operacional",
  },
  {
    cashFlowConcept: "calendar.monthSummary (previsto)",
    equivalent: "Soma diária de movimentos AR/AP abertos no mês",
    motor: "buildFinanceCashFlowCalendarMovements",
    note: "Deve reconciliar com monthlySeries do mês quando viewMode=projected/combined",
  },
  {
    cashFlowConcept: "executiveSummary.receivable.receivedYtd",
    equivalent: "AR recebido YTD alocado por dueDate",
    motor: "sumArReceivedInPeriod + filterFinanceArManagementReportRows",
    arOfficial: "Parcial — alocação por vencimento, não settlementDate",
  },
  {
    cashFlowConcept: "executiveSummary.payable.paidYtd",
    equivalent: "AP pago YTD alocado por dueDate",
    motor: "sumApPaidInPeriod",
    apOfficial: "Parcial — alocação por vencimento, não paymentDate",
  },
] as const;

/** Riscos conhecidos — blocos que podem divergir por usarem motor diferente. */
export const FINANCE_CASH_FLOW_RECONCILIATION_RISKS = [
  {
    id: "R1_executive_timeline_vs_period_series",
    description:
      "Linha do tempo executiva (buildExecutiveMonthlyTimeline) ignora viewMode; série mensal do período respeita projected/realized/combined.",
    affectedBlocks: [
      "executiveSummary.monthlyTimeline",
      "cards.inflowAmount",
      "cards.outflowAmount",
    ],
    severity: "high" as const,
  },
  {
    id: "R2_realized_allocation_due_vs_payment",
    description:
      "Realizado YTD executivo aloca AR/AP por dueDate; ledger AP realizado usa data efetiva de pagamento.",
    affectedBlocks: [
      "executiveSummary.receivable.receivedYtd",
      "executiveSummary.payable.paidYtd",
      "reconciliation.ledgerInflow/Outflow",
    ],
    severity: "high" as const,
  },
  {
    id: "R3_calendar_ap_realized_due_date",
    description:
      "Calendário AP realizado usa dueDate (shouldIncludeCalendarApRealizedMovement); ledger usa paymentDate.",
    affectedBlocks: ["calendar.days[].movements", "calendar.reconciliation"],
    severity: "medium" as const,
  },
  {
    id: "R4_portfolio_vs_ytd_period_open",
    description:
      "Carteira aberta (portfolio, sem mês) difere de executiveYtd.totalReceivableOpen (YTD period-scoped).",
    affectedBlocks: [
      "cards.totalReceivableOpen",
      "executiveYtd.totalReceivableOpen",
      "reconciliation.cashFlowOpenPortfolio",
    ],
    severity: "medium" as const,
  },
  {
    id: "R5_date_base_ignored_for_ar",
    description: "Filtro dateBase (issue/settlement) não altera AR — movimento sempre por dueDate.",
    affectedBlocks: ["monthlySeries", "calendar", "cards.inflowAmount"],
    severity: "medium" as const,
  },
  {
    id: "R6_open_ar_without_due_date",
    description:
      "Títulos AR abertos sem dueDate entram na carteira (portfolio) mas não no fluxo do período.",
    affectedBlocks: ["cards.totalReceivableOpen", "monthlySeries", "reconciliation.notes"],
    severity: "low" as const,
  },
  {
    id: "R7_forecast_scenario_factors",
    description:
      "Cenários conservador/crítico aplicam fatores ad hoc (80%/50%, 60%/30%) — não existem em AR/AP.",
    affectedBlocks: [
      "conservativeScenario",
      "stressScenario",
      "cashForecast",
      "cashHealthScore",
    ],
    severity: "low" as const,
  },
  {
    id: "R8_dead_code_buildCriticalMovements",
    description:
      "buildCriticalMovements em financeCashFlowDashboard.ts não é chamado; blocos vivos vêm de buildBlocksFromPortfolio.",
    affectedBlocks: ["largestProjectedInflows", "overdueReceivables"],
    severity: "low" as const,
  },
] as const;

/**
 * Mapa completo dos números exibidos ou exportados pelo Fluxo de Caixa.
 * Ordenado por aba/bloco na UI.
 */
export const FINANCE_CASH_FLOW_RECONCILIATION_MAP: readonly FinanceCashFlowReconciliationEntry[] =
  [
    // ─── Visão Geral — Resumo executivo ───
    {
      id: "exec_received_ytd",
      uiBlock: "FinanceCashFlowExecutiveSummaryPanel",
      uiTab: "overview",
      payloadPath: "executiveSummary.receivable.receivedYtd",
      label: "Recebido YTD",
      sourceModule: "financeCashFlowExecutiveSummary.ts",
      sourceFunction: "sumArReceivedInPeriod + filterArRowsForYtdReceived",
      rowScope: "ytd_period",
      officialBase: "ar_management",
      usesArOfficial: true,
      usesApOfficial: false,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: "n/a",
      apPurchaseOrderExcluded: "n/a",
      apOperationalDate: "n/a",
      respectsAppliedFilters: true,
      arEquivalent: "AR recebido — parcial; alocação por dueDate, não settlementDate",
      cashFlowInternalOracle: "filterFinanceArManagementReportRows",
      conceptualException:
        "Realizado YTD alocado pelo vencimento (dueDate), não pela data de baixa.",
      alternatePath: "buildFinanceAccountsReceivableDashboard.cards.totalReceivedAmount (escopo diferente)",
    },
    {
      id: "exec_open_ar_to_year_end",
      uiBlock: "FinanceCashFlowExecutiveSummaryPanel",
      uiTab: "overview",
      payloadPath: "executiveSummary.receivable.openFromTodayToYearEnd",
      label: "A receber até 31/12",
      sourceModule: "financeCashFlowExecutiveSummary.ts",
      sourceFunction: "sumArOpenDueInPeriod (forward range)",
      rowScope: "ytd_period",
      officialBase: "ar_management",
      usesArOfficial: true,
      usesApOfficial: false,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: "n/a",
      apPurchaseOrderExcluded: "n/a",
      apOperationalDate: "n/a",
      respectsAppliedFilters: true,
      arEquivalent: "AR upcoming/open com dueDate de hoje até fim do ano",
      cashFlowInternalOracle: "filterArRowsForYtdReceived",
    },
    {
      id: "exec_estimated_ar_year",
      uiBlock: "FinanceCashFlowExecutiveSummaryPanel",
      uiTab: "overview",
      payloadPath: "executiveSummary.receivable.estimatedYearTotal",
      label: "Estimativa AR do ano",
      sourceModule: "financeCashFlowExecutiveSummary.ts",
      sourceFunction: "receivedYtd + openFromTodayToYearEnd",
      rowScope: "ytd_period",
      officialBase: "ar_management",
      usesArOfficial: true,
      usesApOfficial: false,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: "n/a",
      apPurchaseOrderExcluded: "n/a",
      apOperationalDate: "n/a",
      respectsAppliedFilters: true,
      arEquivalent: "Derivado — sem campo único equivalente no dashboard AR",
    },
    {
      id: "exec_paid_ytd",
      uiBlock: "FinanceCashFlowExecutiveSummaryPanel",
      uiTab: "overview",
      payloadPath: "executiveSummary.payable.paidYtd",
      label: "Pago YTD",
      sourceModule: "financeCashFlowExecutiveSummary.ts",
      sourceFunction: "sumApPaidInPeriod + filterApRowsForCashFlowExecutiveTimeline",
      rowScope: "ytd_period",
      officialBase: "ap_management",
      usesArOfficial: false,
      usesApOfficial: true,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: "n/a",
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: false,
      respectsAppliedFilters: true,
      apEquivalent: "AP pago — parcial; alocação por dueDate, não paymentDate",
      conceptualException: "Pago YTD alocado pelo vencimento (dueDate), não data de pagamento.",
      alternatePath: "buildFinanceAccountsPayableDashboard.cards.totalPaidAmount",
    },
    {
      id: "exec_open_ap_to_year_end",
      uiBlock: "FinanceCashFlowExecutiveSummaryPanel",
      uiTab: "overview",
      payloadPath: "executiveSummary.payable.openFromTodayToYearEnd",
      label: "A pagar até 31/12",
      sourceModule: "financeCashFlowExecutiveSummary.ts",
      sourceFunction: "sumApOpenDueInPeriod (operational date forward)",
      rowScope: "ytd_period",
      officialBase: "ap_management",
      usesArOfficial: false,
      usesApOfficial: true,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: "n/a",
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      apEquivalent: "AP open upcoming com data operacional",
    },
    {
      id: "exec_realized_ytd_net",
      uiBlock: "FinanceCashFlowExecutiveSummaryPanel",
      uiTab: "overview",
      payloadPath: "executiveSummary.net.realizedYtd",
      label: "Saldo realizado YTD",
      sourceModule: "financeCashFlowExecutiveSummary.ts",
      sourceFunction: "receivedYtd − paidYtd",
      rowScope: "ytd_period",
      officialBase: "mixed",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: false,
      respectsAppliedFilters: true,
      conceptualException: "Combina alocações por dueDate em AR e AP — sem equivalente único AR/AP.",
    },
    {
      id: "exec_period_inflow",
      uiBlock: "FinanceCashFlowExecutiveSummaryPanel",
      uiTab: "overview",
      payloadPath: "executiveSummary.period.inflowAmount",
      label: "Entradas do período",
      sourceModule: "financeCashFlowDashboard.ts",
      sourceFunction: "sumPeriodAmounts(buildFinanceCashFlowMonthlySeries)",
      rowScope: "period",
      officialBase: "cash_flow_motor",
      usesArOfficial: true,
      usesApOfficial: false,
      usesMonthlyTimeline: true,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: "n/a",
      apPurchaseOrderExcluded: "n/a",
      apOperationalDate: "n/a",
      respectsAppliedFilters: true,
      arEquivalent: "Soma AR no período conforme viewMode",
      cashFlowInternalOracle: FINANCE_CASH_FLOW_TIMELINE_ORACLE.periodMonthlySeries.builder,
      alternatePath: "executiveSummary.monthlyTimeline[].estimatedInflow (executive timeline)",
    },
    {
      id: "exec_period_outflow",
      uiBlock: "FinanceCashFlowExecutiveSummaryPanel",
      uiTab: "overview",
      payloadPath: "executiveSummary.period.outflowAmount",
      label: "Saídas do período",
      sourceModule: "financeCashFlowDashboard.ts",
      sourceFunction: "sumPeriodAmounts(buildFinanceCashFlowMonthlySeries)",
      rowScope: "period",
      officialBase: "cash_flow_motor",
      usesArOfficial: false,
      usesApOfficial: true,
      usesMonthlyTimeline: true,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: "n/a",
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      apEquivalent: "Soma AP no período conforme viewMode + data operacional (aberto)",
      cashFlowInternalOracle: FINANCE_CASH_FLOW_TIMELINE_ORACLE.periodMonthlySeries.builder,
      alternatePath: "executiveSummary.monthlyTimeline[].estimatedOutflow",
    },
    {
      id: "exec_period_net",
      uiBlock: "FinanceCashFlowExecutiveSummaryPanel",
      uiTab: "overview",
      payloadPath: "executiveSummary.period.netFlowAmount",
      label: "Saldo líquido do período",
      sourceModule: "financeCashFlowDashboard.ts",
      sourceFunction: "sumPeriodAmounts → net",
      rowScope: "period",
      officialBase: "cash_flow_motor",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: true,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      cashFlowInternalOracle: FINANCE_CASH_FLOW_TIMELINE_ORACLE.periodMonthlySeries.builder,
    },
    {
      id: "exec_cash_health_score",
      uiBlock: "FinanceCashFlowExecutiveSummaryPanel / FinanceCashFlowRiskTab",
      uiTab: "overview",
      payloadPath: "cashHealthScore.score",
      label: "Score de saúde do caixa",
      sourceModule: "financeCashFlowCfoDiagnostics.ts",
      sourceFunction: "buildCashHealthScore",
      rowScope: "period",
      officialBase: "mixed",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: true,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      conceptualException: "Score composto (0–100) — sem equivalente AR/AP; usa cards + forecast.",
    },

    // ─── Conferência do período ───
    {
      id: "reconciliation_ledger",
      uiBlock: "FinanceCashFlowReconciliationPanel",
      uiTab: "overview",
      payloadPath: "reconciliation.receivable.ledgerInflow",
      label: "Conferência ledger × fluxo",
      sourceModule: "financeCashFlowLedger.ts",
      sourceFunction: "buildCashFlowReconciliation + computeCashFlowLedgerPeriodTotals",
      rowScope: "period",
      officialBase: "cash_flow_motor",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: true,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      cashFlowInternalOracle: FINANCE_CASH_FLOW_TIMELINE_ORACLE.ledgerPeriodTotals.builder,
      arEquivalent: "reconciliation.arDashboardOpen ↔ buildFinanceAccountsReceivableDashboard.cards.totalOpenAmount",
      apEquivalent: "reconciliation.apDashboardOpen ↔ buildFinanceAccountsPayableDashboard.cards.totalOpenAmount",
    },

    // ─── Linha do tempo mensal (oráculo validado) ───
    {
      id: "monthly_timeline_chart",
      uiBlock: "FinanceCashFlowMonthlyPlannedChart",
      uiTab: "overview",
      payloadPath: "executiveSummary.monthlyTimeline",
      label: "Linha do tempo mensal (gráfico)",
      sourceModule: "financeCashFlowExecutiveSummary.ts",
      sourceFunction: "buildExecutiveMonthlyTimeline",
      rowScope: "executive_timeline",
      officialBase: "mixed",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: true,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      cashFlowInternalOracle: FINANCE_CASH_FLOW_TIMELINE_ORACLE.executiveMonthlyTimeline.builder,
      conceptualException:
        "Oráculo interno validado — ignora viewMode; sempre estima inflow/outflow mensal.",
      alternatePath: "monthlySeries (respeita viewMode projected/realized/combined)",
    },
    {
      id: "monthly_timeline_table",
      uiBlock: "FinanceCashFlowMonthlyTimelineTable",
      uiTab: "overview",
      payloadPath: "executiveSummary.monthlyTimeline",
      label: "Linha do tempo mensal (tabela)",
      sourceModule: "financeCashFlowExecutiveSummary.ts",
      sourceFunction: "buildExecutiveMonthlyTimeline",
      rowScope: "executive_timeline",
      officialBase: "mixed",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: true,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      cashFlowInternalOracle: FINANCE_CASH_FLOW_TIMELINE_ORACLE.executiveMonthlyTimeline.builder,
      alternatePath: "monthlySeries",
    },
    {
      id: "monthly_series",
      uiBlock: "(interno — cards, export, YTD trend)",
      uiTab: "all",
      payloadPath: "monthlySeries",
      label: "Série mensal do período filtrado",
      sourceModule: "financeCashFlowDashboard.ts",
      sourceFunction: "buildFinanceCashFlowMonthlySeries",
      rowScope: "period",
      officialBase: "cash_flow_motor",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: true,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      cashFlowInternalOracle: FINANCE_CASH_FLOW_TIMELINE_ORACLE.periodMonthlySeries.builder,
      alternatePath: "executiveSummary.monthlyTimeline",
    },

    // ─── YTD Summary ───
    {
      id: "ytd_net_cash_position",
      uiBlock: "FinanceCashFlowYtdSummary",
      uiTab: "overview",
      payloadPath: "executiveYtd.netCashPosition",
      label: "Posição líquida YTD",
      sourceModule: "financeCashFlowExecutiveYtd.ts",
      sourceFunction: "buildFinanceCashFlowExecutiveYtd → buildNetCashPositionMetrics",
      rowScope: "ytd_period",
      officialBase: "mixed",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      alternatePath: "cards.netCashPosition (portfolio scope)",
      conceptualException: "YTD period-scoped — difere da carteira portfolio quando mês filtrado.",
    },
    {
      id: "ytd_received_comparison",
      uiBlock: "FinanceCashFlowYtdSummary",
      uiTab: "overview",
      payloadPath: "executiveYtd.received.currentAmount",
      label: "Recebido YTD (com comparação)",
      sourceModule: "financeCashFlowExecutiveYtd.ts",
      sourceFunction: "buildYtdReceivedComparison → filterFinanceArManagementReportRows",
      rowScope: "ytd_period",
      officialBase: "ar_management",
      usesArOfficial: true,
      usesApOfficial: false,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: "n/a",
      apPurchaseOrderExcluded: "n/a",
      apOperationalDate: "n/a",
      respectsAppliedFilters: true,
      arEquivalent: "filterFinanceArManagementReportRows + sumArReceivedInPeriod",
    },
    {
      id: "ytd_trend_chart",
      uiBlock: "FinanceCashFlowYtdTrendChart",
      uiTab: "overview",
      payloadPath: "executiveYtd.trend.monthlyNetSeries",
      label: "Tendência YTD (gráfico)",
      sourceModule: "financeCashFlowExecutiveYtd.ts",
      sourceFunction: "mapMonthlyToYtdTrend(ytdMonthlySeries)",
      rowScope: "ytd_period",
      officialBase: "cash_flow_motor",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: true,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      cashFlowInternalOracle: "buildFinanceCashFlowMonthlySeries (YTD filters)",
      alternatePath: "executiveSummary.monthlyTimeline",
    },

    // ─── Cards principais (payload.cards) ───
    {
      id: "cards_total_receivable_open",
      uiBlock: "(cards — alimenta score/reconciliação)",
      uiTab: "all",
      payloadPath: "cards.totalReceivableOpen",
      label: "Total a receber (carteira aberta)",
      sourceModule: "financeCashFlowDataset.ts",
      sourceFunction: "buildBlocksFromPortfolio",
      rowScope: "portfolio",
      officialBase: "ar_management",
      usesArOfficial: true,
      usesApOfficial: false,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: "n/a",
      apPurchaseOrderExcluded: "n/a",
      apOperationalDate: "n/a",
      respectsAppliedFilters: true,
      arEquivalent: "buildFinanceAccountsReceivableDashboard.cards.totalOpenAmount",
      cashFlowInternalOracle: FINANCE_CASH_FLOW_TIMELINE_ORACLE.portfolioBlocks.builder,
    },
    {
      id: "cards_total_payable_open",
      uiBlock: "(cards)",
      uiTab: "all",
      payloadPath: "cards.totalPayableOpen",
      label: "Total a pagar (carteira aberta)",
      sourceModule: "financeCashFlowDataset.ts",
      sourceFunction: "buildBlocksFromPortfolio",
      rowScope: "portfolio",
      officialBase: "ap_management",
      usesArOfficial: false,
      usesApOfficial: true,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: "n/a",
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      apEquivalent: "buildFinanceAccountsPayableDashboard.cards.totalOpenAmount",
      cashFlowInternalOracle: FINANCE_CASH_FLOW_TIMELINE_ORACLE.portfolioBlocks.builder,
    },
    {
      id: "cards_net_cash_position",
      uiBlock: "(cards / FinanceCashFlowCashNeedPanel)",
      uiTab: "all",
      payloadPath: "cards.netCashPosition",
      label: "Posição líquida (receber − pagar)",
      sourceModule: "financeCashFlowDashboard.ts",
      sourceFunction: "buildNetCashPositionMetrics",
      rowScope: "portfolio",
      officialBase: "mixed",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      conceptualException: "AR open − AP open (portfolio); sem campo único em AR ou AP.",
    },
    {
      id: "cards_overdue_receivable",
      uiBlock: "(cards)",
      uiTab: "all",
      payloadPath: "cards.overdueReceivableAmount",
      label: "Vencidos a receber (total)",
      sourceModule: "financeCashFlowDataset.ts",
      sourceFunction: "buildBlocksFromPortfolio → isFinanceArOverdueRow",
      rowScope: "portfolio",
      officialBase: "ar_management",
      usesArOfficial: true,
      usesApOfficial: false,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: "n/a",
      apPurchaseOrderExcluded: "n/a",
      apOperationalDate: "n/a",
      respectsAppliedFilters: true,
      arEquivalent: "buildFinanceArOverduePayload.summary.totalOverdueAmount",
    },
    {
      id: "cards_overdue_payable",
      uiBlock: "(cards)",
      uiTab: "all",
      payloadPath: "cards.overduePayableAmount",
      label: "Pagamentos vencidos (total)",
      sourceModule: "financeCashFlowDataset.ts",
      sourceFunction: "buildBlocksFromPortfolio → isFinanceCashFlowApOverdueRow",
      rowScope: "portfolio",
      officialBase: "ap_management",
      usesArOfficial: false,
      usesApOfficial: true,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: "n/a",
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      apEquivalent: "AP dashboard overdueAmount (data operacional)",
    },

    // ─── Listas críticas ───
    {
      id: "largest_projected_inflows",
      uiBlock: "CriticalList / FinanceCashFlowDetailTable",
      uiTab: "overview",
      payloadPath: "largestProjectedInflows",
      label: "Maiores entradas previstas",
      sourceModule: "financeCashFlowDataset.ts",
      sourceFunction: "buildBlocksFromPortfolio",
      rowScope: "portfolio",
      officialBase: "ar_management",
      usesArOfficial: true,
      usesApOfficial: false,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: "n/a",
      apPurchaseOrderExcluded: "n/a",
      apOperationalDate: "n/a",
      respectsAppliedFilters: true,
      arEquivalent: "Top open AR by balanceReceivable (carteira gerencial)",
    },
    {
      id: "largest_projected_outflows",
      uiBlock: "CriticalList / FinanceCashFlowDetailTable",
      uiTab: "overview",
      payloadPath: "largestProjectedOutflows",
      label: "Maiores saídas previstas",
      sourceModule: "financeCashFlowDataset.ts",
      sourceFunction: "buildBlocksFromPortfolio",
      rowScope: "portfolio",
      officialBase: "ap_management",
      usesArOfficial: false,
      usesApOfficial: true,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: "n/a",
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      apEquivalent: "Top open AP by resolveFinanceApOpenAmount",
    },
    {
      id: "overdue_receivables_list",
      uiBlock: "CriticalList / FinanceCashFlowRiskTab",
      uiTab: "overview",
      payloadPath: "overdueReceivables",
      label: "Vencidos a receber (lista)",
      sourceModule: "financeCashFlowDataset.ts",
      sourceFunction: "buildBlocksFromPortfolio → isFinanceArOverdueRow",
      rowScope: "portfolio",
      officialBase: "ar_management",
      usesArOfficial: true,
      usesApOfficial: false,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: "n/a",
      apPurchaseOrderExcluded: "n/a",
      apOperationalDate: "n/a",
      respectsAppliedFilters: true,
      arEquivalent: "buildFinanceAccountsReceivableOverdueRows",
    },
    {
      id: "overdue_payables_list",
      uiBlock: "CriticalList / FinanceCashFlowRiskTab",
      uiTab: "overview",
      payloadPath: "overduePayables",
      label: "Pagamentos vencidos (lista)",
      sourceModule: "financeCashFlowDataset.ts",
      sourceFunction: "buildBlocksFromPortfolio → isFinanceCashFlowApOverdueRow",
      rowScope: "portfolio",
      officialBase: "ap_management",
      usesArOfficial: false,
      usesApOfficial: true,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: "n/a",
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      apEquivalent: "AP overdue list (operational due date)",
    },
    {
      id: "top_customers",
      uiBlock: "PartyList",
      uiTab: "overview",
      payloadPath: "topCustomers",
      label: "Top clientes por entrada",
      sourceModule: "financeCashFlowDataset.ts",
      sourceFunction: "buildBlocksFromPortfolio → aggregate by customer",
      rowScope: "portfolio",
      officialBase: "ar_management",
      usesArOfficial: true,
      usesApOfficial: false,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: "n/a",
      apPurchaseOrderExcluded: "n/a",
      apOperationalDate: "n/a",
      respectsAppliedFilters: true,
      arEquivalent: "buildFinanceAccountsReceivableDashboard.customerRanking (open balance)",
    },
    {
      id: "top_suppliers",
      uiBlock: "PartyList",
      uiTab: "overview",
      payloadPath: "topSuppliers",
      label: "Top fornecedores por saída",
      sourceModule: "financeCashFlowDataset.ts",
      sourceFunction: "buildBlocksFromPortfolio",
      rowScope: "portfolio",
      officialBase: "ap_management",
      usesArOfficial: false,
      usesApOfficial: true,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: "n/a",
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      apEquivalent: "buildFinanceAccountsPayableDashboard.supplierRanking",
    },

    // ─── Calendário ───
    {
      id: "calendar_daily_grid",
      uiBlock: "FinanceCashFlowCalendar",
      uiTab: "calendar",
      payloadPath: "calendar.days",
      label: "Calendário diário",
      sourceModule: "financeCashFlowCalendar.ts",
      sourceFunction: "buildFinanceCashFlowCalendar → buildFinanceCashFlowCalendarMovements",
      rowScope: "period",
      officialBase: "cash_flow_motor",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: true,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      cashFlowInternalOracle: "buildFinanceCashFlowCalendarMovements",
      conceptualException:
        "Modo combined inclui realized+projected slices; AP realizado no calendário usa dueDate.",
      alternatePath: "monthlySeries do mês exibido",
    },
    {
      id: "calendar_weekly_summary",
      uiBlock: "FinanceCashFlowCalendar",
      uiTab: "calendar",
      payloadPath: "calendar.weeks",
      label: "Resumo semanal",
      sourceModule: "financeCashFlowCalendar.ts",
      sourceFunction: "buildWeekSummaries",
      rowScope: "period",
      officialBase: "cash_flow_motor",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: true,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      cashFlowInternalOracle: "Agregação de calendar.days",
    },
    {
      id: "calendar_month_summary",
      uiBlock: "FinanceCashFlowCalendar",
      uiTab: "calendar",
      payloadPath: "calendar.monthSummary",
      label: "Resumo do mês",
      sourceModule: "financeCashFlowCalendar.ts",
      sourceFunction: "sumCalendarDays",
      rowScope: "period",
      officialBase: "cash_flow_motor",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: true,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      alternatePath: "calendar.reconciliation vs executiveMonthlyTimeline/monthlySeries",
    },
    {
      id: "calendar_reconciliation",
      uiBlock: "FinanceCashFlowCalendar",
      uiTab: "calendar",
      payloadPath: "calendar.reconciliation",
      label: "Conferência calendário × timeline",
      sourceModule: "financeCashFlowCalendar.ts",
      sourceFunction: "buildCalendarTimelineReconciliation",
      rowScope: "period",
      officialBase: "cash_flow_motor",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: true,
      usesExecutiveTimeline: true,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      cashFlowInternalOracle: "Compara calendar vs executiveMonthlyTimeline ou monthlySeries",
    },

    // ─── Risco / Forecast ───
    {
      id: "cash_forecast",
      uiBlock: "FinanceCashFlowRiskTab / FinanceCashFlowCashNeedPanel",
      uiTab: "risk",
      payloadPath: "cashForecast",
      label: "Previsão de caixa (horizontes)",
      sourceModule: "financeCashFlowForecast.ts",
      sourceFunction: "buildCashFlowForecast",
      rowScope: "period",
      officialBase: "cash_flow_motor",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: true,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      conceptualException: "Projeção forward — sem equivalente direto AR/AP.",
    },
    {
      id: "conservative_scenario",
      uiBlock: "FinanceCashFlowRiskTab",
      uiTab: "risk",
      payloadPath: "conservativeScenario.cashNeedConservative",
      label: "Necessidade conservadora",
      sourceModule: "financeCashFlowForecast.ts",
      sourceFunction: "buildConservativeScenario",
      rowScope: "period",
      officialBase: "cash_flow_motor",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: true,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      conceptualException: "Fatores 80%/50% em recebíveis — simulação gerencial exclusiva do Fluxo.",
    },
    {
      id: "stress_scenario",
      uiBlock: "FinanceCashFlowRiskTab",
      uiTab: "risk",
      payloadPath: "stressScenario.cashNeedStress",
      label: "Necessidade crítica",
      sourceModule: "financeCashFlowForecast.ts",
      sourceFunction: "buildStressScenario",
      rowScope: "period",
      officialBase: "cash_flow_motor",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: true,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      conceptualException: "Fatores 60%/30% — simulação gerencial exclusiva do Fluxo.",
    },
    {
      id: "executive_insights_recommendations",
      uiBlock: "FinanceCashFlowRiskTab",
      uiTab: "risk",
      payloadPath: "executiveInsights.recommendedActions",
      label: "Ações recomendadas",
      sourceModule: "financeCashFlowCfoDiagnostics.ts",
      sourceFunction: "buildCashFlowExecutiveInsights",
      rowScope: "portfolio",
      officialBase: "mixed",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      conceptualException: "Texto derivado — sem número contábil equivalente AR/AP.",
      alternatePath: "operationalRecommendations (payload existe; componente FinanceCashFlowRecommendations não wired)",
    },
    {
      id: "concentration_diagnostics",
      uiBlock: "FinanceCashFlowRiskTab",
      uiTab: "risk",
      payloadPath: "executiveInsights.diagnostics.concentration",
      label: "Concentração cliente/fornecedor",
      sourceModule: "financeCashFlowCfoDiagnostics.ts",
      sourceFunction: "buildCashFlowExecutiveInsights",
      rowScope: "portfolio",
      officialBase: "mixed",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      arEquivalent: "Percentual sobre topCustomers",
      apEquivalent: "Percentual sobre topSuppliers",
    },

    // ─── Exportação ───
    {
      id: "export_csv",
      uiBlock: "FinanceCashFlowPage.handleExport",
      uiTab: "export",
      payloadPath: "(export CSV)",
      label: "Exportação Excel/CSV",
      sourceModule: "financeCashFlowExport.ts",
      sourceFunction: "buildFinanceCashFlowExportCsv",
      rowScope: "period",
      officialBase: "mixed",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: true,
      usesExecutiveTimeline: true,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      cashFlowInternalOracle: "Payload completo do dashboard — monthlySeries + executiveSummary + reconciliation",
    },

    // ─── Auditoria técnica (API) ───
    {
      id: "audit_payload",
      uiBlock: "(API /api/finance/cash-flow/audit)",
      uiTab: "audit",
      payloadPath: "(FinanceCashFlowAuditPayload)",
      label: "Auditoria técnica",
      sourceModule: "financeCashFlowDataset.ts",
      sourceFunction: "buildFinanceCashFlowAuditPayload",
      rowScope: "portfolio",
      officialBase: "mixed",
      usesArOfficial: true,
      usesApOfficial: true,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: false,
      freshnessExcluded: true,
      arOverdueNfRule: true,
      apIntercompanyExcluded: true,
      apPurchaseOrderExcluded: true,
      apOperationalDate: true,
      respectsAppliedFilters: true,
      cashFlowInternalOracle: "blockTotals devem bater com soma das listas na UI",
    },

    // ─── Load inicial (Prisma) ───
    {
      id: "prisma_load",
      uiBlock: "(backend loadCashFlowRows)",
      uiTab: "all",
      payloadPath: "(pré-processamento)",
      label: "Carga inicial Nomus AR/AP",
      sourceModule: "financeCashFlowRoutes.ts",
      sourceFunction: "loadCashFlowRows",
      rowScope: "load_only",
      officialBase: "mixed",
      usesArOfficial: false,
      usesApOfficial: false,
      usesMonthlyTimeline: false,
      usesExecutiveTimeline: false,
      usesPrismaDirect: true,
      freshnessExcluded: true,
      arOverdueNfRule: false,
      apIntercompanyExcluded: false,
      apPurchaseOrderExcluded: false,
      apOperationalDate: false,
      respectsAppliedFilters: true,
      conceptualException:
        "Prisma where inclui freshness; saneamento AR/AP aplicado em memória após load.",
    },
  ] as const;

/** Blocos obrigatórios que a auditoria deve cobrir (critério de aceite). */
export const FINANCE_CASH_FLOW_REQUIRED_UI_BLOCKS = [
  "cards principais",
  "posição líquida",
  "entradas previstas",
  "saídas previstas",
  "recebido/realizado",
  "pago/realizado",
  "vencidos a receber",
  "pagamentos vencidos",
  "maiores entradas previstas",
  "maiores saídas previstas",
  "top clientes por entrada",
  "top fornecedores por saída",
  "linha do tempo mensal",
  "calendário",
  "resumo semanal",
  "exportação",
  "auditoria técnica",
  "forecast/cenários/recomendações",
] as const;

export function getReconciliationEntryById(
  id: string
): FinanceCashFlowReconciliationEntry | undefined {
  return FINANCE_CASH_FLOW_RECONCILIATION_MAP.find((e) => e.id === id);
}

export function listReconciliationEntriesWithAlternatePath(): FinanceCashFlowReconciliationEntry[] {
  return FINANCE_CASH_FLOW_RECONCILIATION_MAP.filter((e) => e.alternatePath != null);
}

export function listReconciliationEntriesWithConceptualException(): FinanceCashFlowReconciliationEntry[] {
  return FINANCE_CASH_FLOW_RECONCILIATION_MAP.filter((e) => e.conceptualException != null);
}

export function listArOfficialEntries(): FinanceCashFlowReconciliationEntry[] {
  return FINANCE_CASH_FLOW_RECONCILIATION_MAP.filter((e) => e.usesArOfficial);
}

export function listApOfficialEntries(): FinanceCashFlowReconciliationEntry[] {
  return FINANCE_CASH_FLOW_RECONCILIATION_MAP.filter((e) => e.usesApOfficial);
}

/** Valida cobertura mínima do mapa para testes de auditoria. */
export function validateReconciliationMapCoverage(): {
  ok: boolean;
  missingRequiredBlocks: string[];
  duplicateIds: string[];
  entriesWithoutSource: string[];
} {
  const coveredLabels = new Set(
    FINANCE_CASH_FLOW_RECONCILIATION_MAP.map((e) => e.label.toLowerCase())
  );

  const keywordCoverage: Record<string, boolean> = {
    "cards principais": FINANCE_CASH_FLOW_RECONCILIATION_MAP.some((e) =>
      e.payloadPath.startsWith("cards.")
    ),
    "posição líquida": FINANCE_CASH_FLOW_RECONCILIATION_MAP.some((e) =>
      e.label.toLowerCase().includes("posição líquida")
    ),
    "entradas previstas": coveredLabels.has("entradas do período") ||
      coveredLabels.has("maiores entradas previstas"),
    "saídas previstas": coveredLabels.has("saídas do período") ||
      coveredLabels.has("maiores saídas previstas"),
    "recebido/realizado": coveredLabels.has("recebido ytd"),
    "pago/realizado": coveredLabels.has("pago ytd"),
    "vencidos a receber": FINANCE_CASH_FLOW_RECONCILIATION_MAP.some((e) =>
      e.payloadPath.includes("overdueReceiv")
    ),
    "pagamentos vencidos": FINANCE_CASH_FLOW_RECONCILIATION_MAP.some((e) =>
      e.payloadPath.includes("overduePay")
    ),
    "maiores entradas previstas": coveredLabels.has("maiores entradas previstas"),
    "maiores saídas previstas": coveredLabels.has("maiores saídas previstas"),
    "top clientes por entrada": coveredLabels.has("top clientes por entrada"),
    "top fornecedores por saída": coveredLabels.has("top fornecedores por saída"),
    "linha do tempo mensal": FINANCE_CASH_FLOW_RECONCILIATION_MAP.some((e) =>
      e.usesExecutiveTimeline
    ),
    calendário: FINANCE_CASH_FLOW_RECONCILIATION_MAP.some((e) => e.uiTab === "calendar"),
    "resumo semanal": coveredLabels.has("resumo semanal"),
    exportação: FINANCE_CASH_FLOW_RECONCILIATION_MAP.some((e) => e.uiTab === "export"),
    "auditoria técnica": FINANCE_CASH_FLOW_RECONCILIATION_MAP.some((e) => e.uiTab === "audit"),
    "forecast/cenários/recomendações": FINANCE_CASH_FLOW_RECONCILIATION_MAP.some(
      (e) => e.uiTab === "risk"
    ),
  };

  const missingRequiredBlocks = FINANCE_CASH_FLOW_REQUIRED_UI_BLOCKS.filter(
    (block) => !keywordCoverage[block]
  );

  const ids = FINANCE_CASH_FLOW_RECONCILIATION_MAP.map((e) => e.id);
  const duplicateIds = ids.filter((id, i) => ids.indexOf(id) !== i);

  const entriesWithoutSource = FINANCE_CASH_FLOW_RECONCILIATION_MAP.filter(
    (e) => !e.sourceModule || !e.sourceFunction
  ).map((e) => e.id);

  return {
    ok:
      missingRequiredBlocks.length === 0 &&
      duplicateIds.length === 0 &&
      entriesWithoutSource.length === 0,
    missingRequiredBlocks,
    duplicateIds,
    entriesWithoutSource,
  };
}
