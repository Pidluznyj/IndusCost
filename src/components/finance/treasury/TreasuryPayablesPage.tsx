import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { FINANCE_HEADER_ACTION_REFRESH } from "@/src/lib/financeModuleUiStandards";
import type {
  TreasuryFinancialAccountDto,
  TreasuryPayableListItemDto,
  TreasuryPayableSortField,
} from "@/src/lib/treasury/contracts/index.js";
import { fetchTreasuryAccounts } from "@/src/lib/treasury/treasuryAccountsApi.js";
import { fetchTreasuryAccountLatestBalance } from "@/src/lib/treasury/treasuryBalancesApi.js";
import {
  fetchTreasuryPayable,
  fetchTreasuryPayables,
} from "@/src/lib/treasury/treasuryPayablesApi.js";
import {
  canProgramTreasuryPayables,
  canViewTreasuryPayables,
} from "@/src/lib/treasury/treasuryPayablesPermissions.js";
import {
  TREASURY_PAYABLES_PAGE_SUBTITLE,
  TREASURY_PAYABLES_PAGE_TITLE,
  buildTreasuryPayablesListQuery,
  createEmptyTreasuryPayablesFilters,
  resolveTreasuryPayablesStaleState,
  resolveTreasuryPayablesViewKind,
  type TreasuryPayablesFilterState,
} from "@/src/lib/treasury/treasuryPayablesUi.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { TreasuryPayableDetailDrawer } from "./TreasuryPayableDetailDrawer.js";
import { TreasuryPayablesPanel } from "./TreasuryPayablesPanel.js";

const SORT_FIELDS = new Set<string>([
  "dueDate",
  "personName",
  "openAmount",
  "originalAmount",
  "daysOverdue",
  "scheduledDate",
  "priority",
  "lastSyncedAt",
  "externalId",
  "documentNumber",
]);

function readFilters(params: URLSearchParams): TreasuryPayablesFilterState {
  const base = createEmptyTreasuryPayablesFilters();
  const sortByRaw = params.get("sortBy") ?? "dueDate";
  const sortBy = (
    SORT_FIELDS.has(sortByRaw) ? sortByRaw : "dueDate"
  ) as TreasuryPayableSortField;
  const dir = params.get("sortDirection");
  return {
    ...base,
    supplierName: params.get("supplierName") ?? "",
    supplierTaxId: params.get("supplierTaxId") ?? "",
    document: params.get("document") ?? "",
    classification: params.get("classification") ?? "",
    costCenter: params.get("costCenter") ?? "",
    dueFrom: params.get("dueFrom") ?? "",
    dueTo: params.get("dueTo") ?? "",
    scheduledFrom: params.get("scheduledFrom") ?? "",
    scheduledTo: params.get("scheduledTo") ?? "",
    operationalStatus: params.get("operationalStatus") ?? "",
    openAmountMin: params.get("openAmountMin") ?? "",
    openAmountMax: params.get("openAmountMax") ?? "",
    plannedAccountId: params.get("plannedAccountId") ?? "",
    priority: params.get("priority") ?? "",
    responsibleUserId: params.get("responsibleUserId") ?? "",
    includeCancelled: params.get("includeCancelled") === "1",
    sortBy,
    sortDirection: dir === "desc" ? "desc" : "asc",
  };
}

function filtersToParams(
  filters: TreasuryPayablesFilterState,
  page: number,
  pageSize: number
): URLSearchParams {
  const qs = new URLSearchParams();
  qs.set("page", String(page));
  qs.set("pageSize", String(pageSize));
  const entries: Array<[string, string]> = [
    ["supplierName", filters.supplierName],
    ["supplierTaxId", filters.supplierTaxId],
    ["document", filters.document],
    ["classification", filters.classification],
    ["costCenter", filters.costCenter],
    ["dueFrom", filters.dueFrom],
    ["dueTo", filters.dueTo],
    ["scheduledFrom", filters.scheduledFrom],
    ["scheduledTo", filters.scheduledTo],
    ["operationalStatus", filters.operationalStatus],
    ["openAmountMin", filters.openAmountMin],
    ["openAmountMax", filters.openAmountMax],
    ["plannedAccountId", filters.plannedAccountId],
    ["priority", filters.priority],
    ["responsibleUserId", filters.responsibleUserId],
    ["sortBy", filters.sortBy],
    ["sortDirection", filters.sortDirection],
  ];
  for (const [k, v] of entries) {
    if (v.trim()) qs.set(k, v.trim());
  }
  if (filters.includeCancelled) qs.set("includeCancelled", "1");
  return qs;
}

