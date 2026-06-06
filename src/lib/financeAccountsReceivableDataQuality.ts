import {
  classifyFinanceArTitle,
  computeDaysOverdue,
  isFinanceArOpen,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";

export type FinanceArDataQualitySeverity = "info" | "warning" | "critical";

export type FinanceArDataQualityAlertKey =
  | "missingPersonCnpj"
  | "missingDueDate"
  | "missingPaymentMethod"
  | "negativeBalance"
  | "receivedGreaterThanReceivable"
  | "suspendedCollectionOpen"
  | "missingSourceInvoice"
  | "overdueOver30Days"
  | "overdueOver60Days"
  | "overdueOver90Days";

export type FinanceArDataQualityAlertAccumulator = Record<
  FinanceArDataQualityAlertKey,
  { count: number; amount: number }
>;

export type FinanceArDataQualityAlertItem = {
  key: FinanceArDataQualityAlertKey;
  label: string;
  count: number;
  amount: number | null;
  severity: FinanceArDataQualitySeverity;
};

export type FinanceArDataQualityAlertsLegacy = {
  missingDueDate: number;
  missingPersonCnpj: number;
  missingPaymentMethod: number;
  negativeBalance: number;
  receivedGreaterThanReceivable: number;
  suspendedCollectionOpen: number;
  missingSourceInvoice: number;
  overdueOver30Days: number;
  overdueOver60Days: number;
  overdueOver90Days: number;
};

export function createFinanceArDataQualityAccumulator(): FinanceArDataQualityAlertAccumulator {
  return {
    missingPersonCnpj: { count: 0, amount: 0 },
    missingDueDate: { count: 0, amount: 0 },
    missingPaymentMethod: { count: 0, amount: 0 },
    negativeBalance: { count: 0, amount: 0 },
    receivedGreaterThanReceivable: { count: 0, amount: 0 },
    suspendedCollectionOpen: { count: 0, amount: 0 },
    missingSourceInvoice: { count: 0, amount: 0 },
    overdueOver30Days: { count: 0, amount: 0 },
    overdueOver60Days: { count: 0, amount: 0 },
    overdueOver90Days: { count: 0, amount: 0 },
  };
}

function bump(
  acc: FinanceArDataQualityAlertAccumulator,
  key: FinanceArDataQualityAlertKey,
  amount: number
): void {
  acc[key].count += 1;
  acc[key].amount += amount;
}

export function trackFinanceArDataQualityRow(
  acc: FinanceArDataQualityAlertAccumulator,
  row: FinanceArDashboardRow,
  referenceDate: Date
): void {
  const balance = row.balanceReceivable;
  const open = isFinanceArOpen(row);

  if (balance < 0) {
    bump(acc, "negativeBalance", Math.abs(balance));
  }
  if (row.amountReceived > row.amountReceivable && row.amountReceivable > 0) {
    bump(acc, "receivedGreaterThanReceivable", row.amountReceived);
  }
  if (!row.paymentMethodName?.trim()) {
    bump(acc, "missingPaymentMethod", open ? balance : 0);
  }
  if (!row.sourceInvoiceId && !row.sourceInvoiceNumber?.trim()) {
    bump(acc, "missingSourceInvoice", open ? balance : 0);
  }

  if (!open) return;

  if (!row.personCnpj?.trim()) bump(acc, "missingPersonCnpj", balance);
  if (!row.dueDate) bump(acc, "missingDueDate", balance);
  if (row.suspendCollection === true) bump(acc, "suspendedCollectionOpen", balance);

  const status = classifyFinanceArTitle(row, referenceDate);
  if (status === "overdue" && row.dueDate) {
    const days = computeDaysOverdue(row.dueDate, referenceDate);
    if (days > 30) bump(acc, "overdueOver30Days", balance);
    if (days > 60) bump(acc, "overdueOver60Days", balance);
    if (days > 90) bump(acc, "overdueOver90Days", balance);
  }
}

const ALERT_DEFS: Array<{
  key: FinanceArDataQualityAlertKey;
  label: string;
  severity: FinanceArDataQualitySeverity;
  includeAmount: boolean;
}> = [
  { key: "missingPersonCnpj", label: "Títulos sem CNPJ", severity: "warning", includeAmount: true },
  { key: "missingDueDate", label: "Títulos sem vencimento", severity: "critical", includeAmount: true },
  { key: "missingPaymentMethod", label: "Títulos sem forma de pagamento", severity: "warning", includeAmount: true },
  { key: "negativeBalance", label: "Títulos com saldo negativo", severity: "critical", includeAmount: true },
  {
    key: "receivedGreaterThanReceivable",
    label: "Valor recebido maior que valor original",
    severity: "critical",
    includeAmount: true,
  },
  {
    key: "suspendedCollectionOpen",
    label: "Cobrança suspensa com saldo em aberto",
    severity: "warning",
    includeAmount: true,
  },
  { key: "missingSourceInvoice", label: "Títulos sem NF vinculada", severity: "info", includeAmount: true },
  { key: "overdueOver30Days", label: "Vencidos acima de 30 dias", severity: "warning", includeAmount: true },
  { key: "overdueOver60Days", label: "Vencidos acima de 60 dias", severity: "critical", includeAmount: true },
  { key: "overdueOver90Days", label: "Vencidos acima de 90 dias", severity: "critical", includeAmount: true },
];

export function buildFinanceArDataQualitySummary(
  acc: FinanceArDataQualityAlertAccumulator
): FinanceArDataQualityAlertItem[] {
  return ALERT_DEFS.map((def) => {
    const bucket = acc[def.key];
    return {
      key: def.key,
      label: def.label,
      count: bucket.count,
      amount: def.includeAmount ? bucket.amount : null,
      severity: def.severity,
    };
  }).filter((item) => item.count > 0);
}

export function financeArDataQualityAlertsLegacy(
  acc: FinanceArDataQualityAlertAccumulator
): FinanceArDataQualityAlertsLegacy {
  return {
    missingPersonCnpj: acc.missingPersonCnpj.count,
    missingDueDate: acc.missingDueDate.count,
    missingPaymentMethod: acc.missingPaymentMethod.count,
    negativeBalance: acc.negativeBalance.count,
    receivedGreaterThanReceivable: acc.receivedGreaterThanReceivable.count,
    suspendedCollectionOpen: acc.suspendedCollectionOpen.count,
    missingSourceInvoice: acc.missingSourceInvoice.count,
    overdueOver30Days: acc.overdueOver30Days.count,
    overdueOver60Days: acc.overdueOver60Days.count,
    overdueOver90Days: acc.overdueOver90Days.count,
  };
}

export function rowMatchesFinanceArQualityAlert(
  row: FinanceArDashboardRow,
  alertKey: FinanceArDataQualityAlertKey,
  referenceDate: Date
): boolean {
  const open = isFinanceArOpen(row);
  switch (alertKey) {
    case "missingPersonCnpj":
      return open && !row.personCnpj?.trim();
    case "missingDueDate":
      return open && !row.dueDate;
    case "missingPaymentMethod":
      return !row.paymentMethodName?.trim();
    case "negativeBalance":
      return row.balanceReceivable < 0;
    case "receivedGreaterThanReceivable":
      return row.amountReceived > row.amountReceivable && row.amountReceivable > 0;
    case "suspendedCollectionOpen":
      return open && row.suspendCollection === true;
    case "missingSourceInvoice":
      return !row.sourceInvoiceId && !row.sourceInvoiceNumber?.trim();
    case "overdueOver30Days":
    case "overdueOver60Days":
    case "overdueOver90Days": {
      if (!open || !row.dueDate) return false;
      if (classifyFinanceArTitle(row, referenceDate) !== "overdue") return false;
      const days = computeDaysOverdue(row.dueDate, referenceDate);
      if (alertKey === "overdueOver30Days") return days > 30;
      if (alertKey === "overdueOver60Days") return days > 60;
      return days > 90;
    }
    default:
      return false;
  }
}

export function financeArDataQualitySeverityLabel(severity: FinanceArDataQualitySeverity): string {
  switch (severity) {
    case "info":
      return "Info";
    case "warning":
      return "Atenção";
    case "critical":
      return "Crítico";
    default:
      return "—";
  }
}
