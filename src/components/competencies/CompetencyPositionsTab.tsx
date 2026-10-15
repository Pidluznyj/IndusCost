import React from "react";
import { Users } from "lucide-react";
import { shiftPatternLabel } from "@/src/lib/competencies/competencyDomain";
import type { CompetencyOverviewResponse, WorkPositionDto } from "@/src/lib/competencies/competencyTypes";
import type { Slice } from "./useCompetencyWorkspace";
import { BTN_GHOST, LevelChip, PANEL, PanelState, ReadinessBar } from "./competencyUi";

/** Cards de posto: setor · turno, nome, requisitos e barra de aptos (aptidão da engine). */
export function CompetencyPositionsTab({
  positions,
  overview,
  canManage,
  onEditTeam,
  onRetry,
}: {
  positions: Slice<WorkPositionDto[]>;
  overview: Slice<CompetencyOverviewResponse>;
  canManage: boolean;
  onEditTeam: (position: WorkPositionDto) => void;
  onRetry: () => void;
}) {
  const list = positions.data;
  if (positions.status === "error" && !list) return <PanelState kind="error" message={positions.message} onRetry={onRetry} />;
  if (!list) return <PanelState kind="loading" message="Carregando postos…" />;
  if (list.length === 0) {
    return (
      <div className={PANEL}>
        <PanelState kind="empty" message="Nenhum posto de trabalho cadastrado. Use + Posto para criar o primeiro." testId="competency-positions-empty" />
      </div>
    );
  }
  const readiness = new Map((overview.data?.positions ?? []).map((p) => [p.positionId, p]));
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="competency-positions">
      {list.map((p) => {
        const r = readiness.get(p.id);
        return (
          <article key={p.id} className={`${PANEL} flex flex-col gap-3 p-4`} data-testid="competency-position-card">
            <div>
              <p className="text-xs text-muted-foreground">
                {[p.departmentName ?? "Sem setor", shiftPatternLabel(p.shiftPattern)].join(" · ")}
              </p>
              <h3 className="text-base font-semibold">{p.name}</h3>
            </div>
            <ul className="flex flex-wrap gap-1.5" aria-label="Requisitos">
              {(r?.requirements ?? []).map((q) => (
                <li key={q.competencyId} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs">
                  {q.competencyName}
                  <LevelChip level={q.minLevel} className="h-5 min-w-5 text-[11px]" title={`mín. ${q.minLevel}`} />
                </li>
              ))}
            </ul>
            <div className="mt-auto space-y-2">
              {r ? <ReadinessBar ready={r.ready} total={r.total} ratio={r.ratio} tone={r.tone} /> : null}
              {canManage ? (
                <button type="button" className={BTN_GHOST} onClick={() => onEditTeam(p)} data-testid="competency-position-team">
                  <Users className="h-3.5 w-3.5" aria-hidden /> Equipe ({p.team.length})
                </button>
              ) : (
                <p className="text-xs text-muted-foreground">{p.team.length} colaborador(es)</p>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
