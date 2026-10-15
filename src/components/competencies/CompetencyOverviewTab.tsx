import React from "react";
import { ArrowRight, Award, ClipboardCheck, Target, TriangleAlert } from "lucide-react";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import {
  SystemTotalizerCard,
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
} from "@/src/components/ui/SystemTotalizerCard";
import { shiftPatternLabel } from "@/src/lib/competencies/competencyDomain";
import type { RequirementEvaluation } from "@/src/lib/competencies/competencyEngine";
import type { CompetencyOverviewResponse } from "@/src/lib/competencies/competencyTypes";
import type { Slice } from "./useCompetencyWorkspace";
import { BTN_GHOST, LevelChip, PANEL, PanelState, ReadinessBar } from "./competencyUi";

/** Visão geral: KPIs, lacunas por posto (6 maiores) e aptidão por posto — tudo da engine. */
export function CompetencyOverviewTab({
  overview,
  canPlanTraining,
  onPlan,
  onRetry,
}: {
  overview: Slice<CompetencyOverviewResponse>;
  canPlanTraining: boolean;
  onPlan: (gap: RequirementEvaluation) => void;
  onRetry: () => void;
}) {
  const data = overview.data;
  const loading = overview.status === "loading" && !data;
  if (overview.status === "error" && !data) {
    return <PanelState kind="error" message={overview.message} onRetry={onRetry} testId="competency-overview-error" />;
  }
  return (
    <div className="space-y-6" data-testid="competency-overview">
      <SummaryKpiGrid minColumnWidth={200} className={SYSTEM_TOTALIZER_GRID_CLASS} testId="competency-kpis">
        <SystemTotalizerCard
          testId="kpi-coverage"
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Cobertura de requisitos"
          value={data?.coverage.percentLabel ?? "—"}
          icon={Target}
          tone="info"
          subtitle={data ? `${data.coverage.met} de ${data.coverage.total} requisitos atendidos` : "Requisitos atendidos"}
          loading={loading}
        />
        <SystemTotalizerCard
          testId="kpi-gaps"
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Lacunas abertas"
          amount={data?.openGaps ?? null}
          amountFormat="number"
          icon={TriangleAlert}
          tone={data && data.openGaps > 0 ? "danger" : "success"}
          subtitle={data && data.criticalGaps > 0 ? `${data.criticalGaps} em competência crítica` : "Abaixo do mínimo do posto"}
          loading={loading}
        />
        <SystemTotalizerCard
          testId="kpi-pending"
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Avaliações pendentes"
          amount={data?.pendingAssessments ?? null}
          amountFormat="number"
          icon={ClipboardCheck}
          tone="neutral"
          subtitle="Pendentes ou em andamento"
          loading={loading}
        />
        <SystemTotalizerCard
          testId="kpi-ready"
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Colaboradores aptos"
          value={data ? `${data.readyEmployees}/${data.allocatedEmployees}` : "—"}
          icon={Award}
          tone="success"
          subtitle="Atendem 100% do posto"
          loading={loading}
        />
      </SummaryKpiGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={PANEL} aria-labelledby="competency-gaps-title" data-testid="competency-gaps-panel">
          <header className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-3">
            <h3 id="competency-gaps-title" className="text-sm font-semibold">
              Lacunas por posto
            </h3>
            <span className="text-xs text-muted-foreground">
              {data ? `${data.openGaps} abaixo do mínimo · maiores diferenças` : ""}
            </span>
          </header>
          {loading ? (
            <PanelState kind="loading" message="Calculando lacunas…" />
          ) : !data || data.topGaps.length === 0 ? (
            <PanelState kind="empty" message="Nenhuma lacuna aberta: todos atendem o mínimo do posto." testId="competency-gaps-empty" />
          ) : (
            <ul className="divide-y divide-border/70">
              {data.topGaps.map((g) => (
                <li key={`${g.employeeId}:${g.competencyId}`} className="flex items-center gap-3 px-4 py-3" data-testid="competency-gap-row">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {g.employeeName}
                      {g.critical ? <span className="ml-1.5 text-xs font-semibold text-rose-700">· Crítica</span> : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {g.competencyName} · {g.positionName}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5" aria-label={`Nível ${g.currentLevel} de ${g.requiredLevel} exigido`}>
                    <LevelChip level={g.currentLevel} />
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    <LevelChip level={g.requiredLevel} />
                  </div>
                  {canPlanTraining ? (
                    <button type="button" className={BTN_GHOST} onClick={() => onPlan(g)} data-testid="competency-gap-plan">
                      Planejar
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={PANEL} aria-labelledby="competency-readiness-title" data-testid="competency-readiness-panel">
          <header className="border-b border-border px-4 py-3">
            <h3 id="competency-readiness-title" className="text-sm font-semibold">
              Aptidão por posto
            </h3>
          </header>
          {loading ? (
            <PanelState kind="loading" message="Calculando aptidão…" />
          ) : !data || data.positions.length === 0 ? (
            <PanelState kind="empty" message="Nenhum posto de trabalho cadastrado." />
          ) : (
            <ul className="divide-y divide-border/70">
              {data.positions.map((p) => (
                <li key={p.positionId} className="space-y-2 px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{p.positionName}</p>
                    <p className="shrink-0 text-xs text-muted-foreground">
                      {[p.departmentName, shiftPatternLabel(p.shiftPattern)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <ReadinessBar ready={p.ready} total={p.total} ratio={p.ratio} tone={p.tone} testId="competency-readiness-bar" />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
