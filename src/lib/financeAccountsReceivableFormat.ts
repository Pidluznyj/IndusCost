/** Formatadores da UI Financeiro > Contas a Receber (sem NaN/null na tela). */

export function safeFinanceNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function formatFinanceCurrency(value: unknown): string {
  const n = safeFinanceNumber(value, 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Valores grandes: R$ 1,25 Mi / R$ 350,00 mil */
export function formatFinanceCurrencyCompact(value: unknown): string {
  const n = safeFinanceNumber(value, 0);
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const scaled = n / 1_000_000;
    return `R$ ${scaled.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Mi`;
  }
  if (abs >= 100_000) {
    const scaled = n / 1_000;
    return `R$ ${scaled.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mil`;
  }
  return formatFinanceCurrency(n);
}

export function formatFinancePercent(value: unknown): string {
  const n = safeFinanceNumber(value, 0);
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function formatFinanceInteger(value: unknown): string {
  const n = safeFinanceNumber(value, 0);
  return Math.trunc(n).toLocaleString("pt-BR");
}

export function formatFinanceDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

export function formatFinanceDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}

const STATUS_LABELS: Record<string, string> = {
  open: "Em aberto",
  overdue: "Atrasado",
  dueToday: "Vence hoje",
  upcoming: "A vencer",
  settled: "Baixado",
  suspended: "Cobrança suspensa",
  unknown: "Indefinido",
  all: "Todos",
};

export function formatFinanceCalculatedStatus(status: string | null | undefined): string {
  if (!status) return "—";
  return STATUS_LABELS[status] ?? status;
}

export function formatFinanceDaysOverdue(days: unknown): string {
  const n = safeFinanceNumber(days, 0);
  if (n <= 0) return "—";
  return formatFinanceInteger(n);
}

export function formatFinanceMonthLabel(year: number, month: number): string {
  const d = new Date(year, month - 1, 1);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
}

export function financeArExportFilename(referenceDate: Date = new Date()): string {
  const y = referenceDate.getFullYear();
  const m = String(referenceDate.getMonth() + 1).padStart(2, "0");
  const d = String(referenceDate.getDate()).padStart(2, "0");
  return `contas-a-receber-${y}-${m}-${d}.csv`;
}

export function displayFinanceText(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}
