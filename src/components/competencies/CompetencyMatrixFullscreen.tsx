import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronsLeftRight, ChevronsRightLeft, Grid3x3, Layers, Users, X } from "lucide-react";
import { competencyShiftLabel } from "@/src/lib/competencies/competencyDomain";
import type { CompetencyDepartmentOptionDto, CompetencyMatrixResponse } from "@/src/lib/competencies/competencyTypes";
import { CompetencyMatrixGrid, MatrixLevelLegend, type MatrixOpenCell } from "./CompetencyMatrixGrid";
import type { MatrixCompetencyGroup, MatrixGroupMode } from "./competencyMatrixGroups";
import { CompetencyViewFilters } from "./CompetencyViewFilters";
import { cn } from "@/src/lib/utils";
import { BTN_GHOST, BTN_SECONDARY } from "./competencyUi";

type MatrixSlice = {
  status: "loading" | "ready" | "error";
  data: CompetencyMatrixResponse | null;
  message?: string;
};

function lockPageScroll(anchor: HTMLElement | null): () => void {
  const scroller = anchor?.closest("main")?.querySelector<HTMLElement>(":scope > div.overflow-y-auto") ?? null;
  const bodyOverflow = document.body.style.overflow;
  const scrollerOverflow = scroller?.style.overflow ?? "";
  const scrollTop = scroller?.scrollTop ?? 0;
  document.body.style.overflow = "hidden";
  if (scroller) scroller.style.overflow = "hidden";
  return () => {
    document.body.style.overflow = bodyOverflow;
    if (scroller) {
      scroller.style.overflow = scrollerOverflow;
      scroller.scrollTop = scrollTop;
    }
  };
}

