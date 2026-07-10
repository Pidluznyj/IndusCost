import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, History, Loader2, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import {
  normalizeTransformationHhHmSimulationListPayload,
  TRANSFORMATION_HH_HM_SIMULATION_HISTORY_API,
  TRANSFORMATION_HH_HM_SIMULATION_TYPE_LABELS,
  type TransformationHhHmCostSimulationType,
  type TransformationHhHmSimulationListItem,
} from "@/src/lib/transformationHhHmSimulationHistory";
import { formatCurrency, cn } from "@/src/lib/utils";

type Props = {
  refreshKey?: number;
};

function formatDateTime(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR");
}

export function TransformationHhHmSavedSimulationsSection({ refreshKey = 0 }: Props) {
  const [items, setItems] = useState<TransformationHhHmSimulationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"ALL" | TransformationHhHmCostSimulationType>("ALL");
  const [detail, setDetail] = useState<TransformationHhHmSimulationListItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: "100" });
      if (typeFilter !== "ALL") qs.set("type", typeFilter);
      const payload = await fetchJsonOk(
        `${TRANSFORMATION_HH_HM_SIMULATION_HISTORY_API}?${qs.toString()}`
      );
      const normalized = normalizeTransformationHhHmSimulationListPayload(payload);
      setItems(normalized.items);
      setError(null);
    } catch (err) {
      console.error("TransformationHhHmSavedSimulations: falha ao listar", err);
      setItems([]);
      setError("Não foi possível carregar as simulações salvas.");
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const visibleItems = useMemo(() => items, [items]);

  return (
    <section
      className="rounded-xl border border-slate-300 bg-white p-6 shadow-sm"
      data-testid="transformation-hh-hm-saved-simulations"
    >
      <div className="mb-5 flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
            <History className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 space-y-1">
            <h2 className="text-lg font-bold text-slate-900">Simulações salvas</h2>
            <p className="text-sm leading-relaxed text-slate-600">
              Histórico de simulações HH/HM salvas. Estes registros não alteram custos oficiais.
            </p>
          </div>
        </div>
        <div className="shrink-0">
          <label className="sr-only" htmlFor="hh-hm-sim-type-filter">
            Filtrar por tipo
          </label>
          <select
            id="hh-hm-sim-type-filter"
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value as "ALL" | TransformationHhHmCostSimulationType)
            }
            className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm"
          >
            <option value="ALL">Todos</option>
            <option value="CUSTO_MANUAL">{TRANSFORMATION_HH_HM_SIMULATION_TYPE_LABELS.CUSTO_MANUAL}</option>
            <option value="CUSTO_CC">{TRANSFORMATION_HH_HM_SIMULATION_TYPE_LABELS.CUSTO_CC}</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando histórico...
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {error}
        </div>
      ) : null}

      {!loading && !error && visibleItems.length === 0 ? (
        <p className="text-sm text-slate-600" data-testid="transformation-hh-hm-saved-empty">
          Nenhuma simulação salva ainda.
        </p>
      ) : null}

      {!loading && visibleItems.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2 font-semibold">Data/hora</th>
                <th className="px-2 py-2 font-semibold">Tipo</th>
                <th className="px-2 py-2 font-semibold">Observação</th>
                <th className="px-2 py-2 font-semibold text-right">Taxa HH</th>
                <th className="px-2 py-2 font-semibold text-right">Taxa HM</th>
                <th className="px-2 py-2 font-semibold text-right">HH + HM</th>
                <th className="px-2 py-2 font-semibold">Período</th>
                <th className="px-2 py-2 font-semibold">Criado por</th>
                <th className="px-2 py-2 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 align-top">
                  <td className="px-2 py-2 whitespace-nowrap text-slate-800">
                    {formatDateTime(row.createdAt)}
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
                        row.type === "CUSTO_CC"
                          ? "bg-emerald-50 text-emerald-800"
                          : "bg-slate-100 text-slate-800"
                      )}
                    >
                      {row.typeLabel}
                    </span>
                  </td>
                  <td className="px-2 py-2 max-w-[180px] truncate text-slate-700">
                    {row.observation || "—"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums font-medium text-slate-900">
                    {row.hhEffectiveRate != null ? formatCurrency(row.hhEffectiveRate) : "—"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums font-medium text-slate-900">
                    {row.hmEffectiveRate != null ? formatCurrency(row.hmEffectiveRate) : "—"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums font-bold text-slate-900">
                    {row.finalHhHmRate != null ? formatCurrency(row.finalHhHmRate) : "—"}
                  </td>
                  <td className="px-2 py-2 max-w-[140px] truncate text-slate-700">
                    {row.periodLabel || "—"}
                  </td>
                  <td className="px-2 py-2 text-slate-700">{row.createdByName || "—"}</td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      className="inline-flex min-h-9 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                      onClick={() => setDetail(row)}
                      aria-label={`Ver detalhes da simulação de ${formatDateTime(row.createdAt)}`}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Ver detalhes
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Detalhes da simulação salva"
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Detalhes da simulação</h3>
                <p className="mt-1 text-xs text-slate-600">
                  Simulação histórica, não altera custo oficial.
                </p>
              </div>
              <button
                type="button"
                aria-label="Fechar detalhes"
                className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
                onClick={() => setDetail(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <dl className="mb-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Tipo</dt>
                <dd className="font-medium text-slate-900">{detail.typeLabel}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Data</dt>
                <dd className="font-medium text-slate-900">{formatDateTime(detail.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Taxa HH</dt>
                <dd className="font-medium tabular-nums text-slate-900">
                  {detail.hhEffectiveRate != null ? formatCurrency(detail.hhEffectiveRate) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Taxa HM</dt>
                <dd className="font-medium tabular-nums text-slate-900">
                  {detail.hmEffectiveRate != null ? formatCurrency(detail.hmEffectiveRate) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">HH + HM</dt>
                <dd className="font-bold tabular-nums text-slate-900">
                  {detail.finalHhHmRate != null ? formatCurrency(detail.finalHhHmRate) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Período</dt>
                <dd className="font-medium text-slate-900">{detail.periodLabel || "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Observação</dt>
                <dd className="font-medium text-slate-900">{detail.observation || "—"}</dd>
              </div>
            </dl>
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Entradas (snapshot)
                </p>
                <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-800">
                  {JSON.stringify(detail.inputSnapshot, null, 2)}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Resultados (snapshot)
                </p>
                <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-800">
                  {JSON.stringify(detail.resultSnapshot, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
