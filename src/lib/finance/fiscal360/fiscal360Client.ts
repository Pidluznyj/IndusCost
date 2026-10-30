/**
 * Inteligência Fiscal 360° — cliente (permissões, períodos, chamadas de API). Client-safe.
 */
import { fetchJsonOk } from "@/src/lib/http";
import type { Fiscal360Basis } from "./fiscal360Types";

export const FISCAL360_PERMISSIONS = {
  view: "finance.fiscal360.view",
  export: "finance.fiscal360.export",
  reconcile: "finance.fiscal360.reconcile",
  reclassify: "finance.fiscal360.reclassify",
  assumptions: "finance.fiscal360.assumptions",
  reprocess: "finance.fiscal360.reprocess",
  jobs: "finance.fiscal360.jobs",
} as const;

export type Fiscal360Capability = keyof typeof FISCAL360_PERMISSIONS;

export type Fiscal360Capabilities = Record<Fiscal360Capability, boolean>;

export function resolveFiscal360Capabilities(auth: { hasPermission: (key: string) => boolean }): Fiscal360Capabilities {
  const can = (k: Fiscal360Capability) => auth.hasPermission(FISCAL360_PERMISSIONS[k]);
  const view = can("view");
  // Toda capacidade de escrita/exportação pressupõe visualizar (fail-closed).
  return {
    view,
    export: view && can("export"),
    reconcile: view && can("reconcile"),
    reclassify: view && can("reclassify"),
    assumptions: view && can("assumptions"),
    reprocess: view && can("reprocess"),
    jobs: view && can("jobs"),
  };
}

export type Fiscal360PeriodPreset = "ytd" | "month" | "quarter" | "year" | "last12" | "custom";

export const FISCAL360_PERIOD_LABELS: Record<Fiscal360PeriodPreset, string> = {
  ytd: "Ano até a data (YTD)",
  month: "Mês atual",
  quarter: "Trimestre atual",
  year: "Ano inteiro",
  last12: "Últimos 12 meses",
  custom: "Personalizado",
};

export function resolveFiscal360Period(preset: Fiscal360PeriodPreset, now = new Date(), custom?: { from: string; to: string }): { fromMonth: string; toMonth: string } {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  const current = `${y}-${pad(m)}`;
  if (preset === "month") return { fromMonth: current, toMonth: current };
  if (preset === "quarter") {
    const q = Math.floor((m - 1) / 3) * 3 + 1;
    return { fromMonth: `${y}-${pad(q)}`, toMonth: `${y}-${pad(q + 2)}` };
  }
  if (preset === "year") return { fromMonth: `${y}-01`, toMonth: `${y}-12` };
  if (preset === "last12") {
    const d = new Date(y, m - 12, 1);
    return { fromMonth: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, toMonth: current };
  }
  if (preset === "custom" && custom && custom.from && custom.to) return { fromMonth: custom.from, toMonth: custom.to };
  return { fromMonth: `${y}-01`, toMonth: current };
}

export type Fiscal360UiFilters = {
  company: string;
  fromMonth: string;
  toMonth: string;
  basis: Fiscal360Basis;
  taxType: string;
};

export function buildFiscal360Query(f: Fiscal360UiFilters, extra: Record<string, string | number | null | undefined> = {}): string {
  const params = new URLSearchParams();
  params.set("company", f.company || "group");
  params.set("fromMonth", f.fromMonth);
  params.set("toMonth", f.toMonth);
  params.set("basis", f.basis);
  if (f.taxType) params.set("taxType", f.taxType);
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== "") params.set(k, String(v));
  return params.toString();
}

/** Aceita "1.234,56", "1234,56" e "1234.56"; o que não for número segue como está e o servidor recusa. */
export function normalizeFiscal360Amount(text: string): string {
  const value = text.trim();
  if (value.includes(",")) return value.replace(/\./g, "").replace(",", ".");
  return /^\d{1,3}(\.\d{3})+$/.test(value) ? value.replace(/\./g, "") : value;
}

export async function fetchFiscal360<T>(path: string, query: string, signal?: AbortSignal): Promise<T> {
  const res = await fetchJsonOk<{ ok: boolean; data: T }>(`/api/finance/fiscal-360/${path}${query ? `?${query}` : ""}`, { signal });
  return res.data;
}

export async function postFiscal360<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchJsonOk<{ ok: boolean; data: T }>(`/api/finance/fiscal-360/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return res.data;
}

export function fiscal360ExportUrl(dataset: string, format: "xlsx" | "csv", f: Fiscal360UiFilters): string {
  return `/api/finance/fiscal-360/export?${buildFiscal360Query(f, { dataset, format })}`;
}

export function formatFiscal360Month(month: string | null | undefined): string {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return "—";
  const [y, m] = month.split("-");
  return `${m}/${y}`;
}

export function formatFiscal360Date(date: string | null | undefined): string {
  if (!date) return "—";
  const d = date.slice(0, 10).split("-");
  return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : date;
}

export function formatFiscal360DateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
