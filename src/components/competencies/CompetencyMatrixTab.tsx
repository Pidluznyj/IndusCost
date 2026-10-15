import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2 } from "lucide-react";
import {
  COMPETENCY_LEVEL_DESCRIPTIONS,
  COMPETENCY_LEVEL_LABELS,
  COMPETENCY_LEVELS,
  competencyCategoryLabel,
  competencyLevelLabel,
  formatIsoDateBr,
} from "@/src/lib/competencies/competencyDomain";
import type { CompetencyMatrixResponse } from "@/src/lib/competencies/competencyTypes";

type CompetencyMatrixRow = CompetencyMatrixResponse["rows"][number];
import { cn } from "@/src/lib/utils";
import type { Slice } from "./useCompetencyWorkspace";
import { LevelChip, PANEL, PanelState, levelToneClass } from "./competencyUi";

type OpenCell = { row: CompetencyMatrixRow; cell: CompetencyMatrixRow["cells"][number]; competencyName: string; rect: DOMRect };

function cellTitle(row: CompetencyMatrixRow, competencyName: string, cell: CompetencyMatrixRow["cells"][number]): string {
  const parts = [`${row.employeeName} · ${competencyName}: ${competencyLevelLabel(cell.level)}`];
  if (cell.pending) parts.push(`— aguardando aprovação para ${cell.pending.toLevel}`);
  if (cell.requiredLevel !== null) parts.push(`(mínimo ${cell.requiredLevel})`);
  if (cell.recycling === "EXPIRED") {
    parts.push(`— reciclagem vencida em ${formatIsoDateBr(cell.recyclingExpiresOn)}; nível registrado ${cell.storedLevel}`);
  }
  return parts.join(" ");
}

