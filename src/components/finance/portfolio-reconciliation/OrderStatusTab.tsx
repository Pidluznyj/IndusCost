import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import type { EntityAutocompleteSelection } from "@/src/components/common/CustomerAutocompleteFilter";
import {
  ORDER_STATUS_API_PATH,
  ORDER_STATUS_EMPTY_FILTERED_MESSAGE,
  ORDER_STATUS_EMPTY_NO_RUN_MESSAGE,
  ORDER_STATUS_ERROR_MESSAGE,
  ORDER_STATUS_GRAIN_BADGE,
  ORDER_STATUS_INFO_BANNER,
  ORDER_STATUS_LOADING_MESSAGE,
  ORDER_STATUS_SELECT_MESSAGE,
  ORDER_STATUS_TAB_SUBTITLE,
  ORDER_STATUS_TAB_TITLE,
  buildOrderStatusFilterChips,
  buildOrderStatusListQuery,
  canSearchOrderStatus,
  clearOrderStatusChipField,
  createDefaultOrderStatusUiFilters,
  formatOrderStatusFilterContext,
  nextOrderStatusSort,
  type OrderStatusChipField,
  type OrderStatusUiFilters,
  type PortfolioOrderStatusListPayload,
} from "@/src/lib/finance/portfolioOrderStatusClient";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";
import type { PortfolioOrderStatusRow } from "@/src/lib/finance/portfolioOrderStatusService";
import { OrderStatusFilters } from "./OrderStatusFilters";
import { OrderStatusActiveFilterBar } from "./OrderStatusActiveFilterBar";
import { OrderStatusPrimaryCards } from "./OrderStatusPrimaryCards";
import { OrderStatusDrilldownCards } from "./OrderStatusDrilldownCards";
import { OrderStatusTable } from "./OrderStatusTable";
import { OrderStatusDrawer } from "./OrderStatusDrawer";
import { OrderFullAuditDialog } from "./OrderFullAuditDialog";

/**
 * Aba Status Pedidos — consome GET …/order-status.
 * Pesquisa sob demanda (Aplicar); não recalcula consolidação no frontend.
 */
