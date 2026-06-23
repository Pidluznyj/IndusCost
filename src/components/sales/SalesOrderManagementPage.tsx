import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Clock,
  FileText,
  LayoutGrid,
  Loader2,
  Package,
  Receipt,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatCurrency } from "@/src/lib/utils";
import { CustomerAutocompleteFilter } from "@/src/components/common/CustomerAutocompleteFilter";
import type { EntityAutocompleteSelection } from "@/src/lib/customerSearch";
import { FinanceBiKpiCard } from "@/src/components/finance/bi/FinanceBiKpiCard";
import type {
  SalesOrderManagementCardAmounts,
  SalesOrderManagementCards,
  SalesOrderManagementRow,
  SalesOrderManagementSummary,
} from "@/src/lib/salesOrderManagementTypes";
import {
  getSalesOrderIntelligenceApiPath,
  getSalesOrderManagementApiPath,
} from "@/src/lib/salesOrderManagementTypes";
import type { SalesOrderIntelligencePayload } from "@/src/lib/salesOrderIntelligence";
import {
  buildManagementDashboardCardsFromAggregates,
  emptyManagementStatusCardAmounts,
  emptyManagementStatusCardCounts,
  getManagementStatusFilterLabel,
  type ManagementDashboardCard,
  type ManagementStatusCardId,
} from "@/src/lib/salesOrderManagementStatus";
import {
  BILLING_STATUS_FILTER_OPTIONS,
  COMPLETION_STATUS_FILTER_OPTIONS,
  COMPLETION_STATUS_LABELS,
  DEADLINE_STATUS_FILTER_OPTIONS,
  formatDeadlineBadge,
  formatInvoiceBadge,
  formatProductionBadge,
  formatSalesOrderDate,
  formatSalesOrderPercent,
  INVOICE_FILTER_OPTIONS,
  OPERATIONAL_STATUS_FILTER_OPTIONS,
  PRODUCTION_ORDER_FILTER_OPTIONS,
} from "@/src/lib/salesOrderManagementUi";
import { cn } from "@/src/lib/utils";
import { SalesOrderIntelligenceDrawer } from "@/src/components/sales/SalesOrderIntelligenceDrawer";

type ManagementResponse = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  cards: SalesOrderManagementCards;
  cardAmounts?: SalesOrderManagementCardAmounts;
  dashboardCards?: ManagementDashboardCard[];
  summary?: SalesOrderManagementSummary;
  rows: SalesOrderManagementRow[];
};

const PAGE_SIZE = 20;

const EMPTY_CARDS = emptyManagementStatusCardCounts();
const EMPTY_CARD_AMOUNTS = emptyManagementStatusCardAmounts();

function badgeClass(kind: "status" | "deadline" | "invoice" | "op" | "risk"): string {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide";
  if (kind === "risk") return `${base} bg-red-100 text-red-800`;
  if (kind === "deadline") return `${base} bg-amber-100 text-amber-900`;
  if (kind === "invoice") return `${base} bg-blue-100 text-blue-900`;
  if (kind === "op") return `${base} bg-violet-100 text-violet-900`;
  return `${base} bg-slate-100 text-slate-800`;
}

