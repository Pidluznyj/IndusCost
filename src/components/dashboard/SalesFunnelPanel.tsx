import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  RefreshCcw,
  AlertTriangle,
  TrendingUp,
  Users,
  Target,
  BarChart3,
  Clock,
  ExternalLink,
  Filter,
  Info,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from "recharts";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { SearchableSelect } from "../shared/SearchableSelect";
import type { Proposal, ProposalStatus, Customer } from "@/src/types/commercial";
import {
  FUNNEL_STATUS_ORDER,
  STATUS_FUNNEL_META,
  isPipelineOpenStatus,
  weightedNetValue,
  safeNum,
  proposalExpiryDate,
  daysOpen,
  requestOpenProposal,
} from "@/src/lib/salesFunnel";

type ProposalRow = Proposal & { Customer?: Customer };

const STALE_DAYS = 10;
const ANALYSIS_LONG_DAYS = 14;
const SENT_NO_RESPONSE_DAYS = 14;

function inDateRange(createdAt: string, from: string | null, to: string | null): boolean {
  const d = new Date(createdAt).getTime();
  if (from) {
    const f = new Date(from);
    f.setHours(0, 0, 0, 0);
    if (d < f.getTime()) return false;
  }
  if (to) {
    const t = new Date(to);
    t.setHours(23, 59, 59, 999);
    if (d > t.getTime()) return false;
  }
  return true;
}

