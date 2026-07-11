import React, { useCallback, useEffect, useRef, useState } from "react";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import type { EntityAutocompleteSelection } from "@/src/components/common/CustomerAutocompleteFilter";
import type { OrderToCashAuditListRow } from "@/src/lib/finance/orderToCashAuditApi";
import {
  ORDER_TO_CASH_AUDIT_API_PATH,
  ORDER_TO_CASH_AUDIT_EMPTY_MESSAGE,
  ORDER_TO_CASH_AUDIT_ERROR_MESSAGE,
  ORDER_TO_CASH_AUDIT_HEAVY_WARNING,
  ORDER_TO_CASH_AUDIT_LOADING_MESSAGE,
  ORDER_TO_CASH_AUDIT_SELECT_MESSAGE,
  ORDER_TO_CASH_AUDIT_TAB_SUBTITLE,
  ORDER_TO_CASH_AUDIT_TAB_TITLE,
  buildOrderToCashAuditListQuery,
  canSearchOrderToCashAudit,
  createDefaultOrderToCashAuditUiFilters,
  nextOrderToCashAuditSort,
  type OrderToCashAuditListPayload,
  type OrderToCashAuditUiFilters,
} from "@/src/lib/finance/orderToCashAuditClient";
import { OrderToCashAuditFilters } from "./OrderToCashAuditFilters";
import { OrderToCashAuditSummaryCards } from "./OrderToCashAuditSummaryCards";
import { OrderToCashAuditTable } from "./OrderToCashAuditTable";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";
import { cn } from "@/src/lib/utils";

/**
 * Aba Auditoria Pedido → Caixa.
 * Não carrega no mount — exige Cliente + Ano + Pesquisar.
 */
