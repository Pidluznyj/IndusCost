import React, { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { SearchableSelect } from "@/src/components/shared/SearchableSelect";
import type { Customer, Proposal, ProposalItem, ProposalStatus } from "@/src/types/commercial";
import {
  STATUS_FUNNEL_META,
  isPipelineOpenStatus,
  proposalExpiryDate,
} from "@/src/lib/salesFunnel";
import type { PortfolioAbcResult } from "@/src/lib/customerCommercialIntel";
import {
  computeCommercialPhase2,
  enrichCrossSellFromMix,
  HEALTH_LEVEL_LABEL_PT,
  REPURCHASE_WINDOW_LABEL_PT,
} from "@/src/lib/customerCommercialIntel";

type ProductLite = { id: string; sku: string; name: string; type: string };

export type CommercialProposal = Proposal & {
  items: (ProposalItem & { Product?: ProductLite })[];
};

function n(v: unknown, fb = 0): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : fb;
}

function daysBetween(a: string | Date, b: string | Date): number {
  const t1 = typeof a === "string" ? new Date(a).getTime() : a.getTime();
  const t2 = typeof b === "string" ? new Date(b).getTime() : b.getTime();
  return Math.floor((t2 - t1) / 86400000);
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

const STATUS_OPTS: { value: ProposalStatus | ""; label: string }[] = [
  { value: "", label: "Todos os status" },
  { value: "DRAFT", label: "Rascunho" },
  { value: "ANALYSIS", label: "Em análise" },
  { value: "SENT", label: "Enviada" },
  { value: "APPROVED", label: "Aprovada" },
  { value: "REJECTED", label: "Rejeitada" },
  { value: "EXPIRED", label: "Expirada" },
  { value: "CANCELED", label: "Cancelada" },
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
  const [proposals, setProposals] = useState<CommercialProposal[]>([]);
  const [portfolioAbc, setPortfolioAbc] = useState<PortfolioAbcResult | null>(null);

  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [statusF, setStatusF] = useState<ProposalStatus | "">("");
  const [respF, setRespF] = useState("");
  const [productF, setProductF] = useState("");
  const [dealScope, setDealScope] = useState<"all" | "open" | "won" | "lost">("all");
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
      proposals: CommercialProposal[];
      portfolioAbc: PortfolioAbcResult;
    }>(`/api/customers/${customerId}/commercial-360`)
      .then((data) => {
        if (cancelled) return;
        setCustomer(data.customer);
        setProposals(Array.isArray(data.proposals) ? data.proposals : []);
        setPortfolioAbc(data.portfolioAbc ?? null);
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
    proposals.forEach((p) => {
      const t = (p.responsible || "").trim();
      if (t) s.add(t);
    });
    return [
      { value: "", label: "Todos", searchTerms: "todos" },
      ...[...s].sort().map((r) => ({ value: r, label: r, searchTerms: r })),
    ];
  }, [proposals]);

  const productOpts = useMemo(() => {
    const m = new Map<string, string>();
    proposals.forEach((p) => {
      p.items?.forEach((it) => {
        if (it.Product) m.set(it.Product.id, `${it.Product.sku} — ${it.Product.name}`);
      });
    });
    return [
      { value: "", label: "Todos os produtos", searchTerms: "todos" },
      ...[...m.entries()].map(([id, label]) => ({ value: id, label, searchTerms: label })),
    ];
  }, [proposals]);

  /** Mix agregado de todo o histórico do cliente (sem filtro) — cross-sell / Fase 2. */
  const mixRowsAll = useMemo(() => {
    const m = new Map<
      string,
      { sku: string; name: string; type: string; qty: number; revenue: number; margin: number }
    >();
    proposals.forEach((p) => {
      p.items?.forEach((it) => {
        const pr = it.Product;
        const id = it.productId;
        const qty = n(it.quantity);
        const lineRev = qty * n(it.negotiatedPrice);
        const lineMg = n(it.marginValue);
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
  }, [proposals]);

  const filtered = useMemo(() => {
    const minV = minNet === "" ? null : n(minNet);
    const maxV = maxNet === "" ? null : n(maxNet);
    return proposals.filter((p) => {
      if (!inRange(p.createdAt, dateFrom, dateTo)) return false;
      if (statusF && p.status !== statusF) return false;
      if (respF && (p.responsible || "").trim() !== respF) return false;
      if (productF && !p.items?.some((i) => i.productId === productF)) return false;
      const net = n(p.totalNetValue);
      if (minV !== null && net < minV) return false;
      if (maxV !== null && net > maxV) return false;
      if (dealScope === "open" && !isPipelineOpenStatus(p.status)) return false;
      if (dealScope === "won" && p.status !== "APPROVED") return false;
      if (
        dealScope === "lost" &&
        p.status !== "REJECTED" &&
        p.status !== "CANCELED" &&
        p.status !== "EXPIRED"
      )
        return false;
      return true;
    });
  }, [proposals, dateFrom, dateTo, statusF, respF, productF, minNet, maxNet, dealScope]);

  const metrics = useMemo(() => {
    const fp = filtered;
    const totalNet = fp.reduce((a, p) => a + n(p.totalNetValue), 0);
    const totalGross = fp.reduce((a, p) => a + n(p.totalGrossValue), 0);
    const totalMargin = fp.reduce((a, p) => a + n(p.totalMarginValue), 0);
    const count = fp.length;
    const approved = fp.filter((p) => p.status === "APPROVED");
    const approvedCount = approved.length;
    const lostCount = fp.filter(
      (p) => p.status === "REJECTED" || p.status === "CANCELED"
    ).length;
    const closedConv = approvedCount + lostCount;
    const conversion = closedConv > 0 ? (approvedCount / closedConv) * 100 : 0;
    const ticket = count > 0 ? totalNet / count : 0;
    const nets = fp.map((p) => n(p.totalNetValue)).filter((v) => v > 0);
    const minDeal = nets.length ? Math.min(...nets) : 0;
    const maxDeal = nets.length ? Math.max(...nets) : 0;
    const totalItems = fp.reduce((a, p) => a + (p.totalItems || 0), 0);
    const avgItems = count > 0 ? totalItems / count : 0;
    const marginAvg = count > 0 ? fp.reduce((a, p) => a + n(p.totalMarginPerc), 0) / count : 0;

    const approvedChrono = [...approved].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    let avgRepurchase: number | null = null;
    if (approvedChrono.length >= 2) {
      let sum = 0;
      for (let i = 1; i < approvedChrono.length; i++) {
        sum += daysBetween(approvedChrono[i - 1].createdAt, approvedChrono[i].createdAt);
      }
      avgRepurchase = sum / (approvedChrono.length - 1);
    }
    const lastApproved = approvedChrono.length
      ? approvedChrono[approvedChrono.length - 1]
      : null;
    const daysSinceApproved = lastApproved
      ? daysBetween(lastApproved.createdAt, new Date())
      : null;

    const lastAny = fp.length
      ? [...fp].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )[0]
      : null;

    const openPipe = fp.filter((p) => isPipelineOpenStatus(p.status));
    const pipelineOpenNet = openPipe.reduce((a, p) => a + n(p.totalNetValue), 0);

    return {
      totalNet,
      totalGross,
      totalMargin,
      count,
      approvedCount,
      lostClosed: lostCount,
      conversion,
      ticket,
      minDeal,
      maxDeal,
      avgItems,
      marginAvg,
      avgRepurchase,
      daysSinceApproved,
      lastApprovedDate: lastApproved?.createdAt,
      lastMovement: lastAny,
      pipelineOpenNet,
      openCount: openPipe.length,
    };
  }, [filtered]);

  const mixRows = useMemo(() => {
    const m = new Map<
      string,
      { sku: string; name: string; type: string; qty: number; revenue: number; margin: number }
    >();
    filtered.forEach((p) => {
      p.items?.forEach((it) => {
        const pr = it.Product;
        const id = it.productId;
        const qty = n(it.quantity);
        const lineRev = qty * n(it.negotiatedPrice);
        const lineMg = n(it.marginValue);
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
    const fp = filtered;
    const approved = fp.filter((p) => p.status === "APPROVED");
    const lastApp = approved.length
      ? [...approved].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )[0]
      : null;

    if (approved.length >= 2 && metrics.avgRepurchase != null && lastApp) {
      const since = daysBetween(lastApp.createdAt, now);
      if (since > metrics.avgRepurchase * 1.1) {
        out.push({
          level: "warn",
          text: `Sem nova proposta aprovada há ${since} dias; média histórica entre aprovações ~${Math.round(metrics.avgRepurchase)} dias — oportunidade de recompra.`,
        });
      }
      if (since < metrics.avgRepurchase * 0.5 && since >= 0) {
        out.push({
          level: "info",
          text: `Dentro da janela típica de recompra (última aprovação há ${since} dias; média ~${Math.round(metrics.avgRepurchase)}).`,
        });
      }
    }

    if (lastApp && daysBetween(lastApp.createdAt, now) > 120 && approved.length > 0) {
      out.push({
        level: "warn",
        text: "Último negócio aprovado há mais de 120 dias — revisar relacionamento.",
      });
    }

    fp.forEach((p) => {
      if (p.status === "SENT") {
        const du = daysBetween(p.updatedAt, now);
        if (du > 14) {
          out.push({
            level: "warn",
            text: `Proposta #${p.number} enviada sem atualização há ${du} dias.`,
          });
        }
      }
      if (isPipelineOpenStatus(p.status)) {
        const exp = proposalExpiryDate(p.createdAt, p.validityDays ?? 15);
        if (exp < now) {
          out.push({
            level: "danger",
            text: `Proposta #${p.number} (${p.status}) com validade ultrapassada.`,
          });
        }
      }
    });

    const allP = proposals;
    const conv =
      allP.filter((p) => p.status === "APPROVED").length /
      Math.max(
        1,
        allP.filter((p) =>
          ["APPROVED", "REJECTED", "CANCELED"].includes(p.status)
        ).length
      );
    if (allP.length >= 4 && conv < 0.25) {
      out.push({
        level: "warn",
        text: "Taxa de conversão histórica baixa neste cliente — revisar precificação ou qualificação.",
      });
    }

    if (metrics.pipelineOpenNet > 0 && n(metrics.totalNet) > 0 && metrics.openCount > 0) {
      const ratio = metrics.pipelineOpenNet / (n(metrics.totalNet) + metrics.pipelineOpenNet);
      if (ratio > 0.4 && approved.length > 0) {
        out.push({
          level: "info",
          text: "Pipeline aberto representa fatia relevante do histórico filtrado — acompanhar fechamento.",
        });
      }
    }

    if (metrics.marginAvg >= 15 && approved.length > 0) {
      out.push({
        level: "info",
        text: `Margem média das propostas no filtro elevada (~${formatNumber(metrics.marginAvg, 1)}%).`,
      });
    }

    return out.slice(0, 12);
  }, [filtered, proposals, metrics]);

  const phase2 = useMemo(() => {
    if (!portfolioAbc) return null;
    const approvedN = proposals.filter((p) => p.status === "APPROVED").length;
    const base = computeCommercialPhase2(proposals, portfolioAbc);
    const mixHint = enrichCrossSellFromMix(
      mixRowsAll.map((r) => ({ sku: r.sku, type: r.type, revenue: r.revenue })),
      approvedN
    );
    return {
      ...base,
      crossSell: [...base.crossSell, ...mixHint],
    };
  }, [proposals, portfolioAbc, mixRowsAll]);

  const relationInfo = useMemo(() => {
    const last = proposals.length
      ? [...proposals].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )[0]
      : null;
    const openAll = proposals.filter((p) => isPipelineOpenStatus(p.status)).length;
    return {
      resp: last?.responsible?.trim() || null,
      lastMove: last?.updatedAt,
      lastStatus: last?.status,
      openAll,
    };
  }, [proposals]);

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
              Não existe módulo de pedido faturado no sistema. Negócios fechados usam propostas{" "}
              <strong>Aprovadas</strong> como proxy. Indicadores respeitam os filtros abaixo.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full hover:bg-accent shrink-0"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Carregando histórico comercial...</p>
            </div>
          )}
          {err && (
            <p className="text-sm text-red-600 text-center py-8">{err}</p>
          )}
          {!loading && !err && customer && (
            <>
              {/* Fase 2 — Inteligência comercial (histórico completo) */}
              {phase2 && (
                <div className="rounded-xl border border-primary/25 bg-gradient-to-br from-primary/5 to-transparent p-4 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-black flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        Inteligência comercial (Fase 2)
                      </h3>
                      <p className="text-[10px] text-muted-foreground mt-1 max-w-3xl">{phase2.proxyNote}</p>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">v{phase2.version}</span>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <Heart className="h-4 w-4 text-rose-500" />
                        <span className="text-xs font-bold uppercase text-muted-foreground">Saúde comercial</span>
                      </div>
                      <div className="flex items-end gap-2">
                        <span
                          className={cn(
                            "text-2xl font-black",
                            phase2.health.level === "SAUDAVEL" && "text-emerald-600",
                            phase2.health.level === "ATENCAO" && "text-amber-600",
                            phase2.health.level === "EM_RISCO" && "text-orange-600",
                            phase2.health.level === "INATIVO" && "text-slate-500"
                          )}
                        >
                          {HEALTH_LEVEL_LABEL_PT[phase2.health.level]}
                        </span>
                        <span className="text-sm text-muted-foreground pb-0.5">Score {phase2.health.score}/100</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            phase2.health.level === "SAUDAVEL" && "bg-emerald-500",
                            phase2.health.level === "ATENCAO" && "bg-amber-500",
                            phase2.health.level === "EM_RISCO" && "bg-orange-500",
                            phase2.health.level === "INATIVO" && "bg-slate-400"
                          )}
                          style={{ width: `${phase2.health.score}%` }}
                        />
                      </div>
                      <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
                        {phase2.health.reasons.length ? (
                          phase2.health.reasons.map((r, i) => <li key={i}>{r}</li>)
                        ) : (
                          <li>Critérios calculados; sem detalhes adicionais.</li>
                        )}
                      </ul>
                      <p className="text-[10px] text-muted-foreground border-t border-border pt-2">
                        Critérios: atividade recente, pipeline, tempo desde aprovações (proxy), margem e conversão.
                        Não substitui pedido/NF.
                      </p>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-primary" />
                        <span className="text-xs font-bold uppercase text-muted-foreground">Classificação</span>
                      </div>
                      <p className="text-lg font-black text-primary">
                        {phase2.segment.labelsPt[phase2.segment.primary]}
                      </p>
                      <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
                        {phase2.segment.reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-primary/10 text-primary border border-primary/20">
                          ABC:{" "}
                          {phase2.portfolioAbc.abcEligible && phase2.portfolioAbc.abcClass
                            ? `Classe ${phase2.portfolioAbc.abcClass}`
                            : "— (sem receita aprovada)"}
                        </span>
                        {phase2.portfolioAbc.rank != null && (
                          <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-muted">
                            Ranking receita aprovada: #{phase2.portfolioAbc.rank} /{" "}
                            {phase2.portfolioAbc.customerCount}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-primary" />
                        <span className="text-xs font-bold uppercase text-muted-foreground">Previsão de recompra</span>
                      </div>
                      <p className="text-[11px] font-semibold text-foreground">{phase2.repurchase.basis}</p>
                      <p className="text-sm font-bold">{REPURCHASE_WINDOW_LABEL_PT[phase2.repurchase.windowStatus]}</p>
                      <p className="text-[11px] text-muted-foreground">{phase2.repurchase.windowDetail}</p>
                      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
                        <dt className="text-muted-foreground">Mediana (dias)</dt>
                        <dd className="font-mono text-right">
                          {phase2.repurchase.medianDaysBetweenApprovals != null
                            ? Math.round(phase2.repurchase.medianDaysBetweenApprovals)
                            : "—"}
                        </dd>
                        <dt className="text-muted-foreground">Média (dias)</dt>
                        <dd className="font-mono text-right">
                          {phase2.repurchase.meanDaysBetweenApprovals != null
                            ? Math.round(phase2.repurchase.meanDaysBetweenApprovals)
                            : "—"}
                        </dd>
                        <dt className="text-muted-foreground">Dias última aprovação</dt>
                        <dd className="font-mono text-right">
                          {phase2.repurchase.daysSinceLastApproval != null
                            ? Math.round(phase2.repurchase.daysSinceLastApproval)
                            : "—"}
                        </dd>
                        <dt className="text-muted-foreground">Próxima janela (est.)</dt>
                        <dd className="font-mono text-right text-[10px]">
                          {phase2.repurchase.predictedNextApprovalDate
                            ? new Date(phase2.repurchase.predictedNextApprovalDate).toLocaleDateString("pt-BR")
                            : "—"}
                        </dd>
                      </dl>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-border bg-card p-4">
                      <h4 className="text-xs font-bold uppercase text-muted-foreground mb-2 flex items-center gap-2">
                        <BarChart3 className="h-3.5 w-3.5" /> Curva ABC (carteira)
                      </h4>
                      <p className="text-[10px] text-muted-foreground mb-2">{phase2.portfolioAbc.basisLabel}</p>
                      <p className="text-[11px] leading-relaxed">{phase2.portfolioAbc.methodologyNote}</p>
                      <dl className="mt-3 grid grid-cols-2 gap-1 text-[11px]">
                        <dt className="text-muted-foreground">Receita aprovada (cliente)</dt>
                        <dd className="text-right font-mono">{formatCurrency(phase2.portfolioAbc.customerApprovedNet)}</dd>
                        <dt className="text-muted-foreground">Total carteira aprovada</dt>
                        <dd className="text-right font-mono">{formatCurrency(phase2.portfolioAbc.portfolioApprovedTotal)}</dd>
                        <dt className="text-muted-foreground">Participação</dt>
                        <dd className="text-right font-mono">{formatNumber(phase2.portfolioAbc.shareOfPortfolioPct, 2)}%</dd>
                      </dl>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4">
                      <h4 className="text-xs font-bold uppercase text-muted-foreground mb-2 flex items-center gap-2">
                        <TrendingUp className="h-3.5 w-3.5" /> Tendência (aprovações)
                      </h4>
                      <dl className="grid grid-cols-2 gap-1 text-[11px]">
                        <dt className="text-muted-foreground">Últimos 180d (líq. aprov.)</dt>
                        <dd className="text-right font-mono">{formatCurrency(phase2.trend.recent180dApprovedNet)}</dd>
                        <dt className="text-muted-foreground">180d anteriores</dt>
                        <dd className="text-right font-mono">{formatCurrency(phase2.trend.prior180dApprovedNet)}</dd>
                      </dl>
                      {phase2.trend.note && (
                        <p className="text-[11px] text-amber-800 mt-2">{phase2.trend.note}</p>
                      )}
                    </div>
                  </div>

                  {phase2.crossSell.length > 0 && (
                    <div className="rounded-xl border border-border bg-card p-4">
                      <h4 className="text-xs font-bold uppercase text-muted-foreground mb-2 flex items-center gap-2">
                        <Package className="h-3.5 w-3.5" /> Expansão / cross-sell (heurística)
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
                        <AlertTriangle className="h-3.5 w-3.5" /> Alertas de follow-up
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
                    <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Visão gerencial (reutilizável)</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{phase2.managerial.summary}</p>
                  </div>
                </div>
              )}

              {/* Filtros */}
              <div className="rounded-xl border border-border p-4 bg-accent/10 space-y-3">
                <p className="text-xs font-bold uppercase text-muted-foreground">Filtros da visão</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-muted-foreground">Período (criação)</label>
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
                    <label className="text-[10px] font-bold text-muted-foreground">Status</label>
                    <SearchableSelect
                      placeholder="Status..."
                      options={STATUS_OPTS.map((o) => ({
                        value: o.value,
                        label: o.label,
                        searchTerms: o.label,
                      }))}
                      value={statusF}
                      onChange={(v) => setStatusF(v as ProposalStatus | "")}
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
                        ["all", "Todas"],
                        ["open", "Abertas"],
                        ["won", "Ganhas"],
                        ["lost", "Perdidas"],
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

              {/* Resumo */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                <MiniCard label="Valor líq. (filtro)" value={formatCurrency(metrics.totalNet)} />
                <MiniCard label="Propostas (filtro)" value={String(metrics.count)} />
                <MiniCard label="Aprovadas (filtro)" value={String(metrics.approvedCount)} />
                <MiniCard
                  label="Conversão"
                  value={
                    metrics.approvedCount + metrics.lostClosed > 0
                      ? `${formatNumber(metrics.conversion, 1)}%`
                      : "—"
                  }
                  hint="Aprov ÷ (Aprov+Rej+Canc)"
                />
                <MiniCard label="Ticket médio (filtro)" value={formatCurrency(metrics.ticket)} />
                <MiniCard label="Margem média %" value={`${formatNumber(metrics.marginAvg, 2)}%`} />
                <MiniCard label="Margem R$ total" value={formatCurrency(metrics.totalMargin)} />
                <MiniCard label="Maior / menor negócio (líq.)" value={`${formatCurrency(metrics.maxDeal)} / ${formatCurrency(metrics.minDeal)}`} />
                <MiniCard label="Média itens / prop." value={formatNumber(metrics.avgItems, 2)} />
                <MiniCard
                  label="Pipeline aberto (filtro)"
                  value={formatCurrency(metrics.pipelineOpenNet)}
                  hint={`${metrics.openCount} prop.`}
                />
                <MiniCard
                  label="Última aprovação (proxy)"
                  value={
                    metrics.lastApprovedDate
                      ? new Date(metrics.lastApprovedDate).toLocaleDateString("pt-BR")
                      : "—"
                  }
                />
                <MiniCard
                  label="Dias desde última aprovação"
                  value={metrics.daysSinceApproved != null ? `${Math.round(metrics.daysSinceApproved)}` : "—"}
                />
                <MiniCard
                  label="Média dias entre aprovações"
                  value={
                    metrics.avgRepurchase != null ? `${Math.round(metrics.avgRepurchase)}` : "—"
                  }
                  hint="≥2 aprovações"
                />
                <MiniCard
                  label="Produto líder (receita filtro)"
                  value={mixRows[0] ? `${mixRows[0].sku}` : "—"}
                  hint={mixRows[0]?.name}
                />
              </div>

              {/* Relacionamento */}
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
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Última atualização (histórico completo)</p>
                    <p className="font-bold text-sm">
                      {relationInfo.lastMove
                        ? new Date(relationInfo.lastMove).toLocaleString("pt-BR")
                        : "—"}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">Pipeline aberto (total cliente)</p>
                  <p className="font-bold text-primary">{relationInfo.openAll} proposta(s)</p>
                  <p className="text-[10px] text-muted-foreground">
                    Último status: {relationInfo.lastStatus || "—"}
                    {phase2 && (
                      <>
                        {" "}
                        · Saúde (Fase 2):{" "}
                        <span className="font-semibold text-foreground">
                          {HEALTH_LEVEL_LABEL_PT[phase2.health.level]}
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </div>

              {/* Alertas */}
              {alerts.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" /> Sinais com base no filtro atual
                  </h3>
                  <p className="text-[10px] text-muted-foreground">
                    Complementa os alertas estratégicos acima; respeita período, status e demais filtros.
                  </p>
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

              {/* Histórico propostas */}
              <div>
                <h3 className="text-sm font-bold mb-2 flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Histórico de propostas (cronológico)
                </h3>
                <div className="rounded-xl border border-border overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[800px]">
                    <thead className="bg-accent/50">
                      <tr>
                        <th className="p-2">#</th>
                        <th className="p-2">Status</th>
                        <th className="p-2">Criação</th>
                        <th className="p-2">Atual.</th>
                        <th className="p-2 text-right">Líq.</th>
                        <th className="p-2 text-right">Margem %</th>
                        <th className="p-2">Resp.</th>
                        <th className="p-2">Título / obs.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {[...filtered]
                        .sort(
                          (a, b) =>
                            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                        )
                        .map((p) => (
                          <tr key={p.id} className="hover:bg-accent/20">
                            <td className="p-2 font-mono font-bold">#{p.number}</td>
                            <td className="p-2">{STATUS_FUNNEL_META[p.status].stageLabel}</td>
                            <td className="p-2 whitespace-nowrap">
                              {new Date(p.createdAt).toLocaleDateString("pt-BR")}
                            </td>
                            <td className="p-2 whitespace-nowrap">
                              {new Date(p.updatedAt).toLocaleDateString("pt-BR")}
                            </td>
                            <td className="p-2 text-right">{formatCurrency(n(p.totalNetValue))}</td>
                            <td className="p-2 text-right">{formatNumber(n(p.totalMarginPerc), 2)}%</td>
                            <td className="p-2 max-w-[100px] truncate">
                              {(p.responsible || "—").trim()}
                            </td>
                            <td className="p-2 max-w-[200px] truncate" title={p.notes || ""}>
                              {p.title || p.notes?.slice(0, 80) || "—"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {filtered.length === 0 && (
                    <p className="p-6 text-center text-muted-foreground text-sm">
                      Nenhuma proposta no filtro.
                    </p>
                  )}
                </div>
              </div>

              {/* Proxy negócios */}
              <div>
                <h3 className="text-sm font-bold mb-2 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" /> Negócios fechados (proxy: propostas aprovadas)
                </h3>
                <p className="text-[10px] text-muted-foreground mb-2">
                  Cada linha é uma proposta com status Aprovada — não equivale a NF / pedido ERP.
                </p>
                <div className="rounded-xl border border-border overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[900px]">
                    <thead className="bg-accent/50">
                      <tr>
                        <th className="p-2">Data</th>
                        <th className="p-2">#</th>
                        <th className="p-2 text-right">Valor líq.</th>
                        <th className="p-2 text-right">Margem %</th>
                        <th className="p-2">Itens (resumo)</th>
                        <th className="p-2">Condições</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filtered
                        .filter((p) => p.status === "APPROVED")
                        .map((p) => (
                          <tr key={p.id}>
                            <td className="p-2 whitespace-nowrap">
                              {new Date(p.createdAt).toLocaleDateString("pt-BR")}
                            </td>
                            <td className="p-2 font-mono">#{p.number}</td>
                            <td className="p-2 text-right font-bold">
                              {formatCurrency(n(p.totalNetValue))}
                            </td>
                            <td className="p-2 text-right">{formatNumber(n(p.totalMarginPerc), 2)}%</td>
                            <td className="p-2">
                              {p.items?.slice(0, 3).map((it) => (
                                <span key={it.id} className="block text-[10px]">
                                  {it.Product?.sku} × {formatNumber(n(it.quantity), 2)}
                                </span>
                              ))}
                              {(p.totalItems || 0) > 3 && (
                                <span className="text-[10px] text-muted-foreground">+ mais</span>
                              )}
                            </td>
                            <td className="p-2 max-w-[200px] text-[10px]">
                              {p.paymentTerms || "—"} · {p.freightCondition || "—"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {filtered.filter((p) => p.status === "APPROVED").length === 0 && (
                    <p className="p-4 text-center text-muted-foreground text-sm">
                      Nenhuma proposta aprovada no filtro.
                    </p>
                  )}
                </div>
              </div>

              {/* Mix */}
              <div>
                <h3 className="text-sm font-bold mb-2 flex items-center gap-2">
                  <Package className="h-4 w-4" /> Mix de produtos (itens das propostas filtradas)
                </h3>
                <p className="text-[10px] text-muted-foreground mb-2">
                  Agrupado por SKU. Coluna &quot;Tipo&quot; = engenharia (Produto/Componente), não família comercial.
                </p>
                <div className="rounded-xl border border-border overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-accent/50">
                      <tr>
                        <th className="p-2">SKU</th>
                        <th className="p-2">Nome</th>
                        <th className="p-2">Tipo item</th>
                        <th className="p-2 text-right">Qtd</th>
                        <th className="p-2 text-right">Receita (est.)</th>
                        <th className="p-2 text-right">Margem R$ (linha)</th>
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
                    <p className="p-4 text-center text-muted-foreground text-sm">
                      Sem itens no filtro atual.
                    </p>
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
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-[9px] font-bold text-muted-foreground uppercase leading-tight">{label}</p>
      <p className="text-sm font-black mt-1 truncate" title={value}>
        {value}
      </p>
      {hint && <p className="text-[9px] text-muted-foreground mt-0.5 truncate">{hint}</p>}
    </div>
  );
}
