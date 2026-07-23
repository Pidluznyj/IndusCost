import { createPortal } from "react-dom";
import { useEffect, useState, type RefObject } from "react";
import { Expand, Minimize2, Search, X } from "lucide-react";
import {
  CustomerAutocompleteFilter,
  fetchCustomerByIdForAutocomplete,
} from "@/src/components/common/CustomerAutocompleteFilter";
import {
  SalesOrderFlowKanbanBoard,
  type SalesOrderFlowKanbanColumnView,
} from "@/src/components/commercial/SalesOrderFlowKanbanBoard";
import type { EntityAutocompleteSelection } from "@/src/lib/customerSearch";
import type { SalesOrderFlowStage } from "@/src/lib/sales/salesOrderFlowCatalog";
import { cn } from "@/src/lib/utils";

const FILTER_CONTROL_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20";

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
  /** Busca por pedido (mesmo `q` da barra de filtros da página). */
  orderSearch: string;
  customerId: string;
  searching?: boolean;
  onOrderSearchChange: (value: string) => void;
  onApplySearch: (patch?: { q?: string; customerId?: string }) => void;
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
  orderSearch,
  customerId,
  searching = false,
  onOrderSearchChange,
  onApplySearch,
}: Props) {
  const [customerSelection, setCustomerSelection] =
    useState<EntityAutocompleteSelection | null>(null);

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

  useEffect(() => {
    if (!open) return;
    const id = customerId.trim();
    if (!id) {
      setCustomerSelection(null);
      return;
    }
    if (customerSelection?.id === id) return;
    const controller = new AbortController();
    void fetchCustomerByIdForAutocomplete(id, controller.signal)
      .then((selection) => {
        if (!controller.signal.aborted) setCustomerSelection(selection);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCustomerSelection({
            id,
            name: "Cliente",
            source: "induscost",
          });
        }
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reage a customerId/open
  }, [open, customerId]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sales-order-flow-kanban-fullscreen-title"
      data-testid="sales-order-flow-kanban-fullscreen"
    >
      <header className="flex shrink-0 flex-col gap-2 border-b border-border bg-card px-3 py-2.5 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
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
        </div>

        <div
          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]"
          data-testid="sales-order-flow-kanban-search"
        >
          <label className="min-w-0">
            <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Pedido
            </span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <input
                className={cn(FILTER_CONTROL_CLASS, "pl-8")}
                data-testid="sales-order-flow-kanban-filter-order"
                placeholder="Código do pedido…"
                value={orderSearch}
                disabled={searching}
                onChange={(event) => onOrderSearchChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onApplySearch({ q: orderSearch });
                  }
                }}
              />
            </div>
          </label>

          <div
            className="min-w-0 [&_label]:mb-0.5 [&_label]:text-[10px] [&_label]:font-bold [&_label]:uppercase [&_label]:tracking-wider"
            data-testid="sales-order-flow-kanban-filter-customer"
          >
            <CustomerAutocompleteFilter
              compact
              label="Cliente"
              value={customerSelection}
              customerId={customerId || undefined}
              placeholder="Buscar cliente…"
              onChange={(selection) => {
                setCustomerSelection(selection);
                onApplySearch({
                  customerId: selection?.id?.trim() ?? "",
                });
              }}
              onClear={() => {
                setCustomerSelection(null);
                onApplySearch({ customerId: "" });
              }}
            />
          </div>

          <div className="flex items-end">
            <button
              type="button"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50 sm:text-sm"
              data-testid="sales-order-flow-kanban-search-apply"
              disabled={searching}
              onClick={() => onApplySearch({ q: orderSearch })}
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              Buscar
            </button>
          </div>
        </div>
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
