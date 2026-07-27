import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { FINANCE_HEADER_ACTION_REFRESH } from "@/src/lib/financeModuleUiStandards";
import type {
  TreasuryReceivableListItemDto,
  TreasuryReceivableSortField,
} from "@/src/lib/treasury/contracts/index.js";
import {
  fetchTreasuryReceivable,
  fetchTreasuryReceivables,
} from "@/src/lib/treasury/treasuryReceivablesApi.js";
import {
  canManageTreasuryReceivables,
  canPromiseTreasuryReceivables,
  canViewTreasuryReceivables,
} from "@/src/lib/treasury/treasuryReceivablesPermissions.js";
import {
  TREASURY_RECEIVABLES_PAGE_SUBTITLE,
  TREASURY_RECEIVABLES_PAGE_TITLE,
  buildTreasuryReceivablesListQuery,
  createEmptyTreasuryReceivablesFilters,
  resolveTreasuryReceivablesStaleState,
  resolveTreasuryReceivablesViewKind,
  type TreasuryReceivablesFilterState,
} from "@/src/lib/treasury/treasuryReceivablesUi.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { TreasuryReceivableDetailDrawer } from "./TreasuryReceivableDetailDrawer.js";
import { TreasuryReceivablesPanel } from "./TreasuryReceivablesPanel.js";

const SORT_FIELDS = new Set<string>([
  "dueDate",
  "personName",
  "openAmount",
  "originalAmount",
  "daysOverdue",
  "expectedDate",
  "priority",
  "lastSyncedAt",
  "externalId",
]);

function readFilters(params: URLSearchParams): TreasuryReceivablesFilterState {
  const base = createEmptyTreasuryReceivablesFilters();
  const sortByRaw = params.get("sortBy") ?? "dueDate";
  const sortBy = (
    SORT_FIELDS.has(sortByRaw) ? sortByRaw : "dueDate"
  ) as TreasuryReceivableSortField;
  const dir = params.get("sortDirection");
  return {
    ...base,
    customerName: params.get("customerName") ?? "",
    customerTaxId: params.get("customerTaxId") ?? "",
    document: params.get("document") ?? "",
    salesOrder: params.get("salesOrder") ?? "",
    invoice: params.get("invoice") ?? "",
    sellerName: params.get("sellerName") ?? "",
    commercialOwnerName: params.get("commercialOwnerName") ?? "",
    collectionOwnerUserId: params.get("collectionOwnerUserId") ?? "",
    dueFrom: params.get("dueFrom") ?? "",
    dueTo: params.get("dueTo") ?? "",
    expectedFrom: params.get("expectedFrom") ?? "",
    expectedTo: params.get("expectedTo") ?? "",
    hasPromise: (params.get("hasPromise") as "" | "true" | "false") || "",
    operationalStatus: params.get("operationalStatus") ?? "",
    daysOverdueMin: params.get("daysOverdueMin") ?? "",
    daysOverdueMax: params.get("daysOverdueMax") ?? "",
    openAmountMin: params.get("openAmountMin") ?? "",
    openAmountMax: params.get("openAmountMax") ?? "",
    plannedAccountId: params.get("plannedAccountId") ?? "",
    priority: params.get("priority") ?? "",
    includeCancelled: params.get("includeCancelled") === "1",
    sortBy,
    sortDirection: dir === "desc" ? "desc" : "asc",
  };
}

function filtersToParams(
  filters: TreasuryReceivablesFilterState,
  page: number,
  pageSize: number
): URLSearchParams {
  const qs = new URLSearchParams();
  qs.set("page", String(page));
  qs.set("pageSize", String(pageSize));
  const entries: Array<[string, string]> = [
    ["customerName", filters.customerName],
    ["customerTaxId", filters.customerTaxId],
    ["document", filters.document],
    ["salesOrder", filters.salesOrder],
    ["invoice", filters.invoice],
    ["sellerName", filters.sellerName],
    ["commercialOwnerName", filters.commercialOwnerName],
    ["collectionOwnerUserId", filters.collectionOwnerUserId],
    ["dueFrom", filters.dueFrom],
    ["dueTo", filters.dueTo],
    ["expectedFrom", filters.expectedFrom],
    ["expectedTo", filters.expectedTo],
    ["hasPromise", filters.hasPromise],
    ["operationalStatus", filters.operationalStatus],
    ["daysOverdueMin", filters.daysOverdueMin],
    ["daysOverdueMax", filters.daysOverdueMax],
    ["openAmountMin", filters.openAmountMin],
    ["openAmountMax", filters.openAmountMax],
    ["plannedAccountId", filters.plannedAccountId],
    ["priority", filters.priority],
    ["sortBy", filters.sortBy],
    ["sortDirection", filters.sortDirection],
  ];
  for (const [k, v] of entries) {
    if (v.trim()) qs.set(k, v.trim());
  }
  if (filters.includeCancelled) qs.set("includeCancelled", "1");
  return qs;
}

