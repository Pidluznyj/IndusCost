import { formatFinanceKpiCurrency } from "./financeKpiFormat.js";
import { formatCivilDate } from "./financeCivilDate.js";

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

/** Valores grandes compactos — padrão KPI executivo (R$ 827,5 mil / R$ 5,83 Mi). */
export function formatFinanceCurrencyCompact(value: unknown): string {
  return formatFinanceKpiCurrency(safeFinanceNumber(value, 0));
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
  return formatCivilDate(iso);
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

export function formatFinanceMonthLabel(year: unknown, month: unknown): string {
  const y = safeFinanceNumber(year, 0);
  const m = safeFinanceNumber(month, 0);
  if (y < 1 || m < 1 || m > 12) return "—";
  const d = new Date(y, m - 1, 1);
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

/** Lê `descricaoLancamento` do payload Nomus quando o campo materializado estiver vazio. */
export function readNomusLaunchDescriptionFromPayload(rawPayload: unknown): string | null {
  if (rawPayload == null || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }
  const value = (rawPayload as Record<string, unknown>).descricaoLancamento;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Descrição do lançamento para grids AP/AR (campo materializado → fallback Nomus → null). */
export function resolveFinanceLaunchDescription(input: {
  description?: string | null;
  rawPayload?: unknown;
}): string | null {
  const direct = input.description?.trim();
  if (direct) return direct;
  return readNomusLaunchDescriptionFromPayload(input.rawPayload);
}
