/**
 * CRM > Relatórios — formatação de apresentação (pt-BR) da UI.
 *
 * Só formata números e datas que o backend já calculou. Nenhuma conta de
 * data, janela ou recompra acontece aqui (o dia de referência também vem do
 * backend, em `windows.today`).
 */

import type { CrmReportsCustomerOption } from "@/src/lib/commercial/crmReportsTypes.js";

const MONEY = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const INTEGER = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const DECIMAL = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });

const DASH = "—";

export function formatCrmReportsMoney(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? DASH : MONEY.format(value);
}

export function formatCrmReportsInteger(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? DASH : INTEGER.format(value);
}

/** "1 dia" / "12 dias". */
export function formatCrmReportsDays(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return value === 1 ? "1 dia" : `${INTEGER.format(value)} dias`;
}

/** Média do motor (2 casas no contrato) → "30,5 dias". */
export function formatCrmReportsAverageDays(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return `${DECIMAL.format(value)} dias`;
}

/** Dia civil `YYYY-MM-DD` → `dd/mm/aaaa` (sem fuso: é texto). */
export function formatCrmReportsDate(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return DASH;
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
}

/** Instante ISO → `dd/mm/aaaa HH:mm` no fuso do navegador. */
export function formatCrmReportsDateTime(value: string | null | undefined): string {
  if (!value) return DASH;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return DASH;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Instante ISO → só a data (`dd/mm/aaaa`), no fuso do navegador. */
export function formatCrmReportsDateOfInstant(value: string | null | undefined): string {
  const full = formatCrmReportsDateTime(value);
  return full === DASH ? DASH : full.slice(0, 10);
}

/** Linha secundária de um cliente: "CNPJ · Cidade/UF". */
export function formatCrmReportsCustomerSublabel(
  customer: Pick<CrmReportsCustomerOption, "taxId" | "city" | "state">
): string {
  const place = [customer.city?.trim(), customer.state?.trim()].filter(Boolean).join("/");
  return [customer.taxId?.trim(), place].filter(Boolean).join(" · ");
}
