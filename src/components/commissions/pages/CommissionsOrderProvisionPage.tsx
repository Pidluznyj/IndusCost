import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import {
  COMMISSIONS_FILTER_FIELD_CLASS,
  COMMISSIONS_FILTER_LABEL_CLASS,
  buildCommissionsYearOptions,
} from "@/src/lib/commissionsPeriodFilter";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsKpiSection,
  CommissionsLoading,
  CommissionsSectionIntro,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import {
  SystemTotalizerCard,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
} from "@/src/components/ui/SystemTotalizerCard";
import { cn } from "@/src/lib/utils";
import type { CommissionOrderProvisionPayload } from "@/src/lib/commissions/commissionOrderProvision.shared";
import { formatSalesOrderDisplayCode } from "@/src/lib/salesOrderListUi";

const MONTH_OPTIONS = [
  { value: "", label: "Todos os meses" },
  { value: "1", label: "Janeiro" },
  { value: "2", label: "Fevereiro" },
  { value: "3", label: "Março" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Maio" },
  { value: "6", label: "Junho" },
  { value: "7", label: "Julho" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
];

function formatDatePt(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export function CommissionsOrderProvisionPage() {
  const yearOptions = useMemo(() => buildCommissionsYearOptions(), []);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [customer, setCustomer] = useState("");
  const [orderCode, setOrderCode] = useState("");
  const [includeZero, setIncludeZero] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<CommissionOrderProvisionPayload | null>(
    null
  );
  const [selectedSellerKey, setSelectedSellerKey] = useState<string | null>(null);
  const [selectedCanonicalSellerId, setSelectedCanonicalSellerId] = useState<
    string | null
  >(null);
  const [selectedRawSellerId, setSelectedRawSellerId] = useState<number | null>(
    null
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (year) params.set("year", year);
      if (month) params.set("month", month);
      if (customer.trim()) params.set("customer", customer.trim());
      if (orderCode.trim()) params.set("orderCode", orderCode.trim());
      if (includeZero) params.set("includeZeroCommission", "true");
      if (selectedCanonicalSellerId) {
        params.set("canonicalSellerId", selectedCanonicalSellerId);
      } else if (selectedRawSellerId != null) {
        params.set("rawSellerId", String(selectedRawSellerId));
      }
      params.set("page", String(page));
      params.set("pageSize", "50");

      const data = await fetchJsonOk<CommissionOrderProvisionPayload>(
        `/api/commissions/order-provision?${params.toString()}`
      );
      setPayload(data);
    } catch (err) {
      setPayload(null);
      setError(formatCommissionsApiError(err));
    } finally {
      setLoading(false);
    }
  }, [
    year,
    month,
    customer,
    orderCode,
    includeZero,
    page,
    selectedCanonicalSellerId,
    selectedRawSellerId,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const displayRows = useMemo(() => {
    if (!payload) return [];
    if (!sellerName.trim()) return payload.rows;
    const needle = sellerName.trim().toLowerCase();
    return payload.rows.filter((row) => {
      const name = (
        row.canonicalSellerName ||
        row.rawSellerName ||
        ""
      ).toLowerCase();
      return name.includes(needle);
    });
  }, [payload, sellerName]);

  const selectedSellerTotal = useMemo(() => {
    if (!selectedSellerKey || !payload) return null;
    return payload.cards.sellers.find((s) => s.key === selectedSellerKey) ?? null;
  }, [payload, selectedSellerKey]);

  function clearSellerFilter() {
    setSelectedSellerKey(null);
    setSelectedCanonicalSellerId(null);
    setSelectedRawSellerId(null);
    setPage(1);
  }

  function toggleSeller(seller: {
    key: string;
    canonicalSellerId: string | null;
  }) {
    if (selectedSellerKey === seller.key) {
      clearSellerFilter();
      return;
    }
    setSelectedSellerKey(seller.key);
    setSelectedCanonicalSellerId(seller.canonicalSellerId);
    if (seller.canonicalSellerId) {
      setSelectedRawSellerId(null);
    } else if (seller.key.startsWith("raw:")) {
      const n = Number(seller.key.slice(4));
      setSelectedRawSellerId(Number.isFinite(n) ? n : null);
    } else {
      setSelectedRawSellerId(null);
    }
    setPage(1);
  }

  return (
    <div className="space-y-4" data-testid="commissions-order-provision-page">
      <CommissionsSectionIntro
        title="Provisão por pedido"
        description="Acumulado de comissão por pedidos (snapshot oficial). Soma das comissões por produto = comissão do pedido. Não usa período de pagamento/recebimento."
      />

      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-2 xl:grid-cols-6">
        <label className="space-y-1 text-sm">
          <span className={COMMISSIONS_FILTER_LABEL_CLASS}>Ano da venda</span>
          <select
            className={COMMISSIONS_FILTER_FIELD_CLASS}
            value={year}
            onChange={(e) => {
              setYear(e.target.value);
              setPage(1);
            }}
          >
            {yearOptions.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className={COMMISSIONS_FILTER_LABEL_CLASS}>Mês</span>
          <select
            className={COMMISSIONS_FILTER_FIELD_CLASS}
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setPage(1);
            }}
          >
            {MONTH_OPTIONS.map((m) => (
              <option key={m.value || "all"} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm xl:col-span-1">
          <span className={COMMISSIONS_FILTER_LABEL_CLASS}>Vendedor</span>
          <input
            className={COMMISSIONS_FILTER_FIELD_CLASS}
            value={sellerName}
            onChange={(e) => setSellerName(e.target.value)}
            placeholder="Filtrar na lista"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className={COMMISSIONS_FILTER_LABEL_CLASS}>Cliente</span>
          <input
            className={COMMISSIONS_FILTER_FIELD_CLASS}
            value={customer}
            onChange={(e) => {
              setCustomer(e.target.value);
              setPage(1);
            }}
            placeholder="Nome do cliente"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className={COMMISSIONS_FILTER_LABEL_CLASS}>Pedido</span>
          <input
            className={COMMISSIONS_FILTER_FIELD_CLASS}
            value={orderCode}
            onChange={(e) => {
              setOrderCode(e.target.value);
              setPage(1);
            }}
            placeholder="PD 02716"
          />
        </label>
        <div className="flex flex-col justify-end gap-2">
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={includeZero}
              onChange={(e) => {
                setIncludeZero(e.target.checked);
                setPage(1);
              }}
            />
            Incluir comissão zero (ex.: cliente excluído)
          </label>
          <button
            type="button"
            className={cn(financeBiButtonOutlineClass, "inline-flex items-center gap-2")}
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Atualizar
          </button>
        </div>
      </div>

      {error ? <CommissionsErrorBanner message={error} /> : null}
      {loading && !payload ? <CommissionsLoading label="Carregando provisão…" /> : null}

      {payload ? (
        <>
          <CommissionsKpiSection>
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Pedidos"
              value={String(payload.cards.orderCount)}
              hint={payload.periodLabel}
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Comissão acumulada"
              value={formatFinanceCurrency(payload.cards.totalFinalCommissionAmount)}
              hint="Soma das comissões finais por pedido"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Base vendida"
              value={formatFinanceCurrency(payload.cards.totalSoldAmount)}
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Comissão bruta (antes exclusão)"
              value={formatFinanceCurrency(payload.cards.totalGrossCommissionAmount)}
            />
          </CommissionsKpiSection>

          {selectedSellerTotal ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-950">
              Vendedor <strong>{selectedSellerTotal.sellerName}</strong>:{" "}
              <strong>
                {formatFinanceCurrency(selectedSellerTotal.totalFinalCommissionAmount)}
              </strong>{" "}
              em {selectedSellerTotal.orderCount} pedido(s).{" "}
              <button type="button" className="underline" onClick={clearSellerFilter}>
                Limpar filtro do vendedor
              </button>
            </div>
          ) : null}

          {payload.cards.sellers.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Por vendedor
              </h3>
              <div className="flex flex-wrap gap-2">
                {payload.cards.sellers.map((seller) => (
                  <button
                    key={seller.key}
                    type="button"
                    onClick={() => toggleSeller(seller)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      selectedSellerKey === seller.key
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:bg-accent/40"
                    )}
                    data-testid={`commissions-order-provision-seller-${seller.key}`}
                  >
                    <div className="font-semibold">{seller.sellerName}</div>
                    <div className="tabular-nums text-muted-foreground">
                      {formatFinanceCurrency(seller.totalFinalCommissionAmount)} ·{" "}
                      {seller.orderCount} pedido(s)
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {displayRows.length === 0 ? (
            <CommissionsEmptyState
              title="Sem pedidos neste filtro"
              description={
                payload.message ??
                "Ajuste o período ou inclua comissões zeradas para ver exclusões."
              }
            />
          ) : (
            <CommissionsTableScroll>
              <table
                className="w-full min-w-[960px] border-collapse text-sm"
                data-testid="commissions-order-provision-table"
              >
                <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Pedido</th>
                    <th className="px-3 py-2">Data venda</th>
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Vendedor</th>
                    <th className="px-3 py-2">NF-e</th>
                    <th className="px-3 py-2 text-right">Base</th>
                    <th className="px-3 py-2 text-right">Comissão</th>
                    <th className="px-3 py-2">Obs.</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row) => (
                    <tr
                      key={row.salesOrderId}
                      className="border-t border-border/70"
                      data-testid={`commissions-order-provision-row-${row.salesOrderId}`}
                    >
                      <td className="px-3 py-2 font-medium">
                        {formatSalesOrderDisplayCode(row.orderCode) ||
                          row.orderCode ||
                          "—"}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatDatePt(row.saleDate)}
                      </td>
                      <td className="px-3 py-2">{row.customerName}</td>
                      <td className="px-3 py-2">
                        {row.canonicalSellerName || row.rawSellerName || "—"}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {row.nfeIds.length > 0 ? row.nfeIds.join(", ") : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatFinanceCurrency(row.totalSoldAmount)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {formatFinanceCurrency(row.totalFinalCommissionAmount)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {row.hasCustomerExcludedItems
                          ? "Cliente excluído (itens a zero)"
                          : row.totalFinalCommissionAmount <= 0.009
                            ? "Comissão zero"
                            : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CommissionsTableScroll>
          )}

          {payload.pagination.totalPages > 1 ? (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                Página {payload.pagination.page} de {payload.pagination.totalPages} ·{" "}
                {payload.pagination.totalRows} pedido(s)
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={financeBiButtonOutlineClass}
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className={financeBiButtonOutlineClass}
                  disabled={page >= payload.pagination.totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Próxima
                </button>
                <button
                  type="button"
                  className={cn(financeBiButtonOutlineClass, "inline-flex items-center gap-1")}
                  onClick={() => void load()}
                  disabled={loading}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Atualizar
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
