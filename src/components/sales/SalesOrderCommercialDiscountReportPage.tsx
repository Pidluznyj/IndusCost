import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Download,
  FileSpreadsheet,
  Loader2,
  Percent,
  RefreshCw,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn, formatCurrency } from "@/src/lib/utils";
import { CustomerAutocompleteFilter } from "@/src/components/common/CustomerAutocompleteFilter";
import type { EntityAutocompleteSelection } from "@/src/lib/customerSearch";
import { useAuth } from "@/src/contexts/AuthContext";
import { PermissionGate } from "@/src/components/security/PermissionGate";
import {
  canExportSalesOrderCommercialDiscountReport,
  canViewSalesOrderCommercialDiscountReport,
  canViewSalesOrderCommercialDiscountReportMargin,
  SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_RESOURCE,
} from "@/src/lib/salesOrderCommercialDiscountReportPermissions";
import {
  getSalesOrderCommercialDiscountCsvUrl,
  getSalesOrderCommercialDiscountReportUrl,
  getSalesOrderCommercialDiscountXlsxUrl,
} from "@/src/lib/sales/salesOrderCommercialDiscountReportExportUi";
import {
  SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_SUBTITLE,
  type CommercialDiscountPresenceFilter,
  type CommercialDiscountReportPayload,
} from "@/src/lib/sales/salesOrderCommercialDiscountReport";
import { formatSalesOrderMarginPercent } from "@/src/lib/salesOrderMarginDisplay";

const FILTER_CONTROL =
  "h-9 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20";

function formatPctRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return formatSalesOrderMarginPercent(rate * 100);
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatSalesOrderMarginPercent(value);
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</p>
      {hint ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function DimensionTable({
  title,
  rows,
  includeMargin,
}: {
  title: string;
  rows: CommercialDiscountReportPayload["views"]["bySeller"];
  includeMargin: boolean;
}) {
  if (!rows.length) {
    return (
      <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        Sem dados para {title.toLowerCase()}.
      </div>
    );
  }
  return (
    <div className="overflow-auto rounded-xl border border-border">
      <table className="min-w-full text-sm">
        <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2">{title}</th>
            <th className="px-3 py-2 text-right">Bruto</th>
            <th className="px-3 py-2 text-right">Desconto R$</th>
            <th className="px-3 py-2 text-right">Desconto %</th>
            <th className="px-3 py-2 text-right">Líquido</th>
            {includeMargin ? (
              <>
                <th className="px-3 py-2 text-right">Margem R$</th>
                <th className="px-3 py-2 text-right">Margem %</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 15).map((row) => (
            <tr key={row.key} className="border-t border-border/70">
              <td className="px-3 py-2 font-medium">{row.label}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCurrency(row.grossActiveValue)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCurrency(row.discountValue)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatPctRate(row.discountRate)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCurrency(row.netActiveValue)}
              </td>
              {includeMargin ? (
                <>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.commercialMarginValue != null
                      ? formatCurrency(row.commercialMarginValue)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatPct(row.commercialMarginPercent)}
                  </td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SalesOrderCommercialDiscountReportPage(): React.ReactElement {
  const auth = useAuth();
  const canView = canViewSalesOrderCommercialDiscountReport(auth);
  const canExport = canExportSalesOrderCommercialDiscountReport(auth);
  const includeMarginUi = canViewSalesOrderCommercialDiscountReportMargin(auth);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [customer, setCustomer] = useState<EntityAutocompleteSelection | null>(null);
  const [seller, setSeller] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [family, setFamily] = useState("");
  const [discountRateMin, setDiscountRateMin] = useState("");
  const [discountRateMax, setDiscountRateMax] = useState("");
  const [marginPercentMin, setMarginPercentMin] = useState("");
  const [marginPercentMax, setMarginPercentMax] = useState("");
  const [presence, setPresence] =
    useState<CommercialDiscountPresenceFilter>("all");
  const [billing, setBilling] = useState<"all" | "invoiced" | "not_invoiced">("all");
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState<CommercialDiscountReportPayload | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<
    "monthly" | "seller" | "customer" | "product" | "family" | "risk"
  >("monthly");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (customer?.id) params.set("customerId", customer.id);
    if (seller.trim()) params.set("seller", seller.trim());
    if (productQuery.trim()) params.set("productQuery", productQuery.trim());
    if (family.trim()) params.set("family", family.trim());
    if (discountRateMin.trim()) params.set("discountRateMin", discountRateMin.trim());
    if (discountRateMax.trim()) params.set("discountRateMax", discountRateMax.trim());
    if (marginPercentMin.trim()) params.set("marginPercentMin", marginPercentMin.trim());
    if (marginPercentMax.trim()) params.set("marginPercentMax", marginPercentMax.trim());
    if (presence !== "all") params.set("presence", presence);
    if (billing !== "all") params.set("billing", billing);
    params.set("page", String(page));
    params.set("pageSize", "50");
    params.set("sortBy", "discountValue");
    params.set("sortDir", "desc");
    return params.toString();
  }, [
    startDate,
    endDate,
    customer,
    seller,
    productQuery,
    family,
    discountRateMin,
    discountRateMax,
    marginPercentMin,
    marginPercentMax,
    presence,
    billing,
    page,
  ]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<CommercialDiscountReportPayload>(
        getSalesOrderCommercialDiscountReportUrl(queryString)
      );
      setPayload(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível carregar o relatório de descontos."
      );
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [canView, queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canView) {
    return (
      <PermissionGate
        resourceKey={SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_RESOURCE}
        mode="deny"
        deniedTitle="Sem permissão"
        deniedMessage="Você não tem acesso ao Relatório de descontos comerciais."
      >
        {null}
      </PermissionGate>
    );
  }

  const kpis = payload?.kpis;
  const includeMargin = payload?.meta.includeMargin ?? includeMarginUi;

  return (
    <div className="space-y-6" data-testid="commercial-discount-report-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {SALES_ORDER_COMMERCIAL_DISCOUNT_REPORT_SUBTITLE}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            O desconto é apresentado como <strong>valor concedido em descontos</strong> —
            pode ter sido necessário para fechar a venda.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium",
              loading && "opacity-60"
            )}
            onClick={() => void load()}
            disabled={loading}
            data-testid="commercial-discount-refresh"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Atualizar
          </button>
          {canExport ? (
            <>
              <a
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium"
                href={getSalesOrderCommercialDiscountCsvUrl(queryString)}
                data-testid="commercial-discount-export-csv"
              >
                <Download className="h-4 w-4" />
                CSV
              </a>
              <a
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium"
                href={getSalesOrderCommercialDiscountXlsxUrl(queryString)}
                data-testid="commercial-discount-export-xlsx"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Excel
              </a>
            </>
          ) : null}
        </div>
      </div>

      <div
        className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-2 xl:grid-cols-4"
        data-testid="commercial-discount-filter-bar"
      >
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Emissão de
          </label>
          <input
            type="date"
            className={FILTER_CONTROL}
            value={startDate}
            onChange={(e) => {
              setPage(1);
              setStartDate(e.target.value);
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Emissão até
          </label>
          <input
            type="date"
            className={FILTER_CONTROL}
            value={endDate}
            onChange={(e) => {
              setPage(1);
              setEndDate(e.target.value);
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Cliente
          </label>
          <CustomerAutocompleteFilter
            value={customer}
            onChange={(next) => {
              setPage(1);
              setCustomer(next);
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Vendedor
          </label>
          <input
            className={FILTER_CONTROL}
            value={seller}
            placeholder="Nome do vendedor"
            onChange={(e) => {
              setPage(1);
              setSeller(e.target.value);
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Produto
          </label>
          <input
            className={FILTER_CONTROL}
            value={productQuery}
            placeholder="SKU ou nome"
            onChange={(e) => {
              setPage(1);
              setProductQuery(e.target.value);
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Família
          </label>
          <input
            className={FILTER_CONTROL}
            value={family}
            placeholder="Família logística"
            onChange={(e) => {
              setPage(1);
              setFamily(e.target.value);
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Desconto % mín
          </label>
          <input
            className={FILTER_CONTROL}
            value={discountRateMin}
            placeholder="ex.: 5"
            onChange={(e) => {
              setPage(1);
              setDiscountRateMin(e.target.value);
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Desconto % máx
          </label>
          <input
            className={FILTER_CONTROL}
            value={discountRateMax}
            placeholder="ex.: 20"
            onChange={(e) => {
              setPage(1);
              setDiscountRateMax(e.target.value);
            }}
          />
        </div>
        {includeMarginUi ? (
          <>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Margem % mín
              </label>
              <input
                className={FILTER_CONTROL}
                value={marginPercentMin}
                placeholder="ex.: 10"
                onChange={(e) => {
                  setPage(1);
                  setMarginPercentMin(e.target.value);
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Margem % máx
              </label>
              <input
                className={FILTER_CONTROL}
                value={marginPercentMax}
                placeholder="ex.: 40"
                onChange={(e) => {
                  setPage(1);
                  setMarginPercentMax(e.target.value);
                }}
              />
            </div>
          </>
        ) : null}
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Presença
          </label>
          <select
            className={FILTER_CONTROL}
            value={presence}
            onChange={(e) => {
              setPage(1);
              setPresence(e.target.value as CommercialDiscountPresenceFilter);
            }}
          >
            <option value="all">Todos</option>
            <option value="with_discount">Com desconto</option>
            <option value="without_discount">Sem desconto</option>
            <option value="with_addition">Com acréscimo</option>
            <option value="margin_unavailable">Margem não calculada</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Faturamento
          </label>
          <select
            className={FILTER_CONTROL}
            value={billing}
            onChange={(e) => {
              setPage(1);
              setBilling(e.target.value as typeof billing);
            }}
          >
            <option value="all">Todos</option>
            <option value="invoiced">Pedido faturado</option>
            <option value="not_invoiced">Pedido não faturado</option>
          </select>
        </div>
      </div>

      {error ? (
        <div
          className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          data-testid="commercial-discount-error"
        >
          {error}
        </div>
      ) : null}

      {kpis ? (
        <div
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
          data-testid="commercial-discount-kpis"
        >
          <KpiCard label="Valor bruto" value={formatCurrency(kpis.grossActiveTotalValue)} />
          <KpiCard
            label="Valor concedido em descontos"
            value={formatCurrency(kpis.discountTotalValue)}
            hint={`${formatPctRate(kpis.discountTotalRate)} ponderado`}
          />
          <KpiCard
            label="Valor líquido vendido"
            value={formatCurrency(kpis.netActiveTotalValue)}
          />
          {includeMargin ? (
            <KpiCard
              label="Margem comercial"
              value={
                kpis.commercialMarginTotalValue != null
                  ? formatCurrency(kpis.commercialMarginTotalValue)
                  : "—"
              }
              hint={`${formatPct(kpis.commercialMarginTotalPercent)} · cobertura ${formatPct(kpis.commercialMarginCoveragePercent)}`}
            />
          ) : (
            <KpiCard
              label="Acréscimos comerciais"
              value={formatCurrency(kpis.commercialAdditionTotalValue)}
            />
          )}
          <KpiCard
            label="Pedidos / itens com desconto"
            value={`${kpis.ordersWithDiscount} / ${kpis.itemsWithDiscount}`}
            hint={`${kpis.itemsWithAddition} itens com acréscimo`}
          />
        </div>
      ) : null}

      {payload && includeMargin ? (
        <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          Margem comercial antes dos filtros de faixa:{" "}
          <span className="font-medium text-foreground">
            {payload.views.kpisBeforeBandFilters.commercialMarginTotalValue != null
              ? formatCurrency(
                  payload.views.kpisBeforeBandFilters.commercialMarginTotalValue
                )
              : "—"}
          </span>{" "}
          ({formatPct(payload.views.kpisBeforeBandFilters.commercialMarginTotalPercent)})
          {" · "}
          depois do filtro:{" "}
          <span className="font-medium text-foreground">
            {kpis?.commercialMarginTotalValue != null
              ? formatCurrency(kpis.commercialMarginTotalValue)
              : "—"}
          </span>{" "}
          ({formatPct(kpis?.commercialMarginTotalPercent)})
          {payload.views.divergenceItemCount > 0 ? (
            <span className="ml-2 inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <Percent className="h-3.5 w-3.5" />
              {payload.views.divergenceItemCount} itens com divergência
              informado × efetivo
            </span>
          ) : null}
        </div>
      ) : null}

      {payload ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["monthly", "Evolução mensal"],
                ["seller", "Por vendedor"],
                ["customer", "Por cliente"],
                ["product", "Por produto"],
                ["family", "Por família"],
                ["risk", "Desconto alto / margem baixa"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={cn(
                  "h-8 rounded-md border px-3 text-xs font-medium",
                  viewTab === id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
                )}
                onClick={() => setViewTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {viewTab === "monthly" ? (
            <div className="overflow-auto rounded-xl border border-border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Mês</th>
                    <th className="px-3 py-2 text-right">Bruto</th>
                    <th className="px-3 py-2 text-right">Desconto R$</th>
                    <th className="px-3 py-2 text-right">Desconto %</th>
                    <th className="px-3 py-2 text-right">Líquido</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.views.monthlyEvolution.map((row) => (
                    <tr key={row.monthKey} className="border-t border-border/70">
                      <td className="px-3 py-2 font-medium">{row.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(row.grossActiveValue)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(row.discountValue)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatPctRate(row.discountRate)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(row.netActiveValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {viewTab === "seller" ? (
            <DimensionTable
              title="Vendedor"
              rows={payload.views.bySeller}
              includeMargin={includeMargin}
            />
          ) : null}
          {viewTab === "customer" ? (
            <DimensionTable
              title="Cliente"
              rows={payload.views.byCustomer}
              includeMargin={includeMargin}
            />
          ) : null}
          {viewTab === "product" ? (
            <DimensionTable
              title="Produto"
              rows={payload.views.byProduct}
              includeMargin={includeMargin}
            />
          ) : null}
          {viewTab === "family" ? (
            <DimensionTable
              title="Família"
              rows={payload.views.byFamily}
              includeMargin={includeMargin}
            />
          ) : null}
          {viewTab === "risk" ? (
            <div className="overflow-auto rounded-xl border border-border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Produto</th>
                    <th className="px-3 py-2 text-right">Desconto %</th>
                    <th className="px-3 py-2 text-right">Margem %</th>
                    <th className="px-3 py-2 text-right">Desconto R$</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.views.highDiscountLowMarginProducts.map((row) => (
                    <tr key={row.productId} className="border-t border-border/70">
                      <td className="px-3 py-2">
                        <div className="font-medium">
                          {row.sku} — {row.productName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {row.familyName}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatPctRate(row.discountRate)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatPct(row.commercialMarginPercent)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(row.discountValue)}
                      </td>
                    </tr>
                  ))}
                  {!payload.views.highDiscountLowMarginProducts.length ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-6 text-center text-muted-foreground"
                      >
                        Nenhum produto com desconto alto e margem baixa no filtro.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="overflow-auto rounded-xl border border-border">
              <div className="border-b border-border bg-muted/30 px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Pedidos com maior desconto (R$)
              </div>
              <table className="min-w-full text-sm">
                <tbody>
                  {payload.views.topOrdersByDiscountValue.map((row) => (
                    <tr key={row.salesOrderId} className="border-t border-border/70">
                      <td className="px-3 py-2">
                        <Link
                          to={`/sales-orders/${row.salesOrderId}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {row.orderCode}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {row.customerName}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(row.discountValue)}
                        <div className="text-xs text-muted-foreground">
                          {formatPctRate(row.discountRate)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-auto rounded-xl border border-border">
              <div className="border-b border-border bg-muted/30 px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Pedidos com maior desconto (%)
              </div>
              <table className="min-w-full text-sm">
                <tbody>
                  {payload.views.topOrdersByDiscountRate.map((row) => (
                    <tr key={row.salesOrderId} className="border-t border-border/70">
                      <td className="px-3 py-2">
                        <Link
                          to={`/sales-orders/${row.salesOrderId}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {row.orderCode}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {row.customerName}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatPctRate(row.discountRate)}
                        <div className="text-xs text-muted-foreground">
                          {formatCurrency(row.discountValue)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      <div className="overflow-auto rounded-xl border border-border" data-testid="commercial-discount-detail-table">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Pedido</th>
              <th className="px-3 py-2">Emissão</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Vendedor</th>
              <th className="px-3 py-2">Produto</th>
              <th className="px-3 py-2 text-right">Qtd</th>
              <th className="px-3 py-2 text-right">Bruto</th>
              <th className="px-3 py-2 text-right">Desc. R$</th>
              <th className="px-3 py-2 text-right">Desc. %</th>
              <th className="px-3 py-2 text-right">Líquido</th>
              {includeMargin ? (
                <>
                  <th className="px-3 py-2 text-right">Margem R$</th>
                  <th className="px-3 py-2 text-right">Margem %</th>
                  <th className="px-3 py-2">Status margem</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {(payload?.rows ?? []).map((row) => (
              <tr key={row.itemId} className="border-t border-border/70">
                <td className="px-3 py-2">
                  <Link
                    to={`/sales-orders/${row.salesOrderId}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {row.orderCode}
                  </Link>
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {row.issueDate
                    ? new Date(row.issueDate).toLocaleDateString("pt-BR")
                    : "—"}
                </td>
                <td className="px-3 py-2">{row.customerName}</td>
                <td className="px-3 py-2">{row.sellerName}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">
                    {row.sku} — {row.productName}
                  </div>
                  {row.hasDiscountDivergence ? (
                    <div className="text-[11px] text-amber-700 dark:text-amber-400">
                      Divergência informado × efetivo
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.activeQuantity}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCurrency(row.grossActiveValue)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCurrency(row.discountValue)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatPctRate(row.discountRate)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.netActiveValue != null
                    ? formatCurrency(row.netActiveValue)
                    : "—"}
                </td>
                {includeMargin ? (
                  <>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.commercialMarginValue != null
                        ? formatCurrency(row.commercialMarginValue)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatPct(row.commercialMarginPercent)}
                    </td>
                    <td className="px-3 py-2">{row.marginStatusLabel}</td>
                  </>
                ) : null}
              </tr>
            ))}
            {!payload?.rows.length && !loading ? (
              <tr>
                <td
                  colSpan={includeMargin ? 13 : 10}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  Nenhum item no filtro atual.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {payload ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            {payload.pagination.totalRows} itens · página {payload.pagination.page} de{" "}
            {payload.pagination.totalPages}
            {payload.meta.truncated
              ? ` · escopo limitado a ${payload.meta.ordersTakeLimit} pedidos`
              : ""}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="h-8 rounded-md border border-border px-3 disabled:opacity-40"
              disabled={payload.pagination.page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </button>
            <button
              type="button"
              className="h-8 rounded-md border border-border px-3 disabled:opacity-40"
              disabled={
                payload.pagination.page >= payload.pagination.totalPages || loading
              }
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