export function OrderToCashAuditTab() {
  const abortRef = useRef<AbortController | null>(null);
  const [draft, setDraft] = useState(() => createDefaultOrderToCashAuditUiFilters());
  const [applied, setApplied] = useState<OrderToCashAuditUiFilters | null>(null);
  const [customerSelection, setCustomerSelection] =
    useState<EntityAutocompleteSelection | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [payload, setPayload] = useState<OrderToCashAuditListPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<OrderToCashAuditListRow | null>(null);
  const searched = applied != null;

  const canSearch = canSearchOrderToCashAudit(draft);

  const load = useCallback(async (filters: OrderToCashAuditUiFilters) => {
    if (!canSearchOrderToCashAudit(filters)) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const qs = buildOrderToCashAuditListQuery(filters);
      const data = await fetchJsonOk<OrderToCashAuditListPayload>(
        `${ORDER_TO_CASH_AUDIT_API_PATH}?${qs}`,
        { signal: ac.signal, credentials: "include" }
      );
      setPayload(data);
      if (!data.rows?.length) {
        setSelectedRow(null);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setPayload(null);
      if (e instanceof HttpError && e.status >= 500) {
        setError(ORDER_TO_CASH_AUDIT_ERROR_MESSAGE);
      } else if (e instanceof HttpError && e.status === 400) {
        setError(e.message || ORDER_TO_CASH_AUDIT_ERROR_MESSAGE);
      } else {
        setError(ORDER_TO_CASH_AUDIT_ERROR_MESSAGE);
      }
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, []);

  // Só busca quando `applied` muda (Pesquisar / sort / página / pageSize).
  useEffect(() => {
    if (!applied) return;
    void load(applied);
    return () => abortRef.current?.abort();
  }, [applied, load]);

  const handleSearch = () => {
    if (!canSearchOrderToCashAudit(draft)) return;
    setApplied({ ...draft, page: 1 });
  };

  const handleClear = () => {
    abortRef.current?.abort();
    const next = createDefaultOrderToCashAuditUiFilters();
    setDraft(next);
    setApplied(null);
    setCustomerSelection(null);
    setPayload(null);
    setError(null);
    setLoading(false);
    setSelectedRow(null);
    setAdvancedOpen(false);
  };

  const handleSort = (columnSortKey: string) => {
    if (!applied) return;
    const next = nextOrderToCashAuditSort(
      applied.sortBy,
      applied.sortDirection,
      columnSortKey
    );
    const merged = {
      ...applied,
      sortBy: next.sortBy,
      sortDirection: next.sortDirection,
      page: next.page,
    };
    setDraft((prev) => ({
      ...prev,
      sortBy: next.sortBy,
      sortDirection: next.sortDirection,
      page: next.page,
    }));
    setApplied(merged);
  };

  const handlePageChange = (page: number) => {
    if (!applied) return;
    const merged = { ...applied, page };
    setDraft((prev) => ({ ...prev, page }));
    setApplied(merged);
  };

  const handlePageSizeChange = (pageSize: number) => {
    if (!applied) return;
    const merged = { ...applied, pageSize, page: 1 };
    setDraft((prev) => ({ ...prev, pageSize, page: 1 }));
    setApplied(merged);
  };

  return (
    <div data-testid="order-to-cash-audit-tab">
      <header className="mb-4 space-y-3">
        <div>
          <h2
            className="text-[20px] font-bold leading-tight text-[#101828] sm:text-[22px]"
            data-testid="order-to-cash-audit-title"
          >
            {ORDER_TO_CASH_AUDIT_TAB_TITLE}
          </h2>
          <p className="mt-1 text-[14px] text-[#475467]">{ORDER_TO_CASH_AUDIT_TAB_SUBTITLE}</p>
        </div>
        <div
          className="rounded-xl border border-[#FEDF89] bg-[#FFFAEB] px-4 py-3 text-sm text-[#B54708]"
          data-testid="order-to-cash-audit-heavy-warning"
        >
          {ORDER_TO_CASH_AUDIT_HEAVY_WARNING}
        </div>
      </header>

      <OrderToCashAuditFilters
        draft={draft}
        onDraftChange={setDraft}
        customerSelection={customerSelection}
        onCustomerChange={setCustomerSelection}
        onSearch={handleSearch}
        onClear={handleClear}
        canSearch={canSearch}
        searched={searched}
        advancedOpen={advancedOpen}
        onToggleAdvanced={() => setAdvancedOpen((v) => !v)}
        availableFilters={payload?.availableFilters ?? null}
      />

      {error ? (
        <FinanceModuleErrorBanner
          message={error}
          onRetry={applied ? () => void load(applied) : undefined}
          onDismiss={() => setError(null)}
        />
      ) : null}

      {!searched && !loading ? (
        <FinanceModuleEmptyState
          title="Pesquisa obrigatória"
          description={ORDER_TO_CASH_AUDIT_SELECT_MESSAGE}
        />
      ) : null}

      {loading ? (
        <div data-testid="order-to-cash-audit-loading">
          <FinanceModuleLoadingBlock label={ORDER_TO_CASH_AUDIT_LOADING_MESSAGE} />
        </div>
      ) : null}

      {searched && !loading && !error && payload && payload.rows.length === 0 ? (
        <FinanceModuleEmptyState
          title="Sem dados"
          description={
            payload.message?.trim() || ORDER_TO_CASH_AUDIT_EMPTY_MESSAGE
          }
        />
      ) : null}

      {searched && !loading && payload && payload.rows.length > 0 ? (
        <>
          {payload.run ? (
            <p className="mb-3 text-xs text-muted-foreground" data-testid="order-to-cash-audit-run-meta">
              Run {payload.run.runId.slice(0, 8)}… · {payload.run.status} ·{" "}
              {formatFinanceDateTime(payload.run.finishedAt ?? payload.run.startedAt)}
              {payload.run.totalFacts != null ? ` · ${payload.run.totalFacts} fatos` : ""}
            </p>
          ) : null}
          <OrderToCashAuditSummaryCards summary={payload.summary} />
          <OrderToCashAuditTable
            rows={payload.rows}
            filters={applied!}
            totalRows={payload.pagination.totalRows}
            totalPages={payload.pagination.totalPages}
            onSort={handleSort}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            onRowClick={setSelectedRow}
            selectedId={selectedRow?.id ?? null}
          />
        </>
      ) : null}

      {selectedRow ? (
        <aside
          className={cn(
            "mt-4 rounded-xl border border-border bg-card p-4",
            "text-sm text-[#344054]"
          )}
          data-testid="order-to-cash-audit-row-detail"
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-[#101828]">
              Detalhe da linha · {selectedRow.orderCode ?? selectedRow.id.slice(0, 8)}
            </h3>
            <button
              type="button"
              className="text-xs font-semibold text-muted-foreground hover:text-foreground"
              onClick={() => setSelectedRow(null)}
              data-testid="order-to-cash-audit-detail-close"
            >
              Fechar
            </button>
          </div>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <DetailItem label="ID do fato" value={selectedRow.id} />
            <DetailItem label="Run" value={selectedRow.runId} />
            <DetailItem label="Cliente externo" value={selectedRow.externalCustomerId} />
            <DetailItem label="Responsável" value={selectedRow.responsibleArea} />
            <DetailItem label="Ação recomendada" value={selectedRow.recommendedAction} />
            <DetailItem
              label="Alertas"
              value={
                selectedRow.alerts.length
                  ? selectedRow.alerts.join(" · ")
                  : "Nenhum alerta"
              }
            />
            <DetailItem
              label="Flags"
              value={[
                selectedRow.hasDeliveryDelay && "Atraso entrega",
                selectedRow.hasMissingStockDocument && "Sem documento",
                selectedRow.hasPartialFulfillment && "Atendimento parcial",
                selectedRow.hasFullFulfillment && "Atendimento total",
                selectedRow.hasExcessQuantity && "Excedente",
                selectedRow.hasProductOutsideOrder && "Produto fora",
                selectedRow.hasNfeHeaderGreaterThanOrder && "NF > pedido",
                selectedRow.hasPriceMismatch && "Preço divergente",
                selectedRow.hasDocumentWithoutReceivable && "Doc sem CR",
                selectedRow.hasOverdueReceivable && "CR vencido",
              ]
                .filter(Boolean)
                .join(" · ") || "—"}
            />
          </dl>
        </aside>
      ) : null}
    </div>
  );
}

function DetailItem({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[#667085]">
        {label}
      </dt>
      <dd className="mt-0.5 break-all text-[13px] text-[#101828]">{value ?? "—"}</dd>
    </div>
  );
}
