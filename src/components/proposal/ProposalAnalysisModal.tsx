import React, { useEffect, useState } from "react";
import {
  X,
  Loader2,
  User,
  Calendar,
  FileText,
  Truck,
  Package,
  Building2,
  Percent,
  DollarSign,
  TrendingUp,
  Wallet,
  Receipt,
  Edit2,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Award,
  Lightbulb,
  Clock,
  ShoppingCart,
  Hourglass,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import type { Proposal, ProposalItem, ProposalStatus } from "@/src/types/commercial";
import {
  formatProposalCommercialMoney,
  formatProposalCommercialPercent,
  resolveProposalItemCommercialMarginDisplay,
} from "@/src/lib/proposalCommercialMarginDisplay";
import { resolveProposalCommercialMarginFromItems } from "@/src/lib/proposalListMargin";

export type CustomerHistoryData = {
  totalOrdersCount: number;
  totalOrdersValue: number;
  averageOrderTicket: number | null;
  lastOrderDate: string | null;
};

export type ProposalDetailWithAnalysis = Proposal & {
  salesOrder?: { id: string; orderCode: string; status: string } | null;
  customerHistory?: CustomerHistoryData | null;
};

const STATUS_LABEL: Record<ProposalStatus, string> = {
  DRAFT: "Rascunho",
  ANALYSIS: "Em Análise",
  SENT: "Enviada",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
  EXPIRED: "Expirada",
  CANCELED: "Cancelada",
};

function safeNum(v: unknown, fb = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

type Props = {
  open: boolean;
  proposalId: string | null;
  onClose: () => void;
  /** Abre o fluxo de edição da proposta */
  onEdit?: (id: string) => void;
};

export type DealInsightItem = {
  id: string;
  type: "opportunity" | "margin" | "condition" | "warning" | "customer";
  title: string;
  description: string;
  badgeText: string;
  tone: "success" | "info" | "warning" | "accent";
};

export function buildDealIntelligence(proposal: ProposalDetailWithAnalysis) {
  const netValue = safeNum(proposal.totalNetValue);
  const commercial = resolveProposalCommercialMarginFromItems(proposal.items);
  const commercialMarginPerc =
    commercial.totalMarginPerc != null
      ? commercial.totalMarginPerc
      : proposal.totalMarginPerc != null
        ? safeNum(proposal.totalMarginPerc)
        : null;
  const commercialMarginValue =
    commercial.totalMarginValue != null
      ? commercial.totalMarginValue
      : proposal.totalMarginValue != null
        ? safeNum(proposal.totalMarginValue)
        : null;
  const marginPerc = commercialMarginPerc ?? 0;
  const status = proposal.status;
  const hasSalesOrder = Boolean(proposal.salesOrder?.id);
  const customerHistory = proposal.customerHistory;
  const validityDays = proposal.validityDays ?? 15;

  const createdAt = proposal.createdAt ? new Date(proposal.createdAt) : new Date();
  const now = new Date();
  const daysOpen = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 86400000));
  const expiryDaysLeft = Math.max(0, validityDays - daysOpen);
  const isExpired = status === "EXPIRED" || (status !== "APPROVED" && status !== "CANCELED" && daysOpen > validityDays);

  // Cálculo de Prontidão / Health Score (0 - 100%)
  let healthScore = 50;
  if (hasSalesOrder || status === "APPROVED") {
    healthScore = 100;
  } else if (status === "REJECTED" || status === "CANCELED") {
    healthScore = 10;
  } else {
    if (customerHistory && customerHistory.totalOrdersCount > 0) healthScore += 20;
    if (proposal.paymentTerms && proposal.paymentTerms.trim() !== "") healthScore += 15;
    if (marginPerc >= 20) healthScore += 15;
    if (daysOpen <= 5) healthScore += 10;
    if (isExpired) healthScore -= 30;
  }
  healthScore = Math.min(98, Math.max(10, healthScore));

  let healthLabel = "Promissora — Pronta para Fechar";
  let healthTone: "success" | "info" | "warning" | "danger" = "info";

  if (hasSalesOrder || status === "APPROVED") {
    healthLabel = "Convertida em Pedido 🎉";
    healthTone = "success";
  } else if (status === "REJECTED" || status === "CANCELED") {
    healthLabel = "Encerrada sem Fechamento";
    healthTone = "danger";
  } else if (isExpired) {
    healthLabel = "Proposta Expirada — Urgente";
    healthTone = "warning";
  } else if (healthScore >= 75) {
    healthLabel = "Alta Prontidão de Fechamento 🚀";
    healthTone = "success";
  } else if (healthScore >= 50) {
    healthLabel = "Em Negociação Ativa 💼";
    healthTone = "info";
  } else {
    healthLabel = "Requer Atenção Comercial ⚠️";
    healthTone = "warning";
  }

  // Geração de Insights Dinâmicos
  const insights: DealInsightItem[] = [];

  // Insight 1: Margem e Margem de Manobra (só com margem comercial conhecida)
  if (commercialMarginPerc != null) {
    if (commercialMarginPerc >= 30) {
      const headroomMoney = netValue * 0.05;
      insights.push({
        id: "margin-headroom",
        type: "margin",
        title: `Margem Confortável (${formatNumber(commercialMarginPerc, 1)}%)`,
        description: `Esta proposta possui margem comercial alta. Você dispõe de até R$ ${formatNumber(headroomMoney, 2)} (~5%) de margem de manobra para oferecer como concessão rápida se o cliente pedir contraproposta.`,
        badgeText: "Margem de Manobra",
        tone: "success",
      });
    } else if (commercialMarginPerc >= 18) {
      insights.push({
        id: "margin-healthy",
        type: "margin",
        title: `Margem Comercial Dentro da Meta (${formatNumber(commercialMarginPerc, 1)}%)`,
        description: "Margem comercial saudável. Recomendado manter os preços propostos e negociar frete cortesia ou prazo como diferencial em vez de desconto direto.",
        badgeText: "Margem Saudável",
        tone: "info",
      });
    } else {
      insights.push({
        id: "margin-tight",
        type: "warning",
        title: `Margem Apertada (${formatNumber(commercialMarginPerc, 1)}%)`,
        description: "A margem desta proposta está reduzida. Evite dar descontos adicionais sem aprovação da gestão comercial.",
        badgeText: "Atenção à Margem",
        tone: "warning",
      });
    }
  }

  // Insight 2: Histórico e Perfil do Cliente
  if (customerHistory && customerHistory.totalOrdersCount > 0) {
    insights.push({
      id: "customer-repeat",
      type: "customer",
      title: `Cliente Recorrente (${customerHistory.totalOrdersCount} pedidos anteriores)`,
      description: `Este cliente já comprou R$ ${formatCurrency(customerHistory.totalOrdersValue)} no total (ticket médio R$ ${formatCurrency(customerHistory.averageOrderTicket ?? 0)}). Cliente com forte histórico comprador — enfatize agilidade no prazo de entrega.`,
      badgeText: "Cliente Histórico",
      tone: "accent",
    });
  } else {
    insights.push({
      id: "customer-new",
      type: "opportunity",
      title: "Primeira Compra — Novo Cliente",
      description: "Primeira negociação com este cliente. Apresentar prazos claros e frete garantido é o fator decisivo para destravar este primeiro pedido.",
      badgeText: "Oportunidade Nova",
      tone: "info",
    });
  }

  // Insight 3: Condições Comerciais & Prazos
  if (!proposal.paymentTerms || proposal.paymentTerms.trim() === "") {
    insights.push({
      id: "condition-payment",
      type: "condition",
      title: "Definir Condição de Pagamento",
      description: "Propostas sem prazo de pagamento definido aumentam o tempo de decisão. Sugerir prazos como 30/60 dias pode acelerar o aceite do cliente.",
      badgeText: "Gatilho de Venda",
      tone: "warning",
    });
  } else {
    insights.push({
      id: "condition-ok",
      type: "condition",
      title: `Condição de Pagamento: ${proposal.paymentTerms}`,
      description: "Condições de pagamento definidas. Utilize este alinhamento para solicitar a confirmação do pedido.",
      badgeText: "Condição OK",
      tone: "success",
    });
  }

  // Insight 4: Validade e Urgência
  if (isExpired) {
    insights.push({
      id: "urgency-expired",
      type: "warning",
      title: "Proposta Expirada",
      description: `Aberta há ${daysOpen} dias. Entre em contato com o cliente oferecendo a renovação dos preços por mais 48 horas como gatilho de fechamento.`,
      badgeText: "Ação Urgente",
      tone: "warning",
    });
  } else if (expiryDaysLeft <= 3) {
    insights.push({
      id: "urgency-expiry-soon",
      type: "opportunity",
      title: `Vencimento em ${expiryDaysLeft} dia(s)`,
      description: "A proposta está na reta final de validade. É o momento perfeito para realizar follow-up ressaltando a garantia dos preços propostos.",
      badgeText: "Follow-up Ideal",
      tone: "opportunity" as any,
    });
  }

  return {
    healthScore,
    healthLabel,
    healthTone,
    daysOpen,
    expiryDaysLeft,
    isExpired,
    hasSalesOrder,
    insights,
    commercialMarginPerc,
    commercialMarginValue,
  };
}

