import React from "react";
import { CalendarPlus } from "lucide-react";
import { OverlayTable } from "@/src/components/ui/overlay";
import { formatIsoDateBr } from "@/src/lib/competencies/competencyDomain";
import type { CompetencyAssessmentDto } from "@/src/lib/competencies/competencyTypes";
import type { Slice } from "./useCompetencyWorkspace";
import { AssessmentStatusBadge, BTN_GHOST, BTN_SECONDARY, PANEL, PanelState } from "./competencyUi";

export function CompetencyAssessmentsTab({
  assessments,
  canRegister,
  onSchedule,
  onComplete,
  onDelete,
  onRetry,
}: {
  assessments: Slice<CompetencyAssessmentDto[]>;
  canRegister: boolean;
  onSchedule: () => void;
  onComplete: (assessment: CompetencyAssessmentDto) => void;
  onDelete: (assessment: CompetencyAssessmentDto) => void;
  onRetry: () => void;
}) {
  const list = assessments.data;
  return (
    <section className={PANEL} data-testid="competency-assessments">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Avaliações de competência</h3>
        {canRegister ? (
          <button type="button" className={BTN_SECONDARY} onClick={onSchedule} data-testid="competency-schedule-assessment">
            <CalendarPlus className="h-4 w-4" aria-hidden /> Agendar avaliação
          </button>
        ) : null}
      </header>
      {assessments.status === "error" && !list ? (
        <PanelState kind="error" message={assessments.message} onRetry={onRetry} />
      ) : !list ? (
        <PanelState kind="loading" message="Carregando avaliações…" />
      ) : list.length === 0 ? (
        <PanelState kind="empty" message="Nenhuma avaliação registrada ainda." testId="competency-assessments-empty" />
      ) : (
        <OverlayTable minWidth={820}>
          <OverlayTable.Head>
            <OverlayTable.Row>
              <OverlayTable.HeadCell>Colaborador</OverlayTable.HeadCell>
              <OverlayTable.HeadCell>Posto</OverlayTable.HeadCell>
              <OverlayTable.HeadCell>Avaliador</OverlayTable.HeadCell>
              <OverlayTable.HeadCell nowrap>Data</OverlayTable.HeadCell>
              <OverlayTable.HeadCell align="right">Média</OverlayTable.HeadCell>
              <OverlayTable.HeadCell>Status</OverlayTable.HeadCell>
              {canRegister ? <OverlayTable.HeadCell align="right">Ações</OverlayTable.HeadCell> : null}
            </OverlayTable.Row>
          </OverlayTable.Head>
          <OverlayTable.Body>
            {list.map((a) => (
              <OverlayTable.Row key={a.id} data-testid="competency-assessment-row">
                <OverlayTable.Cell className="font-semibold">{a.employeeName}</OverlayTable.Cell>
                <OverlayTable.Cell>{a.positionName ?? "—"}</OverlayTable.Cell>
                <OverlayTable.Cell>{a.evaluatorName ?? "—"}</OverlayTable.Cell>
                <OverlayTable.Cell mono>{formatIsoDateBr(a.assessmentDate)}</OverlayTable.Cell>
                <OverlayTable.Cell align="right" mono>
                  {a.averageLabel}
                </OverlayTable.Cell>
                <OverlayTable.Cell>
                  <AssessmentStatusBadge status={a.status} />
                </OverlayTable.Cell>
                {canRegister ? (
                  <OverlayTable.Cell align="right" nowrap>
                    {a.status !== "COMPLETED" ? (
                      <span className="inline-flex gap-1">
                        <button type="button" className={BTN_GHOST} onClick={() => onComplete(a)}>
                          Avaliar
                        </button>
                        <button type="button" className={`${BTN_GHOST} text-rose-700 hover:bg-rose-50`} onClick={() => onDelete(a)}>
                          Excluir
                        </button>
                      </span>
                    ) : null}
                  </OverlayTable.Cell>
                ) : null}
              </OverlayTable.Row>
            ))}
          </OverlayTable.Body>
        </OverlayTable>
      )}
    </section>
  );
}
