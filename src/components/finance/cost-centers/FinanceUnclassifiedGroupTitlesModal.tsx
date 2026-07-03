import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { List, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { FinanceCostCentersUiFilters } from "@/src/lib/financeCostCentersPageTypes";
import { resolveOpenOnlyFromApStatus } from "@/src/lib/financeCostCenterAllocationMetrics";
import type { UnclassifiedGroupedBySupplierRow } from "@/src/lib/financeUnclassifiedPayablesGrouping";
import type { UnclassifiedGroupTitlesPayload } from "@/src/lib/financeUnclassifiedGroupTitles.shared";
import { UNCLASSIFIED_GROUP_TITLES_SCOPE_NOTE } from "@/src/lib/financeUnclassifiedGroupTitles.shared";
import {
  UNCLASSIFIED_CAUSE_CHIP_CLASS,
  UNCLASSIFIED_CAUSE_LABEL,
  UNCLASSIFIED_CAUSE_SUGGESTION,
  type UnclassifiedCauseUi,
} from "@/src/lib/financeUnclassifiedPayablesUi";
import {
  formatFinanceCurrency,
  formatFinanceDate,
} from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import {
  FinanceCostCenterGridPagination,
  FinanceCostCenterGridSearchBar,
  FinanceCostCenterGridTableShell,
} from "@/src/components/finance/cost-centers/FinanceCostCenterGridKit";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import {
  FINANCE_COST_CENTERS_CLASSIFICATION_OPTIONS,
  FINANCE_COST_CENTERS_MONTH_OPTIONS,
  FINANCE_COST_CENTERS_STATUS_OPTIONS,
} from "@/src/lib/financeCostCentersPageTypes";

type Props = {
  open: boolean;
  group: UnclassifiedGroupedBySupplierRow | null;
  appliedFilters: FinanceCostCentersUiFilters;
  causeFilter: UnclassifiedCauseUi | "all";
  onClose: () => void;
};

function buildUnclassifiedGroupTitlesApiPath(
  groupKey: string,
  appliedFilters: FinanceCostCentersUiFilters,
  causeFilter: UnclassifiedCauseUi | "all",
  page: number,
  pageSize: number,
  search: string
): string {
  const q = new URLSearchParams();
  q.set("openOnly", resolveOpenOnlyFromApStatus(appliedFilters.status) ? "true" : "false");
  if (appliedFilters.year != null) q.set("year", String(appliedFilters.year));
  if (appliedFilters.month != null) q.set("month", String(appliedFilters.month));
  if (appliedFilters.companyName.trim()) q.set("companyName", appliedFilters.companyName.trim());
  if (appliedFilters.status && appliedFilters.status !== "all") {
    q.set("status", appliedFilters.status);
  }
  if (appliedFilters.classification && appliedFilters.classification !== "all") {
    q.set("classification", appliedFilters.classification);
  }
  if (causeFilter !== "all") q.set("cause", causeFilter);
  q.set("page", String(page));
  q.set("pageSize", String(pageSize));
  if (search.trim()) q.set("search", search.trim());
  return `/api/finance/cost-centers/unclassified-groups/${encodeURIComponent(groupKey)}/titles?${q.toString()}`;
}

function resolveFilterLabel(
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string | undefined
): string {
  if (!value || value === "all") return "Todos";
  return options.find((entry) => entry.value === value)?.label ?? value;
}

export function FinanceUnclassifiedGroupTitlesModal({
  open,
  group,
  appliedFilters,
  causeFilter,
  onClose,
}: Props) {
  const [payload, setPayload] = useState<UnclassifiedGroupTitlesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");

  const loadTitles = useCallback(
    async (nextPage: number, nextSearch: string) => {
      if (!group) return;
      setLoading(true);
      setError(null);
      try {
        const path = buildUnclassifiedGroupTitlesApiPath(
          group.groupKey,
          appliedFilters,
          causeFilter,
          nextPage,
          50,
          nextSearch
        );
        const data = await fetchJsonOk<UnclassifiedGroupTitlesPayload>(path, {
          credentials: "include",
        });
        setPayload(data);
      } catch (e) {
        setError(buildFinanceTabLoadError("Não foi possível carregar títulos do grupo.", e));
        setPayload(null);
      } finally {
        setLoading(false);
      }
    },
    [appliedFilters, causeFilter, group]
  );

  useEffect(() => {
    if (!open || !group) {
      setPayload(null);
      setError(null);
      setPage(1);
      setSearch("");
      setSearchDraft("");
      return;
    }
    void loadTitles(1, "");
  }, [open, group, loadTitles]);

  const filterSummary = useMemo(() => {
    const year = appliedFilters.year ?? new Date().getFullYear();
    const monthLabel =
      appliedFilters.month != null
        ? (FINANCE_COST_CENTERS_MONTH_OPTIONS.find(
            (entry) => entry.value === String(appliedFilters.month)
          )?.label ?? String(appliedFilters.month))
        : "Todos";
    return {
      year: String(year),
      month: monthLabel,
      company: appliedFilters.companyName.trim() || "Todas",
      status: resolveFilterLabel(FINANCE_COST_CENTERS_STATUS_OPTIONS, appliedFilters.status),
      classification: resolveFilterLabel(
        FINANCE_COST_CENTERS_CLASSIFICATION_OPTIONS,
        appliedFilters.classification
      ),
      cause:
        causeFilter !== "all" ? UNCLASSIFIED_CAUSE_LABEL[causeFilter] : "Todas",
    };
  }, [appliedFilters, causeFilter]);

  if (!open || !group) return null;

  const displayCause = group.cause ?? payload?.group.cause ?? null;
  const displaySuggestion =
    displayCause != null
      ? UNCLASSIFIED_CAUSE_SUGGESTION[displayCause]
      : (payload?.group.suggestion ?? "Revisar fornecedor");

  const panel = createPortal(
    <div className="fixed inset-0 z-[75] flex">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Fechar modal"
        onClick={onClose}
      />
      <div
        className={cn(
          financeBiCardClass,
          "relative ml-auto flex h-full w-full max-w-6xl flex-col overflow-hidden shadow-2xl"
        )}
        data-testid="finance-unclassified-group-titles-modal"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold truncate">
              Títulos sem classificação — {group.name}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Títulos que compõem esta pendência no filtro atual.
            </p>
            <p className="text-xs text-muted-foreground mt-1">{UNCLASSIFIED_GROUP_TITLES_SCOPE_NOTE}</p>
          </div>
          <button type="button" className="rounded-lg border p-2" onClick={onClose} aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border/80 bg-muted/20 px-5 py-3 text-sm space-y-2">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>
              <span className="text-muted-foreground">Fornecedor/grupo:</span>{" "}
              <span className="font-semibold">{group.name}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Documento:</span>{" "}
              {group.personDocument ?? payload?.group.supplierDocument ?? "—"}
            </span>
            {displayCause ? (
              <span className="inline-flex items-center gap-2">
                <span className="text-muted-foreground">Causa:</span>
                <span
                  className={cn(
                    "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                    UNCLASSIFIED_CAUSE_CHIP_CLASS[displayCause]
                  )}
                >
                  {UNCLASSIFIED_CAUSE_LABEL[displayCause]}
                </span>
              </span>
            ) : null}
            <span>
              <span className="text-muted-foreground">Sugestão:</span> {displaySuggestion}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <span>
              <span className="text-muted-foreground">Títulos:</span>{" "}
              <span className="font-semibold tabular-nums">
                {payload?.summary.titlesCount ?? group.titlesCount}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">Valor total:</span>{" "}
              <span className="font-semibold tabular-nums">
                {formatFinanceCurrency(payload?.summary.totalAmount ?? group.amount)}
              </span>
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>Ano: {filterSummary.year}</span>
            <span>Mês: {filterSummary.month}</span>
            <span>Empresa: {filterSummary.company}</span>
            <span>Status: {filterSummary.status}</span>
            <span>Classificação: {filterSummary.classification}</span>
            <span>Causa (aba): {filterSummary.cause}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error ? (
            <FinanceModuleErrorBanner
              message={error}
              onRetry={() => void loadTitles(page, search)}
              onDismiss={() => setError(null)}
            />
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <FinanceCostCenterGridSearchBar
              value={searchDraft}
              onChange={setSearchDraft}
              placeholder="Buscar documento, descrição…"
              testId="finance-unclassified-group-titles-search"
            />
            <button
              type="button"
              className="rounded-lg border px-3 py-2 text-sm font-semibold"
              onClick={() => {
                setSearch(searchDraft);
                setPage(1);
                void loadTitles(1, searchDraft);
              }}
            >
              Buscar
            </button>
          </div>

          {loading ? <FinanceModuleLoadingBlock label="Carregando títulos do grupo…" /> : null}

          {!loading && payload && payload.rows.length === 0 ? (
            <FinanceModuleEmptyState
              title="Nenhum título encontrado"
              description="Nenhum título encontrado para este grupo no filtro atual."
            />
          ) : null}

          {!loading && payload && payload.rows.length > 0 ? (
            <FinanceCostCenterGridTableShell
              tableClassName="min-w-[1100px]"
              head={
                <tr className="border-b border-border text-left text-[10px] uppercase text-muted-foreground">
                  <th className="px-3 py-2">Documento / Nº título</th>
                  <th className="px-3 py-2">Fornecedor AP</th>
                  <th className="px-3 py-2">CNPJ/Doc.</th>
                  <th className="px-3 py-2">Emissão</th>
                  <th className="px-3 py-2">Vencimento</th>
                  <th className="px-3 py-2">Pagamento/baixa</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Causa</th>
                  <th className="px-3 py-2 min-w-[14rem]">Descrição / comentário / histórico</th>
                </tr>
              }
              footer={
                <FinanceCostCenterGridPagination
                  page={payload.pagination.page}
                  totalPages={payload.pagination.totalPages}
                  pageSize={payload.pagination.pageSize}
                  onPageChange={(nextPage) => {
                    setPage(nextPage);
                    void loadTitles(nextPage, search);
                  }}
                  onPageSizeChange={() => undefined}
                />
              }
            >
              {payload.rows.map((row) => (
                <tr key={row.externalId} className="border-b border-border/60 text-xs align-top">
                  <td className="px-3 py-2">
                    {row.documentNumber ?? row.externalId}
                  </td>
                  <td className="px-3 py-2">{row.supplierName ?? "—"}</td>
                  <td className="px-3 py-2">{row.supplierDocument ?? "—"}</td>
                  <td className="px-3 py-2">{formatFinanceDate(row.issueDate)}</td>
                  <td className="px-3 py-2">{formatFinanceDate(row.dueDate)}</td>
                  <td className="px-3 py-2">
                    {formatFinanceDate(row.paymentDate ?? row.settlementDate)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {formatFinanceCurrency(row.amount)}
                  </td>
                  <td className="px-3 py-2">{row.statusLabel}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                        UNCLASSIFIED_CAUSE_CHIP_CLASS[row.cause]
                      )}
                    >
                      {UNCLASSIFIED_CAUSE_LABEL[row.cause]}
                    </span>
                  </td>
                  <td className="px-3 py-2 max-w-[20rem]">
                    <p
                      className="line-clamp-3 whitespace-pre-wrap"
                      title={
                        row.rawDescriptionSource
                          ? `${row.description} (fonte: ${row.rawDescriptionSource})`
                          : row.description
                      }
                    >
                      {row.description}
                    </p>
                  </td>
                </tr>
              ))}
            </FinanceCostCenterGridTableShell>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );

  return panel;
}

export { buildUnclassifiedGroupTitlesApiPath };
