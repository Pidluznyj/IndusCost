import React from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  GitBranch,
  Loader2,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/src/lib/utils";
import { EXECUTIVE_DASHBOARD_MIN_YEAR } from "@/src/lib/executiveDashboardYear";
import type {
  SalesFunnelDashboardTab,
  SalesFunnelOperationalStage,
  SalesFunnelStage,
} from "@/src/lib/executiveDashboardTypes";
import {
  formatExecutiveCompactCurrency,
  formatExecutiveCurrency,
  formatExecutiveInteger,
  formatExecutivePercent,
} from "@/src/lib/executiveDashboardFormatters";

const STAGE_COLORS: Record<SalesFunnelStage["id"], string> = {
  emitted: "#546E7A",
  valid: "#1565C0",
  openPortfolio: "#ED7D31",
  invoiced: "#2E7D32",
  overdue: "#C62828",
  cancelled: "#757575",
};

const OPERATIONAL_STAGE_COLORS: Record<
  import("@/src/lib/executiveDashboardTypes").SalesFunnelOperationalStage["id"],
  string
> = {
  sold: "#1565C0",
  withNfe: "#2E7D32",
  invoicedOnTime: "#1B5E20",
  invoicedLate: "#C62828",
  pendingNoNfe: "#ED7D31",
  pendingLate: "#B71C1C",
  partial: "#F9A825",
  withCut: "#6A1B9A",
  reviewData: "#FF6F00",
  cancelled: "#757575",
};

type Props = {
  tab: SalesFunnelDashboardTab | null;
  loading: boolean;
  error: string | null;
  selectedYear: number;
  onYearChange: (year: number) => void;
  onRefresh: () => void;
  generatedAt: string | null;
};

function buildYearOptions(now = new Date()): number[] {
  const max = now.getFullYear() + 1;
  const years: number[] = [];
  for (let y = max; y >= EXECUTIVE_DASHBOARD_MIN_YEAR; y -= 1) {
    years.push(y);
  }
  return years;
}

