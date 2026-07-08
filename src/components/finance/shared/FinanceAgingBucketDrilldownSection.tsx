import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import { FinanceArHorizonExportButtons } from "@/src/components/finance/FinanceArHorizonExportButtons";
import {
  FinanceArHorizonBucketCustomerFilter,
  horizonCustomerLabelFromSelection,
  horizonCustomerQueryFromSelection,
} from "@/src/components/finance/FinanceArHorizonBucketCustomerFilter";
import type { EntityAutocompleteSelection } from "@/src/lib/customerSearch";
import type { FinanceArHorizonBucketCustomer } from "@/src/lib/financeArHorizonBucketCustomers";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import type { FinanceApTitlesPayload } from "@/src/lib/financeAccountsPayableTitles";
import type { FinanceArTitlesPayload } from "@/src/lib/financeAccountsReceivableTitles";
import { buildFinanceApTitlesQuery } from "@/src/lib/financeAccountsPayableDashboardTypes";
import { buildFinanceArTitlesQuery } from "@/src/lib/financeAccountsReceivableDashboardTypes";
import type { FinanceApUiFilters } from "@/src/lib/financeAccountsPayableDashboardTypes";
import type { FinanceArUiFilters } from "@/src/lib/financeAccountsReceivableDashboardTypes";
import type { FinanceAgingBucketCardSource } from "@/src/lib/financeAgingBucketDrilldownTypes";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDaysOverdue,
  formatFinanceInteger,
  resolveFinanceLaunchDescription,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  formatFinanceCalculatedStatus,
} from "@/src/lib/financeAccountsPayableFormat";
import { StatusBadge } from "@/src/components/finance/FinanceAccountsReceivableTabPanels";

type FinanceAgingDrilldownModule = "ar" | "ap";

type Props = {
  module: FinanceAgingDrilldownModule;
  cards: FinanceAgingBucketCardSource[];
  filters: FinanceArUiFilters | FinanceApUiFilters;
  /** Horizonte financeiro: ignora filtros de período; AR usa carteira aberta global dos cards. */
  horizonMode?: boolean;
  /** Texto adicional abaixo do título do grid (horizonte AR). */
  horizonDrilldownNote?: string;
  loadingCards?: boolean;
  cardTone?: (key: string) => "neutral" | "danger" | "warning" | "info";
};

function AgingBucketCard({
  card,
  active,
  loading,
  onSelect,
  tone = "neutral",
}: {
  card: FinanceAgingBucketCardSource;
  active: boolean;
  loading?: boolean;
  onSelect: () => void;
  tone?: "neutral" | "danger" | "warning" | "info";
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "text-left rounded-xl transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40",
        active && "ring-2 ring-[#2563EB] shadow-sm"
      )}
    >
      <FinanceExecutiveTotalizerCard
        label={card.label}
        value={loading ? "…" : formatFinanceKpiCurrency(card.amount)}
        subtitle={card.count > 0 ? `${card.count} título(s)` : "—"}
        compact
        loading={loading}
        tone={tone}
      />
    </button>
  );
}