function SummaryPill({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-[16rem] items-center gap-1.5 truncate rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs font-medium text-foreground">
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

/**
 * Modal de tela cheia no mesmo desenho do Kanban de pedidos:
 * portal, dialog, trava da rolagem da página e Escape na fase de bubble
 * (um diálogo acima, em capture, fecha primeiro).
 */
export function CompetencyMatrixFullscreen({
  open,
  onClose,
  matrix,
  canEdit,
  expandedKeys,
  onToggleGroup,
  onExpandAll,
  onCollapseAll,
  onOpenCell,
  onRetry,
  departmentId,
  departments,
  shifts,
  onDepartmentChange,
  onToggleShift,
  anchor,
  groups,
  groupingStatus,
  groupingMessage,
  groupMode,
  onGroupModeChange,
}: {
  open: boolean;
  onClose: () => void;
  matrix: MatrixSlice;
  canEdit: boolean;
  expandedKeys: ReadonlySet<string>;
  onToggleGroup: (key: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onOpenCell: (open: MatrixOpenCell) => void;
  onRetry: () => void;
  departmentId: string;
  departments: readonly CompetencyDepartmentOptionDto[];
  shifts: readonly string[];
  onDepartmentChange: (departmentId: string) => void;
  onToggleShift: (shift: string) => void;
  anchor: HTMLElement | null;
  groups: readonly MatrixCompetencyGroup<CompetencyMatrixResponse["competencies"][number]>[];
  groupingStatus: "loading" | "ready" | "error";
  groupingMessage?: string;
  groupMode: MatrixGroupMode;
  onGroupModeChange: (mode: MatrixGroupMode) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const unlock = lockPageScroll(anchor);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      unlock();
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      const scroller = scrollRef.current;
      if (scroller && event.target instanceof Node && scroller.contains(event.target)) return;
      event.preventDefault();
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [open]);

  if (!open) return null;

  const data = matrix.data;
  const departmentName = departments.find((department) => department.id === departmentId)?.name ?? "Todos os departamentos";
  const shiftName = shifts.length === 0 ? "Todos os turnos" : shifts.map((shift) => competencyShiftLabel(shift)).join(", ");
  const shown = new Set(groups.flatMap((group) => group.columns.map((column) => column.competency.id))).size;
  const counts =
    data == null
      ? "Carregando a matriz"
      : groupingStatus === "loading"
        ? "Carregando agrupamento"
        : `${data.rows.length} ${data.rows.length === 1 ? "colaborador" : "colaboradores"} · ${shown} ${shown === 1 ? "competência" : "competências"}`;

  const dialog = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="competency-matrix-fullscreen-title"
      tabIndex={-1}
      data-testid="competency-matrix-fullscreen"
      className="fixed inset-0 z-[80] flex h-dvh max-h-dvh w-full flex-col overflow-hidden bg-background outline-none"
    >
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:flex" aria-hidden>
            <Grid3x3 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Gestão de pessoas · Competências</p>
            <h2 id="competency-matrix-fullscreen-title" className="truncate text-lg font-semibold leading-tight text-foreground">
              Matriz de Competências
            </h2>
            <p className="sr-only">
              {departmentName} · {shiftName} · {counts}
            </p>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <div className="hidden min-w-0 flex-wrap items-center justify-end gap-1.5 md:flex" data-testid="competency-matrix-summary">
            <SummaryPill>{departmentName}</SummaryPill>
            <SummaryPill>{shiftName}</SummaryPill>
            {data != null && groupingStatus !== "loading" ? (
              <>
                <SummaryPill icon={<Users className="h-3.5 w-3.5" aria-hidden />}>
                  {data.rows.length} {data.rows.length === 1 ? "colaborador" : "colaboradores"}
                </SummaryPill>
                <SummaryPill icon={<Layers className="h-3.5 w-3.5" aria-hidden />}>
                  {shown} {shown === 1 ? "competência" : "competências"}
                </SummaryPill>
              </>
            ) : (
              <SummaryPill>{counts}</SummaryPill>
            )}
          </div>
          <button type="button" className={BTN_SECONDARY} onClick={onClose} data-testid="competency-matrix-fullscreen-close">
            <X className="h-3.5 w-3.5" aria-hidden />
            Fechar
          </button>
        </div>
      </header>
      <div className="flex shrink-0 flex-col gap-3 border-b border-border bg-muted/40 px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <CompetencyViewFilters
            variant="toolbar"
            departmentId={departmentId}
            departments={departments}
            shifts={shifts}
            onDepartmentChange={onDepartmentChange}
            onToggleShift={onToggleShift}
            testId="competency-matrix-filters"
            departmentTestId="competency-matrix-filter-department"
            shiftTestId={(shift) => `competency-matrix-filter-shift-${shift}`}
          />
          <MatrixLevelLegend />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2 text-xs" role="radiogroup" aria-label="Agrupar por">
            <span className="font-medium text-muted-foreground">Agrupar por</span>
            <span className="inline-flex rounded-lg border border-border bg-background p-0.5 shadow-sm">
              {(
                [
                  ["department", "Departamento"],
                  ["category", "Categoria"],
                ] as const
              ).map(([mode, label]) => (
                <label
                  key={mode}
                  className={cn(
                    "cursor-pointer select-none rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-within:ring-2 focus-within:ring-primary/40",
                    groupMode === mode ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name="competency-matrix-group-by"
                    checked={groupMode === mode}
                    onChange={() => onGroupModeChange(mode)}
                    data-testid={`competency-matrix-group-by-${mode}`}
                  />
                  {label}
                </label>
              ))}
            </span>
          </div>
          <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />
          <div className="flex items-center gap-1">
            <button type="button" className={BTN_GHOST} onClick={onExpandAll} data-testid="competency-matrix-expand-all">
              <ChevronsLeftRight className="h-3.5 w-3.5" aria-hidden />
              Expandir todas
            </button>
            <button type="button" className={BTN_GHOST} onClick={onCollapseAll} data-testid="competency-matrix-collapse-all">
              <ChevronsRightLeft className="h-3.5 w-3.5" aria-hidden />
              Recolher todas
            </button>
          </div>
        </div>
      </div>
      <div
        ref={scrollRef}
        tabIndex={0}
        data-testid="competency-matrix-scroll"
        aria-label="Grade da matriz de competências"
        className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain bg-muted/30 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <CompetencyMatrixGrid
          matrix={matrix}
          groups={groups}
          groupingStatus={groupingStatus}
          groupingMessage={groupingMessage}
          canEdit={canEdit}
          expandedKeys={expandedKeys}
          onToggleGroup={onToggleGroup}
          onOpenCell={onOpenCell}
          onRetry={onRetry}
        />
      </div>
    </div>
  );

  if (typeof document === "undefined") return dialog;
  return createPortal(dialog, document.body);
}