/** Popover com os 5 níveis (edição persistida com histórico no servidor). */
function LevelPopover({
  open,
  onPick,
  onClose,
  saving,
}: {
  open: OpenCell;
  onPick: (level: number) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLButtonElement>("button[aria-checked='true'], button")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const width = 248;
  const left = Math.max(8, Math.min(open.rect.left, window.innerWidth - width - 8));
  const below = open.rect.bottom + 6;
  const top = below + 230 > window.innerHeight ? Math.max(8, open.rect.top - 236) : below;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Nível de ${open.row.employeeName} em ${open.competencyName}`}
      data-testid="competency-level-popover"
      className="fixed z-[105] rounded-xl border border-border bg-popover p-1.5 shadow-lg"
      style={{ top, left, width }}
    >
      <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {open.competencyName}
        {open.cell.requiredLevel !== null ? ` · mín. ${open.cell.requiredLevel}` : ""}
      </p>
      <div role="radiogroup">
        {COMPETENCY_LEVELS.map((n) => {
          const on = open.cell.storedLevel === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={saving}
              onClick={() => onPick(n)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-muted disabled:opacity-60"
            >
              <span className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold", levelToneClass(n))}>
                {n || "—"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{COMPETENCY_LEVEL_LABELS[n]}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{COMPETENCY_LEVEL_DESCRIPTIONS[n]}</span>
              </span>
              {on ? saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4 text-primary" aria-hidden /> : null}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

/** Matriz: linhas = colaboradores, colunas = competências; 1ª coluna fixa; contorno vermelho abaixo do mínimo. */
export function CompetencyMatrixTab({
  matrix,
  canEdit,
  onSetLevel,
  onRetry,
}: {
  matrix: Slice<CompetencyMatrixResponse>;
  canEdit: boolean;
  onSetLevel: (employeeId: string, competencyId: string, level: number, expectedVersion: number) => Promise<void>;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState<OpenCell | null>(null);
  const [saving, setSaving] = useState(false);
  const data = matrix.data;

  if (matrix.status === "error" && !data) {
    return <PanelState kind="error" message={matrix.message} onRetry={onRetry} testId="competency-matrix-error" />;
  }
  if (!data) return <PanelState kind="loading" message="Carregando matriz…" />;
  if (data.competencies.length === 0 || data.rows.length === 0) {
    return (
      <div className={PANEL}>
        <PanelState
          kind="empty"
          testId="competency-matrix-empty"
          message={
            data.competencies.length === 0
              ? "Nenhuma competência cadastrada. Use + Competência para criar a primeira coluna."
              : "Nenhum colaborador alocado em posto. Defina a equipe na aba Postos de trabalho."
          }
        />
      </div>
    );
  }

  const pick = async (level: number) => {
    if (!open) return;
    setSaving(true);
    try {
      await onSetLevel(open.row.employeeId, open.cell.competencyId, level, open.cell.version);
      setOpen(null);
    } finally {
      setSaving(false);
    }
  };

  const names = new Map(data.competencies.map((c) => [c.id, c.name]));

  return (
    <section className={PANEL} data-testid="competency-matrix">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" aria-label="Legenda dos níveis">
          {([1, 2, 3, 4] as const).map((n) => (
            <span key={n} className="inline-flex items-center gap-1.5">
              <LevelChip level={n} /> {COMPETENCY_LEVEL_LABELS[n]}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-4 w-4 rounded ring-2 ring-inset ring-rose-500" aria-hidden /> Abaixo do mínimo
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{canEdit ? "Clique na célula para alterar o nível" : "Somente leitura"}</p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm" style={{ minWidth: 150 + data.competencies.length * 110 }}>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 w-[150px] min-w-[150px] border-b sm:w-[220px] sm:min-w-[220px] border-r border-border bg-card px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">
                Colaborador
              </th>
              {data.competencies.map((c) => (
                <th key={c.id} scope="col" className="min-w-[104px] border-b border-border px-2 py-2.5 text-center align-bottom">
                  <span className="block text-xs font-semibold leading-tight text-foreground">{c.name}</span>
                  <span className="block text-[11px] font-normal text-muted-foreground">
                    {competencyCategoryLabel(c.category)}
                    {c.critical ? <span className="ml-1 font-semibold text-rose-700" title="Competência crítica">· Crítica</span> : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.employeeId} data-testid="competency-matrix-row">
                <th scope="row" className="sticky left-0 z-10 border-b border-r border-border bg-card px-4 py-2 text-left font-normal">
                  <span className="block truncate text-sm font-semibold">{row.employeeName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{row.positionName ?? "Sem posto"}</span>
                </th>
                {row.cells.map((cell) => {
                  const competencyName = names.get(cell.competencyId) ?? "";
                  const content = (
                    <>
                      <span className="text-sm font-bold tabular-nums">{cell.level > 0 ? cell.level : "—"}</span>
                      {cell.requiredLevel !== null ? <span className="text-[10px] font-medium opacity-80">mín. {cell.requiredLevel}</span> : null}
                      {cell.pending ? (
                        <span className="text-[10px] font-semibold text-amber-800" data-testid="competency-matrix-pending">
                          aprovação → {cell.pending.toLevel}
                        </span>
                      ) : null}
                    </>
                  );
                  const cls = cn(
                    "mx-auto flex h-11 w-full max-w-[96px] flex-col items-center justify-center rounded-lg",
                    levelToneClass(cell.level),
                    cell.belowMinimum && "ring-2 ring-inset ring-rose-500",
                    cell.recycling === "EXPIRED" && "underline decoration-dotted",
                  );
                  return (
                    <td key={cell.competencyId} className="border-b border-border/70 px-1.5 py-1.5">
                      {canEdit && row.writable ? (
                        <button
                          type="button"
                          className={cn(cls, "transition-shadow hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary")}
                          title={cellTitle(row, competencyName, cell)}
                          data-below-minimum={cell.belowMinimum || undefined}
                          data-testid="competency-matrix-cell"
                          onClick={(e) => setOpen({ row, cell, competencyName, rect: e.currentTarget.getBoundingClientRect() })}
                        >
                          {content}
                        </button>
                      ) : (
                        <div className={cls} title={cellTitle(row, competencyName, cell)} data-below-minimum={cell.belowMinimum || undefined} data-testid="competency-matrix-cell">
                          {content}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open ? <LevelPopover open={open} onPick={pick} onClose={() => !saving && setOpen(null)} saving={saving} /> : null}
    </section>
  );
}
