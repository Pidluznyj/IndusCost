import React, { useEffect, useMemo, useState } from "react";
import { OverlayField, OverlayFieldGrid, OverlayInput, OverlaySelect, OverlayTextarea } from "@/src/components/ui/overlay";
import { createAssessment, updateAssessment } from "@/src/lib/competencies/competencyClient";
import { competencyLevelLabel } from "@/src/lib/competencies/competencyDomain";
import type {
  CompetencyDto,
  CompetencyEmployeeOptionDto,
  CompetencyMatrixResponse,
} from "@/src/lib/competencies/competencyTypes";

type CompetencyMatrixRow = CompetencyMatrixResponse["rows"][number];
import { CompetencyModalFrame } from "./CompetencyModalFrame";
import { LevelButtons } from "./competencyUi";

export type AssessmentPreset = {
  /** Avaliação pendente/em andamento sendo concluída (ou reagendada). */
  assessmentId?: string;
  employeeId?: string;
  evaluatorEmployeeId?: string | null;
  assessmentDate?: string;
  notes?: string | null;
};

/**
 * Nova avaliação (conclui e atualiza os níveis) ou agendamento (pendente, sem níveis).
 * Escopo e nível atual vêm das células da matriz (saída da engine) — nada é recalculado aqui.
 */
export function CompetencyAssessmentOverlay({
  open,
  mode,
  preset,
  today,
  rows,
  competencies,
  evaluators,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: "complete" | "schedule";
  preset: AssessmentPreset | null;
  today: string;
  rows: CompetencyMatrixRow[];
  competencies: CompetencyDto[];
  evaluators: CompetencyEmployeeOptionDto[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [evaluatorId, setEvaluatorId] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [levels, setLevels] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!open) return;
    setEmployeeId(preset?.employeeId ?? rows.find((r) => r.positionId && r.writable)?.employeeId ?? "");
    setEvaluatorId(preset?.evaluatorEmployeeId ?? "");
    setDate(preset?.assessmentDate ?? today);
    setNotes(preset?.notes ?? "");
    setLevels({});
  }, [open, preset, rows, today]);

  const row = rows.find((r) => r.employeeId === employeeId) ?? null;
  const compName = useMemo(() => new Map(competencies.map((c) => [c.id, c.name])), [competencies]);
  const scope = useMemo(() => (row ? row.cells.filter((c) => c.requiredLevel !== null) : []), [row]);
  const lockedEmployee = Boolean(preset?.assessmentId);
  const scheduling = mode === "schedule";
  const allRated = scope.length > 0 && scope.every((c) => (levels[c.competencyId] ?? 0) >= 1);
  const canSave = Boolean(employeeId && date && (scheduling || (evaluatorId && allRated)));

  const changeEmployee = (id: string) => {
    setEmployeeId(id);
    setLevels({}); // trocar o colaborador limpa as notas
  };

  const save = async () => {
    const body = {
      employeeId,
      evaluatorEmployeeId: evaluatorId || null,
      assessmentDate: date,
      status: scheduling ? ("PENDING" as const) : ("COMPLETED" as const),
      notes: notes.trim() || null,
      items: scheduling ? [] : scope.map((c) => ({ competencyId: c.competencyId, level: levels[c.competencyId] })),
    };
    if (preset?.assessmentId) await updateAssessment(preset.assessmentId, body);
    else await createAssessment(body);
    onSaved(scheduling ? "Avaliação agendada" : "Avaliação registrada e matriz atualizada");
  };

  return (
    <CompetencyModalFrame
      open={open}
      testId="competency-assessment-overlay"
      title={scheduling ? "Agendar avaliação" : "Nova avaliação de competência"}
      subtitle={
        scheduling
          ? "A avaliação fica pendente até o registro dos níveis"
          : "Registre o nível observado em cada competência exigida pelo posto"
      }
      saveLabel={scheduling ? "Agendar avaliação" : "Salvar avaliação"}
      footerHint={scheduling ? "Conta como avaliação pendente" : "Os níveis salvos atualizam a matriz"}
      canSave={canSave}
      onSave={save}
      onClose={onClose}
    >
      <OverlayFieldGrid columns={2}>
        <OverlayField label="Colaborador" required>
          {(p) => (
            <OverlaySelect {...p} value={employeeId} disabled={lockedEmployee} onChange={(e) => changeEmployee(e.target.value)} data-testid="assessment-employee">
              <option value="">Selecione…</option>
              {rows.map((r) => (
                <option key={r.employeeId} value={r.employeeId} disabled={!r.positionId || !r.writable}>
                  {r.employeeName}
                  {!r.writable ? " (fora da sua equipe)" : r.positionId ? "" : " (sem posto)"}
                </option>
              ))}
            </OverlaySelect>
          )}
        </OverlayField>
        <OverlayField label="Data" required>
          {(p) => <OverlayInput {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="assessment-date" />}
        </OverlayField>
        <OverlayField label="Avaliador" required={!scheduling}>
          {(p) => (
            <OverlaySelect {...p} value={evaluatorId} onChange={(e) => setEvaluatorId(e.target.value)} data-testid="assessment-evaluator">
              <option value="">Selecione…</option>
              {evaluators
                .filter((e) => e.id !== employeeId)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </OverlaySelect>
          )}
        </OverlayField>
        <OverlayField label="Posto" description="Derivado da alocação do colaborador">
          {(p) => <OverlayInput {...p} value={row?.positionName ?? "—"} readOnly disabled />}
        </OverlayField>
      </OverlayFieldGrid>

      {scheduling ? null : (
        <section aria-label="Níveis por competência" data-testid="assessment-levels">
          <p className="mb-1.5 text-xs font-semibold text-foreground">
            Competências exigidas pelo posto <span className="font-normal text-muted-foreground">· 1 a 4</span>
          </p>
          {scope.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
              {row ? "O posto deste colaborador não exige competências." : "Selecione um colaborador com posto."}
            </p>
          ) : (
            <ul className="divide-y divide-border/70 border-t border-border/70">
              {scope.map((cell) => (
                <li key={cell.competencyId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{compName.get(cell.competencyId) ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      mín. {cell.requiredLevel} · atual: {competencyLevelLabel(cell.level)}
                    </p>
                  </div>
                  <LevelButtons
                    from={1}
                    value={levels[cell.competencyId] ?? 0}
                    onChange={(n) => setLevels((prev) => ({ ...prev, [cell.competencyId]: n }))}
                    ariaLabel={`Nível em ${compName.get(cell.competencyId) ?? "competência"}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <OverlayField label="Observações">
        {(p) => <OverlayTextarea {...p} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </OverlayField>
    </CompetencyModalFrame>
  );
}
