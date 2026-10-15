import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Maximize2 } from "lucide-react";
import {
  COMPETENCY_LEVEL_DESCRIPTIONS,
  COMPETENCY_LEVEL_LABELS,
  COMPETENCY_LEVELS,
} from "@/src/lib/competencies/competencyDomain";
import type { CompetencyDepartmentOptionDto, CompetencyMatrixResponse } from "@/src/lib/competencies/competencyTypes";
import { cn } from "@/src/lib/utils";
import { CompetencyMatrixFullscreen } from "./CompetencyMatrixFullscreen";
import { MatrixLevelLegend, type MatrixOpenCell } from "./CompetencyMatrixGrid";
import { groupMatrixCompetencies } from "./competencyMatrixGroups";
import type { Slice } from "./useCompetencyWorkspace";
import { BTN_PRIMARY, PANEL, levelToneClass } from "./competencyUi";

function LevelPopover({
  open,
  onPick,
  onClose,
  saving,
}: {
  open: MatrixOpenCell;
  onPick: (level: number) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    ref.current?.querySelector<HTMLButtonElement>("button[aria-checked='true'], button")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
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
      className="fixed z-[120] rounded-xl border border-border bg-popover p-1.5 shadow-lg"
      style={{ top, left, width }}
    >
      <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {open.competencyName}
      </p>
      <div role="radiogroup">
        {COMPETENCY_LEVELS.map((level) => {
          const selected = open.cell.storedLevel === level;
          return (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={saving}
              onClick={() => onPick(level)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-muted disabled:opacity-60"
            >
              <span className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold", levelToneClass(level))}>
                {level || "—"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{COMPETENCY_LEVEL_LABELS[level]}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{COMPETENCY_LEVEL_DESCRIPTIONS[level]}</span>
              </span>
              {selected ? saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4 text-primary" aria-hidden /> : null}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

/** Aba da matriz: resumo na página e a grade só na modal de tela cheia. */
export function CompetencyMatrixTab({
  matrix,
  canEdit,
  onSetLevel,
  onRetry,
  departmentId,
  departments,
  shifts,
  onDepartmentChange,
  onToggleShift,
  expandedKeys,
  onExpandedKeysChange,
}: {
  matrix: Slice<CompetencyMatrixResponse>;
  canEdit: boolean;
  onSetLevel: (employeeId: string, competencyId: string, level: number, expectedVersion: number) => Promise<void>;
  onRetry: () => void;
  departmentId: string;
  departments: readonly CompetencyDepartmentOptionDto[];
  shifts: readonly string[];
  onDepartmentChange: (departmentId: string) => void;
  onToggleShift: (shift: string) => void;
  expandedKeys: readonly string[];
  onExpandedKeysChange: (keys: string[]) => void;
}) {
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState<MatrixOpenCell | null>(null);
  const [saving, setSaving] = useState(false);
  const data = matrix.data;
  const expanded = useMemo(() => new Set(expandedKeys), [expandedKeys]);
  const groups = useMemo(() => groupMatrixCompetencies(data?.competencies ?? []), [data?.competencies]);

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

  const toggleGroup = (key: string) => {
    onExpandedKeysChange(expanded.has(key) ? expandedKeys.filter((item) => item !== key) : [...expandedKeys, key]);
  };

  return (
    <section className={PANEL} data-testid="competency-matrix">
      <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h3 className="text-sm font-semibold">Matriz de competências</h3>
          <p className="max-w-2xl text-sm text-muted-foreground">
            A grade abre em tela cheia, com rolagem própria. As categorias do catálogo recolhem e expandem as colunas. O departamento filtra colaboradores e o turno filtra competências configuradas.
          </p>
          {data ? (
            <p className="text-sm font-medium text-foreground" data-testid="competency-matrix-summary">
              {data.rows.length} colaboradores · {data.competencies.length} competências · {groups.length} categorias
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{matrix.status === "error" ? matrix.message : "Carregando matriz…"}</p>
          )}
          <MatrixLevelLegend />
        </div>
        <button
          ref={openButtonRef}
          type="button"
          className={BTN_PRIMARY}
          aria-haspopup="dialog"
          aria-expanded={fullscreen}
          data-testid="competency-matrix-open-fullscreen"
          onClick={() => {
            setAnchor(openButtonRef.current);
            setFullscreen(true);
          }}
        >
          <Maximize2 className="h-4 w-4" aria-hidden />
          Abrir matriz em tela cheia
        </button>
      </div>
      <CompetencyMatrixFullscreen
        open={fullscreen}
        onClose={() => setFullscreen(false)}
        matrix={matrix}
        canEdit={canEdit}
        expandedKeys={expanded}
        onToggleGroup={toggleGroup}
        onExpandAll={() => onExpandedKeysChange([...new Set([...expandedKeys, ...groups.map((group) => group.key)])])}
        onCollapseAll={() => onExpandedKeysChange([])}
        onOpenCell={setOpen}
        onRetry={onRetry}
        departmentId={departmentId}
        departments={departments}
        shifts={shifts}
        onDepartmentChange={onDepartmentChange}
        onToggleShift={onToggleShift}
        anchor={anchor}
      />
      {open ? <LevelPopover open={open} onPick={(level) => void pick(level)} onClose={() => !saving && setOpen(null)} saving={saving} /> : null}
    </section>
  );
}
