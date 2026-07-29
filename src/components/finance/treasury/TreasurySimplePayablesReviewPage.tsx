/**
 * Página — revisão simples de pagamentos do dia.
 * Reusa API oficial + drawer de overlays; sem escrita no Nomus.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type {
  TreasuryFinancialAccountDto,
  TreasuryPayableListItemDto,
} from "@/src/lib/treasury/contracts/index.js";
import { fetchTreasuryAccounts } from "@/src/lib/treasury/treasuryAccountsApi.js";
import { fetchTreasuryPayables } from "@/src/lib/treasury/treasuryPayablesApi.js";
import { buildTreasurySimpleRefreshHeaderAction } from "@/src/lib/treasury/treasurySimpleUiShared.js";
import {
  canProgramTreasuryPayables,
  canViewTreasuryPayables,
} from "@/src/lib/treasury/treasuryPayablesPermissions.js";
import {
  TREASURY_SIMPLE_PAYABLE_REVIEW_CATEGORIES,
  TREASURY_SIMPLE_REVIEW_BUCKETS,
  filterTreasurySimplePayableRows,
  type TreasurySimplePayableReviewCategory,
  type TreasurySimpleReviewBucket,
} from "@/src/lib/treasury/domain/treasurySimpleTitleReviewRules.js";
import {
  TREASURY_SIMPLE_PAYABLES_REVIEW_SUBTITLE,
  TREASURY_SIMPLE_PAYABLES_REVIEW_TITLE,
  createEmptyTreasurySimpleReviewFilters,
  resolveTreasurySimpleReviewViewKind,
  type TreasurySimpleReviewFilterState,
} from "@/src/lib/treasury/treasurySimpleTitleReviewUi.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { TreasuryPayableDetailDrawer } from "./TreasuryPayableDetailDrawer.js";
import { TreasurySimplePayablesReviewPanel } from "./TreasurySimplePayablesReviewPanel.js";

function readFilters(params: URLSearchParams): TreasurySimpleReviewFilterState {
  const base = createEmptyTreasurySimpleReviewFilters();
  const categoryRaw = params.get("category") ?? "ALL";
  const bucketRaw = params.get("bucket") ?? "ALL";
  const category = (
    categoryRaw === "ALL" ||
    (TREASURY_SIMPLE_PAYABLE_REVIEW_CATEGORIES as readonly string[]).includes(
      categoryRaw
    )
      ? categoryRaw
      : "ALL"
  ) as string;
  const bucket = (
    (TREASURY_SIMPLE_REVIEW_BUCKETS as readonly string[]).includes(bucketRaw)
      ? bucketRaw
      : "ALL"
  ) as TreasurySimpleReviewBucket;
  return {
    date: params.get("date")?.trim() || base.date,
    accountId: params.get("accountId") ?? "",
    category,
    bucket,
  };
}

function filtersToParams(
  filters: TreasurySimpleReviewFilterState,
  page: number
): URLSearchParams {
  const qs = new URLSearchParams();
  qs.set("date", filters.date);
  qs.set("page", String(page));
  if (filters.accountId) qs.set("accountId", filters.accountId);
  if (filters.category !== "ALL") qs.set("category", filters.category);
  if (filters.bucket !== "ALL") qs.set("bucket", filters.bucket);
  return qs;
}

export function TreasurySimplePayablesReviewPage() {
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
  const detailId = searchParams.get("titleId");

  const abortRef = useRef<AbortController | null>(null);
  const [rows, setRows] = useState<TreasuryPayableListItemDto[]>([]);
  const [accounts, setAccounts] = useState<TreasuryFinancialAccountDto[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [headerUpdatedAt, setHeaderUpdatedAt] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<TreasuryPayableListItemDto | null>(
    null
  );

  const load = useCallback(async () => {
    if (!canView) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const [list, accountsPayload] = await Promise.all([
        fetchTreasuryPayables({
          page,
          pageSize: 50,
          dueFrom: filters.date,
          dueTo: filters.date,
          plannedAccountId: filters.accountId || null,
          includeSettledInDueRange: true,
          includeCancelled: false,
          sortBy: "dueDate",
          sortDirection: "asc",
          signal: ac.signal,
        }),
        fetchTreasuryAccounts({
          page: 1,
          pageSize: 200,
          isActive: true,
          sortBy: "sortOrder",
          signal: ac.signal,
        }).catch(() => ({ rows: [] as TreasuryFinancialAccountDto[] })),
      ]);
      if (ac.signal.aborted) return;
      setRows(list.rows);
      setTotalPages(list.pagination.totalPages || 1);
      setAccounts(accountsPayload.rows ?? []);
      setHasLoaded(true);
      setHeaderUpdatedAt(new Date().toISOString());
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(
        buildFinanceTabLoadError("Não foi possível carregar os pagamentos.", err)
      );
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [canView, filters.accountId, filters.date, page]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    if (!detailId) {
      setDetailRow(null);
      return;
    }
    setDetailRow(rows.find((r) => r.titleId === detailId) ?? null);
  }, [detailId, rows]);

  const filtered = useMemo(
    () =>
      filterTreasurySimplePayableRows({
        rows,
        civilDate: filters.date,
        category:
          filters.category === "ALL"
            ? "ALL"
            : (filters.category as TreasurySimplePayableReviewCategory),
        bucket: filters.bucket,
        linkedAccountId: filters.accountId || null,
      }),
    [filters.accountId, filters.bucket, filters.category, filters.date, rows]
  );

  const viewKind = resolveTreasurySimpleReviewViewKind({
    canView,
    loading,
    error,
    rowCount: filtered.length,
    hasLoaded,
  });

  const setFilters = (next: TreasurySimpleReviewFilterState) => {
    setSearchParams(filtersToParams(next, 1), { replace: true });
  };

  const openDetails = (row: TreasuryPayableListItemDto) => {
    const qs = filtersToParams(filters, page);
    qs.set("titleId", row.titleId);
    setSearchParams(qs, { replace: true });
  };

  const closeDetails = () => {
    const qs = filtersToParams(filters, page);
    qs.delete("titleId");
    setSearchParams(qs, { replace: true });
  };

  return (
    <FinanceBiDashboardShell
      header={
        <FinanceExecutivePageHeader
          title={TREASURY_SIMPLE_PAYABLES_REVIEW_TITLE}
          subtitle={TREASURY_SIMPLE_PAYABLES_REVIEW_SUBTITLE}
          updatedAt={headerUpdatedAt}
          actions={[
            buildTreasurySimpleRefreshHeaderAction({
              onClick: () => void load(),
              disabled: loading || !canView,
            }),
          ]}
        />
      }
    >
      <TreasurySimplePayablesReviewPanel
        viewKind={viewKind}
        rows={filtered}
        accounts={accounts}
        filters={filters}
        error={error}
        page={page}
        totalPages={totalPages}
        canProgram={canProgram}
        onFiltersChange={setFilters}
        onRefresh={() => void load()}
        onPageChange={(nextPage) =>
          setSearchParams(filtersToParams(filters, nextPage), { replace: true })
        }
        onOpenDetails={openDetails}
        onDismissError={() => setError(null)}
      />
      <TreasuryPayableDetailDrawer
        open={Boolean(detailRow)}
        row={detailRow}
        accounts={accounts}
        balancesByAccountId={{}}
        canProgram={canProgram}
        onClose={closeDetails}
        onSaved={(row) => {
          setRows((prev) =>
            prev.map((r) => (r.titleId === row.titleId ? row : r))
          );
          setDetailRow(row);
        }}
      />
    </FinanceBiDashboardShell>
  );
}
