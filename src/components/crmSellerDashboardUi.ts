import type { LucideIcon } from "lucide-react";
import {
  Ban,
  Link2,
  Package,
  PackageCheck,
  Receipt,
  ShoppingCart,
  Star,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import type { SellerDashboardSummary, SellerOption } from "@/src/components/crmSellerDashboardTypes";

export type SellerKpiCard = {
  label: string;
  description: string;
  value: string;
  icon: LucideIcon;
  cardClass: string;
  iconClass: string;
};

export const SELLER_KEY_ALL = "all";

export type SellerPeriodPreset =
  | "all"
  | "today"
  | "thisWeek"
  | "thisMonth"
  | "last30"
  | "last90"
  | "custom";

export const SELLER_PERIOD_PRESET_OPTIONS: { value: SellerPeriodPreset; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "today", label: "Hoje" },
  { value: "thisWeek", label: "Esta semana" },
  { value: "thisMonth", label: "Este mês" },
  { value: "last30", label: "Últimos 30 dias" },
  { value: "last90", label: "Últimos 90 dias" },
  { value: "custom", label: "Personalizado" },
];

export function formatYmdLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** null = período personalizado incompleto (não enviar). {} = sem filtro de datas. */
export function resolveSellerPeriodRange(
  preset: SellerPeriodPreset,
  customDateFrom?: string,
  customDateTo?: string
): { dateFrom?: string; dateTo?: string } | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayYmd = formatYmdLocal(today);

  switch (preset) {
    case "all":
      return {};
    case "today":
      return { dateFrom: todayYmd, dateTo: todayYmd };
    case "thisWeek": {
      const start = new Date(today);
      const weekday = start.getDay();
      const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
      start.setDate(start.getDate() - daysFromMonday);
      return { dateFrom: formatYmdLocal(start), dateTo: todayYmd };
    }
    case "thisMonth": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { dateFrom: formatYmdLocal(start), dateTo: todayYmd };
    }
    case "last30": {
      const start = new Date(today);
      start.setDate(start.getDate() - 30);
      return { dateFrom: formatYmdLocal(start), dateTo: todayYmd };
    }
    case "last90": {
      const start = new Date(today);
      start.setDate(start.getDate() - 90);
      return { dateFrom: formatYmdLocal(start), dateTo: todayYmd };
    }
    case "custom": {
      const from = (customDateFrom ?? "").trim();
      const to = (customDateTo ?? "").trim();
      if (!from || !to) return null;
      return { dateFrom: from, dateTo: to };
    }
    default:
      return {};
  }
}

export function buildSellerOptionKey(option: SellerOption): string {
  if (option.sellerIdentityKey?.trim()) {
    return `n:${option.sellerIdentityKey.trim()}`;
  }
  if (option.externalSellerId !== null && option.externalSellerId !== undefined) {
    return `id:${option.externalSellerId}`;
  }
  const resp = (option.responsible ?? "").trim().toLowerCase();
  return resp ? `r:${resp}` : "unknown";
}

export function formatSellerOptionLabel(option: SellerOption): string {
  const name = (option.displayName ?? option.responsible ?? "").trim() || "Sem responsável";
  return name;
}

export function formatSellerOptionDetail(option: SellerOption): string | null {
  if (option.needsReview) return "Revisar dados — nomes conflitantes no mesmo grupo";
  if ((option.externalSellerIds?.length ?? 0) > 1) {
    return `IDs Nomus internos: ${option.externalSellerIds!.join(", ")}`;
  }
  if (option.hasOrdersWithoutNomusId && (option.externalSellerIds?.length ?? 0) > 0) {
    return "Inclui pedidos com e sem ID Nomus";
  }
  return null;
}

