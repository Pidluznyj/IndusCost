/**
 * Metas (OKR) — Tela 3: o dia a dia da meta.
 *
 * Burn-up (linha ideal pontilhada × realizado), quotas por pessoa, kanban de
 * iniciativas (A fazer / Fazendo / Concluído) e o botão "Atualizar Painel"
 * (recalcula agora — protegido contra duplo clique no backend).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Plus, RefreshCw, Trash2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http.js";
import {
  GOAL_INITIATIVE_STATUSES,
  GOAL_INITIATIVE_STATUS_LABELS,
  type GoalDto,
  type GoalInitiativeDto,
  type GoalInitiativeStatusValue,
  type GoalKeyResultDto,
  type GoalSnapshotDto,
} from "@/src/lib/goals/goalContracts.js";
import { GoalKeyResultWizardDialog } from "./GoalKeyResultWizardDialog.js";
import type { GoalMetadataPublicEntity } from "./goalWizardShared.js";

type OwnerOption = { id: string; name: string };

function initialsOf(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary"
      title={name}
    >
      {initialsOf(name)}
    </span>
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

/**
 * Burn-up SVG puro: linha cinza pontilhada (trajetória ideal baseline→target
 * no período do objetivo) + linha azul (realizado por snapshot diário).
 */
function BurnUpChart({
  keyResult,
  snapshots,
  startDate,
  endDate,
}: {
  keyResult: GoalKeyResultDto;
  snapshots: GoalSnapshotDto[];
  startDate: string;
  endDate: string;
}) {
  const width = 640;
  const height = 220;
  const pad = { top: 16, right: 16, bottom: 24, left: 56 };

  const startMs = new Date(`${startDate}T00:00:00Z`).getTime();
  const endMs = new Date(`${endDate}T00:00:00Z`).getTime();
  const spanMs = Math.max(1, endMs - startMs);

  const baseline = Number(keyResult.baseline);
  const target = Number(keyResult.target);
  const decrease = keyResult.trackingType === "DECREASE";
  const values = snapshots.map((s) => Number(s.achievedValue));
  const yMin = Math.min(baseline, target, ...(values.length ? values : [baseline]));
  const yMax = Math.max(baseline, target, ...(values.length ? values : [target]));
  const ySpan = yMax - yMin || 1;

  const x = (ms: number) =>
    pad.left + ((ms - startMs) / spanMs) * (width - pad.left - pad.right);
  const y = (v: number) =>
    height - pad.bottom - ((v - yMin) / ySpan) * (height - pad.top - pad.bottom);

  const realizedPoints = snapshots
    .map((s) => {
      const ms = new Date(`${s.snapshotDate}T00:00:00Z`).getTime();
      return `${x(Math.min(Math.max(ms, startMs), endMs)).toFixed(1)},${y(Number(s.achievedValue)).toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label="Gráfico de progresso da meta: trajetória ideal e realizado"
      data-testid="burnup-chart"
    >
      {/* eixo/labels */}
      <text x={4} y={y(target) + 4} className="fill-current text-[10px]" opacity={0.7}>
        {formatValue(keyResult.target, keyResult.unit)}
      </text>
      <text x={4} y={y(baseline) + 4} className="fill-current text-[10px]" opacity={0.7}>
        {formatValue(keyResult.baseline, keyResult.unit)}
      </text>
      <text x={pad.left} y={height - 6} className="fill-current text-[10px]" opacity={0.7}>
        {civilDateBr(startDate)}
      </text>
      <text
        x={width - pad.right}
        y={height - 6}
        textAnchor="end"
        className="fill-current text-[10px]"
        opacity={0.7}
      >
        {civilDateBr(endDate)}
      </text>

      {/* linhas de referência do alvo e base */}
      <line
        x1={pad.left}
        y1={y(target)}
        x2={width - pad.right}
        y2={y(target)}
        stroke="#059669"
        strokeWidth={1}
        strokeDasharray="2 3"
        opacity={0.5}
      />

      {/* Trajetória ideal: baseline → target, do início ao fim */}
      <line
        x1={x(startMs)}
        y1={y(baseline)}
        x2={x(endMs)}
        y2={y(target)}
        stroke="#94A3B8"
        strokeWidth={2}
        strokeDasharray="6 4"
      />

      {/* Realizado */}
      {snapshots.length > 0 ? (
        <polyline
          points={realizedPoints}
          fill="none"
          stroke="#2563EB"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : (
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          className="fill-current text-[11px]"
          opacity={0.6}
        >
          Ainda sem leituras — o primeiro retrato aparece após o cálculo diário.
        </text>
      )}
      {decrease ? (
        <text
          x={width - pad.right}
          y={pad.top}
          textAnchor="end"
          className="fill-current text-[10px]"
          opacity={0.6}
        >
          meta de redução: quanto mais baixo, melhor
        </text>
      ) : null}
    </svg>
  );
}

const KANBAN_TONES: Record<GoalInitiativeStatusValue, string> = {
  TODO: "border-[#CBD5E1]",
  DOING: "border-[#BFDBFE]",
  DONE: "border-[#A7F3D0]",
};

export function GoalDetailPage() {
  const { goalId } = useParams<{ goalId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [goal, setGoal] = useState<GoalDto | null>(null);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [metadataEntities, setMetadataEntities] = useState<GoalMetadataPublicEntity[]>([]);
  // Drill-down direto: /goals/:goalId?kr=:krId abre já no indicador certo
  // (link vindo do Cockpit). Sem ?kr= cai no primeiro indicador do objetivo.
  const [selectedKrId, setSelectedKrId] = useState<string | null>(
    () => searchParams.get("kr")
  );
  const [snapshots, setSnapshots] = useState<GoalSnapshotDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [newInitiative, setNewInitiative] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [newInitiativeScope, setNewInitiativeScope] = useState<"KR" | "GOAL">("KR");
  const [krWizardOpen, setKrWizardOpen] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!goalId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetchJsonOk<{ goal: GoalDto }>(`/api/goals/${goalId}`, {
          signal,
        });
        setGoal(res.goal);
        setSelectedKrId((prev) => prev ?? res.goal.keyResults[0]?.id ?? null);
      } catch (err) {
        if (signal?.aborted) return;
        setError(err instanceof Error ? err.message : "Falha ao carregar a meta.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [goalId]
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

  /** Selecionar outro indicador atualiza a URL — o link fica compartilhável. */
  function selectKr(krId: string) {
    setSelectedKrId(krId);
    setNewInitiativeScope("KR");
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("kr", krId);
      return next;
    });
  }

  useEffect(() => {
    if (!selectedKrId) {
      setSnapshots([]);
      return;
    }
    const controller = new AbortController();
    fetchJsonOk<{ snapshots: GoalSnapshotDto[] }>(
      `/api/goals/key-results/${selectedKrId}/snapshots`,
      { signal: controller.signal }
    )
      .then((res) => setSnapshots(res.snapshots))
      .catch(() => setSnapshots([]));
    return () => controller.abort();
  }, [selectedKrId, goal]);

  const selectedKr: GoalKeyResultDto | null = useMemo(
    () => goal?.keyResults.find((k) => k.id === selectedKrId) ?? null,
    [goal, selectedKrId]
  );

  const lastReading = snapshots.at(-1);

  async function handleRefresh() {
    if (!selectedKr) return;
    setRefreshBusy(true);
    setRefreshNote(null);
    setError(null);
    try {
      await fetchJsonOk(`/api/goals/key-results/${selectedKr.id}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      setRefreshNote("Painel atualizado agora mesmo. ✔");
      await load();
    } catch (err) {
      setRefreshNote(
        err instanceof Error ? err.message : "Não foi possível recalcular agora."
      );
    } finally {
      setRefreshBusy(false);
    }
  }

  async function handleAddInitiative() {
    if (!goalId || !newInitiative.trim()) return;
    try {
      await fetchJsonOk("/api/goals/initiatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          // Tarefa vinculada ao indicador aberto na tela (drill-down
          // Objetivo → Indicador → Tarefas) ou geral do objetivo, conforme
          // o par de botões abaixo — nunca os dois ao mesmo tempo (RN-007).
          newInitiativeScope === "KR" && selectedKrId
            ? { keyResultId: selectedKrId, title: newInitiative, assigneeAppUserId: newAssignee || null }
            : { goalId, title: newInitiative, assigneeAppUserId: newAssignee || null }
        ),
      });
      setNewInitiative("");
      setNewAssignee("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar a iniciativa.");
    }
  }

  async function moveInitiative(
    initiative: GoalInitiativeDto,
    status: GoalInitiativeStatusValue
  ) {
    try {
      await fetchJsonOk(`/api/goals/initiatives/${initiative.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao mover a iniciativa.");
    }
  }

  async function removeInitiative(initiative: GoalInitiativeDto) {
    try {
      await fetchJsonOk(`/api/goals/initiatives/${initiative.id}`, {
        method: "DELETE",
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao remover a iniciativa.");
    }
  }

  if (loading && !goal) {
    return (
      <p className="rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
        Carregando a meta…
      </p>
    );
  }

  if (error && !goal) {
    return (
      <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-3 text-sm text-[#991B1B]">
        {error}{" "}
        <Link to="/goals" className="underline">
          Voltar para as metas
        </Link>
      </div>
    );
  }

  if (!goal) return null;

  return (
    <div data-testid="goal-detail">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link
            to="/goals"
            className="rounded-md border border-border p-1.5 hover:bg-muted"
            title="Voltar para o cockpit"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
          <div>
            <h2 className="text-lg font-semibold">{goal.title}</h2>
            <p className="text-[12px] text-muted-foreground">
              {civilDateBr(goal.startDate)} – {civilDateBr(goal.endDate)}
              {goal.ownerName ? ` · Dono: ${goal.ownerName}` : ""} ·{" "}
              {goal.progressPercent}% atingido
            </p>
          </div>
        </div>
        {selectedKr && selectedKr.hasRule ? (
          <div className="text-right">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
              disabled={refreshBusy}
              onClick={() => void handleRefresh()}
              data-testid="goal-refresh-button"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshBusy && "animate-spin")} aria-hidden />
              Atualizar Painel
            </button>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {refreshNote ??
                (lastReading
                  ? `Última leitura em ${civilDateBr(lastReading.snapshotDate)}. Clique para recalcular agora.`
                  : "Clique para fazer a primeira leitura agora.")}
            </p>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mb-3 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-3">
        {/* Coluna principal: seletor de indicador + burn-up + quotas */}
        <div className="space-y-3 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">
              Indicadores:
            </span>
            {goal.keyResults.map((kr) => (
              <button
                key={kr.id}
                type="button"
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium",
                  selectedKrId === kr.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
                onClick={() => selectKr(kr.id)}
                data-testid={`detail-kr-tab-${kr.id}`}
              >
                {kr.title} · {kr.progressPercent}%
              </button>
            ))}
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/50 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/5"
              onClick={() => setKrWizardOpen(true)}
              data-testid="detail-add-kr"
            >
              <Plus className="h-3 w-3" aria-hidden /> Novo indicador
            </button>
          </div>

          {selectedKr ? (
            <section className="rounded-lg border border-border bg-card p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">{selectedKr.title}</h3>
                  <p className="text-[11px] text-muted-foreground">
                    {selectedKr.ruleSummary ??
                      "Indicador de lançamento manual — o valor é informado pela equipe."}
                  </p>
                  {selectedKr.comparison ? (
                    <p
                      className="text-[11px] text-muted-foreground"
                      data-testid="detail-kr-target-origin"
                    >
                      Alvo: {Number(selectedKr.comparison.percent) >= 0 ? "+" : ""}
                      {selectedKr.comparison.percent}% sobre{" "}
                      {formatValue(selectedKr.comparison.value, selectedKr.unit)}{" "}
                      apurado em {civilDateBr(selectedKr.comparison.startDate)} –{" "}
                      {civilDateBr(selectedKr.comparison.endDate)} (
                      {selectedKr.comparison.modeLabel})
                    </p>
                  ) : null}
                  <p
                    className="text-[11px] text-muted-foreground"
                    data-testid="detail-kr-period"
                  >
                    Período medido: {civilDateBr(selectedKr.effectiveStartDate)} –{" "}
                    {civilDateBr(selectedKr.effectiveEndDate)}
                    {selectedKr.hasOwnPeriod
                      ? " (recorte próprio deste indicador)"
                      : " (mesmo período do objetivo)"}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums">
                  {formatValue(selectedKr.achievedValue, selectedKr.unit)}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    de {formatValue(selectedKr.target, selectedKr.unit)}
                  </span>
                </p>
              </div>
              {/* A trajetória ideal segue a janela DO INDICADOR — um indicador
                  trimestral dentro de um objetivo anual tem a própria reta. */}
              <BurnUpChart
                keyResult={selectedKr}
                snapshots={snapshots}
                startDate={selectedKr.effectiveStartDate}
                endDate={selectedKr.effectiveEndDate}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Linha pontilhada: trajetória ideal. Linha azul: realizado (um retrato
                por dia — retratos antigos nunca mudam).
              </p>
            </section>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              Este objetivo ainda não tem indicadores.
            </p>
          )}

          {selectedKr && selectedKr.quotas.length > 0 ? (
            <section className="rounded-lg border border-border bg-card p-3">
              <h3 className="mb-2 text-sm font-semibold">Fatias da equipe</h3>
              <ul className="space-y-1.5">
                {selectedKr.quotas.map((quota) => {
                  const value = Number(quota.quotaValue);
                  const targetN = Number(selectedKr.target);
                  const percent =
                    Number.isFinite(targetN) && targetN !== 0
                      ? Math.round((value / targetN) * 100)
                      : 0;
                  return (
                    <li key={quota.id} className="flex items-center gap-2 text-xs">
                      <Avatar name={quota.assigneeName ?? "?"} />
                      <span className="min-w-0 flex-1 truncate">{quota.assigneeName}</span>
                      <span className="tabular-nums font-medium">
                        {formatValue(quota.quotaValue, selectedKr.unit)}
                      </span>
                      <span className="w-10 text-right tabular-nums text-muted-foreground">
                        {percent}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>

        {/* Lateral: kanban de iniciativas */}
        <aside className="space-y-2" data-testid="initiatives-board">
          <h3 className="text-sm font-semibold">
            O que estamos fazendo para chegar lá?
          </h3>
          {goal.keyResults.length > 0 ? (
            <div className="flex gap-1 text-[10px]" data-testid="initiative-scope-toggle">
              <button
                type="button"
                className={cn(
                  "flex-1 rounded-md border px-2 py-1 font-medium",
                  newInitiativeScope === "KR"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground"
                )}
                disabled={!selectedKrId}
                onClick={() => setNewInitiativeScope("KR")}
                title={selectedKr ? `Tarefa deste indicador: ${selectedKr.title}` : "Selecione um indicador acima"}
              >
                Deste indicador
              </button>
              <button
                type="button"
                className={cn(
                  "flex-1 rounded-md border px-2 py-1 font-medium",
                  newInitiativeScope === "GOAL"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground"
                )}
                onClick={() => setNewInitiativeScope("GOAL")}
              >
                Geral do objetivo
              </button>
            </div>
          ) : null}
          <div className="flex gap-1.5">
            <input
              className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
              placeholder='Ex.: "Visitar 10 clientes do setor…"'
              value={newInitiative}
              onChange={(e) => setNewInitiative(e.target.value)}
              data-testid="initiative-new-title"
            />
            <select
              className="w-28 rounded border border-border bg-background px-1 py-1 text-xs"
              value={newAssignee}
              onChange={(e) => setNewAssignee(e.target.value)}
              title="Responsável (opcional)"
            >
              <option value="">Quem?</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-40"
              disabled={!newInitiative.trim()}
              onClick={() => void handleAddInitiative()}
              data-testid="initiative-add"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>

          {GOAL_INITIATIVE_STATUSES.map((status) => {
            const items = goal.initiatives.filter((i) => i.status === status);
            return (
              <div
                key={status}
                className={cn("rounded-lg border-2 bg-card p-2", KANBAN_TONES[status])}
                data-testid={`kanban-col-${status}`}
              >
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  {GOAL_INITIATIVE_STATUS_LABELS[status]} ({items.length})
                </p>
                {items.length === 0 ? (
                  <p className="py-1 text-[11px] text-muted-foreground">—</p>
                ) : (
                  <ul className="space-y-1.5">
                    {items.map((initiative) => (
                      <li
                        key={initiative.id}
                        className="rounded-md border border-border bg-background p-2"
                        data-testid={`initiative-${initiative.id}`}
                      >
                        <span
                          className="mb-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground"
                          title="A qual nível esta tarefa pertence"
                        >
                          {initiative.keyResultId
                            ? (goal.keyResults.find((k) => k.id === initiative.keyResultId)
                                ?.title ?? "Indicador")
                            : "Objetivo (geral)"}
                        </span>
                        <p className="text-xs font-medium">{initiative.title}</p>
                        <div className="mt-1 flex items-center justify-between gap-1">
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            {initiative.assigneeName ? (
                              <Avatar name={initiative.assigneeName} />
                            ) : null}
                            {initiative.dueDate ? `até ${civilDateBr(initiative.dueDate)}` : ""}
                          </span>
                          <span className="flex items-center gap-0.5">
                            {status !== "TODO" ? (
                              <button
                                type="button"
                                className="rounded border border-border px-1 text-[10px] hover:bg-muted"
                                title="Mover para trás"
                                onClick={() =>
                                  void moveInitiative(
                                    initiative,
                                    status === "DONE" ? "DOING" : "TODO"
                                  )
                                }
                              >
                                ←
                              </button>
                            ) : null}
                            {status !== "DONE" ? (
                              <button
                                type="button"
                                className="rounded border border-border px-1 text-[10px] hover:bg-muted"
                                title="Avançar"
                                onClick={() =>
                                  void moveInitiative(
                                    initiative,
                                    status === "TODO" ? "DOING" : "DONE"
                                  )
                                }
                                data-testid={`initiative-advance-${initiative.id}`}
                              >
                                →
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="rounded border border-[#FECACA] px-1 text-[10px] text-[#991B1B] hover:bg-[#FEF2F2]"
                              title="Remover"
                              onClick={() => void removeInitiative(initiative)}
                            >
                              <Trash2 className="h-3 w-3" aria-hidden />
                            </button>
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </aside>
      </div>

      {krWizardOpen ? (
        <GoalKeyResultWizardDialog
          goal={goal}
          owners={owners}
          metadataEntities={metadataEntities}
          onCancel={() => setKrWizardOpen(false)}
          onCreated={(kr) => {
            setKrWizardOpen(false);
            selectKr(kr.id);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
