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
 * Nova avaliação ou agendamento. O departamento só sugere competências;
 * o avaliador escolhe quais registrar. Não há nível mínimo.
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
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [addId, setAddId] = useState("");

  useEffect(() => {
    if (!open) return;
    setEmployeeId(preset?.employeeId ?? rows.find((r) => r.writable)?.employeeId ?? "");
    setEvaluatorId(preset?.evaluatorEmployeeId ?? "");
    setDate(preset?.assessmentDate ?? today);
    setNotes(preset?.notes ?? "");
    setLevels({});
    setExtraIds([]);
    setAddId("");
  }, [open, preset, rows, today]);

  const row = rows.find((r) => r.employeeId === employeeId) ?? null;
  const compName = useMemo(() => new Map(competencies.map((c) => [c.id, c.name])), [competencies]);
  const shownIds = useMemo(() => {
    const ids = [...(row?.linkedCompetencyIds ?? [])];
    for (const id of extraIds) if (!ids.includes(id)) ids.push(id);
    return ids;
  }, [row, extraIds]);
  const cellOf = useMemo(() => new Map(row?.cells.map((c) => [c.competencyId, c]) ?? []), [row]);
  const available = competencies.filter((c) => !shownIds.includes(c.id));
  const rated = shownIds.filter((id) => (levels[id] ?? 0) >= 1);
  const lockedEmployee = Boolean(preset?.assessmentId);
  const scheduling = mode === "schedule";
  const canSave = Boolean(employeeId && date && (scheduling || (evaluatorId && rated.length > 0)));

  const changeEmployee = (id: string) => {
    setEmployeeId(id);
    setLevels({});
    setExtraIds([]);
    setAddId("");
  };

  const save = async () => {
    const body = {
      employeeId,
      evaluatorEmployeeId: evaluatorId || null,
      assessmentDate: date,
      status: scheduling ? ("PENDING" as const) : ("COMPLETED" as const),
      notes: notes.trim() || null,
      items: scheduling ? [] : rated.map((id) => ({ competencyId: id, level: levels[id] })),
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
          : "Registre as competências observadas. Não é obrigatório avaliar todas as do departamento."
      }
      saveLabel={scheduling ? "Agendar avaliação" : "Salvar avaliação"}
      footerHint={scheduling ? "Conta como avaliação pendente" : "Os níveis salvos atualizam a matriz e o histórico"}
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
                <option key={r.employeeId} value={r.employeeId} disabled={!r.writable}>
                  {r.employeeName}
                  {!r.writable ? " (fora da sua equipe)" : ""}
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
        <OverlayField label="Departamento" description="Contexto organizacional do colaborador">
          {(p) => <OverlayInput {...p} value={row?.departmentName ?? "Sem departamento"} readOnly disabled />}
        </OverlayField>
      </OverlayFieldGrid>

      {scheduling ? null : (
        <section aria-label="Níveis por competência" data-testid="assessment-levels">
          <p className="mb-1.5 text-xs font-semibold text-foreground">
            Competências <span className="font-normal text-muted-foreground">· as do departamento aparecem primeiro; inclua outras se quiser</span>
          </p>
          {shownIds.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
              {row ? "Este departamento ainda não tem competências associadas. Inclua uma abaixo." : "Selecione um colaborador."}
            </p>
          ) : (
            <ul className="divide-y divide-border/70 border-t border-border/70">
              {shownIds.map((id) => {
                const cell = cellOf.get(id);
                const fromDepartment = row?.linkedCompetencyIds.includes(id) ?? false;
                return (
                  <li key={id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{compName.get(id) ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {fromDepartment ? "Do departamento" : "Outro departamento"}
                        {cell ? ` · atual: ${competencyLevelLabel(cell.level)}` : ""}
                      </p>
                    </div>
                    <LevelButtons
                      from={1}
                      value={levels[id] ?? 0}
                      onChange={(n) => setLevels((prev) => ({ ...prev, [id]: n }))}
                      ariaLabel={`Nível em ${compName.get(id) ?? "competência"}`}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          {row && available.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                value={addId}
                onChange={(e) => setAddId(e.target.value)}
                className="h-9 min-w-[12rem] flex-1 rounded-md border border-border bg-background px-2 text-sm"
                aria-label="Incluir competência"
                data-testid="assessment-add-competency"
              >
                <option value="">Incluir outra competência…</option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="h-9 rounded-md border border-border px-3 text-sm font-medium disabled:opacity-50"
                disabled={!addId}
                onClick={() => {
                  if (!addId) return;
                  setExtraIds((prev) => (prev.includes(addId) ? prev : [...prev, addId]));
                  setAddId("");
                }}
              >
                Incluir
              </button>
            </div>
          ) : null}
        </section>
      )}

      <OverlayField label="Observações">
        {(p) => <OverlayTextarea {...p} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </OverlayField>
    </CompetencyModalFrame>
  );
}
