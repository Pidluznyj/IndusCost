import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { OverlayInput } from "@/src/components/ui/overlay";
import {
  CERTIFICATE_SYLLABUS_MAX_MODULES,
  CERTIFICATE_SYLLABUS_TITLE_MAX,
  formatHoursShort,
  parseSyllabus,
  syllabusMatchesWorkload,
  syllabusTotalHours,
  type SyllabusModule,
} from "@/src/lib/competencies/trainingCertificate";
import { BTN_GHOST } from "../competencyUi";

export type SyllabusDraftRow = { key: string; title: string; hours: string };

let seq = 0;
const nextKey = () => `m${++seq}`;

export function syllabusToDraft(modules: readonly SyllabusModule[]): SyllabusDraftRow[] {
  return modules.map((m) => ({ key: nextKey(), title: m.title, hours: String(m.hours).replace(".", ",") }));
}

/** Soma das horas já digitadas (ignora campos inválidos) — só para o indicador. */
function draftTotalHours(rows: readonly SyllabusDraftRow[]): number {
  const tenths = rows.reduce((sum, r) => {
    const n = Number(r.hours.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? sum + Math.round(n * 10) : sum;
  }, 0);
  return tenths / 10;
}

/** Rascunho → módulos validados (mesmas regras do servidor). */
export function draftToSyllabus(
  rows: readonly SyllabusDraftRow[],
  workloadHours: number,
): { ok: true; value: SyllabusModule[] } | { ok: false; message: string } {
  const filled = rows.filter((r) => r.title.trim() !== "" || r.hours.trim() !== "");
  const parsed = parseSyllabus(filled.map((r) => ({ title: r.title, hours: r.hours })));
  if (parsed.ok === false) return { ok: false, message: parsed.message };
  if (!syllabusMatchesWorkload(parsed.value, workloadHours)) {
    return {
      ok: false,
      message: `A soma dos módulos (${formatHoursShort(syllabusTotalHours(parsed.value))}) precisa ser igual à carga horária (${formatHoursShort(workloadHours)}).`,
    };
  }
  return { ok: true, value: parsed.value };
}

/**
 * Conteúdo programático do certificado: módulos com carga em horas (passos de 0,5 h).
 * Sem módulos, o certificado mostra a competência desenvolvida.
 */
export function TrainingSyllabusEditor({
  rows,
  onChange,
  workloadHours,
  disabled = false,
}: {
  rows: SyllabusDraftRow[];
  onChange: (rows: SyllabusDraftRow[]) => void;
  workloadHours: number;
  disabled?: boolean;
}) {
  const check = draftToSyllabus(rows, workloadHours);
  const filled = rows.filter((r) => r.title.trim() !== "" || r.hours.trim() !== "");
  const update = (key: string, patch: Partial<SyllabusDraftRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div data-testid="training-syllabus">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">
          Conteúdo programático <span className="font-normal text-muted-foreground">(opcional · aparece no certificado)</span>
        </p>
        {filled.length > 0 ? (
          <span
            className={`text-xs font-semibold ${check.ok ? "text-emerald-700" : "text-amber-700"}`}
            data-testid="training-syllabus-total"
          >
            Total {formatHoursShort(draftTotalHours(filled))} de {formatHoursShort(workloadHours)}
          </span>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem módulos: o certificado mostra a competência desenvolvida.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.key} className="grid grid-cols-[1.75rem_minmax(0,1fr)_6rem_2rem] items-center gap-2">
              <span className="text-right font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              <OverlayInput
                aria-label={`Módulo ${i + 1}`}
                placeholder="Título do módulo"
                value={r.title}
                maxLength={CERTIFICATE_SYLLABUS_TITLE_MAX}
                disabled={disabled}
                onChange={(e) => update(r.key, { title: e.target.value })}
              />
              <OverlayInput
                aria-label={`Horas do módulo ${i + 1}`}
                placeholder="h"
                inputMode="decimal"
                value={r.hours}
                disabled={disabled}
                onChange={(e) => update(r.key, { hours: e.target.value })}
              />
              <button
                type="button"
                className={`${BTN_GHOST} text-rose-700 hover:bg-rose-50`}
                aria-label={`Remover módulo ${i + 1}`}
                disabled={disabled}
                onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className={BTN_GHOST}
          disabled={disabled || rows.length >= CERTIFICATE_SYLLABUS_MAX_MODULES}
          onClick={() => onChange([...rows, { key: nextKey(), title: "", hours: "" }])}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Adicionar módulo
        </button>
        {filled.length > 0 && check.ok === false ? (
          <span className="text-xs text-amber-700" role="status">
            {check.message}
          </span>
        ) : null}
      </div>
    </div>
  );
}
