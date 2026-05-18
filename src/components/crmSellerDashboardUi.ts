import type { LucideIcon } from "lucide-react";
import {
  FileSpreadsheet,
  Link2,
  Package,
  PackageCheck,
  PackageX,
  Receipt,
  ShoppingCart,
  Unlink,
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
  if (option.externalSellerId !== null && option.externalSellerId !== undefined) {
    return `id:${option.externalSellerId}`;
  }
  const resp = (option.responsible ?? "").trim().toLowerCase();
  return resp ? `r:${resp}` : "unknown";
}

export function formatSellerOptionLabel(option: SellerOption): string {
  const name = (option.responsible ?? "").trim() || "Sem responsável";
  if (option.externalSellerId !== null && option.externalSellerId !== undefined) {
    return `${name} (ID ${option.externalSellerId})`;
  }
  return `${name} (sem ID Nomus)`;
}

export function buildSellerKpiCards(
  summary: SellerDashboardSummary | undefined,
  formatNumberPt: (v: number | null | undefined) => string,
  formatIntelCurrency: (v: unknown) => string
): SellerKpiCard[] {
  return [
    {
      label: "Pedidos emitidos",
      description: "Filtrados pela data de emissão do pedido",
      value: formatNumberPt(summary?.ordersCount),
      icon: ShoppingCart,
      cardClass: "border-slate-200/80 bg-gradient-to-br from-slate-50 to-card",
      iconClass: "text-slate-700 bg-slate-100",
    },
    {
      label: "Valor de pedidos emitidos",
      description: "Soma do valor líquido (data de emissão)",
      value: formatIntelCurrency(summary?.ordersValue),
      icon: Receipt,
      cardClass: "border-emerald-200/80 bg-gradient-to-br from-emerald-50/50 to-card",
      iconClass: "text-emerald-800 bg-emerald-100",
    },
    {
      label: "Faturados por NFe",
      description: "NFe com data de processamento no período",
      value: formatNumberPt(summary?.invoicedOrdersCount),
      icon: PackageCheck,
      cardClass: "border-green-200/80 bg-gradient-to-br from-green-50/50 to-card",
      iconClass: "text-green-800 bg-green-100",
    },
    {
      label: "Valor faturado por NFe",
      description: "Pela data de processamento da NFe",
      value: formatIntelCurrency(summary?.invoicedOrdersValue),
      icon: PackageCheck,
      cardClass: "border-green-200/80 bg-gradient-to-br from-green-50/40 to-card",
      iconClass: "text-green-700 bg-green-100",
    },
    {
      label: "Pedidos não faturados",
      description: "Emitidos no período, sem NFe processada",
      value: formatNumberPt(summary?.notInvoicedOrdersCount),
      icon: PackageX,
      cardClass: "border-amber-200/80 bg-gradient-to-br from-amber-50/50 to-card",
      iconClass: "text-amber-800 bg-amber-100",
    },
    {
      label: "Valor não faturado",
      description: "Pedidos emitidos aguardando faturamento",
      value: formatIntelCurrency(summary?.notInvoicedOrdersValue),
      icon: Package,
      cardClass: "border-orange-200/80 bg-gradient-to-br from-orange-50/50 to-card",
      iconClass: "text-orange-800 bg-orange-100",
    },
    {
      label: "Propostas abertas",
      description: "DRAFT, ANÁLISE ou ENVIADA",
      value: formatNumberPt(summary?.openProposalsCount),
      icon: FileSpreadsheet,
      cardClass: "border-violet-200/80 bg-gradient-to-br from-violet-50/50 to-card",
      iconClass: "text-violet-800 bg-violet-100",
    },
    {
      label: "Propostas sem pedido vinculado",
      description: "Abertas sem SalesOrder",
      value: formatNumberPt(summary?.proposalsWithoutLinkedOrderCount),
      icon: Unlink,
      cardClass: "border-amber-200/80 bg-gradient-to-br from-amber-50/40 to-card",
      iconClass: "text-amber-900 bg-amber-100",
    },
    {
      label: "Pedidos sem proposta vinculada",
      description: "Sem proposalId no pedido",
      value: formatNumberPt(summary?.ordersWithoutLinkedProposalCount),
      icon: Link2,
      cardClass: "border-sky-200/80 bg-gradient-to-br from-sky-50/50 to-card",
      iconClass: "text-sky-800 bg-sky-100",
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
