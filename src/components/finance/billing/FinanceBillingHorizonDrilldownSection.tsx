import React, { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import type { FinanceAgingBucketCardSource } from "@/src/lib/financeAgingBucketDrilldownTypes";
import type { FinanceBillingHorizonDrilldownPayload } from "@/src/lib/financeBillingHorizonDrilldownTypes";
import {
  buildFinanceBillingHorizonDrilldownQuery,
  type FinanceBillingHorizonDrilldownFilters,
} from "@/src/lib/financeBillingHorizonDrilldownTypes";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";

type Props = {
  cards: FinanceAgingBucketCardSource[];
  filters: FinanceBillingHorizonDrilldownFilters;
  countUnitLabel?: string;
  loadingCards?: boolean;
};

function HorizonBucketCard({
  card,
  active,
  loading,
  onSelect,
  countUnitLabel,
}: {
  card: FinanceAgingBucketCardSource;
  active: boolean;
  loading?: boolean;
  onSelect: () => void;
  countUnitLabel: string;
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
        subtitle={card.count > 0 ? `${card.count} ${countUnitLabel}` : "—"}
        compact
        loading={loading}
      />
    </button>
  );
}

function OperationNatureCell({ value }: { value: string | null }) {
  const label = displayFinanceText(value);
  return (
    <td className="px-3 py-2 max-w-[220px] truncate" title={value ?? undefined}>
      {label}
    </td>
  );
}

function BillingHorizonDrilldownTable({ data }: { data: FinanceBillingHorizonDrilldownPayload }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[#E5E7EB]">
      <table className="min-w-full text-[11px]">
        <thead className="bg-[#F9FAFB] text-[#6B7280]">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Cliente</th>
            <th className="px-3 py-2 text-left font-semibold">Pedido</th>
            <th className="px-3 py-2 text-left font-semibold">Nº NF-e</th>
            <th className="px-3 py-2 text-left font-semibold">Série</th>
            <th className="px-3 py-2 text-left font-semibold">Prev. entrega</th>
            <th className="px-3 py-2 text-right font-semibold">Valor</th>
            <th className="px-3 py-2 text-left font-semibold">Status</th>
            <th className="px-3 py-2 text-left font-semibold">Descrição / Natureza</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((row) => (
            <tr key={row.orderId} className="border-t border-[#F3F4F6]">
              <td className="px-3 py-2 max-w-[200px]">
                <div className="font-medium truncate" title={row.customerName}>
                  {displayFinanceText(row.customerName)}
                </div>
                {row.customerDocument ? (
                  <div
                    className="text-[10px] text-[#9CA3AF] tabular-nums truncate"
                    title={row.customerDocument}
                  >
                    {row.customerDocument}
                  </div>
                ) : null}
              </td>
              <td className="px-3 py-2 whitespace-nowrap font-semibold">
                {displayFinanceText(row.orderCode)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{displayFinanceText(row.nfeNumber)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{displayFinanceText(row.nfeSerie)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {formatFinanceDate(row.expectedDeliveryDate)}
              </td>
              <td className="px-3 py-2 text-right font-medium">
                {formatFinanceCurrency(row.totalNetValue)}
              </td>
              <td className="px-3 py-2">{displayFinanceText(row.statusLabel)}</td>
              <OperationNatureCell value={row.operationNature} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FinanceBillingHorizonDrilldownSection({
  cards,
  filters,
  countUnitLabel = "pedido(s)",
  loadingCards = false,
}: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<FinanceBillingHorizonDrilldownPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCard = cards.find((c) => c.key === selectedKey) ?? null;

  const handleCardClick = (key: string) => {
    setSelectedKey((current) => (current === key ? null : key));
    setPage(1);
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
      const qs = buildFinanceBillingHorizonDrilldownQuery(filters, {
        horizonBucket: selectedKey,
        page,
        limit: 25,
      });
      const payload = await fetchJsonOk<FinanceBillingHorizonDrilldownPayload>(
        `/api/finance/billing/horizon/orders?${qs}`
      );
      setData(payload);
    } catch (e) {
      setData(null);
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível carregar os pedidos desta faixa."
      );
    } finally {
      setLoading(false);
    }
  }, [filters, page, selectedKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelectedKey(null);
    setPage(1);
  }, [filters]);

  if (!cards.length && !loadingCards) return null;

  return (
    <div className="space-y-4">
      <SummaryKpiGrid minColumnWidth={180} className={SYSTEM_TOTALIZER_GRID_CLASS}>
        {loadingCards
          ? Array.from({ length: Math.min(cards.length || 6, 8) }, (_, index) => (
              <React.Fragment key={`billing-horizon-skeleton-${index}`}>
                <FinanceExecutiveTotalizerCard label="…" value="…" loading compact />
              </React.Fragment>
            ))
          : cards.map((card) => (
              <React.Fragment key={card.key}>
                <HorizonBucketCard
                  card={card}
                  active={selectedKey === card.key}
                  onSelect={() => handleCardClick(card.key)}
                  loading={loadingCards}
                  countUnitLabel={countUnitLabel}
                />
              </React.Fragment>
            ))}
      </SummaryKpiGrid>

      {selectedCard ? (
        <div className={cn(financeBiCardClass, "p-4 space-y-3")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-[#111827]">
                Pedidos da faixa: {selectedCard.label}
              </h3>
              <p className="text-[11px] text-[#6B7280] mt-0.5">
                Carteira prevista de pedidos não faturados — mesma regra dos cards de horizonte
                (data prevista de entrega). Respeita filtros de cliente e documento.
              </p>
              {data?.bucketTotals ? (
                <p className="text-[10px] text-[#9CA3AF] mt-1">
                  Total: {formatFinanceCurrency(data.bucketTotals.amount)} ·{" "}
                  {formatFinanceInteger(data.bucketTotals.ordersCount)} {countUnitLabel}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setSelectedKey(null)}
              className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
            >
              <X className="h-3.5 w-3.5" />
              Limpar seleção
            </button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando pedidos da faixa...
            </div>
          ) : error ? (
            <p className="text-sm text-destructive py-4">{error}</p>
          ) : !data?.items.length ? (
            <p className="text-sm text-muted-foreground py-4">
              Nenhum pedido encontrado para esta faixa com os filtros atuais.
            </p>
          ) : (
            <BillingHorizonDrilldownTable data={data} />
          )}

          {data && data.totalPages > 1 ? (
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E5E7EB]">
              <p className="text-[11px] text-[#6B7280]">
                Página {data.page} de {data.totalPages} · {formatFinanceInteger(data.total)}{" "}
                {countUnitLabel}
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
