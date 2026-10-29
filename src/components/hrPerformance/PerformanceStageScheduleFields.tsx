/**
 * Calendário das etapas na criação e na edição do ciclo: início e fim de cada etapa. O fim da autoavaliação e o
 * do líder são os prazos que o ciclo já tinha. A conferência é a mesma do servidor (stageScheduleProblem).
 */
import React from "react";
import { OverlayField, OverlayFieldGrid, OverlayInput } from "@/src/components/ui/overlay";
import { STAGE_LABELS, stageScheduleProblem } from "@/src/lib/hrPerformance/performanceStages";

export type StageScheduleForm = {
  selfStartAt: string;
  selfDueAt: string;
  leaderStartAt: string;
  leaderDueAt: string;
  leadershipStartAt: string;
  leadershipDueAt: string;
  calibrationStartAt: string;
  calibrationDueAt: string;
};

export function scheduleFormOf(cycle: Partial<Record<keyof StageScheduleForm, string | null>> | null): StageScheduleForm {
  return {
    selfStartAt: cycle?.selfStartAt ?? "",
    selfDueAt: cycle?.selfDueAt ?? "",
    leaderStartAt: cycle?.leaderStartAt ?? "",
    leaderDueAt: cycle?.leaderDueAt ?? "",
    leadershipStartAt: cycle?.leadershipStartAt ?? "",
    leadershipDueAt: cycle?.leadershipDueAt ?? "",
    calibrationStartAt: cycle?.calibrationStartAt ?? "",
    calibrationDueAt: cycle?.calibrationDueAt ?? "",
  };
}

/** Problema do calendário (texto para a pessoa) ou null. Sem nenhuma data de início, vale o ciclo só com prazos. */
export function scheduleFormProblem(form: StageScheduleForm, leadership: boolean): string | null {
  if (!form.selfDueAt || !form.leaderDueAt) return "Informe o fim da autoavaliação e o da avaliação do líder.";
  const nul = (v: string) => (v.trim() ? v : null);
  return stageScheduleProblem(
    {
      selfStartAt: nul(form.selfStartAt),
      selfDueAt: form.selfDueAt,
      leaderStartAt: nul(form.leaderStartAt),
      leaderDueAt: form.leaderDueAt,
      leadershipStartAt: leadership ? nul(form.leadershipStartAt) : null,
      leadershipDueAt: leadership ? nul(form.leadershipDueAt) : null,
      calibrationStartAt: nul(form.calibrationStartAt),
      calibrationDueAt: nul(form.calibrationDueAt),
    },
    leadership
  );
}

/** Corpo para a API: vazio vira null (limpa o calendário). Sem liderança, as datas dela não vão. */
export function scheduleBodyOf(form: StageScheduleForm, leadership: boolean) {
  const nul = (v: string) => (v.trim() ? v : null);
  return {
    selfDueAt: form.selfDueAt,
    leaderDueAt: form.leaderDueAt,
    selfStartAt: nul(form.selfStartAt),
    leaderStartAt: nul(form.leaderStartAt),
    leadershipStartAt: leadership ? nul(form.leadershipStartAt) : null,
    leadershipDueAt: leadership ? nul(form.leadershipDueAt) : null,
    calibrationStartAt: nul(form.calibrationStartAt),
    calibrationDueAt: nul(form.calibrationDueAt),
  };
}

export function PerformanceStageScheduleFields({ value, leadership, onChange }: { value: StageScheduleForm; leadership: boolean; onChange: (next: StageScheduleForm) => void }) {
  const rows: { key: string; label: string; who: string; start: keyof StageScheduleForm; end: keyof StageScheduleForm }[] = [
    { key: "SELF", ...STAGE_LABELS.SELF, start: "selfStartAt", end: "selfDueAt" },
    { key: "LEADER", ...STAGE_LABELS.LEADER, start: "leaderStartAt", end: "leaderDueAt" },
    ...(leadership ? [{ key: "LEADERSHIP", ...STAGE_LABELS.LEADERSHIP, start: "leadershipStartAt" as const, end: "leadershipDueAt" as const }] : []),
    { key: "CALIBRATION", ...STAGE_LABELS.CALIBRATION, start: "calibrationStartAt", end: "calibrationDueAt" },
  ];
  const problem = scheduleFormProblem(value, leadership);
  return (
    <div className="space-y-3" data-testid="perf-stage-schedule">
      <p className="text-xs text-muted-foreground">
        Cada etapa só aceita respostas entre o início e o fim (dias inclusivos). Deixe as datas de início em branco para manter tudo aberto até os prazos, como nos ciclos anteriores.
      </p>
      {rows.map((row, index) => (
        <div key={row.key} className="rounded-lg border border-border p-3" data-testid={`perf-stage-row-${row.key}`}>
          <p className="text-sm font-semibold">
            {index + 1}. {row.label}
          </p>
          <p className="mb-2 text-xs text-muted-foreground">{row.who}</p>
          <OverlayFieldGrid columns={2}>
            <OverlayField label="Início">
              {(p) => <OverlayInput {...p} type="date" value={value[row.start]} onChange={(e) => onChange({ ...value, [row.start]: e.target.value })} data-testid={`perf-stage-${row.key}-start`} />}
            </OverlayField>
            <OverlayField label="Fim" required={row.key === "SELF" || row.key === "LEADER"}>
              {(p) => <OverlayInput {...p} type="date" value={value[row.end]} onChange={(e) => onChange({ ...value, [row.end]: e.target.value })} data-testid={`perf-stage-${row.key}-end`} />}
            </OverlayField>
          </OverlayFieldGrid>
        </div>
      ))}
      {problem ? (
        <p className="text-sm text-amber-700" role="alert" data-testid="perf-stage-schedule-problem">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
