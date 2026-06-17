import type { FinanceArUiFilters } from "./financeAccountsReceivableDashboardTypes.js";
import { FINANCE_AR_OVERDUE_FISCAL_BACKING_NOTE } from "./financeAccountsReceivableManagement.js";
import {
  FINANCE_AR_OVERDUE_AGING_BUCKETS,
  type FinanceArOverdueTitleRow,
  type FinanceArOverdueUiFilters,
} from "./financeAccountsReceivableOverdueTypes.js";

export const FINANCE_AR_OVERDUE_PRINT_TITLE = "Relatório de Contas a Receber em Atraso";
export const FINANCE_AR_OVERDUE_PRINT_SUBTITLE = "Documento de apoio ao processo de cobrança";
export const FINANCE_AR_OVERDUE_PRINT_FOOTER_NOTE =
  "Valores sujeitos à atualização conforme novas baixas, recebimentos ou sincronizações com o Nomus. " +
  FINANCE_AR_OVERDUE_FISCAL_BACKING_NOTE;
export const FINANCE_AR_OVERDUE_PRINT_TOP_CUSTOMERS = 10;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatIsoDateBr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatArOverduePrintPeriod(globalFilters: FinanceArUiFilters): string {
  if (globalFilters.dueDateFrom.trim() && globalFilters.dueDateTo.trim()) {
    return `${formatIsoDateBr(globalFilters.dueDateFrom)} a ${formatIsoDateBr(globalFilters.dueDateTo)}`;
  }
  const year = globalFilters.year.trim();
  const month = globalFilters.month.trim();
  if (year && month) {
    const y = Number(year);
    const m = Number(month);
    if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
      const lastDay = new Date(y, m, 0).getDate();
      return `01/${pad2(m)}/${year} a ${lastDay}/${pad2(m)}/${year}`;
    }
  }
  if (year) {
    return `01/01/${year} a 31/12/${year}`;
  }
  return "Sem restrição de período de vencimento";
}

export function formatArOverduePrintScope(globalFilters: FinanceArUiFilters): string {
  const parts: string[] = ["Clientes externos"];
  if (globalFilters.invoiceIssued === "yes") {
    parts.push("Com NF");
  } else if (globalFilters.invoiceIssued === "no") {
    parts.push("Sem NF / pré-faturamento");
  } else {
    parts.push("Com NF e Sem NF");
  }
  if (globalFilters.companyName.trim()) {
    parts.push(`Empresa: ${globalFilters.companyName.trim()}`);
  } else {
    parts.push("Todas as empresas");
  }
  return parts.join(" · ");
}

export function buildArOverduePrintFilterLines(
  globalFilters: FinanceArUiFilters,
  overdueFilters: FinanceArOverdueUiFilters
): string[] {
  const lines: string[] = [];
  if (globalFilters.personName.trim()) lines.push(`Cliente: ${globalFilters.personName.trim()}`);
  if (globalFilters.personCnpj.trim()) lines.push(`CNPJ/CPF: ${globalFilters.personCnpj.trim()}`);
  if (globalFilters.paymentMethodName.trim()) {
    lines.push(`Forma de pagamento: ${globalFilters.paymentMethodName.trim()}`);
  }
  if (globalFilters.bankAccountName.trim()) {
    lines.push(`Conta bancária: ${globalFilters.bankAccountName.trim()}`);
  }
  if (overdueFilters.agingBucket.trim()) {
    const label = FINANCE_AR_OVERDUE_AGING_BUCKETS.find((b) => b.key === overdueFilters.agingBucket)
      ?.label;
    if (label) lines.push(`Faixa de aging: ${label}`);
  }
  if (overdueFilters.minDaysOverdue.trim()) {
    lines.push(`Atraso mínimo: ${overdueFilters.minDaysOverdue.trim()} dias`);
  }
  if (overdueFilters.minOpenBalance.trim()) {
    lines.push(`Saldo mínimo: R$ ${overdueFilters.minOpenBalance.trim()}`);
  }
  if (overdueFilters.minOverdueTitlesPerCustomer.trim()) {
    lines.push(
      `Mín. títulos por cliente: ${overdueFilters.minOverdueTitlesPerCustomer.trim()}`
    );
  }
  return lines;
}

export type FinanceArOverdueCustomerPrintGroup = {
  customerKey: string;
  customerName: string;
  customerDocument?: string;
  titles: FinanceArOverdueTitleRow[];
  totalOverdue: number;
  titlesCount: number;
  maxDaysOverdue: number;
};

export function groupArOverdueTitlesByCustomer(
  titles: FinanceArOverdueTitleRow[]
): FinanceArOverdueCustomerPrintGroup[] {
  const acc = new Map<string, FinanceArOverdueCustomerPrintGroup>();

  for (const row of titles) {
    const customerKey = `${row.customerDocument ?? ""}|${row.customerName}`;
    const existing = acc.get(customerKey);
    if (existing) {
      existing.titles.push(row);
      existing.totalOverdue += row.balanceReceivable;
      existing.titlesCount += 1;
      if (row.daysOverdue > existing.maxDaysOverdue) existing.maxDaysOverdue = row.daysOverdue;
    } else {
      acc.set(customerKey, {
        customerKey,
        customerName: row.customerName,
        customerDocument: row.customerDocument,
        titles: [row],
        totalOverdue: row.balanceReceivable,
        titlesCount: 1,
        maxDaysOverdue: row.daysOverdue,
      });
    }
  }

  for (const group of acc.values()) {
    group.titles.sort((a, b) => {
      const byBalance = b.balanceReceivable - a.balanceReceivable;
      if (byBalance !== 0) return byBalance;
      const byDays = b.daysOverdue - a.daysOverdue;
      if (byDays !== 0) return byDays;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });
  }

  return [...acc.values()].sort((a, b) => {
    const byAmount = b.totalOverdue - a.totalOverdue;
    if (byAmount !== 0) return byAmount;
    const byDays = b.maxDaysOverdue - a.maxDaysOverdue;
    if (byDays !== 0) return byDays;
    return a.customerName.localeCompare(b.customerName, "pt-BR");
  });
}

export function truncateArOverduePrintText(value: string | undefined, maxLength: number): string {
  const text = value?.trim();
  if (!text) return "—";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}
