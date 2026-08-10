import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, Printer, RefreshCw, Search } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import {
  COMMISSIONS_FILTER_FIELD_CLASS,
  COMMISSIONS_FILTER_LABEL_CLASS,
  buildCommissionsYearOptions,
} from "@/src/lib/commissionsPeriodFilter";
import { CommissionsMonthsMultiSelect } from "@/src/components/commissions/CommissionsMonthsMultiSelect";
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
import {
  buildCommissionOrderProvisionClientQuery,
  isCommissionOrderProvisionSellerChipActive,
  type CommissionOrderProvisionPayload,
  type CommissionOrderProvisionReportPayload,
} from "@/src/lib/commissions/commissionOrderProvision.shared";
import type { CommissionReportsMonthsFilter } from "@/src/lib/commissions/commissionReports.shared";
import type { CommissionsPersonsPayload } from "@/src/components/commissions/commissionsTypes";
import { formatSalesOrderDisplayCode } from "@/src/lib/salesOrderListUi";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import { CommissionOrderProvisionReportPrintDocument } from "@/src/components/commissions/CommissionOrderProvisionReportPrintDocument";

const SalesOrderDetailDialog = React.lazy(() =>
  import("@/src/components/sales/SalesOrderDetailDialog").then((mod) => ({
    default: mod.SalesOrderDetailDialog,
  }))
);