export function ProposalAnalysisModal({
  open,
  proposalId,
  onClose,
  onEdit,
}: Props) {
  const [data, setData] = useState<ProposalDetailWithAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !proposalId) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchJsonOk<ProposalDetailWithAnalysis>(`/api/proposals/${proposalId}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro ao carregar análise.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, proposalId]);

  const items = data?.items ?? [];
  const intelligence = data ? buildDealIntelligence(data) : null;
  const customer = data?.Customer;
  const customerHistory = data?.customerHistory;

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-background/80 backdrop-blur-md"
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="bg-card w-full max-w-5xl max-h-[94vh] rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden text-foreground"
            role="dialog"
            aria-modal="true"
            aria-labelledby="proposal-analysis-title"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header com Ações Rápidas */}
            <div className="px-6 py-4 border-b border-border bg-muted/40 flex items-center justify-between gap-4 shrink-0">
              <div className="min-w-0 flex items-center gap-3">
                <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center text-primary shrink-0 shadow-sm">
                  <Sparkles className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 id="proposal-analysis-title" className="text-lg font-bold leading-tight tracking-tight">
                      Análise Comercial & Insights de Fechamento
                    </h2>
                    {data?.salesOrder?.id ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Pedido #{data.salesOrder.orderCode ?? "Gerado"}
                      </span>
                    ) : null}
                  </div>
                  {data && (
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                      <span className="font-mono font-semibold text-primary">Proposta #{data.number}</span>
                      {data.title ? <span className="truncate">· {data.title}</span> : null}
                      {customer?.companyName ? (
                        <span className="font-medium text-foreground/90 truncate">· {customer.companyName}</span>
                      ) : null}
                    </p>
                  )}
                </div>
              </div>

              {/* Botões de Ação na Barra Superior */}
              <div className="flex items-center gap-2 shrink-0">
                {proposalId && onEdit && data && (
                  <button
                    type="button"
                    onClick={() => {
                      onEdit(proposalId);
                      onClose();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-card text-xs font-semibold hover:bg-accent text-foreground transition-colors"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                    Editar
                  </button>
                )}

                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Fechar"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Conteúdo Principal */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
              {loading && (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  <p className="text-sm font-medium">Carregando inteligência comercial e dados da proposta…</p>
                </div>
              )}

              {error && !loading && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive font-medium">
                  {error}
                </div>
              )}

              {!loading && !error && data && intelligence && (
                <>
                  {/* Status & Termômetro do Fechamento */}
                  <div className="rounded-2xl border border-border bg-gradient-to-r from-card via-accent/30 to-card p-4 sm:p-5 shadow-sm space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={cn(
                            "inline-flex items-center px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase shadow-sm",
                            data.status === "APPROVED"
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
                              : data.status === "REJECTED" || data.status === "CANCELED"
                                ? "bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30"
                                : "bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/30"
                          )}
                        >
                          {STATUS_LABEL[data.status] ?? data.status}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1 font-medium">
                          <Calendar className="h-3.5 w-3.5" />
                          Criada em {new Date(data.createdAt).toLocaleDateString("pt-BR")}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-xs font-semibold">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                        <span>Prontidão de Fechamento:</span>
                        <span
                          className={cn(
                            "px-2.5 py-0.5 rounded-md text-xs font-bold",
                            intelligence.healthTone === "success"
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                              : intelligence.healthTone === "warning"
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                : intelligence.healthTone === "danger"
                                  ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
                                  : "bg-blue-500/15 text-blue-700 dark:text-blue-400"
                          )}
                        >
                          {intelligence.healthLabel}
                        </span>
                      </div>
                    </div>

                    {/* Barra de Progresso da Prontidão (Health Gauge) */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs font-medium text-muted-foreground">
                        <span>Score da Oportunidade</span>
                        <span className="font-bold text-foreground">{intelligence.healthScore}%</span>
                      </div>
                      <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn(
                            "h-full transition-all duration-500 rounded-full",
                            intelligence.healthTone === "success"
                              ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                              : intelligence.healthTone === "warning"
                                ? "bg-gradient-to-r from-amber-500 to-yellow-400"
                                : intelligence.healthTone === "danger"
                                  ? "bg-gradient-to-r from-rose-500 to-red-400"
                                  : "bg-gradient-to-r from-blue-500 to-cyan-400"
                          )}
                          style={{ width: `${intelligence.healthScore}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 4 Cards Principais da Oportunidade */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                    <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Valor do Pipeline</span>
                        <Wallet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <p className="text-lg font-extrabold text-foreground tracking-tight">
                        {formatCurrency(safeNum(data.totalNetValue))}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {items.length} item(ns) · Bruto {formatCurrency(safeNum(data.totalGrossValue))}
                      </p>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Margem Comercial</span>
                        <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <p className="text-lg font-extrabold text-foreground tracking-tight">
                        {formatProposalCommercialPercent(
                          intelligence.commercialMarginPerc
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {intelligence.commercialMarginValue != null &&
                        Number.isFinite(intelligence.commercialMarginValue)
                          ? formatProposalCommercialMoney(
                              intelligence.commercialMarginValue
                            )
                          : "Sem margem comercial nos itens"}
                      </p>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Histórico do Cliente</span>
                        <ShoppingCart className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                      </div>
                      <p className="text-lg font-extrabold text-foreground tracking-tight">
                        {customerHistory && customerHistory.totalOrdersCount > 0
                          ? `${customerHistory.totalOrdersCount} Pedidos`
                          : "Novo Cliente"}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {customerHistory && customerHistory.totalOrdersCount > 0
                          ? `R$ ${formatCurrency(customerHistory.totalOrdersValue)} comprados`
                          : "Primeira oportunidade"}
                      </p>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Ciclo da Proposta</span>
                        <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      </div>
                      <p className="text-lg font-extrabold text-foreground tracking-tight">
                        {intelligence.daysOpen} dia(s)
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Validade: {data.validityDays ?? 15} dias
                      </p>
                    </div>
                  </div>

                  {/* Seção Destacada: Insights Inteligentes de Fechamento */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="h-5 w-5 text-amber-500" />
                      <h3 className="text-sm font-bold tracking-tight">
                        Insights Comerciais & Recomendações para Fechar
                      </h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {intelligence.insights.map((item) => (
                        <div
                          key={item.id}
                          className={cn(
                            "rounded-xl border p-4 transition-all space-y-2 bg-card shadow-sm",
                            item.tone === "success"
                              ? "border-emerald-500/30 bg-emerald-500/5"
                              : item.tone === "warning"
                                ? "border-amber-500/30 bg-amber-500/5"
                                : item.tone === "accent"
                                  ? "border-purple-500/30 bg-purple-500/5"
                                  : "border-blue-500/30 bg-blue-500/5"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold tracking-wide uppercase",
                                item.tone === "success"
                                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                  : item.tone === "warning"
                                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                    : item.tone === "accent"
                                      ? "bg-purple-500/15 text-purple-700 dark:text-purple-400"
                                      : "bg-blue-500/15 text-blue-700 dark:text-blue-400"
                              )}
                            >
                              {item.badgeText}
                            </span>
                          </div>
                          <h4 className="text-xs font-bold text-foreground">{item.title}</h4>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {item.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Lado a Lado: Cliente & Condições da Proposta */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Perfil & Dados do Cliente */}
                    <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        <User className="h-4 w-4 text-primary" /> Perfil do Cliente
                      </h3>
                      <div>
                        <p className="font-semibold text-sm text-foreground">{customer?.companyName ?? "—"}</p>
                        {customer?.tradeName && (
                          <p className="text-xs text-muted-foreground mt-0.5">{customer.tradeName}</p>
                        )}
                        <p className="text-[11px] text-muted-foreground font-mono mt-1">{customer?.taxId ?? "—"}</p>
                        {customer?.city && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            📍 {customer.city}
                            {customer.state ? ` / ${customer.state}` : ""}
                          </p>
                        )}
                      </div>

                      {customerHistory && customerHistory.totalOrdersCount > 0 ? (
                        <div className="pt-2 border-t border-border/60 text-xs space-y-1.5">
                          <p className="font-semibold text-foreground/90">Histórico de Compras:</p>
                          <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                            <div>
                              Pedidos Fechados: <span className="font-bold text-foreground">{customerHistory.totalOrdersCount}</span>
                            </div>
                            <div>
                              Ticket Médio: <span className="font-bold text-foreground">{formatCurrency(customerHistory.averageOrderTicket ?? 0)}</span>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {/* Condições Comerciais */}
                    <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        <Truck className="h-4 w-4 text-primary" /> Condições Comerciais
                      </h3>
                      <dl className="grid grid-cols-1 gap-2 text-xs">
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Responsável Comercial</dt>
                          <dd className="font-medium text-right text-foreground">{data.responsible || "—"}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Validade da Proposta</dt>
                          <dd className="font-medium text-right text-foreground">{data.validityDays ?? "—"} dias</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Condição de Pagamento</dt>
                          <dd className="font-semibold text-right text-primary max-w-[60%]">{data.paymentTerms || "A definir"}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Método de Pagamento</dt>
                          <dd className="font-medium text-right text-foreground">{data.paymentMethod || "—"}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Condição de Frete</dt>
                          <dd className="font-medium text-right text-foreground">{data.freightCondition || "CIF"}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Prazo de Entrega</dt>
                          <dd className="font-medium text-right text-foreground">{data.deliveryTimeDays ? `${data.deliveryTimeDays} dias` : "—"}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>

                  {/* Observações & Notas Internas */}
                  {data.notes && String(data.notes).trim() !== "" && (
                    <div className="rounded-xl border border-border p-4 bg-card shadow-sm">
                      <h3 className="text-xs font-bold uppercase text-muted-foreground mb-1.5">Observações para o Cliente</h3>
                      <p className="text-xs whitespace-pre-wrap text-foreground/90 leading-relaxed">{data.notes}</p>
                    </div>
                  )}
                  {data.internalNotes && String(data.internalNotes).trim() !== "" && (
                    <div className="rounded-xl border border-dashed border-amber-500/40 p-4 bg-amber-500/5">
                      <h3 className="text-xs font-bold uppercase text-amber-800 dark:text-amber-200 mb-1.5">
                        Notas Internas da Equipe
                      </h3>
                      <p className="text-xs whitespace-pre-wrap text-foreground/90 leading-relaxed">{data.internalNotes}</p>
                    </div>
                  )}

                  {/* Tabela de Itens */}
                  <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm">
                    <div className="px-4 py-3 bg-muted/40 border-b border-border flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                        <Package className="h-4 w-4 text-primary" /> Itens Cotados ({items.length})
                      </h3>
                      <span className="text-xs font-semibold text-muted-foreground">
                        Total Líquido: {formatCurrency(safeNum(data.totalNetValue))}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-muted/20 border-b border-border text-muted-foreground">
                            <th className="p-3 font-semibold">Produto / SKU</th>
                            <th className="p-3 font-semibold text-right">Qtd</th>
                            <th className="p-3 font-semibold text-right">Preço Negociado</th>
                            <th className="p-3 font-semibold text-right">Desconto</th>
                            <th className="p-3 font-semibold text-right">Margem Com. %</th>
                            <th className="p-3 font-semibold text-right">Total Líquido</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {items.map((row, idx) => {
                            const qty = safeNum(row.quantity);
                            const neg = safeNum(row.negotiatedPrice);
                            const disc = safeNum(row.discountValue);
                            const netLine = qty * neg - disc;
                            const commercial = resolveProposalItemCommercialMarginDisplay(row);
                            return (
                              <tr key={row.id ?? idx} className="hover:bg-accent/30 transition-colors">
                                <td className="p-3">
                                  <p className="font-semibold text-foreground">
                                    {row.Product?.name ?? "—"}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                                    {row.Product?.sku ?? row.productId}
                                  </p>
                                </td>
                                <td className="p-3 text-right tabular-nums font-medium">{formatNumber(qty, 2)}</td>
                                <td className="p-3 text-right tabular-nums font-medium">
                                  {formatCurrency(neg)}
                                </td>
                                <td className="p-3 text-right tabular-nums font-medium text-muted-foreground">
                                  {disc > 0 ? formatCurrency(disc) : "—"}
                                </td>
                                <td className="p-3 text-right tabular-nums font-bold text-primary">
                                  {formatProposalCommercialPercent(commercial.marginPerc)}
                                </td>
                                <td className="p-3 text-right font-bold tabular-nums text-foreground">
                                  {formatCurrency(netLine)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
