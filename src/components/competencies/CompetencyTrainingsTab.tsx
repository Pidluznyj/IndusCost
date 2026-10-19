import React from "react";
import { Award } from "lucide-react";
import { OverlayTable } from "@/src/components/ui/overlay";
import { TRAINING_MODALITY_LABELS, formatIsoDateBr, isTrainingModality } from "@/src/lib/competencies/competencyDomain";
import type { TrainingDto } from "@/src/lib/competencies/competencyTypes";
import type { Slice } from "./useCompetencyWorkspace";
import { BTN_GHOST, PANEL, PanelState, TrainingStatusBadge } from "./competencyUi";

function validityLabel(months: number): string {
  return months > 0 ? `Validade de ${months} ${months === 1 ? "mês" : "meses"}` : "Sem validade";
}

export function CompetencyTrainingsTab({
  trainings,
  canManage,
  onStatus,
  onDelete,
  onCertificates,
  onRetry,
}: {
  trainings: Slice<TrainingDto[]>;
  canManage: boolean;
  onStatus: (training: TrainingDto, status: "IN_PROGRESS" | "COMPLETED") => void;
  onDelete: (training: TrainingDto) => void;
  /** Abre os certificados do treinamento (emitir exige gestão; imprimir só visualização). */
  onCertificates: (training: TrainingDto) => void;
  onRetry: () => void;
}) {
  const list = trainings.data;
  return (
    <section className={PANEL} data-testid="competency-trainings">
      <header className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Treinamentos</h3>
      </header>
      {trainings.status === "error" && !list ? (
        <PanelState kind="error" message={trainings.message} onRetry={onRetry} />
      ) : !list ? (
        <PanelState kind="loading" message="Carregando treinamentos…" />
      ) : list.length === 0 ? (
        <PanelState kind="empty" message="Nenhum treinamento agendado." testId="competency-trainings-empty" />
      ) : (
        <OverlayTable minWidth={900}>
          <OverlayTable.Head>
            <OverlayTable.Row>
              <OverlayTable.HeadCell>Treinamento</OverlayTable.HeadCell>
              <OverlayTable.HeadCell>Competência</OverlayTable.HeadCell>
              <OverlayTable.HeadCell>Modalidade</OverlayTable.HeadCell>
              <OverlayTable.HeadCell align="right">Carga (h)</OverlayTable.HeadCell>
              <OverlayTable.HeadCell nowrap>Início</OverlayTable.HeadCell>
              <OverlayTable.HeadCell align="right">Participantes</OverlayTable.HeadCell>
              <OverlayTable.HeadCell>Status</OverlayTable.HeadCell>
              {canManage ? <OverlayTable.HeadCell align="right">Ações</OverlayTable.HeadCell> : null}
            </OverlayTable.Row>
          </OverlayTable.Head>
          <OverlayTable.Body>
            {list.map((t) => (
              <OverlayTable.Row key={t.id} data-testid="competency-training-row">
                <OverlayTable.Cell>
                  <span className="block font-semibold">{t.title}</span>
                  <span className="block text-xs text-muted-foreground">{validityLabel(t.validityMonths)}</span>
                </OverlayTable.Cell>
                <OverlayTable.Cell>{t.competencyName}</OverlayTable.Cell>
                <OverlayTable.Cell>{isTrainingModality(t.modality) ? TRAINING_MODALITY_LABELS[t.modality] : t.modality}</OverlayTable.Cell>
                <OverlayTable.Cell align="right" mono>
                  {t.workloadHours}
                </OverlayTable.Cell>
                <OverlayTable.Cell mono>{formatIsoDateBr(t.startDate)}</OverlayTable.Cell>
                <OverlayTable.Cell align="right" title={t.participants.map((p) => p.employeeName).join(", ")}>
                  {t.participants.length} {t.participants.length === 1 ? "pessoa" : "pessoas"}
                  {t.hasParticipantsOutsideScope ? (
                    <span className="block text-xs text-muted-foreground">Turma com outras equipes</span>
                  ) : null}
                </OverlayTable.Cell>
                <OverlayTable.Cell>
                  <span className="flex flex-col items-start gap-1">
                    <TrainingStatusBadge status={t.status} />
                    <button
                      type="button"
                      className={`${BTN_GHOST} -ml-2`}
                      onClick={() => onCertificates(t)}
                      data-testid="competency-training-certificates"
                    >
                      <Award className="h-3.5 w-3.5" aria-hidden />
                      Certificados{t.activeCertificateCount > 0 ? ` (${t.activeCertificateCount})` : ""}
                    </button>
                  </span>
                </OverlayTable.Cell>
                {canManage ? (
                  <OverlayTable.Cell align="right" nowrap>
                    {t.status !== "COMPLETED" && t.hasParticipantsOutsideScope ? (
                      <span className="text-xs text-muted-foreground" title="A turma tem participantes de outras equipes">
                        Gerida pelo RH
                      </span>
                    ) : t.status !== "COMPLETED" ? (
                      <span className="inline-flex gap-1">
                        {t.status === "SCHEDULED" ? (
                          <button type="button" className={BTN_GHOST} onClick={() => onStatus(t, "IN_PROGRESS")}>
                            Iniciar
                          </button>
                        ) : null}
                        <button type="button" className={BTN_GHOST} onClick={() => onStatus(t, "COMPLETED")}>
                          Concluir
                        </button>
                        <button type="button" className={`${BTN_GHOST} text-rose-700 hover:bg-rose-50`} onClick={() => onDelete(t)}>
                          Excluir
                        </button>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Concluído em {formatIsoDateBr(t.completedOn)}</span>
                    )}
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