function formatDatePt(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export function CommissionsOrderProvisionPage() {
  const now = new Date();
  const yearOptions = useMemo(() => buildCommissionsYearOptions(), []);
  const [year, setYear] = useState(String(now.getFullYear()));
  const [months, setMonths] = useState<CommissionReportsMonthsFilter>("all");
  /** Fonte única do select: "all" | CommissionPerson.id */
  const [sellerId, setSellerId] = useState("all");
  /** Chip sem pessoa canônica (só rawSellerId no snapshot). */
  const [selectedRawSellerId, setSelectedRawSellerId] = useState<number | null>(
    null
  );
  const [selectedSellerKey, setSelectedSellerKey] = useState<string | null>(null);
  const [persons, setPersons] = useState<Array<{ id: string; name: string }>>([]);
  const [customer, setCustomer] = useState("");
  const [orderCode, setOrderCode] = useState("");
  const [includeZero, setIncludeZero] = useState(false);
  /**
   * Filtro exclusivo: SÓ pedidos com comissão zerada. Útil para auditar
   * cliente excluído/regra sem base. Ao ligar, desliga o `includeZero`
   * (não faz sentido combinar — o resultado já é composto só de zeros).
   */
  const [onlyZero, setOnlyZero] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<CommissionOrderProvisionPayload | null>(
    null
  );

  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const [reportPrintPayload, setReportPrintPayload] =
    useState<CommissionOrderProvisionReportPayload | null>(null);
  const [printRequestId, setPrintRequestId] = useState(0);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);

  /**
   * Detalhe do Pedido — mesmo modal (quase fullscreen, portalizado no
   * document.body) usado em Comercial > Pedidos de venda. É um toggle de
   * estado local: a lista, filtros e página desta tela nunca desmontam, então
   * fechar o modal sempre volta exatamente no mesmo estado.
   */
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [detailOrderCode, setDetailOrderCode] = useState<string | null>(null);
  const openOrderDetail = useCallback((salesOrderId: string, code: string | null) => {
    setDetailOrderId(salesOrderId);
    setDetailOrderCode(code);
  }, []);
  const closeOrderDetail = useCallback(() => {
    setDetailOrderId(null);
    setDetailOrderCode(null);
  }, []);

  useEffect(() => {
    void fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings")
      .then(setBranding)
      .catch(() => setBranding(DEFAULT_BRANDING));
  }, []);

  useEffect(() => {
    if (printRequestId === 0) return;
    document.body.classList.add("sales-orders-print-route");

    // Força A4 retrato mesmo com @page landscape de outros CSS globais.
    const style = document.createElement("style");
    style.setAttribute("data-commission-order-provision-print-page", "1");
    style.textContent = "@page { size: A4 portrait; margin: 8mm; }";
    document.head.appendChild(style);

    const onAfterPrint = () => {
      document.body.classList.remove("sales-orders-print-route");
      style.remove();
      setPrintRequestId(0);
      setReportPrintPayload(null);
    };
    window.addEventListener("afterprint", onAfterPrint, { once: true });
    const timer = window.setTimeout(() => window.print(), 350);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", onAfterPrint);
      style.remove();
    };
  }, [printRequestId]);

  const currentQueryString = useCallback(
    () =>
      buildCommissionOrderProvisionClientQuery({
        year,
        months,
        sellerId,
        selectedRawSellerId,
        customer,
        orderCode,
        includeZeroCommission: includeZero,
        onlyZeroCommission: onlyZero,
        page: 1,
        pageSize: 50,
      }),
    [year, months, sellerId, selectedRawSellerId, customer, orderCode, includeZero, onlyZero]
  );

  async function handlePrintOrExportPdf() {
    setExportingPdf(true);
    setError(null);
    try {
      const data = await fetchJsonOk<CommissionOrderProvisionReportPayload>(
        `/api/commissions/order-provision/report?${currentQueryString()}`
      );
      setReportPrintPayload(data);
      setPrintRequestId((n) => n + 1);
    } catch (err) {
      setError(formatCommissionsApiError(err, "Não foi possível gerar o PDF."));
    } finally {
      setExportingPdf(false);
    }
  }

  async function handleExportXlsx() {
    setExportingXlsx(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/commissions/order-provision/export.xlsx?${currentQueryString()}`
      );
      if (!res.ok) throw new Error("Falha ao exportar XLSX.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `comissao-provisao-pedido-${year}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(formatCommissionsApiError(err, "Não foi possível exportar o XLSX."));
    } finally {
      setExportingXlsx(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchJsonOk<CommissionsPersonsPayload>(
          "/api/commissions/persons?page=1&pageSize=200&active=true"
        );
        if (!cancelled) {
          setPersons(
            (data.items ?? [])
              .filter((p) => !p.type || p.type === "SELLER")
              .map((p) => ({ id: p.id, name: p.name }))
              .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
          );
        }
      } catch {
        if (!cancelled) setPersons([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildCommissionOrderProvisionClientQuery({
        year,
        months,
        sellerId,
        selectedRawSellerId,
        customer,
        orderCode,
        includeZeroCommission: includeZero,
        onlyZeroCommission: onlyZero,
        page,
        pageSize: 50,
      });
      const data = await fetchJsonOk<CommissionOrderProvisionPayload>(
        `/api/commissions/order-provision?${qs}`
      );
      setPayload(data);
    } catch (err) {
      setPayload(null);
      setError(
        formatCommissionsApiError(err, "Não foi possível carregar a provisão por pedido.")
      );
    } finally {
      setLoading(false);
    }
  }, [year, months, customer, orderCode, includeZero, onlyZero, page, sellerId, selectedRawSellerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sellerOptions = useMemo(() => {
    const fromPersons = persons.map((p) => ({ value: p.id, label: p.name }));
    const fromPayload = (payload?.sellerOptions ?? []).filter(
      (opt) => opt.value !== "all"
    );
    const map = new Map<string, string>();
    for (const opt of fromPersons) map.set(opt.value, opt.label);
    for (const opt of fromPayload) {
      if (!map.has(opt.value)) map.set(opt.value, opt.label);
    }
    return [
      { value: "all", label: "Todos os vendedores" },
      ...[...map.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    ];
  }, [persons, payload?.sellerOptions]);

  const selectedSellerTotal = useMemo(() => {
    if (!selectedSellerKey || !payload) return null;
    return payload.cards.sellers.find((s) => s.key === selectedSellerKey) ?? null;
  }, [payload, selectedSellerKey]);

  function clearSellerFilter() {
    setSelectedSellerKey(null);
    setSelectedRawSellerId(null);
    setSellerId("all");
    setPage(1);
  }

  function onSellerSelectChange(value: string) {
    setSellerId(value);
    setSelectedRawSellerId(null);
    if (value === "all") {
      setSelectedSellerKey(null);
    } else {
      const match = payload?.cards.sellers.find((s) => s.canonicalSellerId === value);
      setSelectedSellerKey(match?.key ?? value);
    }
    setPage(1);
  }

  function toggleSeller(seller: {
    key: string;
    canonicalSellerId: string | null;
  }) {
    const alreadyActive = isCommissionOrderProvisionSellerChipActive({
      seller,
      sellerId,
      selectedSellerKey,
      selectedRawSellerId,
    });
    if (alreadyActive) {
      clearSellerFilter();
      return;
    }
    setSelectedSellerKey(seller.key);
    if (seller.canonicalSellerId) {
      setSellerId(seller.canonicalSellerId);
      setSelectedRawSellerId(null);
    } else if (seller.key.startsWith("raw:")) {
      setSellerId("all");
      const n = Number(seller.key.slice(4));
      setSelectedRawSellerId(Number.isFinite(n) ? n : null);
    } else {
      setSellerId("all");
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

      <div
        className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
        data-testid="commissions-order-provision-filters"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className={COMMISSIONS_FILTER_LABEL_CLASS}>Ano da venda</span>
            <select
              className={COMMISSIONS_FILTER_FIELD_CLASS}
              value={year}
              onChange={(e) => {
                setYear(e.target.value);
                setPage(1);
              }}
              aria-label="Ano da venda"
            >
              {yearOptions.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <CommissionsMonthsMultiSelect
            value={months}
            onChange={(next) => {
              setMonths(next);
              setPage(1);
            }}
          />
          <label className="space-y-1 text-sm">
            <span className={COMMISSIONS_FILTER_LABEL_CLASS}>Vendedor</span>
            <select
              className={COMMISSIONS_FILTER_FIELD_CLASS}
              value={sellerId}
              onChange={(e) => onSellerSelectChange(e.target.value)}
              aria-label="Vendedor"
              data-testid="commissions-order-provision-seller-filter"
            >
              {sellerOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
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
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          <div className="flex flex-col justify-end gap-2 sm:col-span-1 lg:col-span-3">
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeZero}
                disabled={onlyZero}
                onChange={(e) => {
                  setIncludeZero(e.target.checked);
                  setPage(1);
                }}
              />
              Incluir comissão zero (ex.: cliente excluído)
            </label>
            <label
              className="inline-flex items-center gap-2 text-xs text-muted-foreground"
              data-testid="commissions-order-provision-only-zero-toggle"
            >
              <input
                type="checkbox"
                checked={onlyZero}
                onChange={(e) => {
                  const next = e.target.checked;
                  setOnlyZero(next);
                  // Mutuamente exclusivo: ao ligar "somente zeradas",
                  // desliga o includeZero (o resultado já é composto
                  // exclusivamente por zeros — combinar não faz sentido).
                  if (next) setIncludeZero(false);
                  setPage(1);
                }}
              />
              Somente comissões zeradas (auditoria de exclusão/rateio anulado)
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={cn(
                  financeBiButtonOutlineClass,
                  "inline-flex items-center gap-2"
                )}
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
              <button
                type="button"
                className={financeBiButtonOutlineClass}
                onClick={() => {
                  setYear(String(now.getFullYear()));
                  setMonths("all");
                  clearSellerFilter();
                  setCustomer("");
                  setOrderCode("");
                  setIncludeZero(false);
                  setPage(1);
                }}
              >
                Limpar filtros
              </button>
              <button
                type="button"
                className={cn(financeBiButtonOutlineClass, "inline-flex items-center gap-2")}
                onClick={() => void handleExportXlsx()}
                disabled={exportingXlsx}
                title="Exportar Excel (.xlsx) com o filtro atual"
              >
                {exportingXlsx ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Excel
              </button>
              <button
                type="button"
                className={cn(financeBiButtonOutlineClass, "inline-flex items-center gap-2")}
                onClick={() => void handlePrintOrExportPdf()}
                disabled={exportingPdf}
                title="Imprimir / exportar PDF (A4 retrato) com o filtro atual"
              >
                {exportingPdf ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Printer className="h-4 w-4" />
                )}
                PDF
              </button>
            </div>
          </div>
        </div>
      </div>

      {error ? <CommissionsErrorBanner message={error} /> : null}
      {loading && !payload ? <CommissionsLoading label="Carregando provisão…" /> : null}

      {payload ? (
        <>
          <CommissionsKpiSection
            title="Resumo"
            testId="commissions-order-provision-summary"
          >
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Pedidos"
              amount={payload.cards.orderCount}
              amountFormat="number"
              helperText={payload.periodLabel}
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Comissão acumulada"
              amount={payload.cards.totalFinalCommissionAmount}
              amountFormat="currency"
              helperText="Soma das comissões finais por pedido"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Base vendida"
              amount={payload.cards.totalSoldAmount}
              amountFormat="currency"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Comissão bruta (antes exclusão)"
              amount={payload.cards.totalGrossCommissionAmount}
              amountFormat="currency"
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
                      isCommissionOrderProvisionSellerChipActive({
                        seller,
                        sellerId,
                        selectedSellerKey,
                        selectedRawSellerId,
                      })
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

          {payload.rows.length === 0 ? (
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
                  {payload.rows.map((row) => (
                    <tr
                      key={row.salesOrderId}
                      className="border-t border-border/70"
                      data-testid={`commissions-order-provision-row-${row.salesOrderId}`}
                    >
                      <td className="px-3 py-2 font-medium">
                        <button
                          type="button"
                          className="underline decoration-dotted underline-offset-2 hover:text-primary"
                          onClick={() => openOrderDetail(row.salesOrderId, row.orderCode)}
                          data-testid={`commissions-order-provision-open-detail-${row.salesOrderId}`}
                        >
                          {formatSalesOrderDisplayCode(row.orderCode) ||
                            row.orderCode ||
                            "—"}
                        </button>
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

      {reportPrintPayload
        ? createPortal(
            <CommissionOrderProvisionReportPrintDocument
              payload={reportPrintPayload}
              branding={branding}
            />,
            document.body
          )
        : null}

      {detailOrderId != null ? (
        <React.Suspense fallback={null}>
          <SalesOrderDetailDialog
            open
            salesOrderId={detailOrderId}
            orderCode={detailOrderCode}
            onClose={closeOrderDetail}
          />
        </React.Suspense>
      ) : null}
    </div>
  );
}
