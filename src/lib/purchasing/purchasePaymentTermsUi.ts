/**
 * Compras › Performance › Condições de compra — helpers de tela (puros, browser-safe).
 * Só formatação e período; nenhum cálculo de PMP aqui (vem pronto do servidor).
 */
import type { PaymentTermsPeriod } from "./purchasePaymentTermsAnalysis.js";

export const PAYMENT_TERMS_VIEW_ID = "payment-terms";

export const PAYMENT_TERMS_PERIOD_PRESETS = [
  { id: "currentMonth", label: "Mês corrente" },
  { id: "last30", label: "Últimos 30 dias" },
  { id: "last90", label: "Últimos 90 dias" },
  { id: "currentYear", label: "Ano corrente" },
  { id: "custom", label: "Personalizado" },
] as const;

export type PaymentTermsPeriodPresetId = (typeof PAYMENT_TERMS_PERIOD_PRESETS)[number]["id"];

const pad = (n: number) => String(n).padStart(2, "0");
const civil = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Período por emissão do pedido; padrão = mês corrente até hoje. */
export function paymentTermsPeriodFromPreset(
  preset: Exclude<PaymentTermsPeriodPresetId, "custom">,
  today: Date = new Date(),
): PaymentTermsPeriod {
  const to = civil(today);
  if (preset === "currentMonth") return { from: `${to.slice(0, 7)}-01`, to };
  if (preset === "currentYear") return { from: `${to.slice(0, 4)}-01-01`, to };
  const days = preset === "last30" ? 30 : 90;
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  return { from: civil(from), to };
}

export function formatPaymentTermsDays(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const n = Math.round(value);
  return `${n.toLocaleString("pt-BR")} ${Math.abs(n) === 1 ? "dia" : "dias"}`;
}

/** Gap com sinal explícito: "−32 dias", "+5 dias", "0 dia". */
export function formatPaymentTermsGap(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0 dia";
  return `${value > 0 ? "+" : "−"}${formatPaymentTermsDays(Math.abs(value))}`;
}

export function formatPaymentTermsPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/** Moeda BRL; totais gerenciais sem centavos, valores de pedido/parcela com centavos. */
export function formatPaymentTermsMoney(value: number | null | undefined, cents = false): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}

export function formatPaymentTermsMonth(key: string): string {
  const [y, m] = key.split("-");
  const names = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${names[Number(m) - 1] ?? m}/${y}`;
}

export function formatPaymentTermsDate(key: string | null): string {
  if (!key) return "—";
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

/** Variação do PMP vs. período anterior (dias inteiros). */
export function paymentTermsDelta(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null;
  return Math.round(current) - Math.round(previous);
}
