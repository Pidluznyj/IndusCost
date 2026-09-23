/**
 * Tipos compartilhados entre a tela e o PDF de Financeiro > Recuperação do
 * Dinheiro Investido — espelham exatamente o DTO retornado por
 * `getSalesOrderInvestedCapitalRecoveryPayload` (backend é autoridade).
 */

export type InvestedCapitalRecoveryStatus =
  | "SEM_RECUPERACAO"
  | "EM_RECUPERACAO"
  | "CAPITAL_RECUPERADO"
  | "DADOS_INSUFICIENTES";

export type InvestedCapitalRecoveryRow = {
  salesOrderId: string;
  orderCode: string;
  customerId?: string | null;
  issueDate?: string | null;
  customerName: string | null;
  sellerName: string | null;
  saleValue: number;
  invoicedValue?: number;
  investedCapital: number | null;
  investedCapitalSource: "INDUSTRIAL_RESULT";
  investedCapitalUnavailableReason: string | null;
  actualReceived: number;
  outstandingReceivable: number;
  capitalRecovered: number | null;
  moneyOnStreet: number | null;
  realizedGain?: number | null;
  potentialResult?: number | null;
  recoveryPercent: number | null;
  status: InvestedCapitalRecoveryStatus;
  capitalRecoveryDate: string | null;
  forecastCapitalRecoveryDate: string | null;
  forecastSource: "REAL_RECEIVABLES" | "REAL_AND_FORECAST" | "FORECAST_ONLY" | "NONE";
  orderStatusLabel: string;
  /** Componente de custo puro de investedCapital (sem o imposto). */
  industrialCost: number | null;
  /** Imposto usado no cálculo da margem comercial do Pedido — já incluído em investedCapital. */
  totalTaxes: number | null;
  taxSourceLabel: string | null;
};

export type InvestedCapitalRecoveryCustomerChartPoint = {
  customerKey: string;
  customerName: string;
  amount: number;
};

export type InvestedCapitalRecoveryCustomerMoney = {
  orders: number;
  insufficientDataOrders: number;
  sold: number;
  invoiced: number;
  industrialCost: number | null;
  taxes: number | null;
  investedCapital: number | null;
  received: number;
  recoveredCapital: number | null;
  capitalAtRisk: number | null;
  realizedGain: number | null;
  potentialResult: number | null;
  recoveredPercent: number | null;
  economicMarginPercent: number | null;
};

export type InvestedCapitalRecoveryCustomerRow = InvestedCapitalRecoveryCustomerMoney & {
  customerId: string | null;
  customerKey: string;
  customerName: string;
  unidentified: boolean;
};

export type InvestedCapitalRecoveryByCustomer = {
  summary: InvestedCapitalRecoveryCustomerMoney & {
    customers: number;
    invoicedCustomers: number;
  };
  customers: InvestedCapitalRecoveryCustomerRow[];
  charts: {
    topInvoiced: InvestedCapitalRecoveryCustomerChartPoint[];
    topRealizedGain: InvestedCapitalRecoveryCustomerChartPoint[];
    topCapitalAtRisk: InvestedCapitalRecoveryCustomerChartPoint[];
  };
};

export type InvestedCapitalRecoveryPayload = {
  ok: true;
  generatedAt: string;
  totalOrdersInScope: number;
  truncated: boolean;
  kpis: {
    moneyOnStreetToday: number;
    capitalRecoveredTotal: number;
    investedCapitalAnalyzedTotal: number;
    totalOutstandingReceivable: number;
    ordersFullyRecoveredCount: number;
    ordersPartiallyRecoveredCount: number;
    ordersInsufficientDataCount: number;
    averageDaysToRecoverCapital: number | null;
    totalSaleValueAnalyzed: number;
    totalIndustrialCostAnalyzed: number;
    totalTaxesAnalyzed: number;
  };
  agingBuckets: Array<{ key: string; label: string; amount: number }>;
  topCustomers: Array<{ customerName: string; moneyOnStreet: number; percentOfTotal: number }>;
  rows: InvestedCapitalRecoveryRow[];
  byCustomer?: InvestedCapitalRecoveryByCustomer;
  /** Diagnóstico temporário — investigação da tela vazia. Ver serviço backend. */
  populationDiagnostics: {
    rawTotalSalesOrders: number;
    totalCandidates: number;
    intercompanyExcluded: number;
    eligibleOrders: number;
  } | null;
};
