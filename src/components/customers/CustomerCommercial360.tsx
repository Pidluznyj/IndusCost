import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  X,
  Loader2,
  TrendingUp,
  Package,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  User,
  FileText,
  BarChart3,
  Info,
  Clock,
  Heart,
  Sparkles,
  ListTodo,
  Target,
  ExternalLink,
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import "@/src/styles/indus-kpi-grid.css";
import { buildCustomerIntelligencePath } from "@/src/lib/customerIntelligenceNavigation";
import { fetchJsonOk } from "@/src/lib/http";
import { SearchableSelect } from "@/src/components/shared/SearchableSelect";
import type { Customer, SalesOrderLinkStatus } from "@/src/types/commercial";
import type { PortfolioAbcResult } from "@/src/lib/customerCommercialShared";
import type { OfficialScopedOrderMetrics } from "@/src/lib/salesOrderRulesAdapter.js";
import {
  aggregateSalesOrderMarginSummaries,
  buildOfficialSalesOrderMarginTooltipText,
  buildSalesOrderMarginCoverageHint,
  formatSalesOrderMarginPercent,
  resolveSalesOrderMarginMoneyLabel,
  resolveSalesOrderMarginPercentLabel,
} from "@/src/lib/salesOrderMarginDisplay";
import type { SalesOrderItemMarginPayload, SalesOrderMarginSummaryPayload } from "@/src/lib/salesOrderMarginTypes";
import {
  COMMERCIAL_SALES_ORDER_BASIS_NOTE,
  computeCommercialPhase2FromSalesOrders,
  enrichCrossSellFromSalesOrderMix,
  HEALTH_LEVEL_LABEL_PT,
  isCommercialMetricsSalesOrder,
  isCommercialOpenSalesOrder,
  REPURCHASE_WINDOW_LABEL_PT,
  safeCommercialNumber,
  SALES_ORDER_STATUS_LABELS,
} from "@/src/lib/customerCommercialSalesOrderView";

type ProductLite = { id: string; sku: string; name: string; type: string };

type SalesOrderItemRow = {
  id: string;
  productId: string;
  quantity: unknown;
  totalNetValue: unknown;
  /** Legado Nomus — diagnóstico; não usar para KPI de margem. */
  marginValue: unknown;
  negotiatedPrice: unknown;
  Product?: ProductLite;
  officialMargin?: SalesOrderItemMarginPayload | null;
};

export type CommercialSalesOrder = {
  id: string;
  orderCode: string;
  status: SalesOrderLinkStatus;
  issueDate: string;
  updatedAt: string;
  responsible: string | null;
  totalNetValue: unknown;
  totalGrossValue: unknown;
  /** Legado Nomus — diagnóstico; não usar para KPI de margem. */
  totalMarginValue: unknown;
  /** Legado Nomus — diagnóstico; não usar para KPI de margem. */
  totalMarginPerc: unknown;
  marginSummary?: SalesOrderMarginSummaryPayload | null;
  totalItems: number;
  paymentTerms: string | null;
  freightCondition: string | null;
  notes: string | null;
  hasInvoicing: boolean;
  items: SalesOrderItemRow[];
};

function daysBetween(a: string | Date, b: string | Date): number {
  const t1 = typeof a === "string" ? new Date(a).getTime() : a.getTime();
  const t2 = typeof b === "string" ? new Date(b).getTime() : b.getTime();
  return Math.floor((t2 - t1) / 86400000);
}

function officialItemMarginValue(item: SalesOrderItemRow): number {
  if (item.officialMargin?.marginValue != null && Number.isFinite(item.officialMargin.marginValue)) {
    return item.officialMargin.marginValue;
  }
  return 0;
}

function inRange(iso: string, from: string | null, to: string | null): boolean {
  const t = new Date(iso).getTime();
  if (from) {
    const f = new Date(from);
    f.setHours(0, 0, 0, 0);
    if (t < f.getTime()) return false;
  }
  if (to) {
    const x = new Date(to);
    x.setHours(23, 59, 59, 999);
    if (t > x.getTime()) return false;
  }
  return true;
}

const STATUS_OPTS: { value: SalesOrderLinkStatus | ""; label: string }[] = [
  { value: "", label: "Todos os status" },
  ...(["DRAFT", "READY_TO_SEND", "SENT_TO_NOMUS", "CANCELLED", "ERROR"] as const).map((s) => ({
    value: s,
    label: SALES_ORDER_STATUS_LABELS[s],
  })),
];

interface Props {
  open: boolean;
  customerId: string | null;
  onClose: () => void;
}