function SummaryCards({ cards }: { cards: SalesFunnelDashboardTab["summaryCards"] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.id}
          className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
        >
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {card.label}
          </p>
          <p className="mt-2 truncate text-xl font-black lg:text-2xl" title={card.formatted}>
            {card.compactFormatted ?? card.formatted}
          </p>
          {card.hint ? (
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground" title={card.hint}>
              {card.hint}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function LegacyCommercialFunnel({ stages }: { stages: SalesFunnelStage[] }) {
  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">Funil comercial (emitidos → faturados)</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Visão não linear — etapas podem se sobrepor (ex.: atrasados ⊆ carteira).
          </p>
        </div>
      </div>
      <div className="space-y-3">
        {stages.map((stage) => {
          const widthPct = Math.max(8, (stage.count / maxCount) * 100);
          return (
            <div key={stage.id} className="group" title={stage.description}>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-semibold">{stage.label}</span>
                <span className="text-muted-foreground">
                  {stage.formatted.count} · {stage.formatted.compactValue} ·{" "}
                  {stage.formatted.percentOfValid} dos válidos
                </span>
              </div>
              <div className="h-10 w-full overflow-hidden rounded-xl bg-accent/30">
                <div
                  className="flex h-full items-center rounded-xl px-3 text-xs font-bold text-white transition-all duration-500"
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: STAGE_COLORS[stage.id],
                    minWidth: stage.count > 0 ? "4rem" : "0",
                  }}
                >
                  {stage.count > 0 ? stage.formatted.count : null}
                </div>
              </div>
              <p className="mt-1 hidden text-[11px] text-muted-foreground group-hover:block">
                {stage.description}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SalesOperationalFunnel({ stages }: { stages: SalesFunnelOperationalStage[] }) {
  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  return (
    <section className="rounded-3xl border border-primary/20 bg-card p-6 shadow-sm">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">Funil Operacional de Vendas</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Jornada logística/faturamento via motor único — vendido, NF, prazo, pendências e parciais.
          </p>
        </div>
      </div>
      <div className="space-y-3">
        {stages.map((stage) => {
          const widthPct = Math.max(8, (stage.count / maxCount) * 100);
          return (
            <div key={stage.id} className="group" title={stage.description}>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-semibold">{stage.label}</span>
                <span className="text-muted-foreground">
                  {stage.formatted.count} · {stage.formatted.compactValue} ·{" "}
                  {stage.formatted.percentOfSold} dos vendidos
                </span>
              </div>
              <div className="h-10 w-full overflow-hidden rounded-xl bg-accent/30">
                <div
                  className="flex h-full items-center rounded-xl px-3 text-xs font-bold text-white transition-all duration-500"
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: OPERATIONAL_STAGE_COLORS[stage.id],
                    minWidth: stage.count > 0 ? "4rem" : "0",
                  }}
                >
                  {stage.count > 0 ? stage.formatted.count : null}
                </div>
              </div>
              <p className="mt-1 hidden text-[11px] text-muted-foreground group-hover:block">
                {stage.description}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function SalesFunnelPanel({
  tab,
  loading,
  error,
  selectedYear,
  onYearChange,
  onRefresh,
  generatedAt,
}: Props) {
  const yearOptions = React.useMemo(() => buildYearOptions(), []);
  const updatedAt = generatedAt ? new Date(generatedAt).toLocaleString("pt-BR") : null;

  if (loading && !tab) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm font-medium text-muted-foreground">Carregando funil de vendas…</p>
        <div className="grid w-full max-w-4xl grid-cols-2 gap-3 px-4 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-accent/40" />
          ))}
        </div>
      </div>
    );
  }

  if (error && !tab) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
        <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-destructive" />
        <h3 className="text-lg font-semibold">Não foi possível carregar o funil</h3>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={onRefresh}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!tab) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-amber-200/80 bg-amber-50/70 px-6 py-10 text-center dark:border-amber-900/50 dark:bg-amber-950/30">
        <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-700 dark:text-amber-400" />
        <h3 className="text-lg font-semibold">Funil de Vendas indisponível</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Não foi possível montar os indicadores do funil. Tente atualizar ou volte mais tarde.
        </p>
        <button
          type="button"
          onClick={onRefresh}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!tab.available) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {tab?.unavailableReason ??
            "Funil de Vendas exige permissão sales_orders.view ou reports.view."}
        </p>
      </div>
    );
  }

  const monthlyChart = tab.monthlyEvolution.map((point) => ({
    name: point.monthLabel,
    emitido: point.issuedValue,
    faturado: point.invoicedValue,
    conversao: point.conversionPercent ?? 0,
  }));

  const statusChart = tab.statusBreakdown.map((row) => ({
    name: row.label,
    valor: row.value ?? 0,
    qtd: row.count,
  }));

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-black tracking-tight">
            <GitBranch className="h-7 w-7 text-primary" />
            Funil de Vendas
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Pedidos emitidos, carteira, faturamento e pendências comerciais — fonte: pedidos de venda
            ({tab.selectedYear}).
          </p>
          {updatedAt ? (
            <p className="mt-1 text-xs text-muted-foreground">Atualizado em {updatedAt}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm">
            <span className="text-muted-foreground">Ano</span>
            <select
              value={selectedYear}
              onChange={(e) => onYearChange(Number(e.target.value))}
              className="bg-transparent font-semibold outline-none"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <Link
            to="/sales-orders"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-accent/50"
          >
            <ShoppingCart className="h-4 w-4" />
            Ver pedidos
          </Link>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold hover:bg-accent/50 disabled:opacity-60"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Atualizar
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-4 py-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
          Falha ao atualizar — exibindo última carga bem-sucedida.
        </div>
      ) : null}

      <SummaryCards cards={tab.summaryCards} />

      {tab.operationalSummaryCards?.length ? (
        <>
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Indicadores operacionais (motor único)
          </h3>
          <SummaryCards cards={tab.operationalSummaryCards} />
        </>
      ) : null}

      {tab.operationalFunnelStages?.length ? (
        <SalesOperationalFunnel stages={tab.operationalFunnelStages} />
      ) : null}

      <LegacyCommercialFunnel stages={tab.funnelStages} />

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <h3 className="mb-1 text-lg font-bold">Evolução mensal</h3>
          <p className="mb-4 text-xs text-muted-foreground">
            Valor emitido vs faturado por mês de emissão. Carteira/atraso mensal histórico: pendente.
          </p>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyChart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => formatExecutiveCompactCurrency(Number(v)).replace("R$ ", "")}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => formatExecutivePercent(Number(v), 1)}
                />
                <Tooltip
                  formatter={(value: number, name: string) => {
                    if (name === "Conversão") return formatExecutivePercent(value, 1);
                    return formatExecutiveCurrency(value);
                  }}
                />
                <Legend />
                <Bar
                  yAxisId="left"
                  dataKey="emitido"
                  name="Emitido"
                  fill="#1565C0"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  yAxisId="left"
                  dataKey="faturado"
                  name="Faturado"
                  fill="#2E7D32"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="conversao"
                  name="Conversão"
                  stroke="#ED7D31"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <h3 className="mb-1 text-lg font-bold">Pedidos por status</h3>
          <p className="mb-4 text-xs text-muted-foreground">Distribuição de valor por status real do pedido.</p>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusChart} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => formatExecutiveCompactCurrency(Number(v)).replace("R$ ", "")}
                />
                <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(value: number) => formatExecutiveCurrency(value)} />
                <Bar dataKey="valor" name="Valor" fill="#546E7A" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <h3 className="mb-1 flex items-center gap-2 text-lg font-bold">
          <TrendingUp className="h-5 w-5 text-primary" />
          Conversão mensal (emitidos → faturados)
        </h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Percentual de pedidos emitidos no mês que já possuem NF processada.
        </p>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {tab.conversionByMonth.map((row) => (
            <div key={row.month} className="rounded-xl border border-border bg-accent/20 p-3 text-center">
              <p className="text-[10px] font-bold uppercase text-muted-foreground">{row.monthLabel}</p>
              <p className="mt-1 text-lg font-black">
                {row.conversionPercent != null
                  ? formatExecutivePercent(row.conversionPercent, 1)
                  : "—"}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {formatExecutiveInteger(row.invoicedCount)}/{formatExecutiveInteger(row.issuedCount)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <Users className="h-5 w-5 text-primary" />
            Top clientes em carteira ({tab.selectedYear})
          </h3>
          {tab.openPortfolioByCustomer.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum pedido em carteira no ano selecionado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-2 pr-3 font-semibold">Cliente</th>
                    <th className="pb-2 pr-3 font-semibold">Pedidos</th>
                    <th className="pb-2 pr-3 font-semibold">Valor aberto</th>
                    <th className="pb-2 font-semibold">Mais antigo</th>
                  </tr>
                </thead>
                <tbody>
                  {tab.openPortfolioByCustomer.map((row) => (
                    <tr key={row.customerId} className="border-b border-border/60">
                      <td className="py-2 pr-3 font-medium">{row.customerName}</td>
                      <td className="py-2 pr-3">{formatExecutiveInteger(row.orderCount)}</td>
                      <td className="py-2 pr-3">{formatExecutiveCurrency(row.openValue)}</td>
                      <td className="py-2 text-muted-foreground">
                        {formatExecutiveInteger(row.daysOpen)} dias
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Pedidos críticos
          </h3>
          {tab.criticalOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum pedido crítico no ano selecionado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-2 pr-2 font-semibold">Pedido</th>
                    <th className="pb-2 pr-2 font-semibold">Cliente</th>
                    <th className="pb-2 pr-2 font-semibold">Valor</th>
                    <th className="pb-2 pr-2 font-semibold">Status</th>
                    <th className="pb-2 font-semibold">Pendência</th>
                  </tr>
                </thead>
                <tbody>
                  {tab.criticalOrders.map((row) => (
                    <tr key={row.orderId} className="border-b border-border/60">
                      <td className="py-2 pr-2 font-medium">{row.orderCode}</td>
                      <td className="max-w-[120px] truncate py-2 pr-2" title={row.customerName}>
                        {row.customerName}
                      </td>
                      <td className="py-2 pr-2">{formatExecutiveCurrency(row.totalNetValue)}</td>
                      <td className="py-2 pr-2">{row.statusLabel}</td>
                      <td className="py-2">
                        {row.isOverdue ? (
                          <span className="font-semibold text-red-700">
                            Atrasado {formatExecutiveInteger(row.daysOverdue)} d
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            Aberto {formatExecutiveInteger(row.daysOpen)} d
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Link
            to="/sales-orders"
            className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
          >
            Ver todos os pedidos <ArrowRight className="h-3 w-3" />
          </Link>
        </section>
      </div>

      {tab.unavailableIndicators.length > 0 ? (
        <div className="rounded-xl border border-border bg-accent/20 px-4 py-3 text-xs text-muted-foreground">
          {tab.unavailableIndicators.join(" ")}
        </div>
      ) : null}
    </div>
  );
}