export function TreasuryReceivablesPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const permCheck = {
    ...auth,
    canPerformAction: permissions.canPerformAction,
  };
  const canView = canViewTreasuryReceivables(permCheck);
  const canManage = canManageTreasuryReceivables(permCheck);
  const canPromise = canPromiseTreasuryReceivables(permCheck);

  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const page = Math.max(1, Number(searchParams.get("page") || "1") || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(searchParams.get("pageSize") || "50") || 50)
  );
  const detailId = searchParams.get("titleId");

  const abortRef = useRef<AbortController | null>(null);
  const [rows, setRows] = useState<TreasuryReceivableListItemDto[]>([]);
  const [titleCount, setTitleCount] = useState(0);
  const [openAmountTotal, setOpenAmountTotal] = useState("0.00");
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headerUpdatedAt, setHeaderUpdatedAt] = useState<string | null>(null);
  const [detailRow, setDetailRow] =
    useState<TreasuryReceivableListItemDto | null>(null);

  const listQuery = useMemo(
    () =>
      buildTreasuryReceivablesListQuery({
        filters,
        page,
        pageSize,
      }),
    [filters, page, pageSize]
  );

  const viewKind = resolveTreasuryReceivablesViewKind({
    canView,
    loading,
    error,
    rowCount: rows.length,
    hasFilters: listQuery.hasFilters,
  });

  const stale = resolveTreasuryReceivablesStaleState(rows);

  const patchParams = useCallback(
    (next: {
      filters?: TreasuryReceivablesFilterState;
      page?: number;
      pageSize?: number;
      titleId?: string | null;
    }) => {
      const qs = filtersToParams(
        next.filters ?? filters,
        next.page ?? page,
        next.pageSize ?? pageSize
      );
      const titleId = next.titleId === undefined ? detailId : next.titleId;
      if (titleId) qs.set("titleId", titleId);
      setSearchParams(qs, { replace: true });
    },
    [filters, page, pageSize, detailId, setSearchParams]
  );

  const loadList = useCallback(async () => {
    if (!canView) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const { hasFilters: _hf, ...params } = listQuery;
      const payload = await fetchTreasuryReceivables({
        ...params,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setRows(payload.rows);
      setTitleCount(payload.summary.titleCount);
      setOpenAmountTotal(payload.summary.openAmountTotal);
      setTotalPages(payload.pagination.totalPages);
      setHeaderUpdatedAt(new Date().toISOString());
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        buildFinanceTabLoadError(
          "Não foi possível carregar contas a receber.",
          err
        )
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [canView, listQuery]);

  useEffect(() => {
    void loadList();
    return () => abortRef.current?.abort();
  }, [loadList]);

  useEffect(() => {
    if (!canView || !detailId) {
      setDetailRow(null);
      return;
    }
    const fromPage = rows.find((r) => r.titleId === detailId);
    if (fromPage) {
      setDetailRow(fromPage);
      return;
    }
    let cancelled = false;
    void fetchTreasuryReceivable(detailId)
      .then((row) => {
        if (!cancelled) setDetailRow(row);
      })
      .catch(() => {
        if (!cancelled) setDetailRow(null);
      });
    return () => {
      cancelled = true;
    };
  }, [canView, detailId, rows]);

  return (
    <FinanceBiDashboardShell>
      <div data-testid="treasury-receivables-page" className="contents">
        <FinanceExecutivePageHeader
          eyebrow="FINANCEIRO · CENTRAL DE TESOURARIA"
          title={TREASURY_RECEIVABLES_PAGE_TITLE}
          subtitle={TREASURY_RECEIVABLES_PAGE_SUBTITLE}
          updatedAt={headerUpdatedAt}
          updatedAtLabel="Última atualização em"
          actions={[
            {
              id: "refresh",
              label: FINANCE_HEADER_ACTION_REFRESH,
              onClick: () => void loadList(),
            },
          ]}
        />

        <TreasuryReceivablesPanel
          viewKind={viewKind}
          rows={rows}
          error={error}
          staleMessage={stale.message}
          filters={filters}
          page={page}
          pageSize={pageSize}
          totalPages={totalPages}
          titleCount={titleCount}
          openAmountTotal={openAmountTotal}
          onFiltersChange={(next) =>
            patchParams({ filters: next, page: 1, titleId: detailId })
          }
          onPageChange={(nextPage) => patchParams({ page: nextPage })}
          onRefresh={() => void loadList()}
          onClearFilters={() =>
            patchParams({
              filters: createEmptyTreasuryReceivablesFilters(),
              page: 1,
              titleId: null,
            })
          }
          onOpenDetails={(row) => patchParams({ titleId: row.titleId })}
          onDismissError={() => setError(null)}
        />

        <TreasuryReceivableDetailDrawer
          open={Boolean(detailId && detailRow)}
          row={detailRow}
          canManage={canManage}
          canPromise={canPromise}
          onClose={() => patchParams({ titleId: null })}
          onSaved={(saved) => {
            setDetailRow(saved);
            setRows((prev) =>
              prev.map((r) => (r.titleId === saved.titleId ? saved : r))
            );
            void loadList();
          }}
        />
      </div>
    </FinanceBiDashboardShell>
  );
}