export function buildSellerKpiCards(
  summary: SellerDashboardSummary | undefined,
  formatNumberPt: (v: number | null | undefined) => string,
  formatIntelCurrency: (v: unknown) => string
): SellerKpiCard[] {
  const topProductLabel = summary?.topProduct?.productName?.trim()
    ? summary.topProduct.productName.trim()
    : "—";

  return [
    {
      label: "Pedidos emitidos",
      description: "Pedidos válidos no período (data de emissão)",
      value: formatNumberPt(summary?.ordersCount),
      icon: ShoppingCart,
      cardClass: "border-slate-200/80 bg-gradient-to-br from-slate-50 to-card",
      iconClass: "text-slate-700 bg-slate-100",
    },
    {
      label: "Valor de pedidos",
      description: "Soma do valor líquido (issueDate)",
      value: formatIntelCurrency(summary?.ordersValue),
      icon: Receipt,
      cardClass: "border-emerald-200/80 bg-gradient-to-br from-emerald-50/50 to-card",
      iconClass: "text-emerald-800 bg-emerald-100",
    },
    {
      label: "Carteira aberta",
      description: "Pedidos válidos sem NF processada",
      value: formatNumberPt(summary?.openOrdersCount),
      icon: Wallet,
      cardClass: "border-violet-200/80 bg-gradient-to-br from-violet-50/50 to-card",
      iconClass: "text-violet-800 bg-violet-100",
    },
    {
      label: "Valor em carteira",
      description: "Soma da carteira aberta",
      value: formatIntelCurrency(summary?.openOrdersValue),
      icon: TrendingUp,
      cardClass: "border-violet-200/80 bg-gradient-to-br from-violet-50/40 to-card",
      iconClass: "text-violet-700 bg-violet-100",
    },
    {
      label: "Pedidos faturados",
      description: "Com NFe processada no escopo",
      value: formatNumberPt(summary?.invoicedOrdersCount),
      icon: PackageCheck,
      cardClass: "border-green-200/80 bg-gradient-to-br from-green-50/50 to-card",
      iconClass: "text-green-800 bg-green-100",
    },
    {
      label: "Valor faturado",
      description: "Pedidos com NF processada",
      value: formatIntelCurrency(summary?.invoicedOrdersValue),
      icon: PackageCheck,
      cardClass: "border-green-200/80 bg-gradient-to-br from-green-50/40 to-card",
      iconClass: "text-green-700 bg-green-100",
    },
    {
      label: "Pedidos cancelados",
      description: "Status CANCELLED no período",
      value: formatNumberPt(summary?.cancelledOrdersCount),
      icon: Ban,
      cardClass: "border-red-200/80 bg-gradient-to-br from-red-50/40 to-card",
      iconClass: "text-red-800 bg-red-100",
    },
    {
      label: "Ticket médio",
      description: "Valor de pedidos válidos ÷ quantidade",
      value: formatIntelCurrency(summary?.ticketAverage),
      icon: Receipt,
      cardClass: "border-sky-200/80 bg-gradient-to-br from-sky-50/50 to-card",
      iconClass: "text-sky-800 bg-sky-100",
    },
    {
      label: "Clientes com pedido",
      description: "Clientes distintos com pedido válido",
      value: formatNumberPt(summary?.uniqueCustomersCount),
      icon: Users,
      cardClass: "border-indigo-200/80 bg-gradient-to-br from-indigo-50/50 to-card",
      iconClass: "text-indigo-800 bg-indigo-100",
    },
    {
      label: "Produto líder",
      description: "Maior receita em SalesOrderItem",
      value: topProductLabel,
      icon: Star,
      cardClass: "border-amber-200/80 bg-gradient-to-br from-amber-50/50 to-card",
      iconClass: "text-amber-800 bg-amber-100",
    },
    {
      label: "Pedidos sem proposta vinculada",
      description: "Qualidade de rastreabilidade (não é KPI de performance)",
      value: formatNumberPt(summary?.ordersWithoutLinkedProposalCount),
      icon: Link2,
      cardClass: "border-slate-200/80 bg-gradient-to-br from-slate-50/40 to-card",
      iconClass: "text-slate-700 bg-slate-100",
    },
  ];
}

export function truncateMiddle(text: string, maxLen = 18): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  const head = Math.ceil((maxLen - 1) / 2);
  const tail = Math.floor((maxLen - 1) / 2);
  return `${t.slice(0, head)}…${t.slice(-tail)}`;
}
