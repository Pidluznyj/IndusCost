import React from "react";
import { Award, ClipboardCheck, GraduationCap, Share2, Users } from "lucide-react";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import {
  SystemTotalizerCard,
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
} from "@/src/components/ui/SystemTotalizerCard";
import { COMPETENCY_LEVEL_LABELS } from "@/src/lib/competencies/competencyDomain";
import type { CompetencyOverviewResponse } from "@/src/lib/competencies/competencyTypes";
import type { Slice } from "./useCompetencyWorkspace";
import { PANEL, PanelState } from "./competencyUi";

/** Visão geral: indicadores de desenvolvimento calculados pela engine, sem lacuna de posto. */
export function CompetencyOverviewTab({
  overview,
  onRetry,
}: {
  overview: Slice<CompetencyOverviewResponse>;
  onRetry: () => void;
}) {
  const data = overview.data;
  const development = data?.development;
  const loading = overview.status === "loading" && !data;
  if (overview.status === "error" && !data) {
    return <PanelState kind="error" message={overview.message} onRetry={onRetry} testId="competency-overview-error" />;
  }
  return (
    <div className="space-y-6" data-testid="competency-overview">
      <SummaryKpiGrid minColumnWidth={200} className={SYSTEM_TOTALIZER_GRID_CLASS} testId="competency-kpis">
        <SystemTotalizerCard
          testId="kpi-evaluated"
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Colaboradores avaliados"
          value={development ? `${development.evaluatedEmployees}/${development.employeesInScope}` : "—"}
          icon={Users}
          tone="info"
          subtitle="Com ao menos um nível registrado"
          loading={loading}
        />
        <SystemTotalizerCard
          testId="kpi-autonomous"
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Profissionais autônomos"
          amount={development?.autonomousEmployees ?? null}
          amountFormat="number"
          icon={Award}
          tone="success"
          subtitle="Nível 3 ou 4 em alguma competência"
          loading={loading}
        />
        <SystemTotalizerCard
          testId="kpi-multipliers"
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Multiplicadores"
          amount={development?.multipliers ?? null}
          amountFormat="number"
          icon={GraduationCap}
          tone="info"
          subtitle="Nível 4 — referência que ensina"
          loading={loading}
        />
        <SystemTotalizerCard
          testId="kpi-polyvalence"
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Polivalência"
          amount={development?.polyvalentEmployees ?? null}
          amountFormat="number"
          icon={Share2}
          tone="neutral"
          subtitle="Nível em competência de outro departamento"
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
          testId="kpi-trainings"
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Treinamentos em aberto"
          amount={data?.openTrainings ?? null}
          amountFormat="number"
          icon={GraduationCap}
          tone="neutral"
          subtitle="Agendados ou em andamento"
          loading={loading}
        />
      </SummaryKpiGrid>

      <section className={PANEL} aria-labelledby="competency-levels-title" data-testid="competency-level-distribution">
        <header className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-3">
          <h3 id="competency-levels-title" className="text-sm font-semibold">
            Distribuição dos níveis
          </h3>
          <span className="text-xs text-muted-foreground">
            {development ? `${development.evaluatedCompetencies} competência(s) avaliada(s)` : ""}
          </span>
        </header>
        {loading ? (
          <PanelState kind="loading" message="Calculando níveis…" />
        ) : (
          <ul className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {([1, 2, 3, 4] as const).map((level) => (
              <li key={level} className="rounded-lg border border-border px-3 py-2">
                <p className="text-xs text-muted-foreground">{COMPETENCY_LEVEL_LABELS[level]}</p>
                <p className="text-lg font-semibold tabular-nums">
                  {development?.levelDistribution.find((d) => d.level === level)?.count ?? 0}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
