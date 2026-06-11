import {
  classifyFinanceApTitle,
  isFinanceApOpen,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import { computeFinanceApDaysOverdue } from "./financeAccountsPayableOperational.js";

export type FinanceApDataQualitySeverity = "info" | "warning" | "critical";

export type FinanceApDataQualityAlertKey =
  | "missingPersonCnpj"
  | "missingDueDate"
  | "missingPaymentMethod"
  | "negativeBalance"
  | "paidGreaterThanPayable"
  | "suspendedPaymentOpen"
  | "overdueOver30Days"
  | "overdueOver60Days"
  | "overdueOver90Days";

export type FinanceApDataQualityAlertAccumulator = Record<
  FinanceApDataQualityAlertKey,
  { count: number; amount: number }
>;

export type FinanceApDataQualityAlertItem = {
  key: FinanceApDataQualityAlertKey;
  label: string;
  count: number;
  amount: number | null;
  severity: FinanceApDataQualitySeverity;
};

export type FinanceApDataQualityAlertsLegacy = {
  missingDueDate: number;
  missingPersonCnpj: number;
  missingPaymentMethod: number;
  negativeBalance: number;
  paidGreaterThanPayable: number;
  suspendedPaymentOpen: number;
  overdueOver30Days: number;
  overdueOver60Days: number;
  overdueOver90Days: number;
};

export function createFinanceApDataQualityAccumulator(): FinanceApDataQualityAlertAccumulator {
  return {
    missingPersonCnpj: { count: 0, amount: 0 },
    missingDueDate: { count: 0, amount: 0 },
    missingPaymentMethod: { count: 0, amount: 0 },
    negativeBalance: { count: 0, amount: 0 },
    paidGreaterThanPayable: { count: 0, amount: 0 },
    suspendedPaymentOpen: { count: 0, amount: 0 },
    overdueOver30Days: { count: 0, amount: 0 },
    overdueOver60Days: { count: 0, amount: 0 },
    overdueOver90Days: { count: 0, amount: 0 },
  };
}

function bump(
  acc: FinanceApDataQualityAlertAccumulator,
  key: FinanceApDataQualityAlertKey,
  amount: number
): void {
  acc[key].count += 1;
  acc[key].amount += amount;
}

export function trackFinanceApDataQualityRow(
  acc: FinanceApDataQualityAlertAccumulator,
  row: FinanceApDashboardRow,
  referenceDate: Date
): void {
  const balance = row.balancePayable;
  const open = isFinanceApOpen(row);

  if (balance < 0) {
    bump(acc, "negativeBalance", Math.abs(balance));
  }
  if (row.amountPaid > row.amountPayable && row.amountPayable > 0) {
    bump(acc, "paidGreaterThanPayable", row.amountPaid);
  }
  if (!row.paymentMethodName?.trim()) {
    bump(acc, "missingPaymentMethod", open ? balance : 0);
  }

  if (!open) return;

  if (!row.personCnpj?.trim()) bump(acc, "missingPersonCnpj", balance);
  if (!row.dueDate) bump(acc, "missingDueDate", balance);
  if (row.suspendPayment === true) bump(acc, "suspendedPaymentOpen", balance);

  const status = classifyFinanceApTitle(row, referenceDate);
  if (status === "overdue") {
    const days = computeFinanceApDaysOverdue(row, referenceDate);
    if (days > 30) bump(acc, "overdueOver30Days", balance);
    if (days > 60) bump(acc, "overdueOver60Days", balance);
    if (days > 90) bump(acc, "overdueOver90Days", balance);
  }
}

const ALERT_DEFS: Array<{
  key: FinanceApDataQualityAlertKey;
  label: string;
  severity: FinanceApDataQualitySeverity;
  includeAmount: boolean;
}> = [
  { key: "missingPersonCnpj", label: "Títulos sem CNPJ", severity: "warning", includeAmount: true },
  { key: "missingDueDate", label: "Títulos sem vencimento", severity: "critical", includeAmount: true },
  { key: "missingPaymentMethod", label: "Títulos sem forma de pagamento", severity: "warning", includeAmount: true },
  { key: "negativeBalance", label: "Títulos com saldo negativo", severity: "critical", includeAmount: true },
  {
    key: "paidGreaterThanPayable",
    label: "Valor pago maior que valor original",
    severity: "critical",
    includeAmount: true,
  },
  {
    key: "suspendedPaymentOpen",
    label: "Pagamento suspenso com saldo em aberto",
    severity: "warning",
    includeAmount: true,
  },
  { key: "overdueOver30Days", label: "Vencidos acima de 30 dias", severity: "warning", includeAmount: true },
  { key: "overdueOver60Days", label: "Vencidos acima de 60 dias", severity: "critical", includeAmount: true },
  { key: "overdueOver90Days", label: "Vencidos acima de 90 dias", severity: "critical", includeAmount: true },
];

export function buildFinanceApDataQualitySummary(
  acc: FinanceApDataQualityAlertAccumulator
): FinanceApDataQualityAlertItem[] {
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

export function financeApDataQualityAlertsLegacy(
  acc: FinanceApDataQualityAlertAccumulator
): FinanceApDataQualityAlertsLegacy {
  return {
    missingPersonCnpj: acc.missingPersonCnpj.count,
    missingDueDate: acc.missingDueDate.count,
    missingPaymentMethod: acc.missingPaymentMethod.count,
    negativeBalance: acc.negativeBalance.count,
    paidGreaterThanPayable: acc.paidGreaterThanPayable.count,
    suspendedPaymentOpen: acc.suspendedPaymentOpen.count,
    overdueOver30Days: acc.overdueOver30Days.count,
    overdueOver60Days: acc.overdueOver60Days.count,
    overdueOver90Days: acc.overdueOver90Days.count,
  };
}

export function rowMatchesFinanceApQualityAlert(
  row: FinanceApDashboardRow,
  alertKey: FinanceApDataQualityAlertKey,
  referenceDate: Date
): boolean {
  const open = isFinanceApOpen(row);
  switch (alertKey) {
    case "missingPersonCnpj":
      return open && !row.personCnpj?.trim();
    case "missingDueDate":
      return open && !row.dueDate;
    case "missingPaymentMethod":
      return !row.paymentMethodName?.trim();
    case "negativeBalance":
      return row.balancePayable < 0;
    case "paidGreaterThanPayable":
      return row.amountPaid > row.amountPayable && row.amountPayable > 0;
    case "suspendedPaymentOpen":
      return open && row.suspendPayment === true;
    case "overdueOver30Days":
    case "overdueOver60Days":
    case "overdueOver90Days": {
      if (!open || !row.dueDate) return false;
      if (classifyFinanceApTitle(row, referenceDate) !== "overdue") return false;
      const days = computeFinanceApDaysOverdue(row, referenceDate);
      if (alertKey === "overdueOver30Days") return days > 30;
      if (alertKey === "overdueOver60Days") return days > 60;
      return days > 90;
    }
    default:
      return false;
  }
}

export function financeApDataQualitySeverityLabel(severity: FinanceApDataQualitySeverity): string {
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
