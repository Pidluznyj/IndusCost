import React, { useEffect, useState } from "react";
import { OverlayField, OverlayFieldGrid, OverlayInput, OverlaySelect } from "@/src/components/ui/overlay";
import { createTraining } from "@/src/lib/competencies/competencyClient";
import { TRAINING_MODALITIES, TRAINING_MODALITY_LABELS, type TrainingModality } from "@/src/lib/competencies/competencyDomain";
import type { CompetencyDto, CompetencyMatrixResponse } from "@/src/lib/competencies/competencyTypes";

type CompetencyMatrixRow = CompetencyMatrixResponse["rows"][number];
import { CompetencyModalFrame } from "./CompetencyModalFrame";
import { ChipToggle, SegmentedControl } from "./competencyUi";

export type TrainingPreset = { competencyId?: string; title?: string; participantIds?: string[] };

const MODALITY_OPTIONS = TRAINING_MODALITIES.map((m) => ({ value: m, label: TRAINING_MODALITY_LABELS[m] }));

/** Novo treinamento — nasce "Agendado". Participantes são os colaboradores graváveis do escopo. */
export function CompetencyTrainingOverlay({
  open,
  preset,
  today,
  rows,
  competencies,
  onClose,
  onSaved,
}: {
  open: boolean;
  preset: TrainingPreset | null;
  today: string;
  rows: CompetencyMatrixRow[];
  competencies: CompetencyDto[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [competencyId, setCompetencyId] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [workload, setWorkload] = useState("8");
  const [validity, setValidity] = useState("12");
  const [modality, setModality] = useState<TrainingModality>("IN_PERSON");
  const [participants, setParticipants] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setTitle(preset?.title ?? "");
    setCompetencyId(preset?.competencyId ?? competencies[0]?.id ?? "");
    setStartDate(today);
    setWorkload("8");
    setValidity("12");
    setModality("IN_PERSON");
    setParticipants(preset?.participantIds ?? []);
  }, [open, preset, competencies, today]);

  const workloadHours = Number(workload);
  const validityMonths = Number(validity);
  const numbersOk =
    Number.isInteger(workloadHours) && workloadHours >= 0 && Number.isInteger(validityMonths) && validityMonths >= 0;
  const canSave = Boolean(title.trim() && competencyId && startDate && participants.length > 0 && numbersOk);

  const eligible = rows.filter((r) => r.writable);
  const toggle = (id: string) =>
    setParticipants((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const save = async () => {
    await createTraining({
      title: title.trim(),
      competencyId,
      modality,
      workloadHours,
      startDate,
      validityMonths,
      participantIds: participants,
    });
    onSaved("Treinamento agendado");
  };

  return (
    <CompetencyModalFrame
      open={open}
      testId="competency-training-overlay"
      title="Novo treinamento"
      subtitle="Turma vinculada a uma competência da matriz"
      saveLabel="Agendar treinamento"
      footerHint={`${participants.length} participante(s)`}
      canSave={canSave}
      onSave={save}
      onClose={onClose}
    >
      <OverlayField label="Título" required>
        {(p) => <OverlayInput {...p} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} data-testid="training-title" />}
      </OverlayField>
      <OverlayFieldGrid columns={2}>
        <OverlayField label="Competência" required>
          {(p) => (
            <OverlaySelect {...p} value={competencyId} onChange={(e) => setCompetencyId(e.target.value)} data-testid="training-competency">
              {competencies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </OverlaySelect>
          )}
        </OverlayField>
        <OverlayField label="Data de início" required>
          {(p) => <OverlayInput {...p} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}
        </OverlayField>
        <OverlayField label="Carga horária (h)" required>
          {(p) => <OverlayInput {...p} type="number" min={0} step={1} value={workload} onChange={(e) => setWorkload(e.target.value)} />}
        </OverlayField>
        <OverlayField label="Validade (meses)" description="0 = sem validade">
          {(p) => <OverlayInput {...p} type="number" min={0} step={1} value={validity} onChange={(e) => setValidity(e.target.value)} />}
        </OverlayField>
      </OverlayFieldGrid>
      <div>
        <p className="mb-1.5 text-xs font-semibold">Modalidade</p>
        <SegmentedControl ariaLabel="Modalidade" options={MODALITY_OPTIONS} value={modality} onChange={setModality} testId="training-modality" />
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold">
          Participantes
        </p>
        {eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum colaborador na sua equipe.</p>
        ) : (
          <div className="flex flex-wrap gap-2" data-testid="training-participants">
            {eligible.map((r) => (
              <ChipToggle
                key={r.employeeId}
                label={r.employeeName}
                selected={participants.includes(r.employeeId)}
                onToggle={() => toggle(r.employeeId)}
              />
            ))}
          </div>
        )}
      </div>
    </CompetencyModalFrame>
  );
}
