import { createPortal } from "react-dom";
import { useEffect, type RefObject } from "react";
import { Expand, Minimize2, X } from "lucide-react";
import {
  SalesOrderFlowKanbanBoard,
  type SalesOrderFlowKanbanColumnView,
} from "@/src/components/commercial/SalesOrderFlowKanbanBoard";
import type { SalesOrderFlowStage } from "@/src/lib/sales/salesOrderFlowCatalog";

type Props = {
  open: boolean;
  onClose: () => void;
  columns: readonly SalesOrderFlowKanbanColumnView[];
  valuesVisible: boolean;
  inconsistenciesVisible: boolean;
  cardsMinimized: boolean;
  onToggleCardsMinimized: () => void;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  onOpenOrder: (orderId: string, orderCode: string) => void;
  onLoadMore: (stage: SalesOrderFlowStage) => void;
  onRetryColumn: (stage: SalesOrderFlowStage) => void;
};

/**
 * Kanban em modal de tela cheia — cobre o viewport do dispositivo
 * para maximizar usabilidade operacional.
 */
export function SalesOrderFlowKanbanFullscreen({
  open,
  onClose,
  columns,
  valuesVisible,
  inconsistenciesVisible,
  cardsMinimized,
  onToggleCardsMinimized,
  scrollContainerRef,
  onOpenOrder,
  onLoadMore,
  onRetryColumn,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sales-order-flow-kanban-fullscreen-title"
      data-testid="sales-order-flow-kanban-fullscreen"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2.5 sm:px-4">
        <div className="min-w-0 flex-1">
          <h2
            id="sales-order-flow-kanban-fullscreen-title"
            className="truncate text-sm font-semibold text-foreground sm:text-base"
          >
            Kanban — Fluxo de Pedidos
          </h2>
          <p className="text-[11px] text-muted-foreground sm:text-xs">
            Esc para fechar · cards podem ficar só com número e status
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent sm:text-sm"
          data-testid="sales-order-flow-kanban-toggle-minimize"
          onClick={onToggleCardsMinimized}
        >
          {cardsMinimized ? (
            <>
              <Expand className="h-3.5 w-3.5" aria-hidden="true" />
              Expandir cards
            </>
          ) : (
            <>
              <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
              Minimizar cards
            </>
          )}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent sm:text-sm"
          data-testid="sales-order-flow-kanban-fullscreen-close"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Fechar
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-2 sm:p-3">
        <SalesOrderFlowKanbanBoard
          columns={columns}
          valuesVisible={valuesVisible}
          inconsistenciesVisible={inconsistenciesVisible}
          cardsMinimized={cardsMinimized}
          fullscreen
          scrollContainerRef={scrollContainerRef}
          onOpenOrder={onOpenOrder}
          onLoadMore={onLoadMore}
          onRetryColumn={onRetryColumn}
        />
      </div>
    </div>,
    document.body
  );
}
