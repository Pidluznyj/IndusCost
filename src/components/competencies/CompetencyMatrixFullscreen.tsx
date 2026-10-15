import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { competencyShiftLabel } from "@/src/lib/competencies/competencyDomain";
import type { CompetencyDepartmentOptionDto, CompetencyMatrixResponse } from "@/src/lib/competencies/competencyTypes";
import { CompetencyMatrixGrid, MatrixLevelLegend, type MatrixOpenCell } from "./CompetencyMatrixGrid";
import { CompetencyViewFilters } from "./CompetencyViewFilters";
import { BTN_SECONDARY } from "./competencyUi";

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
  const counts =
    data != null ? `${data.rows.length} colaboradores · ${data.competencies.length} competências` : "Carregando a matriz";

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
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
        <div className="min-w-0">
          <h2 id="competency-matrix-fullscreen-title" className="truncate text-base font-semibold text-foreground">
            Matriz de Competências
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {departmentName} · {shiftName} · {counts}
          </p>
        </div>
        <button type="button" className={BTN_SECONDARY} onClick={onClose} data-testid="competency-matrix-fullscreen-close">
          <X className="h-3.5 w-3.5" aria-hidden />
          Fechar
        </button>
      </header>
      <div className="flex shrink-0 flex-col gap-3 border-b border-border bg-card px-4 py-3">
        <CompetencyViewFilters
          departmentId={departmentId}
          departments={departments}
          shifts={shifts}
          onDepartmentChange={onDepartmentChange}
          onToggleShift={onToggleShift}
          testId="competency-matrix-filters"
          departmentTestId="competency-matrix-filter-department"
          shiftTestId={(shift) => `competency-matrix-filter-shift-${shift}`}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={onExpandAll} data-testid="competency-matrix-expand-all">
              Expandir todas
            </button>
            <button type="button" className={BTN_SECONDARY} onClick={onCollapseAll} data-testid="competency-matrix-collapse-all">
              Recolher todas
            </button>
          </div>
          <MatrixLevelLegend />
        </div>
      </div>
      <div
        ref={scrollRef}
        tabIndex={0}
        data-testid="competency-matrix-scroll"
        aria-label="Grade da matriz de competências"
        className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <CompetencyMatrixGrid
          matrix={matrix}
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