export const SalesFunnelPanel: React.FC = () => {
  const [rows, setRows] = useState<ProposalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [responsibleFilter, setResponsibleFilter] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProposalStatus | "">("");
  const [minNet, setMinNet] = useState("");
  const [maxNet, setMaxNet] = useState("");
  const [dealScope, setDealScope] = useState<"all" | "open" | "won" | "lost">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<ProposalRow[]>("/api/proposals");
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Falha ao carregar propostas.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const customerOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => {
      const name = r.Customer?.companyName?.trim() || "Cliente";
      map.set(r.customerId, name);
    });
    return [...map.entries()].map(([value, label]) => ({
      value,
      label,
      searchTerms: label,
    }));
  }, [rows]);

  const responsibleOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      const t = (r.responsible || "").trim();
      if (t) set.add(t);
    });
    const opts = [...set].sort().map((name) => ({
      value: name,
      label: name,
      searchTerms: name,
    }));
    return [{ value: "", label: "Todos os responsáveis", searchTerms: "todos" }, ...opts];
  }, [rows]);

  const statusOptions = useMemo(
    () => [
      { value: "", label: "Todos os status", searchTerms: "todos" },
      ...FUNNEL_STATUS_ORDER.map((s) => ({
        value: s,
        label: `${STATUS_FUNNEL_META[s].stageLabel} (${s})`,
        searchTerms: `${s} ${STATUS_FUNNEL_META[s].stageLabel}`,
      })),
    ],
    []
  );

  const filtered = useMemo(() => {
    const minV = minNet === "" ? null : safeNum(minNet);
    const maxV = maxNet === "" ? null : safeNum(maxNet);
    return rows.filter((r) => {
      if (!inDateRange(r.createdAt, dateFrom, dateTo)) return false;
      if (responsibleFilter && (r.responsible || "").trim() !== responsibleFilter) return false;
      if (customerId && r.customerId !== customerId) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      const net = safeNum(r.totalNetValue);
      if (minV !== null && net < minV) return false;
      if (maxV !== null && net > maxV) return false;
      if (dealScope === "open" && !isPipelineOpenStatus(r.status)) return false;
      if (dealScope === "won" && r.status !== "APPROVED") return false;
      if (
        dealScope === "lost" &&
        r.status !== "REJECTED" &&
        r.status !== "CANCELED" &&
        r.status !== "EXPIRED"
      )
        return false;
      return true;
    });
  }, [rows, dateFrom, dateTo, responsibleFilter, customerId, statusFilter, minNet, maxNet, dealScope]);

  const metrics = useMemo(() => {
    const open = filtered.filter((r) => isPipelineOpenStatus(r.status));
    const totalGrossOpen = open.reduce((a, r) => a + safeNum(r.totalGrossValue), 0);
    const totalNetOpen = open.reduce((a, r) => a + safeNum(r.totalNetValue), 0);
    const weightedOpen = open.reduce(
      (a, r) => a + weightedNetValue(safeNum(r.totalNetValue), r.status),
      0
    );
    const countOpen = open.length;
    const avgTicket = countOpen > 0 ? totalNetOpen / countOpen : 0;
    const sent = filtered.filter((r) => r.status === "SENT").length;
    const won = filtered.filter((r) => r.status === "APPROVED").length;
    const lost =
      filtered.filter((r) => r.status === "REJECTED" || r.status === "CANCELED").length;
    const closed = won + lost;
    const conversion = closed > 0 ? (won / closed) * 100 : 0;

    const now = new Date();
    let stalled = 0;
    filtered.forEach((r) => {
      if (!isPipelineOpenStatus(r.status)) return;
      const upd = new Date(r.updatedAt);
      const daysSinceUpd = Math.floor((now.getTime() - upd.getTime()) / 86400000);
      const exp = proposalExpiryDate(r.createdAt, r.validityDays ?? 15);
      if (exp < now || daysSinceUpd >= STALE_DAYS) stalled++;
    });

    const approvedNet = filtered
      .filter((r) => r.status === "APPROVED")
      .reduce((a, r) => a + safeNum(r.totalNetValue), 0);

    const forecastWeightedPeriod = filtered.reduce(
      (a, r) => a + weightedNetValue(safeNum(r.totalNetValue), r.status),
      0
    );

    return {
      totalGrossOpen,
      totalNetOpen,
      weightedOpen,
      countOpen,
      avgTicket,
      sent,
      won,
      lost,
      conversion,
      stalled,
      approvedNet,
      forecastWeightedPeriod,
      totalInFilter: filtered.length,
    };
  }, [filtered]);

  const stageChartData = useMemo(() => {
    return FUNNEL_STATUS_ORDER.map((status) => {
      const list = filtered.filter((r) => r.status === status);
      const net = list.reduce((a, r) => a + safeNum(r.totalNetValue), 0);
      const w = list.reduce(
        (a, r) => a + weightedNetValue(safeNum(r.totalNetValue), status),
        0
      );
      return {
        etapa: STATUS_FUNNEL_META[status].stageLabel,
        status,
        qtd: list.length,
        valorLiquido: net,
        valorPonderado: w,
      };
    }).filter((row) => row.qtd > 0 || ["DRAFT", "ANALYSIS", "SENT"].includes(row.status));
  }, [filtered]);

  const tableRows = useMemo(() => {
    return [...filtered]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((r) => {
        const net = safeNum(r.totalNetValue);
        const w = weightedNetValue(net, r.status);
        const exp = proposalExpiryDate(r.createdAt, r.validityDays ?? 15);
        const dOpen = daysOpen(r.createdAt);
        const margin = safeNum(r.totalMarginPerc);
        return {
          r,
          net,
          weighted: w,
          expiry: exp,
          daysOpen: dOpen,
          margin,
          clientName: r.Customer?.companyName || "—",
        };
      });
  }, [filtered]);

  const topCustomersByOpenNet = useMemo(() => {
    const m = new Map<string, { name: string; net: number }>();
    filtered.forEach((r) => {
      if (!isPipelineOpenStatus(r.status)) return;
      const net = safeNum(r.totalNetValue);
      const name = r.Customer?.companyName?.trim() || "Cliente";
      const cur = m.get(r.customerId);
      m.set(r.customerId, { name, net: (cur?.net ?? 0) + net });
    });
    return [...m.entries()]
      .map(([, v]) => v)
      .sort((a, b) => b.net - a.net)
      .slice(0, 8);
  }, [filtered]);

  const topResponsibleByOpenNet = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((r) => {
      if (!isPipelineOpenStatus(r.status)) return;
      const key = (r.responsible || "").trim() || "(Sem responsável)";
      m.set(key, (m.get(key) || 0) + safeNum(r.totalNetValue));
    });
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [filtered]);

  const alerts = useMemo(() => {
    const now = new Date();
    const out: { level: "warn" | "danger"; text: string; proposalId: string }[] = [];
    filtered.forEach((r) => {
      if (!isPipelineOpenStatus(r.status)) return;
      const net = safeNum(r.totalNetValue);
      const exp = proposalExpiryDate(r.createdAt, r.validityDays ?? 15);
      const upd = new Date(r.updatedAt);
      const daysSinceUpd = Math.floor((now.getTime() - upd.getTime()) / 86400000);
      const dAnalysis = daysOpen(r.createdAt);

      if (exp < now) {
        out.push({
          level: "danger",
          text: `Proposta #${r.number}: validade vencida (${exp.toLocaleDateString("pt-BR")}) — ${r.Customer?.companyName || ""}`,
          proposalId: r.id,
        });
      }
      if (isPipelineOpenStatus(r.status) && daysSinceUpd >= STALE_DAYS && exp >= now) {
        out.push({
          level: "warn",
          text: `Proposta #${r.number}: sem atualização há ${daysSinceUpd} dias — ${r.Customer?.companyName || ""}`,
          proposalId: r.id,
        });
      }
      if (r.status === "ANALYSIS" && dAnalysis >= ANALYSIS_LONG_DAYS) {
        out.push({
          level: "warn",
          text: `Proposta #${r.number}: em análise há ${dAnalysis} dias — ${r.Customer?.companyName || ""}`,
          proposalId: r.id,
        });
      }
      if (r.status === "SENT" && daysSinceUpd >= SENT_NO_RESPONSE_DAYS) {
        out.push({
          level: "warn",
          text: `Proposta #${r.number}: enviada há ${daysSinceUpd} dias sem movimento registrado`,
          proposalId: r.id,
        });
      }
      if (net >= 50000 && daysSinceUpd >= 7 && isPipelineOpenStatus(r.status)) {
        out.push({
          level: "warn",
          text: `Alto valor (${formatCurrency(net)}): #${r.number} parada — ${r.Customer?.companyName || ""}`,
          proposalId: r.id,
        });
      }
    });
    const seen = new Set<string>();
    return out.filter((a) => {
      const k = `${a.proposalId}-${a.text.slice(0, 40)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 25);
  }, [filtered]);

  const COLORS = ["#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#10b981", "#f59e0b", "#ef4444"];

  if (loading && rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">Carregando pipeline comercial...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-card text-sm font-bold hover:bg-accent"
          >
            <RefreshCcw className="h-4 w-4" />
            Atualizar
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
        <p className="text-[10px] text-muted-foreground max-w-xl flex items-start gap-1">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          Valor ponderado = valor líquido × probabilidade por status (tabela em código). Não há campo de
          probabilidade por proposta; previsão é heurística. Período filtra por data de criação.
        </p>
      </div>

      {/* Filtros */}
      <div className="bg-card rounded-2xl border border-border p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground uppercase tracking-wider">
          <Filter className="h-4 w-4" /> Filtros
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-muted-foreground">Período (criação) — de</label>
            <input
              type="date"
              className="w-full p-2 rounded-lg border border-border bg-background text-sm"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-muted-foreground">até</label>
            <input
              type="date"
              className="w-full p-2 rounded-lg border border-border bg-background text-sm"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-muted-foreground">Responsável</label>
            <SearchableSelect
              placeholder="Todos..."
              options={responsibleOptions}
              value={responsibleFilter}
              onChange={(v) => setResponsibleFilter(v)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-muted-foreground">Cliente</label>
            <SearchableSelect
              placeholder="Todos..."
              options={customerOptions}
              value={customerId}
              onChange={(v) => setCustomerId(v)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-muted-foreground">Status / etapa</label>
            <SearchableSelect
              placeholder="Todos..."
              options={statusOptions}
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as ProposalStatus | "")}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-muted-foreground">Valor líq. mín. (R$)</label>
            <input
              type="number"
              className="w-full p-2 rounded-lg border border-border bg-background text-sm"
              value={minNet}
              onChange={(e) => setMinNet(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-muted-foreground">Valor líq. máx. (R$)</label>
            <input
              type="number"
              className="w-full p-2 rounded-lg border border-border bg-background text-sm"
              value={maxNet}
              onChange={(e) => setMaxNet(e.target.value)}
              placeholder="—"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-muted-foreground">Escopo</label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["all", "Todas"],
                  ["open", "Abertas (pipeline)"],
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
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border hover:bg-accent"
                  )}
                >
                  {lab}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <FunnelCard
          title="Valor líquido (pipeline aberto)"
          subtitle="DRAFT + ANÁLISE + ENVIADA"
          value={formatCurrency(metrics.totalNetOpen)}
          icon={TrendingUp}
        />
        <FunnelCard
          title="Valor ponderado (aberto)"
          subtitle="Probabilidade por status"
          value={formatCurrency(metrics.weightedOpen)}
          icon={Target}
        />
        <FunnelCard
          title="Oportunidades abertas"
          subtitle="Quantidade no filtro"
          value={String(metrics.countOpen)}
          icon={Users}
        />
        <FunnelCard
          title="Ticket médio (aberto)"
          subtitle="Média do líquido"
          value={formatCurrency(metrics.avgTicket)}
          icon={BarChart3}
        />
        <FunnelCard
          title="Propostas enviadas"
          subtitle="Status SENT no período"
          value={String(metrics.sent)}
          icon={Clock}
        />
        <FunnelCard
          title="Ganhas"
          subtitle="APPROVED no período"
          value={String(metrics.won)}
          icon={TrendingUp}
        />
        <FunnelCard
          title="Taxa conversão"
          subtitle="Ganhas ÷ (Ganhas + Perd. REJ/CANC); EXPIRED fora"
          value={metrics.lost + metrics.won > 0 ? `${formatNumber(metrics.conversion, 1)}%` : "—"}
          icon={Target}
        />
        <FunnelCard
          title="Alertas / paradas"
          subtitle="Abertas vencidas ou sem update"
          value={String(metrics.stalled)}
          icon={AlertTriangle}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-2xl border border-border p-5">
          <h4 className="text-sm font-bold mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" /> Clientes — maior pipeline aberto (líq.)
          </h4>
          <ul className="space-y-2 text-sm">
            {topCustomersByOpenNet.length === 0 && (
              <li className="text-muted-foreground text-xs">Sem oportunidades abertas no filtro.</li>
            )}
            {topCustomersByOpenNet.map((c, idx) => (
              <li key={`${c.name}-${idx}`} className="flex justify-between gap-2 border-b border-border/50 pb-1">
                <span className="truncate font-medium">{c.name}</span>
                <span className="font-bold text-primary shrink-0">{formatCurrency(c.net)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <h4 className="text-sm font-bold mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" /> Responsáveis — pipeline aberto (líq.)
          </h4>
          <ul className="space-y-2 text-sm">
            {topResponsibleByOpenNet.length === 0 && (
              <li className="text-muted-foreground text-xs">Sem dados no filtro.</li>
            )}
            {topResponsibleByOpenNet.map(([name, net]) => (
              <li key={name} className="flex justify-between gap-2 border-b border-border/50 pb-1">
                <span className="truncate font-medium">{name}</span>
                <span className="font-bold text-primary shrink-0">{formatCurrency(net)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Previsão */}
      <div className="bg-gradient-to-br from-primary/5 to-accent/30 rounded-2xl border border-border p-6">
        <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" /> Previsão comercial (período filtrado)
        </h3>
        <p className="text-[10px] text-muted-foreground mb-4">
          Valor ponderado total no período (todos os status no filtro): indicativo; não substitui
          forecast formal sem data de fechamento explícita.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-card border border-border">
            <p className="text-[10px] font-bold text-muted-foreground uppercase">Ponderado (filtro)</p>
            <p className="text-2xl font-black text-primary">{formatCurrency(metrics.forecastWeightedPeriod)}</p>
          </div>
          <div className="p-4 rounded-xl bg-card border border-border">
            <p className="text-[10px] font-bold text-muted-foreground uppercase">Valor ganho (líq.)</p>
            <p className="text-2xl font-black text-green-600">{formatCurrency(metrics.approvedNet)}</p>
          </div>
          <div className="p-4 rounded-xl bg-card border border-border">
            <p className="text-[10px] font-bold text-muted-foreground uppercase">Propostas no filtro</p>
            <p className="text-2xl font-black">{metrics.totalInFilter}</p>
          </div>
        </div>
      </div>

      {/* Gráfico */}
      <div className="bg-card rounded-2xl border border-border p-6">
        <h3 className="font-bold text-lg mb-2">Funil por etapa (valor no período)</h3>
        <p className="text-[10px] text-muted-foreground mb-6">
          Quantidade e valores por etapa derivados do status da proposta.
        </p>
        <div className="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stageChartData} layout="vertical" margin={{ left: 24, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => formatCurrency(Number(v))} />
              <YAxis dataKey="etapa" type="category" width={200} tick={{ fontSize: 10 }} />
              <Tooltip
                formatter={(v: number) => formatCurrency(v)}
                contentStyle={{ borderRadius: 12 }}
              />
              <Legend />
              <Bar dataKey="valorLiquido" name="Valor líquido" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              <Bar dataKey="valorPonderado" name="Valor ponderado" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
          {stageChartData.map((row) => (
            <div key={row.status} className="p-2 rounded-lg bg-accent/20 border border-border/50">
              <p className="font-bold truncate" title={row.etapa}>
                {row.status}
              </p>
              <p className="text-muted-foreground">Qtd: {row.qtd}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Alertas */}
      {alerts.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
          <h3 className="font-bold text-sm mb-3 flex items-center gap-2 text-amber-800">
            <AlertTriangle className="h-4 w-4" /> Alertas e gargalos
          </h3>
          <ul className="space-y-2 text-sm">
            {alerts.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className={a.level === "danger" ? "text-red-700" : "text-amber-800"}>{a.text}</span>
                <button
                  type="button"
                  className="text-xs font-bold text-primary flex items-center gap-1 shrink-0"
                  onClick={() => requestOpenProposal(a.proposalId)}
                >
                  Abrir <ExternalLink className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tabela */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border bg-accent/20 flex items-center justify-between">
          <h3 className="font-bold text-sm">Pipeline analítico</h3>
          <span className="text-[10px] text-muted-foreground">{tableRows.length} linhas</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[1100px]">
            <thead className="bg-accent/40 border-b border-border">
              <tr>
                <th className="p-3 font-bold">#</th>
                <th className="p-3 font-bold">Cliente</th>
                <th className="p-3 font-bold">Título</th>
                <th className="p-3 font-bold">Etapa</th>
                <th className="p-3 font-bold">Resp.</th>
                <th className="p-3 font-bold text-right">Bruto</th>
                <th className="p-3 font-bold text-right">Líq.</th>
                <th className="p-3 font-bold text-right">Pond.</th>
                <th className="p-3 font-bold text-right">Margem %</th>
                <th className="p-3 font-bold">Criação</th>
                <th className="p-3 font-bold">Atual.</th>
                <th className="p-3 font-bold text-right">Dias</th>
                <th className="p-3 font-bold">Validade</th>
                <th className="p-3 font-bold text-right">Itens</th>
                <th className="p-3 font-bold text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tableRows.map(({ r, net, weighted, expiry, daysOpen: dO, margin, clientName }) => (
                <tr key={r.id} className="hover:bg-accent/10">
                  <td className="p-3 font-mono font-bold">#{r.number}</td>
                  <td className="p-3 max-w-[140px] truncate" title={clientName}>
                    {clientName}
                  </td>
                  <td className="p-3 max-w-[160px] truncate">{r.title || "—"}</td>
                  <td className="p-3">
                    <span className="text-[10px]">{STATUS_FUNNEL_META[r.status].stageLabel}</span>
                  </td>
                  <td className="p-3 max-w-[100px] truncate">{(r.responsible || "—").trim() || "—"}</td>
                  <td className="p-3 text-right">{formatCurrency(safeNum(r.totalGrossValue))}</td>
                  <td className="p-3 text-right font-medium">{formatCurrency(net)}</td>
                  <td className="p-3 text-right text-primary font-bold">{formatCurrency(weighted)}</td>
                  <td className="p-3 text-right">{formatNumber(margin, 2)}%</td>
                  <td className="p-3 whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {new Date(r.updatedAt).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="p-3 text-right">{dO}</td>
                  <td className="p-3 whitespace-nowrap">{expiry.toLocaleDateString("pt-BR")}</td>
                  <td className="p-3 text-right">{r.totalItems}</td>
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      onClick={() => requestOpenProposal(r.id)}
                      className="text-primary font-bold hover:underline inline-flex items-center gap-1"
                    >
                      Abrir <ExternalLink className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tableRows.length === 0 && (
            <p className="p-8 text-center text-muted-foreground text-sm">Nenhuma proposta no filtro.</p>
          )}
        </div>
      </div>
    </div>
  );
};

function FunnelCard({
  title,
  subtitle,
  value,
  icon: Icon,
}: {
  title: string;
  subtitle: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{title}</p>
      <p className="text-xl font-black mt-1 truncate" title={value}>
        {value}
      </p>
      <p className="text-[10px] text-muted-foreground mt-1">{subtitle}</p>
    </div>
  );
}
