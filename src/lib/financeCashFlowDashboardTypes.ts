/** Tipos do payload GET /api/finance/cash-flow/dashboard */

import type {
  FinanceCashFlowCashForecast,
  FinanceCashFlowConservativeScenario,
  FinanceCashFlowScenarioChartPoint,
  FinanceCashFlowStressScenario,
} from "./financeCashFlowForecast.js";
import type {
  CashHealthScore,
  FinanceCashFlowDailyPoint,
  FinanceCashFlowExecutiveInsights,
} from "./financeCashFlowCfoDiagnostics.js";
import type { FinanceCashFlowExecutiveYtd } from "./financeCashFlowExecutiveYtd.js";

export type FinanceCashFlowViewMode = "projected" | "realized" | "combined";
export type FinanceCashFlowDateBase = "due" | "settlement" | "issue";
export type FinanceCashFlowStatusFilter = "all" | "open" | "settled" | "overdue";

export type FinanceCashFlowDashboardFiltersApplied = {
  year?: number;
  month?: number;
  companyName?: string;
  viewMode: FinanceCashFlowViewMode;
  dateBase: FinanceCashFlowDateBase;
  status: FinanceCashFlowStatusFilter;
  customerName?: string;
  supplierName?: string;
  personCnpj?: string;
  paymentMethodName?: string;
  bankAccountName?: string;
  invoiceIssued?: string;
};

export type NetCashPositionStatus = "surplus" | "deficit";
export type FinanceCashFlowMonthlyNetStatus = "positive" | "negative";

export type FinanceCashFlowDashboardCards = {
  totalReceivableOpen: number;
  totalPayableOpen: number;
  inflowAmount: number;
  outflowAmount: number;
  netFlowAmount: number;
  accumulatedBalance: number;
  overdueCashImpact: number;
  overdueReceivableAmount: number;
  overduePayableAmount: number;
  outflowToInflowPercent: number | null;
  negativeBalanceMonthsCount: number;
  /** Posição líquida de caixa = totalReceivableOpen − totalPayableOpen. */
  netCashPosition: number;
  netCashPositionStatus: NetCashPositionStatus;
  netCashPositionAbs: number;
  netCashPositionLabel: string;
  /** totalReceivableOpen / totalPayableOpen — null quando pagar = 0 e receber > 0. */
  cashCoverageRatio: number | null;
  /** Valor necessário para zerar déficit; 0 em superávit. */
  cashNeedAmount: number;
  cashNeedLabel: string;
  arRecords: number;
  apRecords: number;
  lastSyncAt: string | null;
  hasInitialBankBalance: false;
};

export type FinanceCashFlowMonthlyPoint = {
  year: number;
  month: number;
  monthLabel: string;
  inflowAmount: number | null;
  outflowAmount: number | null;
  netFlowAmount: number | null;
  accumulatedBalance: number | null;
  /** positive | negative — null em meses futuros sem dado (modo realizado). */
  status: FinanceCashFlowMonthlyNetStatus | null;
  inflowCount: number;
  outflowCount: number;
};

export type FinanceCashFlowPartySummary = {
  personName: string | null;
  personCnpj: string | null;
  amount: number;
  titlesCount: number;
  percentOfTotal: number;
};

export type FinanceCashFlowCriticalMovement = {
  side: "inflow" | "outflow";
  externalId: number;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  dueDate: string | null;
  movementDate: string | null;
  amount: number;
  daysOverdue: number;
  documentLabel: string | null;
};

export type FinanceCashFlowDashboardPayload = {
  generatedAt: string;
  referenceDate: string;
  filtersApplied: FinanceCashFlowDashboardFiltersApplied;
  sources: {
    inflows: "NomusAccountsReceivable";
    outflows: "NomusAccountsPayable";
  };
  cards: FinanceCashFlowDashboardCards;
  /** Frases determinísticas para leitura gerencial do caixa (período filtrado). */
  executiveReading: string[];
  /** Resumo executivo YTD — topo da tela, independente do mês filtrado. */
  executiveYtd: FinanceCashFlowExecutiveYtd;
  /** Leitura executiva do bloco YTD. */
  executiveYtdReading: string[];
  /** Previsão de caixa por horizonte (mês atual, 3, 6 e 12 meses). */
  cashForecast: FinanceCashFlowCashForecast;
  conservativeScenario: FinanceCashFlowConservativeScenario;
  stressScenario: FinanceCashFlowStressScenario;
  scenarioChartPoints: FinanceCashFlowScenarioChartPoint[];
  /** Recomendações operacionais determinísticas. */
  operationalRecommendations: string[];
  /** Score composto de saúde do caixa (0–100). */
  cashHealthScore: CashHealthScore;
  /** Diagnóstico CFO: alertas, oportunidades, plano de ação. */
  executiveInsights: FinanceCashFlowExecutiveInsights;
  /** Calendário diário do mês filtrado (ou mês de referência). */
  dailyCalendar: FinanceCashFlowDailyPoint[];
  monthlySeries: FinanceCashFlowMonthlyPoint[];
  topCustomers: FinanceCashFlowPartySummary[];
  topSuppliers: FinanceCashFlowPartySummary[];
  largestProjectedInflows: FinanceCashFlowCriticalMovement[];
  largestProjectedOutflows: FinanceCashFlowCriticalMovement[];
  overdueReceivables: FinanceCashFlowCriticalMovement[];
  overduePayables: FinanceCashFlowCriticalMovement[];
};

