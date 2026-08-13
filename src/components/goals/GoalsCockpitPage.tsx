/**
 * Metas (OKR) — Cockpit (MVP 1, docs/goal-engine-plan.md).
 *
 * Lista objetivos com roll-up ponderado (somente leitura — RN-001), KRs com
 * progresso individual, visão "Minhas Metas" (RN-005) e lançamento MANUAL de
 * valor realizado (RN-008 chega no MVP 3 com o motor). Todo cálculo vem do
 * backend — esta tela só desenha DTOs.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Target,
  Plus,
  Pencil,
  Trash2,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { renderInPortal } from "@/src/lib/renderInPortal.js";
import { fetchJsonOk } from "@/src/lib/http.js";
import { useAuth } from "@/src/contexts/AuthContext.js";
import { GoalWizardDialog } from "./GoalWizardDialog.js";
import { GoalKeyResultWizardDialog } from "./GoalKeyResultWizardDialog.js";
import type { GoalMetadataPublicEntity } from "./goalWizardShared.js";
import {
  GOAL_DOMAIN_LABELS,
  GOAL_DOMAINS,
  GOAL_STATUS_LABELS,
  GOAL_STATUSES,
  GOAL_TRACKING_TYPE_LABELS,
  GOAL_TRACKING_TYPES,
  type GoalDto,
  type GoalKeyResultDto,
  type GoalStatusValue,
} from "@/src/lib/goals/goalContracts.js";

type OwnerOption = { id: string; name: string };

const STATUS_BADGE: Record<GoalStatusValue, string> = {
  DRAFT: "border-[#CBD5E1] bg-[#F8FAFC] text-[#475569]",
  ACTIVE: "border-[#BFDBFE] bg-[#EFF6FF] text-[#1E40AF]",
  DONE: "border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]",
  ARCHIVED: "border-[#E5E7EB] bg-[#F9FAFB] text-[#6B7280]",
};

function progressTone(percent: number): string {
  if (percent >= 100) return "bg-[#059669]";
  if (percent >= 70) return "bg-[#2563EB]";
  if (percent >= 40) return "bg-[#D97706]";
  return "bg-[#DC2626]";
}

function ProgressBar({ percent, invalid }: { percent: number; invalid?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-full max-w-[240px] overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-2 rounded-full transition-all", progressTone(percent))}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      <span className="text-xs font-semibold tabular-nums">{percent}%</span>
      {invalid ? (
        <span
          className="rounded bg-[#FEF2F2] px-1 text-[10px] font-semibold text-[#991B1B]"
          title="Alvo igual à linha de base — meta sem intervalo de progresso"
        >
          meta inválida
        </span>
      ) : null}
    </div>
  );
}

function formatValue(value: string, unit: string | null): string {
  const n = Number(value);
  const formatted = Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
    : value;
  return unit ? `${formatted} ${unit}` : formatted;
}

function civilDateBr(value: string): string {
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
}

// ─── Dialog base ────────────────────────────────────────────────────────────

function DialogShell({
  title,
  children,
  onCancel,
  onSubmit,
  submitLabel,
  busy,
  error,
  canSubmit,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  canSubmit: boolean;
  testId: string;
}) {
  return renderInPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      data-testid={testId}
    >
      <div className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg">
        <h2 className="text-base font-semibold">{title}</h2>
        {children}
        {error ? (
          <p className="text-xs text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="text-xs text-muted-foreground" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
            disabled={!canSubmit || busy}
            onClick={onSubmit}
            data-testid={`${testId}-submit`}
          >
            {busy ? "Salvando…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const fieldClass =
  "w-full rounded border border-border bg-background px-2 py-1 text-xs";
const labelClass = "text-[11px] font-semibold text-muted-foreground";

// ─── Página ─────────────────────────────────────────────────────────────────

/** Visões rápidas do cockpit (Tela 1): Minhas × Minha Equipe × Empresa. */
type CockpitView = "MINE" | "TEAM" | "ALL";

