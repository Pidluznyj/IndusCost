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
  customerName: string | null;
  sellerName: string | null;
  saleValue: number;
  investedCapital: number | null;
  investedCapitalSource: "INDUSTRIAL_RESULT";
  investedCapitalUnavailableReason: string | null;
  actualReceived: number;
  outstandingReceivable: number;
  capitalRecovered: number | null;
  moneyOnStreet: number | null;
  recoveryPercent: number | null;
  status: InvestedCapitalRecoveryStatus;
  capitalRecoveryDate: string | null;
  forecastCapitalRecoveryDate: string | null;
  forecastSource: "REAL_RECEIVABLES" | "REAL_AND_FORECAST" | "FORECAST_ONLY" | "NONE";
  orderStatusLabel: string;
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
  };
  agingBuckets: Array<{ key: string; label: string; amount: number }>;
  topCustomers: Array<{ customerName: string; moneyOnStreet: number; percentOfTotal: number }>;
  rows: InvestedCapitalRecoveryRow[];
};
