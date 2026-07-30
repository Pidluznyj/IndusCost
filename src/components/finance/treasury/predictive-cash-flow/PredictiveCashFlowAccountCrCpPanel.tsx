/**
 * CR e CP por conta — API agrupada (Nomus bankAccountId → conta local).
 */

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  Eye,
  Search,
  X,
} from "lucide-react";
import {
  TREASURY_CRCP_UNLINKED_ID,
  type TreasuryCrCpAccountGroupDto,
  type TreasuryCrCpByAccountBoardDto,
  type TreasuryCrCpTitleDto,
} from "@/src/lib/treasury/domain/treasuryPredictiveCrCpByAccountRules.js";
import {
  EMPTY_TREASURY_CRCP_TITLES_FILTERS,
  listTreasuryCrCpTitleCounterparties,
  presentTreasuryCrCpTitles,
  toggleTreasuryCrCpTitlesSort,
  type TreasuryCrCpTitlesPresentationFilters,
  type TreasuryCrCpTitlesSortDir,
  type TreasuryCrCpTitlesSortKey,
} from "@/src/lib/treasury/domain/treasuryPredictiveCrCpTitlesPresentation.js";
import {
  formatPredictiveCashFlowDate,
  formatPredictiveCashFlowMoney,
  treasuryMoneyToNumber,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { fetchTreasuryPredictiveCrCpByAccount } from "@/src/lib/treasury/treasuryPredictiveCrCpByAccountApi.js";
import {
  TABLE_HORIZONTAL_TOP_SCROLL_CLASS,
  useTableHorizontalScrollSync,
} from "@/src/components/finance/portfolio-reconciliation/useTableHorizontalScrollSync";
import { cn } from "@/src/lib/utils";

const TITLE_TABLE_MIN_WIDTH = 980;

export type PredictiveCashFlowAccountCrCpPanelProps = {
  companyCode: string | null;
  fromDate: string;
  toDate: string;
};

function moneyLabel(value: string | null | undefined): string {
  if (value == null) return "—";
  return formatPredictiveCashFlowMoney(treasuryMoneyToNumber(value));
}

const FILTER_CONTROL_CLASS =
  "h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#111827] outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200 disabled:opacity-50";

type SortableColumn = {
  key: TreasuryCrCpTitlesSortKey;
  label: string;
  align?: "left" | "right";
};

const TITLE_COLUMNS: SortableColumn[] = [
  { key: "dueDate", label: "Vencimento" },
  { key: "situation", label: "Situação" },
  { key: "counterpartyName", label: "Cliente / fornecedor" },
  { key: "documentNumber", label: "Documento" },
  { key: "installmentLabel", label: "Parcela" },
  { key: "originalAmount", label: "Original", align: "right" },
  { key: "settledAmount", label: "Pago/Recebido", align: "right" },
  { key: "openBalance", label: "Saldo", align: "right" },
  { key: "nomusFinancialAccountName", label: "Conta Nomus" },
  { key: "destinationBucketLabel", label: "Agrupamento" },
];

function SortHeaderButton({
  column,
  sortKey,
  sortDir,
  onSort,
}: {
  column: SortableColumn;
  sortKey: TreasuryCrCpTitlesSortKey;
  sortDir: TreasuryCrCpTitlesSortDir;
  onSort: (key: TreasuryCrCpTitlesSortKey) => void;
}) {
  const active = sortKey === column.key;
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(column.key)}
      className={cn(
        "inline-flex items-center gap-1 font-bold uppercase tracking-wider transition-colors hover:text-[#111827]",
        column.align === "right" ? "w-full justify-end" : "",
        active ? "text-[#0F172A]" : "text-[#6B7280]"
      )}
      data-testid={`predictive-cf-crcp-sort-${column.key}`}
      aria-sort={
        active ? (sortDir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      {column.label}
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
    </button>
  );
}

function TitleRowsTable({
  titles,
  sortKey,
  sortDir,
  onSort,
  emptyLabel,
  side,
}: {
  titles: TreasuryCrCpTitleDto[];
  sortKey: TreasuryCrCpTitlesSortKey;
  sortDir: TreasuryCrCpTitlesSortDir;
  onSort: (key: TreasuryCrCpTitlesSortKey) => void;
  emptyLabel: string;
  side: "RECEIVABLE" | "PAYABLE";
}) {
  const {
    topScrollRef,
    mainScrollRef,
    tableRef,
    handleTopScroll,
    handleMainScroll,
    scrollContentWidth,
  } = useTableHorizontalScrollSync({
    minWidth: TITLE_TABLE_MIN_WIDTH,
    deps: [titles],
  });

  if (titles.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-[#6B7280]">{emptyLabel}</p>
    );
  }

  const mainScrollId = `predictive-cf-crcp-scroll-main-${side}`;

  return (
    <div className="min-w-0">
      <div
        ref={topScrollRef}
        className={TABLE_HORIZONTAL_TOP_SCROLL_CLASS}
        onScroll={handleTopScroll}
        data-testid={`predictive-cf-crcp-scroll-top-${side}`}
        aria-label={
          side === "RECEIVABLE"
            ? "Rolagem horizontal das contas a receber (topo)"
            : "Rolagem horizontal das contas a pagar (topo)"
        }
        role="scrollbar"
        aria-orientation="horizontal"
        aria-controls={mainScrollId}
      >
        <div style={{ width: scrollContentWidth, height: 12 }} aria-hidden />
      </div>
      <div
        id={mainScrollId}
        ref={mainScrollRef}
        className="overflow-x-auto"
        onScroll={handleMainScroll}
        data-testid={mainScrollId}
      >
        <table
          ref={tableRef}
          className="min-w-[980px] w-full border-collapse text-sm"
        >
          <thead className="sticky top-3 z-10 bg-[#F8FAFC]">
            <tr className="border-b border-[#E5E7EB] text-left text-[10px]">
              {TITLE_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className={cn(
                    "px-3 py-2.5",
                    column.align === "right" ? "text-right" : ""
                  )}
                >
                  <SortHeaderButton
                    column={column}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {titles.map((t) => (
              <tr
                key={`${t.side}-${t.id}`}
                className="border-b border-[#E5E7EB] last:border-0 hover:bg-[#F8FAFC]/40"
                data-testid={`predictive-cf-crcp-title-row-${side}-${t.id}`}
              >
                <td className="px-3 py-2.5 tabular-nums">
                  {t.dueDate ? formatPredictiveCashFlowDate(t.dueDate) : "—"}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={cn(
                      "inline-flex rounded-md px-2 py-0.5 text-xs font-semibold",
                      t.situation === "OVERDUE"
                        ? "bg-red-50 text-red-800"
                        : "bg-emerald-50 text-emerald-800"
                    )}
                  >
                    {t.situation === "OVERDUE" ? "Vencido" : "A vencer"}
                  </span>
                </td>
                <td className="px-3 py-2.5">{t.counterpartyName ?? "—"}</td>
                <td className="px-3 py-2.5">{t.documentNumber ?? "—"}</td>
                <td className="px-3 py-2.5">{t.installmentLabel ?? "—"}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {moneyLabel(t.originalAmount)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {moneyLabel(t.settledAmount)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                  {moneyLabel(t.openBalance)}
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {t.nomusFinancialAccountName
                    ? `${t.nomusFinancialAccountName}${
                        t.nomusFinancialAccountId
                          ? ` (#${t.nomusFinancialAccountId})`
                          : ""
                      }`
                    : t.nomusFinancialAccountId
                      ? `#${t.nomusFinancialAccountId}`
                      : "Sem conta financeira"}
                  {t.unlinkedReasonLabel ? (
                    <span className="mt-0.5 block text-[#B45309]">
                      {t.unlinkedReasonLabel}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 text-xs">{t.destinationBucketLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TitleDetailDialog({
  group,
  onClose,
}: {
  group: TreasuryCrCpAccountGroupDto;
  onClose: () => void;
}) {
  const [filters, setFilters] = useState<TreasuryCrCpTitlesPresentationFilters>(
    EMPTY_TREASURY_CRCP_TITLES_FILTERS
  );
  const [sortKey, setSortKey] = useState<TreasuryCrCpTitlesSortKey>("dueDate");
  const [sortDir, setSortDir] = useState<TreasuryCrCpTitlesSortDir>("asc");

  const allTitles = useMemo(
    () => [...group.receivableTitles, ...group.payableTitles],
    [group]
  );
  const counterparties = useMemo(
    () => listTreasuryCrCpTitleCounterparties(allTitles),
    [allTitles]
  );

  const receivableTitles = useMemo(
    () =>
      presentTreasuryCrCpTitles(
        group.receivableTitles,
        filters,
        sortKey,
        sortDir
      ),
    [group.receivableTitles, filters, sortKey, sortDir]
  );
  const payableTitles = useMemo(
    () =>
      presentTreasuryCrCpTitles(group.payableTitles, filters, sortKey, sortDir),
    [group.payableTitles, filters, sortKey, sortDir]
  );

  useEffect(() => {
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
  }, [onClose]);

  const onSort = (key: TreasuryCrCpTitlesSortKey) => {
    const next = toggleTreasuryCrCpTitlesSort(sortKey, sortDir, key);
    setSortKey(next.sortKey);
    setSortDir(next.sortDir);
  };

  const filtersActive =
    filters.situation !== "ALL" ||
    Boolean(filters.counterparty.trim()) ||
    Boolean(filters.query.trim());

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex flex-col bg-[#F8FAFC]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="predictive-cf-crcp-titles-title"
      data-testid="predictive-cf-crcp-titles-dialog"
    >
      <header className="shrink-0 border-b border-[#E5E7EB] bg-white px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
              Tesouraria · apresentação de títulos
            </p>
            <h3
              id="predictive-cf-crcp-titles-title"
              className="truncate text-lg font-extrabold text-[#111827] sm:text-xl"
            >
              Títulos · {group.accountName}
            </h3>
            <p className="mt-1 text-sm text-[#6B7280]">
              <span className="font-semibold text-emerald-700">
                CR {group.accountsReceivableCount}
              </span>
              {" · "}
              <span className="font-semibold text-red-700">
                CP {group.accountsPayableCount}
              </span>
              {" · "}
              Liquidez{" "}
              <span className="font-semibold tabular-nums text-[#111827]">
                {moneyLabel(group.netMovement)}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-semibold text-[#111827] hover:bg-[#F8FAFC]"
            aria-label="Fechar"
            data-testid="predictive-cf-crcp-titles-close"
          >
            <X className="h-4 w-4" />
            Fechar
          </button>
        </div>

        <div
          className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto_auto_auto]"
          data-testid="predictive-cf-crcp-titles-filters"
        >
          <label className="min-w-0">
            <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
              Cliente / fornecedor
            </span>
            <select
              className={FILTER_CONTROL_CLASS}
              data-testid="predictive-cf-crcp-filter-counterparty"
              value={filters.counterparty}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  counterparty: event.target.value,
                }))
              }
            >
              <option value="">Todos</option>
              {counterparties.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <label className="min-w-0">
            <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
              Busca
            </span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                className={cn(FILTER_CONTROL_CLASS, "pl-8")}
                data-testid="predictive-cf-crcp-filter-query"
                placeholder="Documento, parcela, conta…"
                value={filters.query}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    query: event.target.value,
                  }))
                }
              />
            </div>
          </label>

          <div className="flex flex-wrap items-end gap-1.5 sm:col-span-2">
            {(
              [
                ["ALL", "Todos"],
                ["OVERDUE", "Vencidos"],
                ["UPCOMING", "A vencer"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() =>
                  setFilters((current) => ({ ...current, situation: id }))
                }
                className={cn(
                  "h-9 rounded-lg border px-3 text-xs font-semibold",
                  filters.situation === id
                    ? "border-sky-300 bg-sky-50 text-sky-950"
                    : "border-[#E5E7EB] bg-white text-[#374151]"
                )}
                data-testid={`predictive-cf-crcp-filter-situation-${id}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-end">
            <button
              type="button"
              className="inline-flex h-9 w-full items-center justify-center rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs font-semibold text-[#111827] hover:bg-[#F8FAFC] disabled:opacity-40"
              data-testid="predictive-cf-crcp-filters-clear"
              disabled={!filtersActive}
              onClick={() => setFilters(EMPTY_TREASURY_CRCP_TITLES_FILTERS)}
            >
              Limpar filtros
            </button>
          </div>
        </div>
      </header>

      <div
        className="min-h-0 flex-1 overflow-auto p-3 sm:p-4"
        data-testid="predictive-cf-crcp-titles-body"
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <section
            className="flex min-h-[280px] flex-col overflow-hidden rounded-xl border border-emerald-200/80 bg-white shadow-sm"
            data-testid="predictive-cf-crcp-section-receivable"
          >
            <div className="flex items-center justify-between gap-2 border-b border-emerald-100 bg-emerald-50/70 px-4 py-3">
              <div>
                <h4 className="text-sm font-extrabold text-emerald-950">
                  Contas a receber
                </h4>
                <p className="text-xs text-emerald-800/80">
                  {receivableTitles.length} título(s) · saldo{" "}
                  <span className="font-semibold tabular-nums">
                    {moneyLabel(group.accountsReceivableTotal)}
                  </span>
                </p>
              </div>
              <span className="rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                CR
              </span>
            </div>
            <TitleRowsTable
              titles={receivableTitles}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              emptyLabel="Nenhum título a receber neste filtro."
              side="RECEIVABLE"
            />
          </section>

          <section
            className="flex min-h-[280px] flex-col overflow-hidden rounded-xl border border-red-200/80 bg-white shadow-sm"
            data-testid="predictive-cf-crcp-section-payable"
          >
            <div className="flex items-center justify-between gap-2 border-b border-red-100 bg-red-50/70 px-4 py-3">
              <div>
                <h4 className="text-sm font-extrabold text-red-950">
                  Contas a pagar
                </h4>
                <p className="text-xs text-red-800/80">
                  {payableTitles.length} título(s) · saldo{" "}
                  <span className="font-semibold tabular-nums">
                    {moneyLabel(group.accountsPayableTotal)}
                  </span>
                </p>
              </div>
              <span className="rounded-md bg-red-600 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                CP
              </span>
            </div>
            <TitleRowsTable
              titles={payableTitles}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              emptyLabel="Nenhum título a pagar neste filtro."
              side="PAYABLE"
            />
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function PredictiveCashFlowAccountCrCpPanel({
  companyCode,
  fromDate,
  toDate,
}: PredictiveCashFlowAccountCrCpPanelProps) {
  const [board, setBoard] = useState<TreasuryCrCpByAccountBoardDto | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailGroup, setDetailGroup] =
    useState<TreasuryCrCpAccountGroupDto | null>(null);

  useEffect(() => {
    if (!companyCode?.trim() || !fromDate || !toDate) {
      setBoard(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchTreasuryPredictiveCrCpByAccount({
      companyCode,
      fromDate,
      toDate,
      signal: controller.signal,
    })
      .then((payload) => {
        if (!controller.signal.aborted) setBoard(payload);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          err instanceof Error
            ? err.message
            : "Não foi possível carregar CR e CP por conta."
        );
        setBoard(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [companyCode, fromDate, toDate]);

  const groups = board?.groups ?? [];
  const totals = board?.totals;

  return (
    <section
      className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-none"
      data-testid="predictive-cf-account-crcp"
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-base font-extrabold tracking-tight text-[#111827]">
            CR e CP por conta
          </h3>
          <p className="mt-1 text-sm text-[#6B7280]">
            Contas a receber e a pagar oficiais agrupadas pelo ID Nomus da conta
            financeira · horizonte{" "}
            <span className="font-semibold tabular-nums text-[#111827]">
              {formatPredictiveCashFlowDate(fromDate)}
            </span>
            {" → "}
            <span className="font-semibold tabular-nums text-[#111827]">
              {formatPredictiveCashFlowDate(toDate)}
            </span>
          </p>
        </div>
      </div>

      {!companyCode ? (
        <p className="rounded-lg border border-dashed border-[#E5E7EB] px-4 py-8 text-center text-sm text-[#6B7280]">
          Informe a empresa para carregar CR e CP.
        </p>
      ) : loading && !board ? (
        <p className="rounded-lg border border-dashed border-[#E5E7EB] px-4 py-8 text-center text-sm text-[#6B7280]">
          Carregando títulos…
        </p>
      ) : error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          role="alert"
        >
          {error}
        </p>
      ) : groups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[#E5E7EB] px-4 py-8 text-center text-sm text-[#6B7280]">
          Nenhum título aberto no horizonte.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E5E7EB]">
          <table className="min-w-[820px] w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F8FAFC] text-left text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                <th className="px-3 py-2.5">Conta / banco</th>
                <th className="px-3 py-2.5 text-right">CR a receber</th>
                <th className="px-3 py-2.5 text-right">Títulos CR</th>
                <th className="px-3 py-2.5 text-right">CP a pagar</th>
                <th className="px-3 py-2.5 text-right">Títulos CP</th>
                <th className="px-3 py-2.5 text-right">Líquido</th>
                <th className="px-3 py-2.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((row) => (
                <tr
                  key={row.treasuryAccountId}
                  className={cn(
                    "border-b border-[#E5E7EB] last:border-0",
                    row.isUnlinked ? "bg-amber-50/40" : ""
                  )}
                  data-testid={`predictive-cf-crcp-${row.treasuryAccountId}`}
                >
                  <td className="px-3 py-3">
                    <div className="flex items-start gap-2">
                      <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-[#6B7280]" />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[#111827]">
                          {row.accountName}
                        </p>
                        <p className="truncate text-xs text-[#6B7280]">
                          {row.isUnlinked
                            ? "Sem saldo bancário próprio"
                            : row.institutionName ??
                              (row.nomusFinancialAccountId
                                ? `Nomus #${row.nomusFinancialAccountId}`
                                : "—")}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold text-[#059669]">
                    {moneyLabel(row.accountsReceivableTotal)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-[#6B7280]">
                    {row.accountsReceivableCount}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold text-[#DC2626]">
                    {moneyLabel(row.accountsPayableTotal)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-[#6B7280]">
                    {row.accountsPayableCount}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-3 text-right tabular-nums font-extrabold",
                      treasuryMoneyToNumber(row.netMovement) >= 0
                        ? "text-[#059669]"
                        : "text-[#DC2626]"
                    )}
                  >
                    {moneyLabel(row.netMovement)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setDetailGroup(row)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#111827] hover:bg-[#F8FAFC]"
                      data-testid={`predictive-cf-crcp-view-${row.treasuryAccountId}`}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Ver títulos
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {totals ? (
              <tfoot>
                <tr
                  className="border-t-2 border-[#111827] bg-[#F1F5F9]"
                  data-testid="predictive-cf-crcp-totals"
                >
                  <td className="px-3 py-3.5 font-extrabold text-[#111827]">
                    Total consolidado
                  </td>
                  <td className="px-3 py-3.5 text-right tabular-nums font-extrabold text-[#059669]">
                    {moneyLabel(totals.accountsReceivableTotal)}
                  </td>
                  <td className="px-3 py-3.5 text-right tabular-nums text-[#6B7280]">
                    {totals.accountsReceivableCount}
                  </td>
                  <td className="px-3 py-3.5 text-right tabular-nums font-extrabold text-[#DC2626]">
                    {moneyLabel(totals.accountsPayableTotal)}
                  </td>
                  <td className="px-3 py-3.5 text-right tabular-nums text-[#6B7280]">
                    {totals.accountsPayableCount}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-3.5 text-right tabular-nums font-extrabold",
                      treasuryMoneyToNumber(totals.netMovement) >= 0
                        ? "text-[#059669]"
                        : "text-[#DC2626]"
                    )}
                  >
                    {moneyLabel(totals.netMovement)}
                  </td>
                  <td className="px-3 py-3.5" />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}

      {detailGroup ? (
        <TitleDetailDialog
          group={detailGroup}
          onClose={() => setDetailGroup(null)}
        />
      ) : null}

      <span className="sr-only" data-testid="predictive-cf-crcp-unlinked-id">
        {TREASURY_CRCP_UNLINKED_ID}
      </span>
    </section>
  );
}