export const CustomerCommercial360: React.FC<Props> = ({ open, customerId, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [salesOrders, setSalesOrders] = useState<CommercialSalesOrder[]>([]);
  const [portfolioAbc, setPortfolioAbc] = useState<PortfolioAbcResult | null>(null);
  const [officialOrderMetrics, setOfficialOrderMetrics] = useState<OfficialScopedOrderMetrics | null>(
    null
  );

  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [statusF, setStatusF] = useState<SalesOrderLinkStatus | "">("");
  const [respF, setRespF] = useState("");
  const [productF, setProductF] = useState("");
  const [dealScope, setDealScope] = useState<"all" | "open" | "invoiced" | "cancelled">("all");
  const [minNet, setMinNet] = useState("");
  const [maxNet, setMaxNet] = useState("");

  useEffect(() => {
    if (!open || !customerId) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setPortfolioAbc(null);
    fetchJsonOk<{
      customer: Customer;
      salesOrders: CommercialSalesOrder[];
      portfolioAbc: PortfolioAbcResult;
      officialOrderMetrics?: OfficialScopedOrderMetrics;
    }>(`/api/customers/${customerId}/commercial-360`)
      .then((data) => {
        if (cancelled) return;
        setCustomer(data.customer);
        setSalesOrders(Array.isArray(data.salesOrders) ? data.salesOrders : []);
        setPortfolioAbc(data.portfolioAbc ?? null);
        setOfficialOrderMetrics(data.officialOrderMetrics ?? null);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Erro ao carregar.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, customerId]);

  const responsibleOpts = useMemo(() => {
    const s = new Set<string>();
    salesOrders.forEach((o) => {
      const t = (o.responsible || "").trim();
      if (t) s.add(t);
    });
    return [
      { value: "", label: "Todos", searchTerms: "todos" },
      ...[...s].sort().map((r) => ({ value: r, label: r, searchTerms: r })),
    ];
  }, [salesOrders]);

  const productOpts = useMemo(() => {
    const m = new Map<string, string>();
    salesOrders.forEach((o) => {
      o.items?.forEach((it) => {
        if (it.Product) m.set(it.Product.id, `${it.Product.sku} — ${it.Product.name}`);
      });
    });
    return [
      { value: "", label: "Todos os produtos", searchTerms: "todos" },
      ...[...m.entries()].map(([id, label]) => ({ value: id, label, searchTerms: label })),
    ];
  }, [salesOrders]);

  const mixRowsAll = useMemo(() => {
    const m = new Map<
      string,
      { sku: string; name: string; type: string; qty: number; revenue: number; margin: number }
    >();
    salesOrders.forEach((o) => {
      if (!isCommercialMetricsSalesOrder(o.status)) return;
      o.items?.forEach((it) => {
        const pr = it.Product;
        const id = it.productId;
        const qty = safeCommercialNumber(it.quantity);
        const lineRev = safeCommercialNumber(it.totalNetValue);
        const lineMg = officialItemMarginValue(it);
        const prev = m.get(id);
        const sku = pr?.sku || "—";
        const name = pr?.name || "Produto";
        const type = pr?.type || "—";
        if (prev) {
          m.set(id, {
            ...prev,
            qty: prev.qty + qty,
            revenue: prev.revenue + lineRev,
            margin: prev.margin + lineMg,
          });
        } else {
          m.set(id, { sku, name, type, qty, revenue: lineRev, margin: lineMg });
        }
      });
    });
    return [...m.values()].sort((a, b) => b.revenue - a.revenue);
  }, [salesOrders]);

  const filtered = useMemo(() => {
    const minV = minNet === "" ? null : safeCommercialNumber(minNet);
    const maxV = maxNet === "" ? null : safeCommercialNumber(maxNet);
    return salesOrders.filter((o) => {
      if (!inRange(o.issueDate, dateFrom, dateTo)) return false;
      if (statusF && o.status !== statusF) return false;
      if (respF && (o.responsible || "").trim() !== respF) return false;
      if (productF && !o.items?.some((i) => i.productId === productF)) return false;
      const net = safeCommercialNumber(o.totalNetValue);
      if (minV !== null && net < minV) return false;
      if (maxV !== null && net > maxV) return false;
      if (dealScope === "open" && !isCommercialOpenSalesOrder(o)) return false;
      if (dealScope === "invoiced" && (!o.hasInvoicing || !isCommercialMetricsSalesOrder(o.status)))
        return false;
      if (dealScope === "cancelled" && o.status !== "CANCELLED") return false;
      return true;
    });
  }, [salesOrders, dateFrom, dateTo, statusF, respF, productF, minNet, maxNet, dealScope]);

  const filtersAreDefault =
    !dateFrom &&
    !dateTo &&
    !statusF &&
    !respF &&
    !productF &&
    !minNet &&
    !maxNet &&
    dealScope === "all";

  const metrics = useMemo(() => {
    const fo = filtered;
    const valid = fo.filter((o) => isCommercialMetricsSalesOrder(o.status));
    const useOfficial = filtersAreDefault && officialOrderMetrics != null;
    const marginSummaries = valid
      .map((o) => o.marginSummary)
      .filter((s): s is SalesOrderMarginSummaryPayload => Boolean(s));
    const filteredMarginAgg = aggregateSalesOrderMarginSummaries(marginSummaries);
    const usesOfficialMarginMetrics = marginSummaries.length > 0 && filteredMarginAgg != null;
    const marginCoverage = filteredMarginAgg ?? null;
    const totalNet = useOfficial
      ? officialOrderMetrics.soldAmount
      : valid.reduce((a, o) => a + safeCommercialNumber(o.totalNetValue), 0);
    const totalGross = valid.reduce((a, o) => a + safeCommercialNumber(o.totalGrossValue), 0);
    const totalMargin = usesOfficialMarginMetrics ? filteredMarginAgg!.marginValue : 0;
    const count = fo.length;
    const validCount = useOfficial ? officialOrderMetrics.filteredOrders : valid.length;
    const invoicedCount = useOfficial
      ? officialOrderMetrics.invoicedPortfolioCount
      : valid.filter((o) => o.hasInvoicing).length;
    const cancelledCount = fo.filter((o) => o.status === "CANCELLED").length;
    const ticket = useOfficial
      ? officialOrderMetrics.averageTicket
      : validCount > 0
        ? totalNet / validCount
        : 0;
    const nets = valid.map((o) => safeCommercialNumber(o.totalNetValue)).filter((v) => v > 0);
    const minDeal = nets.length ? Math.min(...nets) : 0;
    const maxDeal = nets.length ? Math.max(...nets) : 0;
    const totalItems = valid.reduce((a, o) => a + (o.totalItems || 0), 0);
    const avgItems = validCount > 0 ? totalItems / validCount : 0;
    const marginAvg =
      usesOfficialMarginMetrics && filteredMarginAgg?.marginPercent != null
        ? filteredMarginAgg.marginPercent
        : 0;

    const validChrono = [...valid].sort(
      (a, b) => new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime()
    );
    let avgRepurchase: number | null = null;
    if (validChrono.length >= 2) {
      let sum = 0;
      for (let i = 1; i < validChrono.length; i++) {
        sum += daysBetween(validChrono[i - 1]!.issueDate, validChrono[i]!.issueDate);
      }
      avgRepurchase = sum / (validChrono.length - 1);
    }
    const lastOrder = validChrono.length ? validChrono[validChrono.length - 1] : null;
    const daysSinceLastOrder = lastOrder ? daysBetween(lastOrder.issueDate, new Date()) : null;

    const lastAny = fo.length
      ? [...fo].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
      : null;

    const openOrders = valid.filter((o) => isCommercialOpenSalesOrder(o));
    const openNet = useOfficial
      ? officialOrderMetrics.openPortfolioAmount
      : openOrders.reduce((a, o) => a + safeCommercialNumber(o.totalNetValue), 0);

    return {
      totalNet,
      totalGross,
      totalMargin,
      count,
      validCount,
      invoicedCount,
      cancelledCount,
      ticket,
      minDeal,
      maxDeal,
      avgItems,
      marginAvg,
      avgRepurchase,
      daysSinceLastOrder,
      lastOrderDate: lastOrder?.issueDate,
      lastMovement: lastAny,
      openNet,
      openCount: useOfficial ? officialOrderMetrics.openPortfolioCount : openOrders.length,
      usesOfficialOrderMetrics: useOfficial,
      usesOfficialMarginMetrics,
      marginCoverage,
    };
  }, [filtered, filtersAreDefault, officialOrderMetrics]);

  const mixRows = useMemo(() => {
    const m = new Map<
      string,
      { sku: string; name: string; type: string; qty: number; revenue: number; margin: number }
    >();
    filtered.forEach((o) => {
      if (!isCommercialMetricsSalesOrder(o.status)) return;
      o.items?.forEach((it) => {
        const pr = it.Product;
        const id = it.productId;
        const qty = safeCommercialNumber(it.quantity);
        const lineRev = safeCommercialNumber(it.totalNetValue);
        const lineMg = officialItemMarginValue(it);
        const prev = m.get(id);
        const sku = pr?.sku || "—";
        const name = pr?.name || "Produto";
        const type = pr?.type || "—";
        if (prev) {
          m.set(id, {
            ...prev,
            qty: prev.qty + qty,
            revenue: prev.revenue + lineRev,
            margin: prev.margin + lineMg,
          });
        } else {
          m.set(id, { sku, name, type, qty, revenue: lineRev, margin: lineMg });
        }
      });
    });
    return [...m.values()].sort((a, b) => b.revenue - a.revenue);
  }, [filtered]);

  const alerts = useMemo(() => {
    const out: { level: "info" | "warn" | "danger"; text: string }[] = [];
    const now = new Date();
    const valid = filtered.filter((o) => isCommercialMetricsSalesOrder(o.status));
    const lastOrd = valid.length
      ? [...valid].sort(
          (a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime()
        )[0]
      : null;

    if (valid.length >= 2 && metrics.avgRepurchase != null && lastOrd) {
      const since = daysBetween(lastOrd.issueDate, now);
      if (since > metrics.avgRepurchase * 1.1) {
        out.push({
          level: "warn",
          text: `Sem novo pedido há ${since} dias; média histórica entre pedidos ~${Math.round(metrics.avgRepurchase)} dias — oportunidade de recompra.`,
        });
      }
      if (since < metrics.avgRepurchase * 0.5 && since >= 0) {
        out.push({
          level: "info",
          text: `Dentro da janela típica de recompra (último pedido há ${since} dias; média ~${Math.round(metrics.avgRepurchase)}).`,
        });
      }
    }

    if (lastOrd && daysBetween(lastOrd.issueDate, now) > 120) {
      out.push({
        level: "warn",
        text: "Último pedido há mais de 120 dias — revisar relacionamento.",
      });
    }

    valid
      .filter((o) => isCommercialOpenSalesOrder(o))
      .forEach((o) => {
        const du = daysBetween(o.updatedAt, now);
        if (du > 30) {
          out.push({
            level: "warn",
            text: `Pedido ${o.orderCode} em carteira há ${du} dias sem faturamento processado.`,
          });
        }
      });

    if (metrics.openNet > 0 && metrics.totalNet > 0 && metrics.openCount > 0) {
      const ratio = metrics.openNet / (metrics.totalNet + metrics.openNet);
      if (ratio > 0.4 && valid.length > 0) {
        out.push({
          level: "info",
          text: "Carteira em aberto representa fatia relevante do histórico filtrado — acompanhar faturamento.",
        });
      }
    }

    if (metrics.marginAvg >= 15 && valid.length > 0) {
      out.push({
        level: "info",
        text: `Margem média dos pedidos no filtro elevada (~${formatNumber(metrics.marginAvg, 1)}%).`,
      });
    }

    return out.slice(0, 12);
  }, [filtered, metrics]);

  const phase2 = useMemo(() => {
    if (!portfolioAbc) return null;
    const slices = salesOrders.map((o) => ({
      id: o.id,
      orderCode: o.orderCode,
      status: o.status,
      issueDate: o.issueDate,
      updatedAt: o.updatedAt,
      totalNetValue: o.totalNetValue,
      marginSummary: o.marginSummary,
      responsible: o.responsible,
      hasInvoicing: o.hasInvoicing,
    }));
    const base = computeCommercialPhase2FromSalesOrders(slices, portfolioAbc);
    const mixHint = enrichCrossSellFromSalesOrderMix(
      mixRowsAll.map((r) => ({ sku: r.sku, type: r.type, revenue: r.revenue })),
      slices.filter((o) => isCommercialMetricsSalesOrder(o.status)).length
    );
    return { ...base, crossSell: [...base.crossSell, ...mixHint] };
  }, [salesOrders, portfolioAbc, mixRowsAll]);

  const relationInfo = useMemo(() => {
    const last = salesOrders.length
      ? [...salesOrders].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )[0]
      : null;
    const openAll = salesOrders.filter((o) => isCommercialOpenSalesOrder(o)).length;
    return {
      resp: last?.responsible?.trim() || null,
      lastMove: last?.updatedAt,
      lastStatus: last?.status,
      openAll,
    };
  }, [salesOrders]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/90 backdrop-blur-sm">
      <div className="bg-card w-full max-w-6xl max-h-[95vh] rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden">
        <div className="p-4 border-b border-border bg-accent/30 flex items-start justify-between gap-4 shrink-0">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-primary" />
              Visão comercial do cliente
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {customer?.companyName || "..."}{" "}
              {customer?.tradeName ? `· ${customer.tradeName}` : ""}
            </p>
            <p className="text-[10px] text-muted-foreground mt-2 max-w-2xl flex gap-1">
              <Info className="h-3 w-3 shrink-0 mt-0.5" />
              {COMMERCIAL_SALES_ORDER_BASIS_NOTE} Indicadores respeitam os filtros abaixo.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {customerId ? (
              <Link
                to={buildCustomerIntelligencePath(customerId)}
                onClick={onClose}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Abrir Inteligência Completa
              </Link>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-full hover:bg-accent"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {customerId ? (
          <div className="mx-4 mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2 shrink-0">
            <span>
              Resumo rápido local. Para score, financeiro (AR), CRM e oportunidades prioritárias, abra a
              Inteligência Completa.
            </span>
            <Link
              to={buildCustomerIntelligencePath(customerId)}
              onClick={onClose}
              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline whitespace-nowrap"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Inteligência Completa
            </Link>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Carregando histórico comercial...</p>
            </div>
          )}
          {err && <p className="text-sm text-red-600 text-center py-8">{err}</p>}
          {!loading && !err && customer && (
            <>
              {phase2 && (
                <div className="rounded-xl border border-primary/25 bg-gradient-to-br from-primary/5 to-transparent p-4 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-black flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        Inteligência comercial
                      </h3>
                      <p className="text-[10px] text-muted-foreground mt-1 max-w-3xl">{phase2.proxyNote}</p>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">v{phase2.version}</span>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <IntelCard
                      title="Saúde comercial"
                      icon={<Heart className="h-4 w-4 text-rose-500" />}
                      main={HEALTH_LEVEL_LABEL_PT[phase2.health.level]}
                      sub={`Score ${phase2.health.score}/100`}
                      reasons={phase2.health.reasons}
                      footer="Critérios: recência de pedidos, carteira em aberto, intervalo entre compras e margem."
                    />
                    <IntelCard
                      title="Classificação"
                      icon={<Target className="h-4 w-4 text-primary" />}
                      main={phase2.segment.labelsPt[phase2.segment.primary]}
                      reasons={phase2.segment.reasons}
                      badges={[
                        `ABC: ${
                          phase2.portfolioAbc.abcEligible && phase2.portfolioAbc.abcClass
                            ? `Classe ${phase2.portfolioAbc.abcClass}`
                            : "— (sem receita de pedidos)"
                        }`,
                        phase2.portfolioAbc.rank != null
                          ? `Ranking receita: #${phase2.portfolioAbc.rank} / ${phase2.portfolioAbc.customerCount}`
                          : "",
                      ].filter(Boolean)}
                    />
                    <IntelCard
                      title="Previsão de recompra"
                      icon={<Calendar className="h-4 w-4 text-primary" />}
                      main={REPURCHASE_WINDOW_LABEL_PT[phase2.repurchase.windowStatus]}
                      sub={phase2.repurchase.windowDetail}
                      stats={[
                        ["Mediana (dias)", phase2.repurchase.medianDaysBetweenApprovals],
                        ["Média (dias)", phase2.repurchase.meanDaysBetweenApprovals],
                        ["Dias último pedido", phase2.repurchase.daysSinceLastApproval],
                      ]}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-border bg-card p-4">
                      <h4 className="text-xs font-bold uppercase text-muted-foreground mb-2 flex items-center gap-2">
                        <BarChart3 className="h-3.5 w-3.5" /> Curva ABC (carteira)
                      </h4>
                      <p className="text-[10px] text-muted-foreground mb-2">{phase2.portfolioAbc.basisLabel}</p>
                      <p className="text-[11px] leading-relaxed">{phase2.portfolioAbc.methodologyNote}</p>
                      <dl className="mt-3 grid grid-cols-2 gap-1 text-[11px]">
                        <dt className="text-muted-foreground">Receita de pedidos (cliente)</dt>
                        <dd className="text-right font-mono">
                          {formatCurrency(phase2.portfolioAbc.customerApprovedNet)}
                        </dd>
                        <dt className="text-muted-foreground">Total carteira (pedidos)</dt>
                        <dd className="text-right font-mono">
                          {formatCurrency(phase2.portfolioAbc.portfolioApprovedTotal)}
                        </dd>
                        <dt className="text-muted-foreground">Participação</dt>
                        <dd className="text-right font-mono">
                          {formatNumber(phase2.portfolioAbc.shareOfPortfolioPct, 2)}%
                        </dd>
                      </dl>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4">
                      <h4 className="text-xs font-bold uppercase text-muted-foreground mb-2 flex items-center gap-2">
                        <TrendingUp className="h-3.5 w-3.5" /> Tendência (pedidos)
                      </h4>
                      <dl className="grid grid-cols-2 gap-1 text-[11px]">
                        <dt className="text-muted-foreground">Últimos 180d (líq. pedidos)</dt>
                        <dd className="text-right font-mono">
                          {formatCurrency(phase2.trend.recent180dApprovedNet)}
                        </dd>
                        <dt className="text-muted-foreground">180d anteriores</dt>
                        <dd className="text-right font-mono">
                          {formatCurrency(phase2.trend.prior180dApprovedNet)}
                        </dd>
                      </dl>
                      {phase2.trend.note && (
                        <p className="text-[11px] text-amber-800 mt-2">{phase2.trend.note}</p>
                      )}
                    </div>
                  </div>

                  {phase2.crossSell.length > 0 && (
                    <div className="rounded-xl border border-border bg-card p-4">
                      <h4 className="text-xs font-bold uppercase text-muted-foreground mb-2 flex items-center gap-2">
                        <Package className="h-3.5 w-3.5" /> Expansão / cross-sell
                      </h4>
                      <ul className="text-[11px] space-y-1 list-disc pl-4 text-muted-foreground">
                        {phase2.crossSell.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {phase2.nextActions.length > 0 && (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                      <h4 className="text-xs font-bold uppercase text-amber-900 mb-2 flex items-center gap-2">
                        <ListTodo className="h-3.5 w-3.5" /> Próximas ações sugeridas
                      </h4>
                      <ul className="text-sm space-y-1.5">
                        {phase2.nextActions.map((a, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-[10px] font-bold uppercase text-muted-foreground w-16 shrink-0 pt-0.5">
                              {a.kind === "follow_up" ? "Follow-up" : a.kind === "risk" ? "Risco" : "Expansão"}
                            </span>
                            <span>{a.text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {phase2.strategicAlerts.length > 0 && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-2">
                      <h4 className="text-xs font-bold uppercase text-red-900 flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5" /> Alertas comerciais
                      </h4>
                      <ul className="text-sm space-y-1">
                        {phase2.strategicAlerts.map((a, i) => (
                          <li
                            key={i}
                            className={cn(
                              a.level === "danger" && "text-red-800",
                              a.level === "warn" && "text-amber-900",
                              a.level === "info" && "text-blue-900"
                            )}
                          >
                            {a.text}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="rounded-xl border border-dashed border-border p-3 bg-muted/30">
                    <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Visão gerencial</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{phase2.managerial.summary}</p>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-border p-4 bg-accent/10 space-y-3">
                <p className="text-xs font-bold uppercase text-muted-foreground">Filtros da visão</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-muted-foreground">Período (emissão)</label>
                    <div className="flex gap-2 mt-1">
                      <input
                        type="date"
                        className="w-full p-2 rounded-lg border border-border text-xs"
                        value={dateFrom || ""}
                        onChange={(e) => setDateFrom(e.target.value || null)}
                      />
                      <input
                        type="date"
                        className="w-full p-2 rounded-lg border border-border text-xs"
                        value={dateTo || ""}
                        onChange={(e) => setDateTo(e.target.value || null)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-muted-foreground">Status do pedido</label>
                    <SearchableSelect
                      placeholder="Status..."
                      options={STATUS_OPTS.map((o) => ({
                        value: o.value,
                        label: o.label,
                        searchTerms: o.label,
                      }))}
                      value={statusF}
                      onChange={(v) => setStatusF(v as SalesOrderLinkStatus | "")}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-muted-foreground">Responsável</label>
                    <SearchableSelect
                      placeholder="—"
                      options={responsibleOpts}
                      value={respF}
                      onChange={setRespF}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-muted-foreground">Produto (linha)</label>
                    <SearchableSelect
                      placeholder="—"
                      options={productOpts}
                      value={productF}
                      onChange={setProductF}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-muted-foreground">Valor líq. min / max</label>
                    <div className="flex gap-2 mt-1">
                      <input
                        type="number"
                        className="w-full p-2 rounded-lg border border-border text-xs"
                        placeholder="Min"
                        value={minNet}
                        onChange={(e) => setMinNet(e.target.value)}
                      />
                      <input
                        type="number"
                        className="w-full p-2 rounded-lg border border-border text-xs"
                        placeholder="Max"
                        value={maxNet}
                        onChange={(e) => setMaxNet(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 items-end">
                    {(
                      [
                        ["all", "Todos"],
                        ["open", "Em aberto"],
                        ["invoiced", "Faturados"],
                        ["cancelled", "Cancelados"],
                      ] as const
                    ).map(([k, lab]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setDealScope(k)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-bold border",
                          dealScope === k
                            ? "bg-primary text-primary-foreground"
                            : "bg-background border-border"
                        )}
                      >
                        {lab}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="indus-kpi-grid indus-kpi-grid--wide">
                <MiniCard label="Receita de pedidos (filtro)" value={formatCurrency(metrics.totalNet)} hint={metrics.usesOfficialOrderMetrics ? "Motor oficial de Pedidos de Venda" : "Escopo filtrado localmente"} />
                <MiniCard label="Pedidos (filtro)" value={String(metrics.count)} />
                <MiniCard label="Pedidos válidos (filtro)" value={String(metrics.validCount)} />
                <MiniCard label="Faturados (filtro)" value={String(metrics.invoicedCount)} />
                <MiniCard label="Ticket médio (filtro)" value={formatCurrency(metrics.ticket)} />
                <MiniCard
                  label={resolveSalesOrderMarginPercentLabel(metrics.marginCoverage)}
                  value={
                    metrics.usesOfficialMarginMetrics
                      ? formatSalesOrderMarginPercent(metrics.marginAvg)
                      : "—"
                  }
                  valueTitle={
                    metrics.usesOfficialMarginMetrics && metrics.marginCoverage
                      ? buildOfficialSalesOrderMarginTooltipText({ summary: metrics.marginCoverage })
                      : undefined
                  }
                  hint={
                    metrics.usesOfficialMarginMetrics && metrics.marginCoverage
                      ? buildSalesOrderMarginCoverageHint(metrics.marginCoverage, formatCurrency)
                      : "Margem indisponível para o filtro atual"
                  }
                />
                <MiniCard
                  label={resolveSalesOrderMarginMoneyLabel(metrics.marginCoverage)}
                  value={
                    metrics.usesOfficialMarginMetrics
                      ? formatCurrency(metrics.totalMargin)
                      : "—"
                  }
                  valueTitle={
                    metrics.usesOfficialMarginMetrics && metrics.marginCoverage
                      ? buildOfficialSalesOrderMarginTooltipText({ summary: metrics.marginCoverage })
                      : undefined
                  }
                  hint={
                    metrics.usesOfficialMarginMetrics && metrics.marginCoverage
                      ? buildSalesOrderMarginCoverageHint(metrics.marginCoverage, formatCurrency)
                      : "Margem indisponível para o filtro atual"
                  }
                />
                <MiniCard
                  label="Maior / menor pedido (líq.)"
                  value={`${formatCurrency(metrics.maxDeal)} / ${formatCurrency(metrics.minDeal)}`}
                />
                <MiniCard label="Média itens / pedido" value={formatNumber(metrics.avgItems, 2)} />
                <MiniCard
                  label="Carteira em aberto (filtro)"
                  value={formatCurrency(metrics.openNet)}
                  hint={`${metrics.openCount} pedido(s)`}
                />
                <MiniCard
                  label="Último pedido"
                  value={
                    metrics.lastOrderDate
                      ? new Date(metrics.lastOrderDate).toLocaleDateString("pt-BR")
                      : "—"
                  }
                />
                <MiniCard
                  label="Dias desde último pedido"
                  value={metrics.daysSinceLastOrder != null ? `${Math.round(metrics.daysSinceLastOrder)}` : "—"}
                />
                <MiniCard
                  label="Média dias entre pedidos"
                  value={metrics.avgRepurchase != null ? `${Math.round(metrics.avgRepurchase)}` : "—"}
                  hint="≥2 pedidos válidos"
                />
                <MiniCard
                  label="Produto líder (receita filtro)"
                  value={mixRows[0] ? `${mixRows[0].sku}` : "—"}
                  hint={mixRows[0]?.name}
                />
              </div>

              <div className="rounded-xl border border-border p-4 flex flex-wrap gap-6 items-center bg-primary/5">
                <div className="flex items-center gap-2">
                  <User className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Responsável (última mov.)</p>
                    <p className="font-bold">{relationInfo.resp || "—"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Última atualização</p>
                    <p className="font-bold text-sm">
                      {relationInfo.lastMove
                        ? new Date(relationInfo.lastMove).toLocaleString("pt-BR")
                        : "—"}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">Carteira em aberto (total)</p>
                  <p className="font-bold text-primary">{relationInfo.openAll} pedido(s)</p>
                  <p className="text-[10px] text-muted-foreground">
                    Último status:{" "}
                    {relationInfo.lastStatus ? SALES_ORDER_STATUS_LABELS[relationInfo.lastStatus] : "—"}
                    {phase2 && (
                      <>
                        {" "}
                        · Saúde:{" "}
                        <span className="font-semibold text-foreground">
                          {HEALTH_LEVEL_LABEL_PT[phase2.health.level]}
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </div>

              {alerts.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" /> Sinais com base no filtro atual
                  </h3>
                  <ul className="text-sm space-y-1">
                    {alerts.map((a, i) => (
                      <li
                        key={i}
                        className={cn(
                          "flex gap-2",
                          a.level === "danger" && "text-red-700",
                          a.level === "warn" && "text-amber-800",
                          a.level === "info" && "text-blue-800"
                        )}
                      >
                        <CheckCircle2 className="h-4 w-4 shrink-0 opacity-50" />
                        {a.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h3 className="text-sm font-bold mb-2 flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Histórico de pedidos de venda
                </h3>
                <div className="rounded-xl border border-border overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[900px]">
                    <thead className="bg-accent/50">
                      <tr>
                        <th className="p-2">Pedido</th>
                        <th className="p-2">Status</th>
                        <th className="p-2">Emissão</th>
                        <th className="p-2">Atual.</th>
                        <th className="p-2 text-right">Líq.</th>
                        <th className="p-2 text-right">Margem %</th>
                        <th className="p-2">Resp.</th>
                        <th className="p-2">Faturado</th>
                        <th className="p-2">Obs.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {[...filtered]
                        .sort(
                          (a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime()
                        )
                        .map((o) => (
                          <tr key={o.id} className="hover:bg-accent/20">
                            <td className="p-2 font-mono font-bold">{o.orderCode}</td>
                            <td className="p-2">{SALES_ORDER_STATUS_LABELS[o.status]}</td>
                            <td className="p-2 whitespace-nowrap">
                              {new Date(o.issueDate).toLocaleDateString("pt-BR")}
                            </td>
                            <td className="p-2 whitespace-nowrap">
                              {new Date(o.updatedAt).toLocaleDateString("pt-BR")}
                            </td>
                            <td className="p-2 text-right">{formatCurrency(safeCommercialNumber(o.totalNetValue))}</td>
                            <td className="p-2 text-right">
                              {o.marginSummary?.marginPercent != null
                                ? formatSalesOrderMarginPercent(o.marginSummary.marginPercent)
                                : "—"}
                            </td>
                            <td className="p-2 max-w-[100px] truncate">{(o.responsible || "—").trim()}</td>
                            <td className="p-2">{o.hasInvoicing ? "Sim" : "Não"}</td>
                            <td className="p-2 max-w-[200px] truncate" title={o.notes || ""}>
                              {o.notes?.slice(0, 80) || "—"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {filtered.length === 0 && (
                    <p className="p-6 text-center text-muted-foreground text-sm">Nenhum pedido no filtro.</p>
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold mb-2 flex items-center gap-2">
                  <Package className="h-4 w-4" /> Mix de produtos (itens dos pedidos filtrados)
                </h3>
                <div className="rounded-xl border border-border overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-accent/50">
                      <tr>
                        <th className="p-2">SKU</th>
                        <th className="p-2">Nome</th>
                        <th className="p-2">Tipo item</th>
                        <th className="p-2 text-right">Qtd</th>
                        <th className="p-2 text-right">Receita</th>
                        <th className="p-2 text-right">Margem R$</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {mixRows.map((row, i) => (
                        <tr key={i}>
                          <td className="p-2 font-mono">{row.sku}</td>
                          <td className="p-2">{row.name}</td>
                          <td className="p-2">{row.type}</td>
                          <td className="p-2 text-right">{formatNumber(row.qty, 2)}</td>
                          <td className="p-2 text-right">{formatCurrency(row.revenue)}</td>
                          <td className="p-2 text-right">{formatCurrency(row.margin)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {mixRows.length === 0 && (
                    <p className="p-4 text-center text-muted-foreground text-sm">Sem itens no filtro atual.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

function MiniCard({
  label,
  value,
  hint,
  valueTitle,
}: {
  label: string;
  value: string;
  hint?: string;
  valueTitle?: string;
}) {
  return (
    <div className="indus-kpi-card rounded-xl border border-border bg-card p-3 min-w-0">
      <p className="text-[9px] font-bold text-muted-foreground uppercase leading-tight truncate">{label}</p>
      <p className="indus-kpi-value text-sm font-black mt-1" title={valueTitle ?? value}>
        {value}
      </p>
      {hint && <p className="text-[9px] text-muted-foreground mt-0.5 truncate">{hint}</p>}
    </div>
  );
}

function IntelCard({
  title,
  icon,
  main,
  sub,
  reasons,
  footer,
  badges,
  stats,
}: {
  title: string;
  icon: React.ReactNode;
  main: string;
  sub?: string;
  reasons?: string[];
  footer?: string;
  badges?: string[];
  stats?: Array<[string, number | null]>;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-bold uppercase text-muted-foreground">{title}</span>
      </div>
      <p className="text-lg font-black text-primary">{main}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      {reasons && reasons.length > 0 && (
        <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {badges && badges.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {badges.map((b) => (
            <span
              key={b}
              className="text-[10px] font-bold px-2 py-1 rounded-md bg-primary/10 text-primary border border-primary/20"
            >
              {b}
            </span>
          ))}
        </div>
      )}
      {stats && (
        <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
          {stats.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-mono text-right">
                {value != null ? Math.round(value) : "—"}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      {footer && (
        <p className="text-[10px] text-muted-foreground border-t border-border pt-2">{footer}</p>
      )}
    </div>
  );
}