export function OrderStatusTab() {
  const abortRef = useRef<AbortController | null>(null);
  const [draft, setDraft] = useState(() => createDefaultOrderStatusUiFilters());
  const [applied, setApplied] = useState<OrderStatusUiFilters | null>(null);
  const [customerSelection, setCustomerSelection] =
    useState<EntityAutocompleteSelection | null>(null);
  const [payload, setPayload] = useState<PortfolioOrderStatusListPayload | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] =
    useState<PortfolioOrderStatusRow | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [auditOrder, setAuditOrder] = useState<PortfolioOrderStatusRow | null>(
    null
  );
  const searched = applied != null;
  const canApply = canSearchOrderStatus(draft);

  const load = useCallback(async (filters: OrderStatusUiFilters) => {
    if (!canSearchOrderStatus(filters)) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const qs = buildOrderStatusListQuery(filters);
      const data = await fetchJsonOk<PortfolioOrderStatusListPayload>(
        `${ORDER_STATUS_API_PATH}?${qs}`,
        { signal: ac.signal, credentials: "include" }
      );
      setPayload(data);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setPayload(null);
      if (e instanceof HttpError) {
        setError(e.message || ORDER_STATUS_ERROR_MESSAGE);
      } else {
        setError(ORDER_STATUS_ERROR_MESSAGE);
      }
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!applied) return;
    void load(applied);
    return () => abortRef.current?.abort();
  }, [applied, load]);

  const handleApply = () => {
    if (!canSearchOrderStatus(draft)) return;
    setSelectedOrder(null);
    setSummaryOpen(false);
    setApplied({ ...draft, page: 1 });
  };

  const handleClear = () => {
    abortRef.current?.abort();
    const next = createDefaultOrderStatusUiFilters();
    setDraft(next);
    setApplied(null);
    setCustomerSelection(null);
    setPayload(null);
    setError(null);
    setLoading(false);
    setSelectedOrder(null);
    setSummaryOpen(false);
  };

  const patchApplied = (partial: Partial<OrderStatusUiFilters>) => {
    if (!applied) return;
    setApplied({ ...applied, ...partial });
    setDraft((prev) => ({ ...prev, ...partial }));
  };

  const handleRemoveChip = useCallback(
    (field: OrderStatusChipField) => {
      setApplied((current) => {
        if (!current) return current;
        const next = clearOrderStatusChipField(current, field);
        if (field === "customer") setCustomerSelection(null);
        setDraft(next);
        setSelectedOrder(null);
        setSummaryOpen(false);
        return { ...next, page: 1 };
      });
    },
    []
  );

  const activeChips = useMemo(() => {
    if (!applied) return [];
    const drillLabel =
      payload?.drilldownCards.find((c) => c.id === applied.selectedDrilldown)
        ?.label ?? null;
    return buildOrderStatusFilterChips(applied, handleRemoveChip, {
      drilldownLabel: drillLabel,
    });
  }, [applied, payload?.drilldownCards, handleRemoveChip]);

  const noRun = payload?.state === "NO_RUN";
  const filteredEmpty = payload?.state === "FILTERED_EMPTY";

  return (
    <div className="space-y-5" data-testid="order-status-tab">
      <div className="rounded-[14px] border border-[#E5E7EB] bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#667085]">
              Conciliação de Carteira
            </p>
            <h2 className="mt-1 text-lg font-semibold text-[#101828]">
              {ORDER_STATUS_TAB_TITLE}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-[#667085]">
              {ORDER_STATUS_TAB_SUBTITLE}
            </p>
          </div>
          <span className="inline-flex rounded-full border border-[#E5E7EB] bg-[#F9FAFB] px-2.5 py-1 text-[11px] font-semibold text-[#667085]">
            {ORDER_STATUS_GRAIN_BADGE}
          </span>
        </div>
        <div
          className="mt-4 rounded-[12px] border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-xs leading-relaxed text-sky-950"
          data-testid="order-status-info-banner"
        >
          {ORDER_STATUS_INFO_BANNER}
        </div>
      </div>

      <OrderStatusFilters
        draft={draft}
        onDraftChange={setDraft}
        customerSelection={customerSelection}
        onCustomerChange={setCustomerSelection}
        onApply={handleApply}
        onClear={handleClear}
        canApply={canApply}
      />

      {searched ? (
        <OrderStatusActiveFilterBar chips={activeChips} onClearAll={handleClear} />
      ) : null}

      {!searched && !loading ? (
        <FinanceModuleEmptyState
          title="Pronto para pesquisar"
          description={ORDER_STATUS_SELECT_MESSAGE}
        />
      ) : null}

      {loading ? (
        <>
          <FinanceModuleLoadingBlock label={ORDER_STATUS_LOADING_MESSAGE} />
          <OrderStatusPrimaryCards
            cards={[]}
            selectedCard=""
            onSelect={() => undefined}
            loading
          />
        </>
      ) : null}

      {error ? (
        <div data-testid="order-status-error">
          <FinanceModuleErrorBanner message={error} />
        </div>
      ) : null}

      {searched && !loading && noRun ? (
        <FinanceModuleEmptyState
          title="Auditoria indisponível"
          description={ORDER_STATUS_EMPTY_NO_RUN_MESSAGE}
        />
      ) : null}

      {searched && !loading && !error && payload && !noRun ? (
        <>
          {payload.runMeta ? (
            <p className="text-xs text-[#667085]">
              Fonte: Auditoria Pedido → Caixa
              {payload.runMeta.createdAt
                ? ` · atualizado em ${formatFinanceDateTime(payload.runMeta.createdAt)}`
                : null}
            </p>
          ) : null}

          <OrderStatusPrimaryCards
            cards={payload.primaryCards}
            selectedCard={applied?.selectedCard ?? ""}
            onSelect={(cardId) => {
              setSelectedOrder(null);
              setSummaryOpen(false);
              patchApplied({
                selectedCard: cardId,
                selectedDrilldown: "",
                page: 1,
              });
            }}
          />

          <OrderStatusDrilldownCards
            cards={payload.drilldownCards}
            selectedCard={applied?.selectedCard ?? ""}
            selectedDrilldown={applied?.selectedDrilldown ?? ""}
            contextLabel={formatOrderStatusFilterContext({
              selectedCard: applied?.selectedCard ?? "",
              selectedDrilldown: applied?.selectedDrilldown ?? "",
              drilldownCards: payload.drilldownCards,
            })}
            onSelect={(drilldownId) => {
              setSelectedOrder(null);
              setSummaryOpen(false);
              patchApplied({ selectedDrilldown: drilldownId, page: 1 });
            }}
          />

          {filteredEmpty || payload.rows.length === 0 ? (
            <FinanceModuleEmptyState
              title="Nenhum pedido"
              description={
                payload.message || ORDER_STATUS_EMPTY_FILTERED_MESSAGE
              }
            />
          ) : (
            <OrderStatusTable
              rows={payload.rows}
              page={payload.pagination.page}
              pageSize={payload.pagination.pageSize}
              totalRows={payload.pagination.totalRows}
              totalPages={payload.pagination.totalPages}
              sortBy={applied?.sortBy ?? "orderIssueDate"}
              sortDirection={applied?.sortDirection ?? "desc"}
              selectedOrderKey={selectedOrder?.orderKey ?? null}
              onSort={(column) => {
                if (!applied) return;
                setApplied(nextOrderStatusSort(applied, column));
              }}
              onPageChange={(page) => patchApplied({ page })}
              onPageSizeChange={(pageSize) =>
                patchApplied({ pageSize, page: 1 })
              }
              onRowClick={(row) => {
                setSelectedOrder(row);
                setSummaryOpen(false);
                setAuditOrder(row);
              }}
            />
          )}

          <div
            className="rounded-[14px] border border-dashed border-[#D0D5DD] bg-white px-4 py-5 text-center text-xs text-[#667085]"
            data-testid="order-status-audit-hint"
          >
            Selecione um pedido para abrir a{" "}
            <strong>Auditoria 360º do Pedido</strong> — proposta, pedido, itens,
            documentos, NF-e, financeiro, margem, comissões e divergências em um
            único lugar.
          </div>

          <OrderFullAuditDialog
            open={auditOrder != null}
            onOpenChange={(open) => {
              if (!open) setAuditOrder(null);
            }}
            salesOrderId={auditOrder?.salesOrderId ?? null}
            orderCode={auditOrder?.orderCode ?? null}
            runId={payload.runMeta?.runId ?? null}
          />

          <OrderStatusDrawer
            open={summaryOpen && selectedOrder != null}
            order={selectedOrder}
            onClose={() => setSummaryOpen(false)}
          />
        </>
      ) : null}
    </div>
  );
}
