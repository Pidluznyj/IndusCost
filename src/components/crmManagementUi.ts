import type { LucideIcon } from "lucide-react";
import type { MetricCardVariant } from "@/src/components/ui/MetricCard";
import {
  AlertTriangle,
  CalendarDays,
  Clock,
  FileSpreadsheet,
  ShoppingCart,
  Target,
  TrendingUp,
  UserX,
} from "lucide-react";
import type { ManagementDashboardSummary } from "@/src/components/crmManagementTypes";

/**
 * Classe do indicador — o gestor precisa saber o que pode ser conferido
 * contra a tela Pedidos de Venda e o que é métrica própria do CRM.
 *
 *  TRANSACIONAL  → sai da população canônica de Pedidos de Venda e TEM
 *                  que reconciliar no centavo (pedidos, valor, carteira,
 *                  faturado).
 *  RELACIONAMENTO→ nasce do CRM (contato, follow-up, recência, vínculo).
 *                  Não reconcilia com Pedidos de Venda e não deveria.
 */
export type ManagementKpiClass = "TRANSACIONAL" | "RELACIONAMENTO";

export type ManagementKpiCard = {
  kpiClass: ManagementKpiClass;
  label: string;
  description: string;
  value: string;
  icon: LucideIcon;
  cardClass: string;
  iconClass: string;
};

export const MANAGEMENT_RISK_REASON_LABELS: Record<string, string> = {
  ORDER_WITHOUT_FOLLOW_UP: "Pedido em carteira sem follow-up",
  NO_PURCHASE_90D: "Sem compra há 90+ dias",
  NO_VALID_PURCHASE: "Sem compra válida",
  OPEN_ORDERS_IN_PORTFOLIO: "Pedidos em carteira",
  OVERDUE_OPEN_ORDER: "Pedido em carteira atrasado",
  PROPOSAL_WITHOUT_FOLLOW_UP: "Proposta sem follow-up",
  OPEN_PROPOSALS: "Propostas abertas",
};

export function resolveManagementKpiMetricVariant(cardClass: string): MetricCardVariant {
  if (cardClass.includes("red")) return "danger";
  if (cardClass.includes("emerald")) return "money";
  if (cardClass.includes("amber") || cardClass.includes("orange")) return "warning";
  if (cardClass.includes("violet") || cardClass.includes("sky")) return "info";
  return "neutral";
}

export function formatManagementRiskReason(code: string): string {
  return MANAGEMENT_RISK_REASON_LABELS[code] ?? code.replace(/_/g, " ").toLowerCase();
}

export function managementRiskBadgeClass(level: string): string {
  const u = level.trim().toUpperCase();
  if (u === "HIGH") return "border-red-200 bg-red-50 text-red-900";
  if (u === "MEDIUM") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-50 text-slate-800";
}

export function buildManagementKpiCards(
  summary: ManagementDashboardSummary | undefined,
  formatNumberPt: (v: number | null | undefined) => string,
  formatIntelCurrency: (v: unknown) => string
): ManagementKpiCard[] {
  return [
    {
      kpiClass: "RELACIONAMENTO",
      label: "Clientes em alto risco",
      description: "Carteira sem follow-up ou sem compra há 90+ dias (janela móvel)",
      value: formatNumberPt(summary?.customersAtHighRisk),
      icon: AlertTriangle,
      cardClass: "border-red-200/80 bg-gradient-to-br from-red-50/60 to-card",
      iconClass: "text-red-700 bg-red-100",
    },
    {
      kpiClass: "TRANSACIONAL",
      label: "Pedidos em carteira",
      description: "Pedidos válidos sem NF processada — mesma régua de Pedidos de Venda",
      value: formatNumberPt(summary?.openOrdersCount),
      icon: FileSpreadsheet,
      cardClass: "border-violet-200/80 bg-gradient-to-br from-violet-50/50 to-card",
      iconClass: "text-violet-800 bg-violet-100",
    },
    {
      kpiClass: "TRANSACIONAL",
      label: "Valor em carteira",
      description: "Valor líquido do pedido (header), igual ao card da tela Pedidos",
      value: formatIntelCurrency(summary?.openOrdersValue),
      icon: TrendingUp,
      cardClass: "border-emerald-200/80 bg-gradient-to-br from-emerald-50/50 to-card",
      iconClass: "text-emerald-800 bg-emerald-100",
    },
    {
      kpiClass: "RELACIONAMENTO",
      label: "Pedidos sem follow-up",
      description: "Carteira aberta sem contato após a atualização (janela móvel)",
      value: formatNumberPt(summary?.ordersWithoutFollowUpCount),
      icon: Target,
      cardClass: "border-amber-200/80 bg-gradient-to-br from-amber-50/50 to-card",
      iconClass: "text-amber-800 bg-amber-100",
    },
    {
      kpiClass: "RELACIONAMENTO",
      label: "Sem contato 30 dias",
      description: "Clientes ativos sem atividade nos últimos 30 dias (janela móvel)",
      value: formatNumberPt(summary?.customersWithoutContactLast30Days),
      icon: UserX,
      cardClass: "border-orange-200/80 bg-gradient-to-br from-orange-50/50 to-card",
      iconClass: "text-orange-800 bg-orange-100",
    },
    {
      kpiClass: "RELACIONAMENTO",
      label: "Sem compra válida",
      description: "Clientes ativos sem nenhum pedido válido (mesma régua dos cards)",
      value: formatNumberPt(summary?.customersWithoutValidPurchase),
      icon: ShoppingCart,
      cardClass: "border-slate-200/80 bg-gradient-to-br from-slate-50 to-card",
      iconClass: "text-slate-700 bg-slate-100",
    },
    {
      kpiClass: "RELACIONAMENTO",
      label: "Follow-ups atrasados",
      description: "Ações comerciais vencidas (janela móvel)",
      value: formatNumberPt(summary?.overdueFollowUps),
      icon: Clock,
      cardClass: "border-red-200/80 bg-gradient-to-br from-red-50/40 to-card",
      iconClass: "text-red-700 bg-red-100",
    },
    {
      kpiClass: "RELACIONAMENTO",
      label: "Próximos follow-ups 7 dias",
      description: "Agenda da semana (janela móvel)",
      value: formatNumberPt(summary?.upcomingFollowUpsNext7Days),
      icon: CalendarDays,
      cardClass: "border-sky-200/80 bg-gradient-to-br from-sky-50/60 to-card",
      iconClass: "text-sky-800 bg-sky-100",
    },
  ];
}
