import React, { useCallback, useEffect, useState } from "react";
import { Eye, History, Loader2, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { useAdminStepUp } from "@/src/components/settings/useAdminStepUp";
import { formatCurrency, cn } from "@/src/lib/utils";
import {
  APPLY_HH_HM_SIMULATION_API,
  type OfficialHhHmRatesSnapshot,
} from "@/src/lib/settingsApplyHhHmSimulation";
import {
  normalizeTransformationHhHmSimulationListPayload,
  TRANSFORMATION_HH_HM_SIMULATION_HISTORY_API,
  TRANSFORMATION_HH_HM_SIMULATION_TYPE_LABELS,
  type TransformationHhHmSimulationListItem,
} from "@/src/lib/transformationHhHmSimulationHistory";

type Props = {
  canApply: boolean;
  currentOfficial: {
    hhOverride: number | null;
    energyCost: number;
    workingHours: number;
  };
  onApplied: () => void;
};

function formatDateTime(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR");
}

function formatRate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatCurrency(value)}/h`;
}

function currentOfficialSnapshot(input: Props["currentOfficial"]): OfficialHhHmRatesSnapshot {
  const hh = input.hhOverride != null && input.hhOverride > 0 ? input.hhOverride : null;
  const hm =
    input.workingHours > 0 && Number.isFinite(input.energyCost)
      ? input.energyCost / input.workingHours
      : null;
  return {
    hhDefault: hh,
    hmDefault: hm,
    injectionHourlyCostDefault:
      hh != null || hm != null ? (hh ?? 0) + (hm ?? 0) : null,
    energyCost: input.energyCost,
    workingHours: input.workingHours,
    hhOverride: input.hhOverride,
  };
}

export function SettingsApplyHhHmSimulationSection({
  canApply,
  currentOfficial,
  onApplied,
}: Props) {
  const [items, setItems] = useState<TransformationHhHmSimulationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<TransformationHhHmSimulationListItem | null>(null);
  const [pendingApply, setPendingApply] =
    useState<TransformationHhHmSimulationListItem | null>(null);
  const [applying, setApplying] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const stepUp = useAdminStepUp();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await fetchJsonOk(
        `${TRANSFORMATION_HH_HM_SIMULATION_HISTORY_API}?limit=50`
      );
      const normalized = normalizeTransformationHhHmSimulationListPayload(payload);
      setItems(normalized.items);
      setError(null);
    } catch (err) {
      console.error("SettingsApplyHhHmSimulation: falha ao listar", err);
      setItems([]);
      setError("Não foi possível carregar as simulações HH/HM salvas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const beforeSnapshot = currentOfficialSnapshot(currentOfficial);

  const confirmApply = async () => {
    if (!pendingApply) return;
    setApplying(true);
    setFeedback(null);
    try {
      await stepUp.run(async () => {
        const result = await fetchJsonOk<{ message?: string }>(APPLY_HH_HM_SIMULATION_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ simulationId: pendingApply.id, confirm: true }),
        });
        setFeedback(result.message ?? "Aplicado com sucesso.");
        setPendingApply(null);
        onApplied();
        void load();
      });
    } catch (err) {
      console.error("SettingsApplyHhHmSimulation: falha ao aplicar", err);
      alert(
        err instanceof Error
          ? err.message
          : "Não foi possível aplicar a simulação aos parâmetros oficiais."
      );
    } finally {
      setApplying(false);
    }
  };

  return (
    <section
      className="mt-8 rounded-2xl border border-border bg-background/60 p-5"
      data-testid="settings-apply-hh-hm-simulation"
    >
      {stepUp.dialog}
      {stepUp.notice ? (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {stepUp.notice}
        </div>
      ) : null}
      <div className="mb-4 flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
          <History className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 space-y-1">
          <h4 className="text-base font-bold text-foreground">
            Aplicar simulação HH/HM salva
          </h4>
          <p className="text-sm text-muted-foreground">
            Sugestões do Simulador de Custo de Injeção. Só alteram os parâmetros oficiais quando
            você aplicar explicitamente. O motor de custo continua usando os mesmos GLOBAL_PARAM.
          </p>
        </div>
      </div>

      {feedback ? (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {feedback}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando simulações...
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {error}
        </div>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma simulação HH/HM salva ainda.</p>
      ) : null}

      {!loading && items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-2 font-semibold">Data/hora</th>
                <th className="px-2 py-2 font-semibold">Tipo</th>
                <th className="px-2 py-2 font-semibold">Observação</th>
                <th className="px-2 py-2 font-semibold text-right">HH</th>
                <th className="px-2 py-2 font-semibold text-right">HM</th>
                <th className="px-2 py-2 font-semibold text-right">HH+HM</th>
                <th className="px-2 py-2 font-semibold">Criado por</th>
                <th className="px-2 py-2 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-b border-border/70 align-top">
                  <td className="px-2 py-2 whitespace-nowrap">{formatDateTime(row.createdAt)}</td>
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
                  <td className="px-2 py-2 max-w-[160px] truncate">{row.observation || "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatRate(row.hhEffectiveRate)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatRate(row.hmEffectiveRate)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums font-semibold">
                    {formatRate(row.finalHhHmRate)}
                  </td>
                  <td className="px-2 py-2">{row.createdByName || "—"}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-xs font-semibold hover:bg-accent"
                        onClick={() => setDetail(row)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Ver detalhes
                      </button>
                      {canApply ? (
                        <button
                          type="button"
                          className="inline-flex min-h-9 items-center rounded-md bg-slate-900 px-2.5 text-xs font-semibold text-white hover:bg-slate-800"
                          onClick={() => {
                            setFeedback(null);
                            setPendingApply(row);
                          }}
                          data-testid={`apply-hh-hm-simulation-${row.id}`}
                        >
                          Aplicar aos parâmetros oficiais
                        </button>
                      ) : null}
                    </div>
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
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h5 className="text-base font-bold">Detalhes da simulação</h5>
                <p className="mt-1 text-xs text-muted-foreground">
                  Histórico — não altera custo oficial até ser aplicada.
                </p>
              </div>
              <button
                type="button"
                aria-label="Fechar"
                className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md hover:bg-accent"
                onClick={() => setDetail(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <dl className="mb-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Tipo</dt>
                <dd className="font-medium">
                  {TRANSFORMATION_HH_HM_SIMULATION_TYPE_LABELS[detail.type]}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Data</dt>
                <dd className="font-medium">{formatDateTime(detail.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Taxa HH</dt>
                <dd className="font-medium tabular-nums">{formatRate(detail.hhEffectiveRate)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Taxa HM</dt>
                <dd className="font-medium tabular-nums">{formatRate(detail.hmEffectiveRate)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">HH + HM</dt>
                <dd className="font-bold tabular-nums">{formatRate(detail.finalHhHmRate)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Período</dt>
                <dd className="font-medium">{detail.periodLabel || "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Observação</dt>
                <dd className="font-medium">{detail.observation || "—"}</dd>
              </div>
            </dl>
            <pre className="overflow-x-auto rounded-lg bg-muted/40 p-3 text-xs">
              {JSON.stringify(
                { inputSnapshot: detail.inputSnapshot, resultSnapshot: detail.resultSnapshot },
                null,
                2
              )}
            </pre>
          </div>
        </div>
      ) : null}

      {pendingApply ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl"
            data-testid="apply-hh-hm-simulation-confirm"
          >
            <h5 className="text-base font-bold">Aplicar aos parâmetros oficiais?</h5>
            <p className="mt-2 text-sm text-muted-foreground">
              Deseja aplicar esta simulação aos parâmetros oficiais de HH/HM? Isso atualizará os
              valores usados no custo oficial do Processo Padrão. O motor de custo continuará usando
              os mesmos parâmetros oficiais.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-lg border border-border p-3">
                <p className="mb-2 text-xs font-bold uppercase text-muted-foreground">Atual</p>
                <p>HH: {formatRate(beforeSnapshot.hhDefault)}</p>
                <p>HM: {formatRate(beforeSnapshot.hmDefault)}</p>
                <p className="font-semibold">
                  Injeção: {formatRate(beforeSnapshot.injectionHourlyCostDefault)}
                </p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                <p className="mb-2 text-xs font-bold uppercase text-emerald-900">Simulação</p>
                <p>HH: {formatRate(pendingApply.hhEffectiveRate)}</p>
                <p>HM: {formatRate(pendingApply.hmEffectiveRate)}</p>
                <p className="font-semibold">
                  HH+HM: {formatRate(pendingApply.finalHhHmRate)}
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              HH → HH_VALUE_OVERRIDE. HM → ENERGY_COST = HM × WORKING_HOURS (horas preservadas).
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="inline-flex min-h-10 items-center rounded-lg border border-border px-4 text-sm font-semibold hover:bg-accent"
                onClick={() => setPendingApply(null)}
                disabled={applying}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                onClick={() => void confirmApply()}
                disabled={applying}
                data-testid="apply-hh-hm-simulation-confirm-button"
              >
                {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Confirmar aplicação
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