export function SalesOrderManagementPage() {
  const currentYear = new Date().getFullYear();
  const [rows, setRows] = useState<SalesOrderManagementRow[]>([]);
  const [cards, setCards] = useState<SalesOrderManagementCards>(EMPTY_CARDS);
  const [cardAmounts, setCardAmounts] = useState<SalesOrderManagementCardAmounts>(EMPTY_CARD_AMOUNTS);
  const [dashboardCards, setDashboardCards] = useState<ManagementDashboardCard[]>([]);
  const [managementSummary, setManagementSummary] = useState<SalesOrderManagementSummary | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [year, setYear] = useState(String(currentYear));
  const [month, setMonth] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerSelection, setCustomerSelection] = useState<EntityAutocompleteSelection | null>(
    null
  );
  const [responsible, setResponsible] = useState("");
  const [companyIssuer, setCompanyIssuer] = useState("");
  const [operationalStatus, setOperationalStatus] = useState("");
  const [deadlineStatus, setDeadlineStatus] = useState("");
  const [completionStatus, setCompletionStatus] = useState("");
  const [billingStatus, setBillingStatus] = useState("");
  const [invoiceFilter, setInvoiceFilter] = useState("");
  const [productionFilter, setProductionFilter] = useState("");
  const [withRisk, setWithRisk] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [invoiceAfterDeadline, setInvoiceAfterDeadline] = useState(false);
  const [partialOrCut, setPartialOrCut] = useState(false);
  const [noProductionOrder, setNoProductionOrder] = useState(false);
  const [productionLate, setProductionLate] = useState(false);
  const [selectedManagementStatus, setSelectedManagementStatus] =
    useState<ManagementStatusCardId | "">("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState<SalesOrderManagementRow | null>(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [intelError, setIntelError] = useState<string | null>(null);
  const [intelPayload, setIntelPayload] = useState<SalesOrderIntelligencePayload | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    if (year) params.set("year", year);
    if (month) params.set("month", month);
    if (customerId) params.set("customerId", customerId);
    if (responsible.trim()) params.set("responsible", responsible.trim());
    if (companyIssuer.trim()) params.set("companyIssuer", companyIssuer.trim());
    if (operationalStatus) params.set("operationalStatus", operationalStatus);
    if (deadlineStatus) params.set("deadlineStatus", deadlineStatus);
    if (completionStatus) params.set("completionStatus", completionStatus);
    if (billingStatus) params.set("billingStatus", billingStatus);
    if (invoiceFilter === "true") params.set("hasInvoice", "true");
    if (invoiceFilter === "false") params.set("hasInvoice", "false");
    if (productionFilter === "true") params.set("hasProductionOrder", "true");
    if (productionFilter === "false") params.set("hasProductionOrder", "false");
    if (productionFilter === "late") params.set("productionLate", "true");
    if (withRisk) params.set("withRisk", "true");
    if (overdueOnly) params.set("overdueOnly", "true");
    if (invoiceAfterDeadline) params.set("invoiceAfterDeadline", "true");
    if (partialOrCut) params.set("partialOrCut", "true");
    if (noProductionOrder) params.set("noProductionOrder", "true");
    if (productionLate) params.set("productionLate", "true");
    if (selectedManagementStatus) params.set("logisticStatus", selectedManagementStatus);
    return params.toString();
  }, [
    page,
    year,
    month,
    customerId,
    responsible,
    companyIssuer,
    operationalStatus,
    deadlineStatus,
    completionStatus,
    billingStatus,
    invoiceFilter,
    productionFilter,
    withRisk,
    overdueOnly,
    invoiceAfterDeadline,
    partialOrCut,
    noProductionOrder,
    productionLate,
    selectedManagementStatus,
  ]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJsonOk<ManagementResponse>(
        getSalesOrderManagementApiPath(queryString),
        { signal }
      );
      setRows(data.rows ?? []);
      setCards(data.cards ?? EMPTY_CARDS);
      setCardAmounts(data.cardAmounts ?? EMPTY_CARD_AMOUNTS);
      setDashboardCards(data.dashboardCards ?? []);
      setManagementSummary(data.summary ?? null);
      setTotal(data.total ?? 0);
      setTotalPages(Math.max(1, data.totalPages ?? 1));
    } catch (e) {
      if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
      console.error(e);
      setLoadError("Não foi possível carregar a Gestão de Pedidos.");
      setRows([]);
      setCards(EMPTY_CARDS);
      setCardAmounts(EMPTY_CARD_AMOUNTS);
      setDashboardCards([]);
      setManagementSummary(null);
      setTotal(0);
      setTotalPages(1);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const openDrawer = useCallback(async (row: SalesOrderManagementRow) => {
    setSelectedRow(row);
    setDrawerOpen(true);
    setIntelLoading(true);
    setIntelError(null);
    setIntelPayload(null);
    try {
      const payload = await fetchJsonOk<SalesOrderIntelligencePayload>(
        getSalesOrderIntelligenceApiPath(row.id)
      );
      setIntelPayload(payload);
    } catch (e) {
      setIntelError(e instanceof Error ? e.message : "Erro ao carregar inteligência.");
    } finally {
      setIntelLoading(false);
    }
  }, []);

  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = currentYear; y >= currentYear - 5; y -= 1) years.push(y);
    return years;
  }, [currentYear]);

  const kpiIcons: Record<string, React.ComponentType<{ className?: string }>> = {
    total: LayoutGrid,
    deliveredOnTime: Receipt,
    deliveredLate: Clock,
    overduePending: AlertTriangle,
    onTimePending: Package,
    finishedOrCancelled: AlertTriangle,
    reviewData: FileText,
  };

  const toggleManagementStatusCard = useCallback((cardId: ManagementStatusCardId) => {
    setSelectedManagementStatus((current) => (current === cardId ? "" : cardId));
    setPage(1);
  }, []);

  const clearManagementStatusCardFilter = useCallback(() => {
    setSelectedManagementStatus("");
    setPage(1);
  }, []);

  const displayDashboardCards = useMemo((): ManagementDashboardCard[] => {
    if (dashboardCards.length > 0) return dashboardCards;
    if (loading || loadError) return [];
    return buildManagementDashboardCardsFromAggregates(cards, cardAmounts, {
      totalOrders: managementSummary?.totalOrdersCount,
      totalNetValue: managementSummary?.totalNetValue,
    });
  }, [cardAmounts, cards, dashboardCards, loadError, loading, managementSummary]);

  const validPortfolioCount = managementSummary?.validPortfolioCount ?? null;
  const validPortfolioValue = managementSummary?.validPortfolioValue ?? null;

  return (
    <div className="space-y-6" data-testid="sales-order-management-page">
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 flex-1">
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Ano</label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
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
              <option value="all">Todos os anos</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Mês</label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={String(m)}>
                  {String(m).padStart(2, "0")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <CustomerAutocompleteFilter
              label="Cliente"
              value={customerSelection}
              placeholder="Todos os clientes"
              onChange={(sel) => {
                setCustomerSelection(sel);
                setCustomerId(sel?.id ?? "");
                setPage(1);
              }}
              onClear={() => {
                setCustomerSelection(null);
                setCustomerId("");
                setPage(1);
              }}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">
              Vendedor / responsável
            </label>
            <input
              type="text"
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
              value={responsible}
              onChange={(e) => {
                setResponsible(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Empresa</label>
            <input
              type="text"
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
              value={companyIssuer}
              onChange={(e) => {
                setCompanyIssuer(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">
              Status gerencial
            </label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
              value={operationalStatus}
              onChange={(e) => {
                setOperationalStatus(e.target.value);
                setPage(1);
              }}
            >
              {OPERATIONAL_STATUS_FILTER_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Prazo</label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
              value={deadlineStatus}
              onChange={(e) => {
                setDeadlineStatus(e.target.value);
                setPage(1);
              }}
            >
              {DEADLINE_STATUS_FILTER_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">
              Completeza
            </label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
              value={completionStatus}
              onChange={(e) => {
                setCompletionStatus(e.target.value);
                setPage(1);
              }}
            >
              {COMPLETION_STATUS_FILTER_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">NF</label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
              value={billingStatus}
              onChange={(e) => {
                setBillingStatus(e.target.value);
                setPage(1);
              }}
            >
              {BILLING_STATUS_FILTER_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">
              Vínculo NF
            </label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
              value={invoiceFilter}
              onChange={(e) => {
                setInvoiceFilter(e.target.value);
                setPage(1);
              }}
            >
              {INVOICE_FILTER_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">OP</label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
              value={productionFilter}
              onChange={(e) => {
                setProductionFilter(e.target.value);
                setPage(1);
              }}
            >
              {PRODUCTION_ORDER_FILTER_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setYear(String(currentYear));
            setMonth("");
            setCustomerId("");
            setCustomerSelection(null);
            setResponsible("");
            setCompanyIssuer("");
            setOperationalStatus("");
            setDeadlineStatus("");
            setCompletionStatus("");
            setBillingStatus("");
            setInvoiceFilter("");
            setProductionFilter("");
            setWithRisk(false);
            setOverdueOnly(false);
            setInvoiceAfterDeadline(false);
            setPartialOrCut(false);
            setNoProductionOrder(false);
            setProductionLate(false);
            setSelectedManagementStatus("");
            setPage(1);
          }}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          Limpar filtros
        </button>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Status Logístico
        </p>
        <div className="indus-kpi-grid mt-2">
          {displayDashboardCards.map((card) => {
            const Icon = kpiIcons[card.key] ?? FileText;
            const isTotal = card.isTotal === true;
            const isActive = isTotal
              ? selectedManagementStatus === ""
              : selectedManagementStatus === card.logisticStatus;
            const countLabel = `${card.count} pedido${card.count === 1 ? "" : "s"}`;
            const percentHint =
              card.percentOfTotal != null && !isTotal
                ? `${card.tooltip} (${card.percentOfTotal}% do total no filtro)`
                : card.tooltip;
            return (
              <button
                key={card.key}
                type="button"
                data-testid={
                  isTotal
                    ? "management-status-card-total"
                    : `management-status-card-${card.key}`
                }
                data-active={isActive ? "true" : "false"}
                onClick={() => {
                  if (isTotal) clearManagementStatusCardFilter();
                  else if (card.logisticStatus) toggleManagementStatusCard(card.logisticStatus);
                }}
                className={cn(
                  "text-left rounded-xl transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  isActive && "ring-2 ring-primary shadow-md"
                )}
              >
                <FinanceBiKpiCard
                  icon={Icon}
                  label={card.label}
                  value={loading || loadError ? "—" : countLabel}
                  sub={loading || loadError ? undefined : formatCurrency(card.totalNetValue)}
                  loading={loading}
                  hint={percentHint}
                />
              </button>
            );
          })}
        </div>
        {!loading && !loadError && validPortfolioCount != null ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Carteira válida no filtro:{" "}
            <span className="font-semibold text-foreground">{validPortfolioCount}</span> pedido(s)
            {validPortfolioValue != null ? (
              <>
                {" "}
                ·{" "}
                <span className="font-semibold text-foreground">
                  {formatCurrency(validPortfolioValue)}
                </span>
              </>
            ) : null}{" "}
            não finalizados/cancelados (BI)
          </p>
        ) : null}
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Alertas operacionais
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
        <label className="inline-flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={withRisk}
            onChange={(e) => {
              setWithRisk(e.target.checked);
              setPage(1);
            }}
          />
          Com risco
        </label>
        <label className="inline-flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => {
              setOverdueOnly(e.target.checked);
              setPage(1);
            }}
          />
          Atrasados
        </label>
        <label className="inline-flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={noProductionOrder}
            onChange={(e) => {
              setNoProductionOrder(e.target.checked);
              setPage(1);
            }}
          />
          Sem OP
        </label>
        <label className="inline-flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={invoiceAfterDeadline}
            onChange={(e) => {
              setInvoiceAfterDeadline(e.target.checked);
              setPage(1);
            }}
          />
          NF após prazo
        </label>
        <label className="inline-flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={partialOrCut}
            onChange={(e) => {
              setPartialOrCut(e.target.checked);
              setPage(1);
            }}
          />
          Parcial / com corte
        </label>
        <label className="inline-flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={productionLate}
            onChange={(e) => {
              setProductionLate(e.target.checked);
              setPage(1);
            }}
          />
          OP atrasada
        </label>
        </div>
      </div>

      {selectedManagementStatus ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm">
          <span>
            Exibindo <span className="font-semibold">{total}</span> pedido(s) com status:{" "}
            <span className="font-semibold">
              {getManagementStatusFilterLabel(selectedManagementStatus)}
            </span>
          </span>
          <button
            type="button"
            data-testid="clear-management-status-filter"
            onClick={() => {
              setSelectedManagementStatus("");
              setPage(1);
            }}
            className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium hover:bg-muted"
          >
            Limpar filtro do card
          </button>
        </div>
      ) : null}

      {loadError ? (
        <div
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          data-testid="sales-order-management-error"
          role="alert"
        >
          {loadError}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {loading ? (
          "Carregando gestão de pedidos…"
        ) : loadError ? (
          "Falha ao carregar pedidos."
        ) : total === 0 ? (
          year === "all"
            ? "Nenhum pedido encontrado para os filtros aplicados."
            : "Nenhum pedido encontrado para o ano selecionado."
        ) : (
          <>
            Exibindo página <span className="font-semibold text-foreground">{page}</span> de{" "}
            <span className="font-semibold text-foreground">{totalPages}</span> ·{" "}
            <span className="font-semibold text-foreground">{total}</span> pedido(s) no filtro
          </>
        )}
      </p>
      <p className="text-xs text-muted-foreground" data-testid="sales-order-management-row-hint">
        Clique no pedido para ver dados completos da integração.
      </p>

      <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table
            className="w-full text-left text-sm"
            data-testid="sales-order-management-table"
          >
            <thead className="bg-accent/50 border-b border-border">
              <tr>
                <th className="p-3 font-semibold">Pedido</th>
                <th className="p-3 font-semibold">Cliente</th>
                <th className="p-3 font-semibold">Emissão</th>
                <th className="p-3 font-semibold">Previsão entrega</th>
                <th className="p-3 font-semibold text-right">Valor</th>
                <th className="p-3 font-semibold">Status Logístico</th>
                <th className="p-3 font-semibold">Prazo</th>
                <th className="p-3 font-semibold">NF</th>
                <th className="p-3 font-semibold">OP</th>
                <th className="p-3 font-semibold">Completeza</th>
                <th className="p-3 font-semibold text-right">% fat.</th>
                <th className="p-3 font-semibold text-right">% atend.</th>
                <th className="p-3 font-semibold w-28"> </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={13} className="p-8 text-center text-muted-foreground">
                    <Loader2 className="inline h-5 w-5 animate-spin mr-2" />
                    Carregando…
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={13} className="p-8 text-center text-destructive">
                    {loadError}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="p-8 text-center text-muted-foreground">
                    {year === "all"
                      ? "Nenhum pedido encontrado para os filtros aplicados."
                      : "Nenhum pedido encontrado para o ano selecionado."}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border/60 hover:bg-accent/30 cursor-pointer"
                    onClick={() => void openDrawer(row)}
                    data-testid="sales-order-management-row"
                  >
                    <td className="p-3">
                      <div className="font-semibold text-primary">{row.number}</div>
                      <div className="text-[10px] text-muted-foreground">Ver detalhes</div>
                    </td>
                    <td className="p-3">{row.customerName}</td>
                    <td className="p-3">{formatSalesOrderDate(row.issueDate)}</td>
                    <td className="p-3">{formatSalesOrderDate(row.expectedDeliveryDate)}</td>
                    <td className="p-3 text-right tabular-nums">{formatCurrency(row.totalNetValue)}</td>
                    <td className="p-3">
                      <span
                        className={badgeClass("status")}
                        title={row.executiveStatusLabel}
                      >
                        {row.logisticStatusLabel}
                      </span>
                    </td>
                    <td className="p-3">
                      <span
                        className={badgeClass("deadline")}
                        title={formatDeadlineBadge(
                          row.deadlineStatus,
                          row.daysOverdue,
                          row.operationalStatus
                        )}
                      >
                        {formatDeadlineBadge(
                          row.deadlineStatus,
                          row.daysOverdue,
                          row.operationalStatus
                        )}
                      </span>
                    </td>
                    <td className="p-3">
                      <span
                        className={badgeClass("invoice")}
                        title={
                          row.deadlineStatus === "invoiced_late"
                            ? "NF após prazo"
                            : formatInvoiceBadge(
                                row.hasInvoice,
                                row.invoicedPercent,
                                row.operationalStatus
                              )
                        }
                      >
                        {row.deadlineStatus === "invoiced_late"
                          ? "NF após prazo"
                          : formatInvoiceBadge(
                              row.hasInvoice,
                              row.invoicedPercent,
                              row.operationalStatus
                            )}
                      </span>
                    </td>
                    <td className="p-3">
                      <span
                        className={badgeClass("op")}
                        title={formatProductionBadge(
                          row.hasLinkedProductionOrder,
                          row.productionOrderLate,
                          {
                            label: row.productionOrderLabel,
                            status: row.productionOrderStatus,
                            operationalStatus: row.operationalStatus,
                          }
                        )}
                      >
                        {formatProductionBadge(
                          row.hasLinkedProductionOrder,
                          row.productionOrderLate,
                          {
                            label: row.productionOrderLabel,
                            status: row.productionOrderStatus,
                            operationalStatus: row.operationalStatus,
                          }
                        )}
                      </span>
                    </td>
                    <td className="p-3">
                      <span title={COMPLETION_STATUS_LABELS[row.completionStatus]}>
                        {COMPLETION_STATUS_LABELS[row.completionStatus]}
                      </span>
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {formatSalesOrderPercent(row.invoicedPercent)}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {formatSalesOrderPercent(row.fulfilledPercent)}
                    </td>
                    <td className="p-3">
                      <button
                        type="button"
                        className="rounded-lg border border-border bg-card px-2 py-1 text-xs font-semibold hover:bg-accent"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openDrawer(row);
                        }}
                        data-testid="sales-order-view-intelligence"
                      >
                        Ver inteligência
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm disabled:opacity-50"
          >
            Anterior
          </button>
          <span className="text-sm text-muted-foreground">
            Página {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm disabled:opacity-50"
          >
            Próxima
          </button>
        </div>
      ) : null}

      <SalesOrderIntelligenceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        loading={intelLoading}
        error={intelError}
        payload={intelPayload}
        orderLabel={
          selectedRow
            ? `${selectedRow.number} · ${selectedRow.customerName}`
            : "Pedido de venda"
        }
      />
    </div>
  );
}
