/**
 * Prontidão do ciclo (antes de abrir): o que falta para cada pessoa ter todas as avaliações que lhe
 * cabem, com a ação que resolve em um clique. Regras em performanceReadiness.ts.
 */
import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, UserPlus, UserRoundCog } from "lucide-react";
import { OverlaySelect } from "@/src/components/ui/overlay";
import {
  fetchCycleReadiness,
  fetchPerformanceModels,
  includeCycleLeaders,
  setCycleLeadershipModel,
  type ModelSummary,
  type ReadinessIssue,
} from "@/src/lib/hrPerformance/performanceClient";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, ErrorBanner, PANEL } from "./performanceUi";

export function CycleReadinessPanel({
  cycleId,
  version,
  canManage,
  onChanged,
  onBlockedChange,
  onPickLeader,
}: {
  cycleId: string;
  /** Muda quando a mesa recarrega, para reler a prontidão. */
  version: number;
  canManage: boolean;
  onChanged: (message: string) => Promise<void> | void;
  onBlockedChange: (blocked: boolean) => void;
  /** Abre o seletor de líder/avaliador de um participante (troca com motivo). */
  onPickLeader: (participantId: string) => void;
}) {
  const [issues, setIssues] = useState<ReadinessIssue[] | null>(null);
  const [leadershipModels, setLeadershipModels] = useState<ModelSummary[]>([]);
  const [modelChoice, setModelChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetchCycleReadiness(cycleId);
      setIssues(r.issues);
      onBlockedChange(r.blocked);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível conferir a prontidão.");
    }
  }, [cycleId, onBlockedChange]);
  useEffect(() => {
    void reload();
  }, [reload, version]);
  useEffect(() => {
    if (!issues?.some((i) => i.action === "SET_LEADERSHIP_MODEL")) return;
    void fetchPerformanceModels()
      .then((payload) => {
        const published = payload.models.filter((m) => m.kind === "LEADERSHIP" && m.status === "PUBLISHED");
        setLeadershipModels(published);
        if (published[0] && !modelChoice) setModelChoice(published[0].id);
      })
      .catch(() => setLeadershipModels([]));
  }, [issues, modelChoice]);

  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setError(null);
    try {
      const message = await fn();
      await onChanged(message);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir.");
    } finally {
      setBusy(null);
    }
  };

  if (issues === null) return null;
  if (issues.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-700" data-testid="perf-readiness-ok">
        <CheckCircle2 className="h-4 w-4" aria-hidden /> Pronto para abrir: todo mundo tem as avaliações que lhe cabem (auto, líder, equipe e superior).
      </p>
    );
  }
  const blocks = issues.filter((i) => i.severity === "BLOCK").length;
  return (
    <section className={`${PANEL} space-y-3 p-4`} data-testid="perf-readiness">
      <div className="flex items-start gap-2">
        <AlertTriangle className={`mt-0.5 h-4 w-4 ${blocks ? "text-rose-600" : "text-amber-600"}`} aria-hidden />
        <div>
          <p className="text-sm font-semibold">{blocks ? `${blocks} item(ns) impedem a abertura` : "Avisos antes de abrir"}</p>
          <p className="text-xs text-muted-foreground">A regra: toda pessoa se autoavalia; quem tem líder avalia o líder e é avaliado por ele; quem lidera avalia cada liderado.</p>
        </div>
      </div>
      <ErrorBanner message={error} />
      <ul className="space-y-3">
        {issues.map((issue) => (
          <li key={issue.code} className={`rounded-lg border p-3 ${issue.severity === "BLOCK" ? "border-rose-200 bg-rose-50/40" : "border-amber-200 bg-amber-50/40"}`} data-testid={`perf-readiness-${issue.code}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{issue.title}</p>
                <p className="text-xs text-muted-foreground">{issue.message}</p>
              </div>
              {canManage && issue.action === "SET_LEADERSHIP_MODEL" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <OverlaySelect value={modelChoice} onChange={(e) => setModelChoice(e.target.value)} aria-label="Modelo de liderança" data-testid="perf-readiness-model">
                    {leadershipModels.length === 0 ? <option value="">Publique um modelo de liderança em Modelos</option> : null}
                    {leadershipModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} · v{m.version}
                      </option>
                    ))}
                  </OverlaySelect>
                  <button
                    type="button"
                    className={BTN_PRIMARY}
                    disabled={!modelChoice || busy !== null}
                    onClick={() =>
                      void act("model", async () => {
                        await setCycleLeadershipModel(cycleId, modelChoice);
                        return "Avaliação 180° incluída no ciclo";
                      })
                    }
                    data-testid="perf-readiness-set-model"
                  >
                    Usar este modelo
                  </button>
                </div>
              ) : null}
              {canManage && issue.action === "INCLUDE_LEADERS" ? (
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  disabled={busy !== null}
                  onClick={() =>
                    void act("leaders", async () => {
                      const r = await includeCycleLeaders(cycleId);
                      return `${r.added} líder(es) incluído(s) no ciclo`;
                    })
                  }
                  data-testid="perf-readiness-include-leaders"
                >
                  <UserPlus className="h-4 w-4" aria-hidden /> Incluir os líderes
                </button>
              ) : null}
              {issue.action === "LINK_USERS" || issue.action === "REGULARIZE_ACCOUNT" || issue.action === "REVIEW_IDENTITY" ? (
                <a className={BTN_SECONDARY} href="/people" target="_blank" rel="noopener" data-testid={`perf-readiness-people-${issue.code}`}>
                  Pessoas 360°
                </a>
              ) : null}
              {issue.action === "REVIEW_ACCOUNT" ? (
                <a className={BTN_SECONDARY} href="/settings/users" target="_blank" rel="noopener">
                  Configurações › Usuários
                </a>
              ) : null}
            </div>
            {issue.people.length > 0 ? (
              <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                {issue.people.map((p) => (
                  <li key={p.employeeId} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-card px-2 py-1">
                    <span className="min-w-0">
                      <span className="font-medium">{p.name}</span>
                      {p.detail ? <span className="text-xs text-muted-foreground"> · {p.detail}</span> : null}
                    </span>
                    {p.personId && (issue.action === "LINK_USERS" || issue.action === "REGULARIZE_ACCOUNT" || issue.action === "REVIEW_IDENTITY" || issue.action === "REVIEW_ACCOUNT") ? (
                      <a className={BTN_GHOST} href={`/people/${p.personId}`} target="_blank" rel="noopener" data-testid={`perf-readiness-person-${p.employeeId}`}>
                        {issue.action === "REGULARIZE_ACCOUNT" ? "Regularizar na ficha" : issue.action === "LINK_USERS" ? "Habilitar acesso na ficha" : "Abrir ficha"}
                      </a>
                    ) : null}
                    {canManage && p.participantId && (issue.action === "SET_EVALUATOR" || issue.action === "REVIEW_LEADER") ? (
                      <button type="button" className={BTN_GHOST} onClick={() => onPickLeader(p.participantId!)} data-testid={`perf-readiness-leader-${p.name}`}>
                        <UserRoundCog className="h-3.5 w-3.5" aria-hidden /> {issue.action === "SET_EVALUATOR" ? "Definir avaliador" : "Trocar líder"}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