export function FinanceAgingBucketDrilldownSection({
  module,
  cards,
  filters,
  horizonMode = false,
  horizonDrilldownNote,
  loadingCards = false,
  cardTone,
}: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<FinanceArTitlesPayload | FinanceApTitlesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gridSearch, setGridSearch] = useState("");
  const [gridSearchDraft, setGridSearchDraft] = useState("");
  const [customerSelection, setCustomerSelection] = useState<EntityAutocompleteSelection | null>(null);
  const [bucketCustomers, setBucketCustomers] = useState<FinanceArHorizonBucketCustomer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  const selectedCard = cards.find((c) => c.key === selectedKey) ?? null;
  const horizonCustomerQuery = useMemo(
    () => horizonCustomerQueryFromSelection(customerSelection),
    [customerSelection]
  );
  const selectedCustomerLabel = horizonCustomerLabelFromSelection(customerSelection);
  const hasHorizonGridFilters = Boolean(gridSearch.trim() || customerSelection);

  const handleCardClick = (key: string) => {
    setSelectedKey((current) => (current === key ? null : key));
    setPage(1);
    setGridSearch("");
    setGridSearchDraft("");
    setCustomerSelection(null);
  };

  const load = useCallback(async () => {
    if (!selectedKey) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs =
        module === "ar"
          ? buildFinanceArTitlesQuery(filters as FinanceArUiFilters, {
              page,
              limit: 25,
              sortBy: "dueDate",
              sortDirection: "desc",
              agingBucket: selectedKey,
              ...(horizonMode
                ? {
                    search: gridSearch,
                    ...horizonCustomerQuery,
                  }
                : {}),
            })
          : buildFinanceApTitlesQuery(filters as FinanceApUiFilters, {
              page,
              limit: 25,
              sortBy: "dueDate",
              sortDirection: "desc",
              agingBucket: selectedKey,
            });
      const endpoint =
        module === "ar"
          ? `/api/finance/accounts-receivable/titles?${qs}`
          : `/api/finance/accounts-payable/titles?${qs}`;
      const payload = await fetchJsonOk<FinanceArTitlesPayload | FinanceApTitlesPayload>(endpoint);
      setData(payload);
    } catch (e) {
      setData(null);
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível carregar os títulos desta faixa."
      );
    } finally {
      setLoading(false);
    }
  }, [filters, gridSearch, horizonCustomerQuery, horizonMode, module, page, selectedKey]);

  const loadBucketCustomers = useCallback(async () => {
    if (!selectedKey || module !== "ar" || !horizonMode) {
      setBucketCustomers([]);
      return;
    }
    setLoadingCustomers(true);
    try {
      const payload = await fetchJsonOk<{ items: FinanceArHorizonBucketCustomer[] }>(
        `/api/finance/accounts-receivable/horizon/bucket-customers?agingBucket=${encodeURIComponent(selectedKey)}`
      );
      setBucketCustomers(payload.items ?? []);
    } catch {
      setBucketCustomers([]);
    } finally {
      setLoadingCustomers(false);
    }
  }, [horizonMode, module, selectedKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadBucketCustomers();
  }, [loadBucketCustomers]);

  useEffect(() => {
    setSelectedKey(null);
    setPage(1);
    setGridSearch("");
    setGridSearchDraft("");
    setCustomerSelection(null);
    setBucketCustomers([]);
  }, [filters, horizonMode]);

  if (!cards.length && !loadingCards) return null;

  return (
    <div className="space-y-4">
      <SummaryKpiGrid minColumnWidth={180} className={SYSTEM_TOTALIZER_GRID_CLASS}>
        {loadingCards
          ? Array.from({ length: Math.min(cards.length || 6, 8) }, (_, index) => (
              <React.Fragment key={`aging-skeleton-${index}`}>
                <FinanceExecutiveTotalizerCard label="…" value="…" loading compact />
              </React.Fragment>
            ))
          : cards.map((card) => (
              <React.Fragment key={card.key}>
                <AgingBucketCard
                  card={card}
                  active={selectedKey === card.key}
                  onSelect={() => handleCardClick(card.key)}
                  tone={cardTone?.(card.key)}
                />
              </React.Fragment>
            ))}
      </SummaryKpiGrid>

      {selectedCard ? (
        <div className={cn(financeBiCardClass, "p-4 space-y-3")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-[#111827]">
                Títulos da faixa: {selectedCard.label}
              </h3>
              <p className="text-[11px] text-[#6B7280] mt-0.5">
                {horizonMode
                  ? "Listando os títulos que compõem o card selecionado no horizonte financeiro."
                  : "Listando os títulos que compõem o card selecionado, respeitando os filtros atuais."}
              </p>
              {horizonMode && horizonDrilldownNote ? (
                <p className="text-[10px] text-[#9CA3AF] mt-1 leading-snug">{horizonDrilldownNote}</p>
              ) : null}
              {data?.bucketTotals ? (
                <p className="text-[10px] text-[#9CA3AF] mt-1">
                  {hasHorizonGridFilters && module === "ar" && horizonMode
                    ? "Total filtrado"
                    : "Total"}
                  : {formatFinanceCurrency(data.bucketTotals.openBalanceAmount)} ·{" "}
                  {formatFinanceInteger(data.bucketTotals.titlesCount)} título(s)
                  {selectedCustomerLabel && module === "ar" && horizonMode ? (
                    <>
                      {" "}
                      · Cliente: {selectedCustomerLabel}
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {module === "ar" && horizonMode ? (
                <FinanceArHorizonExportButtons
                  agingBucket={selectedKey}
                  bucketLabel={selectedCard.label}
                  disabled={loading}
                  testIdPrefix="finance-ar-horizon-bucket"
                  search={gridSearch}
                  customerId={horizonCustomerQuery.customerId}
                  customerName={horizonCustomerQuery.customerName}
                />
              ) : null}
              <button
                type="button"
                onClick={() => setSelectedKey(null)}
                className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
              >
                <X className="h-3.5 w-3.5" />
                Limpar seleção
              </button>
            </div>
          </div>

          {module === "ar" && horizonMode ? (
            <div
              className="flex flex-wrap items-end gap-2 pt-1"
              data-testid="finance-ar-horizon-bucket-grid-filters"
            >
              <label className="space-y-1 min-w-[180px] flex-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
                  Busca geral
                </span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" />
                  <input
                    type="search"
                    value={gridSearchDraft}
                    onChange={(e) => setGridSearchDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setGridSearch(gridSearchDraft.trim());
                        setPage(1);
                      }
                    }}
                    onBlur={() => {
                      if (gridSearchDraft.trim() !== gridSearch.trim()) {
                        setGridSearch(gridSearchDraft.trim());
                        setPage(1);
                      }
                    }}
                    placeholder="Documento, descrição, NF…"
                    className="h-8 w-full rounded-md border border-[#E5E7EB] bg-white pl-8 pr-2 text-[11px] text-[#111827] placeholder:text-[#9CA3AF]"
                    data-testid="finance-ar-horizon-bucket-search"
                  />
                </div>
              </label>
              <FinanceArHorizonBucketCustomerFilter
                customers={bucketCustomers}
                value={customerSelection}
                loading={loadingCustomers}
                disabled={loading}
                onChange={(selection) => {
                  setCustomerSelection(selection);
                  setPage(1);
                }}
              />
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando títulos da faixa...
            </div>
          ) : error ? (
            <p className="text-sm text-destructive py-4">{error}</p>
          ) : !data?.items.length ? (
            <p className="text-sm text-muted-foreground py-4">
              Nenhum título encontrado para esta faixa com os filtros atuais.
            </p>
          ) : module === "ar" && horizonMode ? (
            <ArHorizonDrilldownTable data={data as FinanceArTitlesPayload} />
          ) : module === "ar" ? (
            <ArDrilldownTable data={data as FinanceArTitlesPayload} />
          ) : (
            <ApDrilldownTable data={data as FinanceApTitlesPayload} />
          )}

          {data && data.totalPages > 1 ? (
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E5E7EB]">
              <p className="text-[11px] text-[#6B7280]">
                Página {data.page} de {data.totalPages} · {formatFinanceInteger(data.total)} título(s)
              </p>
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={data.page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-[#E5E7EB] p-1.5 disabled:opacity-40"
                  aria-label="Página anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={data.page >= data.totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded border border-[#E5E7EB] p-1.5 disabled:opacity-40"
                  aria-label="Próxima página"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LaunchDescriptionCell({ description }: { description: string | null }) {
  const resolved = resolveFinanceLaunchDescription({ description });
  const label = displayFinanceText(resolved);
  return (
    <td className="px-3 py-2 max-w-[220px] truncate" title={resolved ?? undefined}>
      {label}
    </td>
  );
}

function resolveArHorizonDocument(row: FinanceArTitlesPayload["items"][number]): string | null {
  return row.sourceInvoiceNumber?.trim() || row.personCnpj?.trim() || null;
}

function ArHorizonDrilldownTable({ data }: { data: FinanceArTitlesPayload }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[#E5E7EB]">
      <table className="min-w-full text-[11px]">
        <thead className="bg-[#F9FAFB] text-[#6B7280]">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Cliente</th>
            <th className="px-3 py-2 text-left font-semibold">Documento</th>
            <th className="px-3 py-2 text-left font-semibold">Vencimento</th>
            <th className="px-3 py-2 text-right font-semibold">Dias</th>
            <th className="px-3 py-2 text-right font-semibold">Valor a receber</th>
            <th className="px-3 py-2 text-right font-semibold">Saldo</th>
            <th className="px-3 py-2 text-left font-semibold">Status</th>
            <th className="px-3 py-2 text-left font-semibold">Descrição do lançamento</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((row) => (
            <tr key={row.externalId} className="border-t border-[#F3F4F6]">
              <td className="px-3 py-2 max-w-[180px] truncate" title={row.personName ?? undefined}>
                {displayFinanceText(row.personName)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {displayFinanceText(resolveArHorizonDocument(row))}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{formatFinanceDate(row.dueDate)}</td>
              <td className="px-3 py-2 text-right">{formatFinanceDaysOverdue(row.daysOverdue)}</td>
              <td className="px-3 py-2 text-right">{formatFinanceCurrency(row.amountReceivable)}</td>
              <td className="px-3 py-2 text-right font-medium">
                {formatFinanceCurrency(row.balanceReceivable)}
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={row.calculatedStatus} />
              </td>
              <LaunchDescriptionCell description={row.description} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ArDrilldownTable({ data }: { data: FinanceArTitlesPayload }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[#E5E7EB]">
      <table className="min-w-full text-[11px]">
        <thead className="bg-[#F9FAFB] text-[#6B7280]">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Cliente</th>
            <th className="px-3 py-2 text-left font-semibold">Documento / NF</th>
            <th className="px-3 py-2 text-left font-semibold">Empresa</th>
            <th className="px-3 py-2 text-left font-semibold">Vencimento</th>
            <th className="px-3 py-2 text-right font-semibold">Dias</th>
            <th className="px-3 py-2 text-right font-semibold">Valor original</th>
            <th className="px-3 py-2 text-right font-semibold">Em aberto</th>
            <th className="px-3 py-2 text-left font-semibold">Status</th>
            <th className="px-3 py-2 text-left font-semibold">Descrição do lançamento</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((row) => (
            <tr key={row.externalId} className="border-t border-[#F3F4F6]">
              <td className="px-3 py-2">{displayFinanceText(row.personName)}</td>
              <td className="px-3 py-2">
                {displayFinanceText(row.sourceInvoiceNumber ?? row.description)}
              </td>
              <td className="px-3 py-2">{displayFinanceText(row.companyName)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{formatFinanceDate(row.dueDate)}</td>
              <td className="px-3 py-2 text-right">{formatFinanceDaysOverdue(row.daysOverdue)}</td>
              <td className="px-3 py-2 text-right">{formatFinanceCurrency(row.amountReceivable)}</td>
              <td className="px-3 py-2 text-right font-medium">
                {formatFinanceCurrency(row.balanceReceivable)}
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={row.calculatedStatus} />
              </td>
              <LaunchDescriptionCell description={row.description} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApDrilldownTable({ data }: { data: FinanceApTitlesPayload }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[#E5E7EB]">
      <table className="min-w-full text-[11px]">
        <thead className="bg-[#F9FAFB] text-[#6B7280]">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Fornecedor</th>
            <th className="px-3 py-2 text-left font-semibold">Documento</th>
            <th className="px-3 py-2 text-left font-semibold">Vencimento</th>
            <th className="px-3 py-2 text-right font-semibold">Dias</th>
            <th className="px-3 py-2 text-right font-semibold">Valor a pagar</th>
            <th className="px-3 py-2 text-right font-semibold">Saldo</th>
            <th className="px-3 py-2 text-left font-semibold">Status</th>
            <th className="px-3 py-2 text-left font-semibold">Descrição do lançamento</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((row) => (
            <tr key={row.externalId} className="border-t border-[#F3F4F6]">
              <td className="px-3 py-2">{displayFinanceText(row.personName)}</td>
              <td className="px-3 py-2">{displayFinanceText(row.documentNumber)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {formatFinanceDate(row.operationalDueDate ?? row.dueDate)}
              </td>
              <td className="px-3 py-2 text-right">{formatFinanceDaysOverdue(row.daysOverdue)}</td>
              <td className="px-3 py-2 text-right">{formatFinanceCurrency(row.amountPayable)}</td>
              <td className="px-3 py-2 text-right font-medium">
                {formatFinanceCurrency(row.balancePayable)}
              </td>
              <td className="px-3 py-2">{formatFinanceCalculatedStatus(row.calculatedStatus)}</td>
              <LaunchDescriptionCell description={row.description} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
