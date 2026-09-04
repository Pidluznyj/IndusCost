import React from "react";
import {
  CNPJ_PROVIDER_STATUS_LABEL,
  CNPJ_REGISTRY_COMPARE_LABEL,
  type CnpjEconomicContextView,
  type CnpjFieldProvenanceView,
  type CnpjSourceStatusView,
} from "@/src/lib/customerCnpjIntelligenceTypes";

function formatRefDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const day = iso.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const [y, m, d] = day.split("-");
    return `${d}/${m}/${y}`;
  }
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString("pt-BR");
}

function formatMonthYear(iso: string | null | undefined): string {
  if (!iso) return "—";
  const day = iso.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const [y, m] = day.split("-");
    return `${m}/${y}`;
  }
  return formatRefDate(iso);
}

function statusClass(status: string): string {
  if (status === "SUCCESS") return "bg-emerald-50 text-emerald-900 border-emerald-200";
  if (status === "UNAVAILABLE" || status === "ERROR" || status === "TIMEOUT") {
    return "bg-slate-100 text-slate-700 border-slate-200";
  }
  if (status === "RATE_LIMIT" || status === "NOT_FOUND" || status === "INVALID_PAYLOAD") {
    return "bg-amber-50 text-amber-900 border-amber-200";
  }
  return "bg-slate-50 text-slate-700 border-slate-200";
}

export function CnpjSourcesStatusPanel({
  sources,
}: {
  sources?: CnpjSourceStatusView[] | null;
}) {
  if (!sources?.length) return null;
  return (
    <section
      className="rounded-lg border border-slate-200 overflow-hidden"
      data-testid="cnpj-sources-status"
    >
      <div className="bg-slate-50 px-3 py-2 font-semibold text-sm">Fontes consultadas</div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b bg-white">
              <th className="px-3 py-2 text-left">Fonte</th>
              <th className="px-3 py-2 text-left">Situação</th>
              <th className="px-3 py-2 text-left">Atualizado</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((row) => (
              <tr key={`${row.source}-${row.role}`} className="border-b">
                <td className="px-3 py-2">
                  <span className="font-medium">{row.displayName}</span>
                  {row.role === "fallback" ? (
                    <span className="ml-1 text-slate-500">(fallback)</span>
                  ) : null}
                  {row.role === "economic" ? (
                    <span className="ml-1 text-slate-500">(macro)</span>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded border px-1.5 py-0.5 ${statusClass(row.status)}`}>
                    {CNPJ_PROVIDER_STATUS_LABEL[row.status] ?? row.status}
                  </span>
                  {row.message ? (
                    <p className="mt-1 text-slate-500">{row.message}</p>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {formatRefDate(row.fetchedAt)}
                  {row.fromCache ? " · cache" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CnpjSourceConflictsPanel({
  conflicts,
}: {
  conflicts?: CnpjFieldProvenanceView[] | null;
}) {
  if (!conflicts?.length) return null;
  return (
    <section
      className="rounded-lg border border-amber-200 bg-amber-50/40 overflow-hidden"
      data-testid="cnpj-source-conflicts"
    >
      <div className="px-3 py-2 font-semibold text-sm">Divergências cadastrais entre fontes</div>
      <p className="px-3 pb-2 text-xs text-slate-600">
        O valor consolidado segue a fonte principal quando ela responde. Nada é aplicado ao
        cadastro automaticamente.
      </p>
      <div className="overflow-x-auto bg-white">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b">
              <th className="px-3 py-2 text-left">Campo</th>
              <th className="px-3 py-2 text-left">Consolidado</th>
              <th className="px-3 py-2 text-left">Fontes</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((row) => (
              <tr key={row.field} className="border-b align-top">
                <td className="px-3 py-2 font-medium">{row.label}</td>
                <td className="px-3 py-2">{row.chosenValue ?? "—"}</td>
                <td className="px-3 py-2">
                  {row.values.map((value) => (
                    <p key={value.source}>
                      {value.source}: {value.value ?? "—"}
                    </p>
                  ))}
                </td>
                <td className="px-3 py-2">
                  {CNPJ_REGISTRY_COMPARE_LABEL[row.status] ?? row.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function EconomicContextPanel({
  economicContext,
}: {
  economicContext?: CnpjEconomicContextView | null;
}) {
  if (!economicContext) return null;
  const unavailable = economicContext.status === "unavailable";
  return (
    <section
      className="rounded-lg border border-slate-200 p-3 space-y-2"
      data-testid="cnpj-economic-context"
    >
      <div>
        <h3 className="font-semibold text-sm">Contexto econômico — Brasil</h3>
        <p className="text-xs text-slate-500 mt-1">{economicContext.disclaimer}</p>
      </div>
      {unavailable ? (
        <p className="text-sm text-slate-600">Contexto econômico temporariamente indisponível.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 text-sm">
          {economicContext.indicators.map((indicator) => (
            <div key={indicator.code} className="rounded border bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">{indicator.name}</p>
              <p className="font-semibold">
                {indicator.status === "ok" ? indicator.displayValue : "—"}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Referência:{" "}
                {indicator.code === "IPCA_12M"
                  ? formatMonthYear(indicator.referenceDate)
                  : formatRefDate(indicator.referenceDate)}
              </p>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-500">
        Fonte: {economicContext.sourceLabel}
        {economicContext.fromCache ? " · cache" : ""} · Atualização:{" "}
        {formatRefDate(economicContext.fetchedAt)}
      </p>
    </section>
  );
}