export function TreasuryPayablesPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const permCheck = {
    ...auth,
    canPerformAction: permissions.canPerformAction,
  };
  const canView = canViewTreasuryPayables(permCheck);
  const canProgram = canProgramTreasuryPayables(permCheck);

  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const page = Math.max(1, Number(searchParams.get("page") || "1") || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(searchParams.get("pageSize") || "50") || 50)
  );
  const detailId = searchParams.get("titleId");

  const abortRef = useRef<AbortController | null>(null);
  const [rows, setRows] = useState<TreasuryPayableListItemDto[]>([]);
  const [accounts, setAccounts] = useState<TreasuryFinancialAccountDto[]>([]);
  const [balancesByAccountId, setBalancesByAccountId] = useState<
    Record<string, string | null | undefined>
  >({});
  const [titleCount, setTitleCount] = useState(0);
  const [openAmountTotal, setOpenAmountTotal] = useState("0.00");
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headerUpdatedAt, setHeaderUpdatedAt] = useState<string | null>(null);
  const [detailRow, setDetailRow] =
    useState<TreasuryPayableListItemDto | null>(null);

  const listQuery = useMemo(
    () =>
      buildTreasuryPayablesListQuery({
        filters,
        page,
        pageSize,
      }),
    [filters, page, pageSize]
  );

  const viewKind = resolveTreasuryPayablesViewKind({
    canView,
    loading,
    error,
    rowCount: rows.length,
    hasFilters: listQuery.hasFilters,
  });

  const stale = resolveTreasuryPayablesStaleState(rows);

  const patchParams = useCallback(
    (next: {
      filters?: TreasuryPayablesFilterState;
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

  const loadAccountsAndBalances = useCallback(async (signal?: AbortSignal) => {
    try {
      const payload = await fetchTreasuryAccounts({
        isActive: true,
        page: 1,
        pageSize: 200,
        signal,
      });
      if (signal?.aborted) return;
      setAccounts(payload.rows);
      const balances: Record<string, string | null | undefined> = {};
      await Promise.all(
        payload.rows.map(async (acc) => {
          try {
            const snap = await fetchTreasuryAccountLatestBalance(acc.id, signal);
            balances[acc.id] = snap?.availableBalance ?? "0.00";
          } catch {
            balances[acc.id] = "0.00";
          }
        })
      );
      if (!signal?.aborted) setBalancesByAccountId(balances);
    } catch {
      // Contas/saldos são auxiliares ao preview; listagem de títulos segue.
    }
  }, []);

  const loadList = useCallback(async () => {
    if (!canView) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const { hasFilters: _hf, ...params } = listQuery;
      const [payload] = await Promise.all([
        fetchTreasuryPayables({
          ...params,
          signal: controller.signal,
        }),
        loadAccountsAndBalances(controller.signal),
      ]);
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
          "Não foi possível carregar contas a pagar.",
          err
        )
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [canView, listQuery, loadAccountsAndBalances]);

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
    void fetchTreasuryPayable(detailId)
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
      <div data-testid="treasury-payables-page" className="contents">
        <FinanceExecutivePageHeader
          eyebrow="FINANCEIRO · CENTRAL DE TESOURARIA"
          title={TREASURY_PAYABLES_PAGE_TITLE}
          subtitle={TREASURY_PAYABLES_PAGE_SUBTITLE}
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

        <TreasuryPayablesPanel
          viewKind={viewKind}
          rows={rows}
          accounts={accounts}
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
              filters: createEmptyTreasuryPayablesFilters(),
              page: 1,
              titleId: null,
            })
          }
          onOpenDetails={(row) => patchParams({ titleId: row.titleId })}
          onDismissError={() => setError(null)}
        />

        <TreasuryPayableDetailDrawer
          open={Boolean(detailId && detailRow)}
          row={detailRow}
          accounts={accounts}
          balancesByAccountId={balancesByAccountId}
          canProgram={canProgram}
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
