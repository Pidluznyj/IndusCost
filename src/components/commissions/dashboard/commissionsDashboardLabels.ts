/** Rótulos legíveis para status e severidade de comissões. */

export const COMMISSION_STATUS_LABELS: Record<string, string> = {
  FORECAST_FROM_ORDER: "Previsão (pedido)",
  WAITING_NFE: "Aguardando NF-e",
  SUPERSEDED_BY_OUTPUT_DOCUMENT: "Substituída por doc. saída",
  CONFIRMED_BY_OUTPUT_DOCUMENT: "Confirmada",
  WAITING_RECEIVABLE: "Aguardando recebimento",
  WAITING_PAYMENT: "Aguardando pagamento",
  PARTIALLY_RELEASED: "Parcialmente liberada",
  RELEASED: "Liberada",
  PAID_PARTIAL: "Paga parcial",
  PAID_TOTAL: "Paga total",
  CANCELLED: "Cancelada",
  REVERSED: "Estornada",
  ERROR: "Erro",
};

export function formatCommissionStatus(status: string): string {
  return COMMISSION_STATUS_LABELS[status] ?? status;
}

export function formatMonthYearLabel(year: number, month: number): string {
  return `${String(month).padStart(2, "0")}/${year}`;
}

export type PendingDueBucket = {
  key: string;
  label: string;
  amount: number;
};

export function buildPendingByDueDateBuckets(
  items: Array<{ dueDate: string | null; balanceToRelease: number }>
): PendingDueBucket[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const buckets: Record<string, PendingDueBucket> = {
    overdue: { key: "overdue", label: "Vencidas", amount: 0 },
    d0_30: { key: "d0_30", label: "0–30 dias", amount: 0 },
    d31_60: { key: "d31_60", label: "31–60 dias", amount: 0 },
    d61_90: { key: "d61_90", label: "61–90 dias", amount: 0 },
    d91_plus: { key: "d91_plus", label: "91+ dias", amount: 0 },
    no_date: { key: "no_date", label: "Sem vencimento", amount: 0 },
  };

  for (const item of items) {
    const amount = item.balanceToRelease;
    if (amount <= 0) continue;
    if (!item.dueDate) {
      buckets.no_date.amount += amount;
      continue;
    }
    const due = new Date(item.dueDate);
    due.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) buckets.overdue.amount += amount;
    else if (diffDays <= 30) buckets.d0_30.amount += amount;
    else if (diffDays <= 60) buckets.d31_60.amount += amount;
    else if (diffDays <= 90) buckets.d61_90.amount += amount;
    else buckets.d91_plus.amount += amount;
  }

  return Object.values(buckets).filter((b) => b.amount > 0);
}

export function filterUpcomingReleases<
  T extends {
    dueDate: string | null;
    balanceToRelease: number;
  }
>(items: T[], limit = 10): T[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return items
    .filter((item) => item.balanceToRelease > 0)
    .filter((item) => {
      if (!item.dueDate) return true;
      const due = new Date(item.dueDate);
      due.setHours(0, 0, 0, 0);
      return due.getTime() >= today.getTime();
    })
    .sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    })
    .slice(0, limit);
}