export function GoalsCockpitPage() {
  const { authUser } = useAuth();
  const [goals, setGoals] = useState<GoalDto[]>([]);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [metadataEntities, setMetadataEntities] = useState<GoalMetadataPublicEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<CockpitView>("ALL");
  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [includeArchived, setIncludeArchived] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [expandedGoalIds, setExpandedGoalIds] = useState<ReadonlySet<string>>(new Set());

  // Dialog state (um por vez).
  const [goalDialog, setGoalDialog] = useState<{ mode: "create" } | { mode: "edit"; goal: GoalDto } | null>(null);
  // Criação de indicador usa o assistente conversacional (mesma experiência
  // do "+ Novo Objetivo", só que dentro de um Objetivo já existente — nunca
  // cria um Objetivo novo). Edição continua no formulário técnico simples.
  const [krWizardGoal, setKrWizardGoal] = useState<GoalDto | null>(null);
  const [krDialog, setKrDialog] = useState<
    { mode: "edit"; goal: GoalDto; keyResult: GoalKeyResultDto } | null
  >(null);
  const [valueDialog, setValueDialog] = useState<{ keyResult: GoalKeyResultDto } | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams();
        if (view === "MINE") qs.set("onlyMine", "true");
        if (includeArchived) qs.set("includeArchived", "true");
        qs.set("year", String(year));
        const res = await fetchJsonOk<{ goals: GoalDto[] }>(
          `/api/goals?${qs.toString()}`,
          { signal }
        );
        setGoals(res.goals);
      } catch (err) {
        if (signal?.aborted) return;
        setError(err instanceof Error ? err.message : "Falha ao carregar metas.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [view, includeArchived, year]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    fetchJsonOk<{ owners: OwnerOption[] }>("/api/goals/owner-options", {
      signal: controller.signal,
    })
      .then((res) => setOwners(res.owners))
      .catch(() => setOwners([]));
    fetchJsonOk<{ entities: GoalMetadataPublicEntity[] }>("/api/goals/metadata", {
      signal: controller.signal,
    })
      .then((res) => setMetadataEntities(res.entities))
      .catch(() => setMetadataEntities([]));
    return () => controller.abort();
  }, []);

  function toggleExpanded(goalId: string) {
    setExpandedGoalIds((prev) => {
      const next = new Set(prev);
      if (next.has(goalId)) next.delete(goalId);
      else next.add(goalId);
      return next;
    });
  }

  async function submitDialog(action: () => Promise<unknown>) {
    setDialogBusy(true);
    setDialogError(null);
    try {
      await action();
      setGoalDialog(null);
      setKrDialog(null);
      setValueDialog(null);
      await load();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setDialogBusy(false);
    }
  }

  async function handleDeleteGoal(goal: GoalDto) {
    const confirmed = window.confirm(
      `Excluir o objetivo "${goal.title}"? Com histórico ele será ARQUIVADO (auditável); sem histórico será removido.`
    );
    if (!confirmed) return;
    try {
      await fetchJsonOk(`/api/goals/${goal.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir.");
    }
  }

  async function handleDeleteKeyResult(kr: GoalKeyResultDto) {
    const confirmed = window.confirm(
      `Excluir o KR "${kr.title}"? Com histórico ele será ARQUIVADO (auditável).`
    );
    if (!confirmed) return;
    try {
      await fetchJsonOk(`/api/goals/key-results/${kr.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir.");
    }
  }

  // "Minha Equipe" = objetivos que EU lidero (meu time executa os KRs).
  const visibleGoals = useMemo(() => {
    if (view !== "TEAM" || !authUser) return goals;
    return goals.filter((g) => g.ownerAppUserId === authUser.id);
  }, [goals, view, authUser]);

  const yearOptions = useMemo(() => {
    const base = new Date().getFullYear();
    const out: number[] = [];
    for (let y = base - 2; y <= base + 2; y += 1) out.push(y);
    return out;
  }, []);

  return (
    <div data-testid="goals-cockpit">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" aria-hidden />
          <div>
            <h2 className="text-lg font-semibold">Metas (OKR)</h2>
            <p className="text-[12px] text-muted-foreground">
              Objetivos e Key Results com progresso calculado pelo sistema — o
              percentual é somente leitura, derivado dos KRs.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
          onClick={() => setWizardOpen(true)}
          data-testid="goals-new-goal"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Novo Objetivo
        </button>
      </div>

      {/* Filtros rápidos (Tela 1): três botões grandes + ano */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
        {(
          [
            ["MINE", "Minhas Metas"],
            ["TEAM", "Metas da Minha Equipe"],
            ["ALL", "Metas da Empresa"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={cn(
              "rounded-full border px-3 py-1.5 font-semibold",
              view === id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setView(id)}
            data-testid={id === "MINE" ? "goals-only-mine" : `goals-view-${id.toLowerCase()}`}
          >
            {label}
          </button>
        ))}
        <select
          className="ml-auto rounded-md border border-border bg-background px-2 py-1"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          data-testid="goals-year"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Mostrar arquivados
        </label>
        <span className="text-muted-foreground">{visibleGoals.length} objetivo(s)</span>
      </div>

      {error ? (
        <div className="mb-3 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
          Carregando metas…
        </p>
      ) : visibleGoals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-3 py-10 text-center">
          <p className="text-sm font-medium">Nenhum objetivo por aqui ainda.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Crie o primeiro Objetivo e desdobre em Key Results mensuráveis.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleGoals.map((goal) => {
            const expanded = expandedGoalIds.has(goal.id);
            return (
              <section
                key={goal.id}
                className="rounded-lg border border-border bg-card shadow-sm"
                data-testid={`goal-card-${goal.id}`}
              >
                <header className="flex flex-wrap items-start justify-between gap-2 p-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    {goal.ownerName ? (
                      <span
                        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary"
                        title={`Dono: ${goal.ownerName}`}
                      >
                        {goal.ownerName
                          .split(" ")
                          .slice(0, 2)
                          .map((p) => p[0])
                          .join("")
                          .toUpperCase()}
                      </span>
                    ) : null}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="truncate text-left text-sm font-semibold hover:underline"
                          onClick={() => toggleExpanded(goal.id)}
                          title={expanded ? "Recolher prévia dos indicadores" : "Prévia rápida dos indicadores"}
                        >
                          {goal.title}
                        </button>
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                            STATUS_BADGE[goal.status]
                          )}
                        >
                          {GOAL_STATUS_LABELS[goal.status]}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {civilDateBr(goal.startDate)} – {civilDateBr(goal.endDate)}
                        {goal.ownerName ? ` · Resp.: ${goal.ownerName}` : ""} ·{" "}
                        {goal.activeKeyResults} indicador(es) ativo(s)
                      </p>
                      <div className="mt-2">
                        <ProgressBar
                          percent={goal.progressPercent}
                          invalid={goal.invalidKeyResults > 0}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Único caminho de drill-down: Objetivo → indicadores →
                        tarefas. Botão sólido e em primeiro lugar para não se
                        confundir com as ações secundárias ao lado. */}
                    <Link
                      to={`/goals/${goal.id}`}
                      className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground hover:opacity-90"
                      data-testid={`goal-detail-link-${goal.id}`}
                      title="Abrir a meta: ver indicadores, evolução e tarefas"
                    >
                      Abrir meta <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
                      title="Adicionar um novo indicador (número) dentro deste objetivo"
                      onClick={() => {
                        setDialogError(null);
                        setKrWizardGoal(goal);
                      }}
                      data-testid={`goal-add-kr-${goal.id}`}
                    >
                      + Indicador
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-border p-1.5 hover:bg-muted"
                      title="Editar objetivo"
                      onClick={() => {
                        setDialogError(null);
                        setGoalDialog({ mode: "edit", goal });
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-[#FECACA] p-1.5 text-[#991B1B] hover:bg-[#FEF2F2]"
                      title="Excluir/arquivar objetivo"
                      onClick={() => void handleDeleteGoal(goal)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                </header>

                {expanded ? (
                  <div className="border-t border-border/60 px-3 pb-3">
                    <p className="py-2 text-[10px] text-muted-foreground">
                      Prévia rápida — clique em um indicador para abrir a evolução e as
                      tarefas dele.
                    </p>
                    {goal.keyResults.length === 0 ? (
                      <p className="py-3 text-xs text-muted-foreground">
                        Nenhum indicador ainda — clique em "+ Indicador" acima para
                        adicionar o primeiro número mensurável deste objetivo.
                      </p>
                    ) : (
                      <ul className="divide-y divide-border/60">
                        {goal.keyResults.map((kr) => (
                          <li
                            key={kr.id}
                            className={cn(
                              "flex flex-wrap items-center justify-between gap-2 py-2",
                              kr.status === "ARCHIVED" && "opacity-60"
                            )}
                            data-testid={`kr-row-${kr.id}`}
                          >
                            <Link
                              to={`/goals/${goal.id}?kr=${kr.id}`}
                              className="min-w-0 flex-1"
                              title="Abrir este indicador (evolução e tarefas)"
                              data-testid={`kr-drilldown-${kr.id}`}
                            >
                              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                {kr.trackingType === "INCREASE" ? (
                                  <TrendingUp className="h-3.5 w-3.5 text-[#059669]" aria-hidden />
                                ) : (
                                  <TrendingDown className="h-3.5 w-3.5 text-[#7C3AED]" aria-hidden />
                                )}
                                <span className="font-medium hover:underline">{kr.title}</span>
                                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  {GOAL_DOMAIN_LABELS[kr.domain]}
                                </span>
                                {kr.status === "ARCHIVED" ? (
                                  <span className="rounded-full border border-[#E5E7EB] bg-[#F9FAFB] px-1.5 text-[10px] text-[#6B7280]">
                                    Arquivado
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                {formatValue(kr.achievedValue, kr.unit)} de{" "}
                                {formatValue(kr.target, kr.unit)} (base{" "}
                                {formatValue(kr.baseline, kr.unit)}) · peso {kr.weight}
                                {kr.ownerName ? ` · Resp.: ${kr.ownerName}` : ""}
                              </p>
                              <div className="mt-1">
                                <ProgressBar
                                  percent={kr.progressPercent}
                                  invalid={kr.invalidTargets}
                                />
                              </div>
                            </Link>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                className="rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
                                disabled={kr.status === "ARCHIVED"}
                                onClick={() => {
                                  setDialogError(null);
                                  setValueDialog({ keyResult: kr });
                                }}
                                data-testid={`kr-set-value-${kr.id}`}
                              >
                                Lançar valor
                              </button>
                              <button
                                type="button"
                                className="rounded-md border border-border p-1.5 hover:bg-muted"
                                title="Editar indicador"
                                onClick={() => {
                                  setDialogError(null);
                                  setKrDialog({ mode: "edit", goal, keyResult: kr });
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="rounded-md border border-[#FECACA] p-1.5 text-[#991B1B] hover:bg-[#FEF2F2]"
                                title="Excluir/arquivar indicador"
                                onClick={() => void handleDeleteKeyResult(kr)}
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      {wizardOpen ? (
        <GoalWizardDialog
          owners={owners}
          metadataEntities={metadataEntities}
          onCancel={() => setWizardOpen(false)}
          onCreated={() => {
            setWizardOpen(false);
            void load();
          }}
        />
      ) : null}

      {goalDialog ? (
        <GoalFormDialog
          mode={goalDialog.mode}
          goal={goalDialog.mode === "edit" ? goalDialog.goal : null}
          owners={owners}
          busy={dialogBusy}
          error={dialogError}
          onCancel={() => setGoalDialog(null)}
          onSubmit={(payload) =>
            void submitDialog(() =>
              goalDialog.mode === "create"
                ? fetchJsonOk("/api/goals", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                  })
                : fetchJsonOk(`/api/goals/${goalDialog.goal.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                  })
            )
          }
        />
      ) : null}

      {krWizardGoal ? (
        <GoalKeyResultWizardDialog
          goal={krWizardGoal}
          owners={owners}
          metadataEntities={metadataEntities}
          onCancel={() => setKrWizardGoal(null)}
          onCreated={() => {
            setKrWizardGoal(null);
            setExpandedGoalIds((prev) => new Set(prev).add(krWizardGoal.id));
            void load();
          }}
        />
      ) : null}

      {krDialog ? (
        <KeyResultFormDialog
          keyResult={krDialog.keyResult}
          owners={owners}
          busy={dialogBusy}
          error={dialogError}
          onCancel={() => setKrDialog(null)}
          onSubmit={(payload) =>
            void submitDialog(() =>
              fetchJsonOk(`/api/goals/key-results/${krDialog.keyResult.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              })
            )
          }
        />
      ) : null}

      {valueDialog ? (
        <AchievedValueDialog
          keyResult={valueDialog.keyResult}
          busy={dialogBusy}
          error={dialogError}
          onCancel={() => setValueDialog(null)}
          onSubmit={(achievedValue) =>
            void submitDialog(() =>
              fetchJsonOk(
                `/api/goals/key-results/${valueDialog.keyResult.id}/achieved-value`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ achievedValue }),
                }
              )
            )
          }
        />
      ) : null}
    </div>
  );
}

// ─── Dialogs ────────────────────────────────────────────────────────────────

function GoalFormDialog({
  mode,
  goal,
  owners,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  mode: "create" | "edit";
  goal: GoalDto | null;
  owners: OwnerOption[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState(goal?.title ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [startDate, setStartDate] = useState(goal?.startDate ?? "");
  const [endDate, setEndDate] = useState(goal?.endDate ?? "");
  const [status, setStatus] = useState<GoalStatusValue>(goal?.status ?? "DRAFT");
  const [ownerAppUserId, setOwnerAppUserId] = useState(goal?.ownerAppUserId ?? "");

  const canSubmit = Boolean(title.trim() && startDate && endDate && ownerAppUserId);

  return (
    <DialogShell
      title={mode === "create" ? "Novo Objetivo" : "Editar Objetivo"}
      onCancel={onCancel}
      onSubmit={() =>
        onSubmit({
          title,
          description: description || null,
          startDate,
          endDate,
          status,
          ownerAppUserId,
        })
      }
      submitLabel={mode === "create" ? "Criar Objetivo" : "Salvar"}
      busy={busy}
      error={error}
      canSubmit={canSubmit}
      testId="goal-form-dialog"
    >
      <label className="block space-y-1">
        <span className={labelClass}>Título *</span>
        <input className={fieldClass} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="goal-form-title" />
      </label>
      <label className="block space-y-1">
        <span className={labelClass}>Descrição</span>
        <textarea className={fieldClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className={labelClass}>Início *</span>
          <input type="date" className={fieldClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>Fim *</span>
          <input type="date" className={fieldClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className={labelClass}>Status</span>
          <select
            className={fieldClass}
            value={status}
            onChange={(e) => setStatus(e.target.value as GoalStatusValue)}
          >
            {GOAL_STATUSES.filter((s) => s !== "ARCHIVED" || mode === "edit").map((s) => (
              <option key={s} value={s}>
                {GOAL_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>Responsável *</span>
          <select
            className={fieldClass}
            value={ownerAppUserId}
            onChange={(e) => setOwnerAppUserId(e.target.value)}
            data-testid="goal-form-owner"
          >
            <option value="">Selecione…</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </DialogShell>
  );
}

/**
 * Edição dos campos gerais de um indicador já existente (título, domínio,
 * direção, base/alvo/peso/responsável). Criar um indicador novo sempre usa
 * o assistente conversacional (GoalKeyResultWizardDialog) — este formulário
 * só edita o que já existe, por isso não tem modo "create".
 */
function KeyResultFormDialog({
  keyResult,
  owners,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  keyResult: GoalKeyResultDto;
  owners: OwnerOption[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState(keyResult.title);
  const [domain, setDomain] = useState(keyResult.domain);
  const [trackingType, setTrackingType] = useState(keyResult.trackingType);
  const [baseline, setBaseline] = useState(keyResult.baseline);
  const [target, setTarget] = useState(keyResult.target);
  const [unit, setUnit] = useState(keyResult.unit ?? "");
  const [weight, setWeight] = useState(keyResult.weight);
  const [ownerAppUserId, setOwnerAppUserId] = useState(keyResult.ownerAppUserId);

  const canSubmit = Boolean(
    title.trim() && baseline !== "" && target !== "" && weight !== "" && ownerAppUserId
  );

  return (
    <DialogShell
      title="Editar indicador"
      onCancel={onCancel}
      onSubmit={() =>
        onSubmit({
          title,
          domain,
          trackingType,
          baseline,
          target,
          unit: unit || null,
          weight,
          ownerAppUserId,
        })
      }
      submitLabel="Salvar"
      busy={busy}
      error={error}
      canSubmit={canSubmit}
      testId="kr-form-dialog"
    >
      <label className="block space-y-1">
        <span className={labelClass}>Título *</span>
        <input className={fieldClass} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="kr-form-title" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className={labelClass}>Domínio *</span>
          <select className={fieldClass} value={domain} onChange={(e) => setDomain(e.target.value as typeof domain)}>
            {GOAL_DOMAINS.map((d) => (
              <option key={d} value={d}>
                {GOAL_DOMAIN_LABELS[d]}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>Direção da meta *</span>
          <select
            className={fieldClass}
            value={trackingType}
            onChange={(e) => setTrackingType(e.target.value as typeof trackingType)}
          >
            {GOAL_TRACKING_TYPES.map((t) => (
              <option key={t} value={t}>
                {GOAL_TRACKING_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="block space-y-1">
          <span className={labelClass}>Linha de base *</span>
          <input className={fieldClass} value={baseline} onChange={(e) => setBaseline(e.target.value)} data-testid="kr-form-baseline" />
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>Alvo *</span>
          <input className={fieldClass} value={target} onChange={(e) => setTarget(e.target.value)} data-testid="kr-form-target" />
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>Unidade</span>
          <input className={fieldClass} placeholder="R$, un, %…" value={unit} onChange={(e) => setUnit(e.target.value)} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className={labelClass}>Peso</span>
          <input className={fieldClass} value={weight} onChange={(e) => setWeight(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className={labelClass}>Responsável *</span>
          <select
            className={fieldClass}
            value={ownerAppUserId}
            onChange={(e) => setOwnerAppUserId(e.target.value)}
            data-testid="kr-form-owner"
          >
            <option value="">Selecione…</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-[10px] text-muted-foreground">
        O KR herda o período do Objetivo. Progresso ={" "}
        (realizado − base) ÷ (alvo − base), limitado a 0–100%.
      </p>
    </DialogShell>
  );
}

function AchievedValueDialog({
  keyResult,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  keyResult: GoalKeyResultDto;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (achievedValue: string) => void;
}) {
  const [value, setValue] = useState(keyResult.achievedValue);

  return (
    <DialogShell
      title={`Lançar valor — ${keyResult.title}`}
      onCancel={onCancel}
      onSubmit={() => onSubmit(value)}
      submitLabel="Registrar"
      busy={busy}
      error={error}
      canSubmit={value.trim() !== ""}
      testId="kr-value-dialog"
    >
      <p className="text-xs text-muted-foreground">
        Valor realizado ATUAL do indicador (não é incremento). Base{" "}
        {formatValue(keyResult.baseline, keyResult.unit)} · alvo{" "}
        {formatValue(keyResult.target, keyResult.unit)}. O retrato do dia é
        gravado no histórico; dias anteriores nunca mudam.
      </p>
      <label className="block space-y-1">
        <span className={labelClass}>Valor realizado *</span>
        <input
          className={fieldClass}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          data-testid="kr-value-input"
        />
      </label>
    </DialogShell>
  );
}