export type FinanceCashFlowUiFilters = {
  year: string;
  month: string;
  companyName: string;
  viewMode: FinanceCashFlowViewMode;
  dateBase: FinanceCashFlowDateBase;
  status: FinanceCashFlowStatusFilter;
  customerName: string;
  supplierName: string;
  personCnpj: string;
  paymentMethodName: string;
  bankAccountName: string;
  invoiceIssued: string;
};

export const FINANCE_CASH_FLOW_VIEW_OPTIONS = [
  { value: "projected", label: "Previsto" },
  { value: "realized", label: "Realizado" },
  { value: "combined", label: "Previsto x Realizado" },
] as const;

export const FINANCE_CASH_FLOW_DATE_BASE_OPTIONS = [
  { value: "due", label: "Vencimento" },
  { value: "settlement", label: "Baixa" },
  { value: "issue", label: "Emissão" },
] as const;

export const FINANCE_CASH_FLOW_STATUS_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "open", label: "Aberto" },
  { value: "settled", label: "Pago/Baixado" },
  { value: "overdue", label: "Vencido" },
] as const;

export const FINANCE_CASH_FLOW_INVOICE_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "yes", label: "Sim" },
  { value: "no", label: "Não" },
] as const;

export const FINANCE_CASH_FLOW_MONTH_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "1", label: "Janeiro" },
  { value: "2", label: "Fevereiro" },
  { value: "3", label: "Março" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Maio" },
  { value: "6", label: "Junho" },
  { value: "7", label: "Julho" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
] as const;

export const FINANCE_CASH_FLOW_TABS = [
  { id: "overview", label: "Visão Geral" },
  { id: "calendar", label: "Calendário" },
  { id: "accumulated", label: "Acumulado" },
  { id: "detailed", label: "Detalhado" },
  { id: "inflows", label: "Entradas" },
  { id: "outflows", label: "Saídas" },
  { id: "risk", label: "Risco de Caixa" },
] as const;

export type FinanceCashFlowTabId = (typeof FINANCE_CASH_FLOW_TABS)[number]["id"];

export const PHASE1_FINANCE_CASH_FLOW_TABS: FinanceCashFlowTabId[] = [
  "overview",
  "calendar",
  "risk",
];

export function createDefaultFinanceCashFlowUiFilters(
  referenceYear = new Date().getFullYear()
): FinanceCashFlowUiFilters {
  return {
    year: String(referenceYear),
    month: "",
    companyName: "",
    viewMode: "projected",
    dateBase: "due",
    status: "all",
    customerName: "",
    supplierName: "",
    personCnpj: "",
    paymentMethodName: "",
    bankAccountName: "",
    invoiceIssued: "all",
  };
}

export function buildFinanceCashFlowYearOptions(referenceYear = new Date().getFullYear()) {
  const options: Array<{ value: string; label: string }> = [];
  for (let y = referenceYear + 1; y >= referenceYear - 5; y -= 1) {
    options.push({ value: String(y), label: String(y) });
  }
  return options;
}

export function normalizeFinanceCashFlowUiFilters(
  filters: Partial<FinanceCashFlowUiFilters>
): FinanceCashFlowUiFilters {
  const defaults = createDefaultFinanceCashFlowUiFilters();
  const merged = { ...defaults, ...filters };
  const year = merged.year.trim();
  const month = merged.month.trim();
  if (month && !year) {
    return { ...merged, year: String(new Date().getFullYear()) };
  }
  return merged;
}

export function buildFinanceCashFlowDashboardQuery(
  filters: Partial<FinanceCashFlowUiFilters>
): string {
  const n = normalizeFinanceCashFlowUiFilters(filters);
  const q = new URLSearchParams();
  if (n.year.trim()) q.set("year", n.year.trim());
  if (n.month.trim()) q.set("month", n.month.trim());
  if (n.companyName.trim()) q.set("companyName", n.companyName.trim());
  if (n.viewMode !== "projected") q.set("viewMode", n.viewMode);
  if (n.dateBase !== "due") q.set("dateBase", n.dateBase);
  if (n.status !== "all") q.set("status", n.status);
  if (n.customerName.trim()) q.set("customerName", n.customerName.trim());
  if (n.supplierName.trim()) q.set("supplierName", n.supplierName.trim());
  if (n.personCnpj.trim()) q.set("personCnpj", n.personCnpj.trim());
  if (n.paymentMethodName.trim()) q.set("paymentMethodName", n.paymentMethodName.trim());
  if (n.bankAccountName.trim()) q.set("bankAccountName", n.bankAccountName.trim());
  if (n.invoiceIssued !== "all") q.set("invoiceIssued", n.invoiceIssued);
  return q.toString();
}

export function buildFinanceCashFlowExportQuery(
  filters: Partial<FinanceCashFlowUiFilters>
): string {
  const q = buildFinanceCashFlowDashboardQuery(filters);
  return q ? `${q}&format=csv` : "format=csv";
}
