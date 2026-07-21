import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SalesOrderFlowAnalyticsModel } from "@/src/lib/salesOrderFlowAnalytics";
import { cn } from "@/src/lib/utils";

const CHART_HEIGHT = 260;

const STAGE_COLORS = [
  "#94a3b8",
  "#38bdf8",
  "#6366f1",
  "#f59e0b",
  "#14b8a6",
  "#22c55e",
];

const RISK_COLORS: Record<string, string> = {
  overdue: "#f59e0b",
  blocked: "#e11d48",
  inconsistent: "#f43f5e",
  partial: "#a855f7",
  cut: "#64748b",
  healthy: "#10b981",
};

const BURN_COLORS: Record<string, string> = {
  scope: "#94a3b8",
  completed: "#22c55e",
  remaining: "#38bdf8",
};

type Props = {
  model: SalesOrderFlowAnalyticsModel | null;
  loading?: boolean;
  className?: string;
};

export function SalesOrderFlowAnalyticsPanel({
  model,
  loading = false,
  className,
}: Props) {
  if (loading && model == null) {
    return (
      <section
        className={cn(
          "rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground",
          className
        )}
        data-testid="sales-order-flow-analytics-loading"
      >
        Carregando gráficos de fluxo…
      </section>
    );
  }

  if (model == null) return null;

  const riskPie = model.risks.filter((point) => point.value > 0);

  return (
    <section
      className={cn("space-y-3", className)}
      aria-label="Gráficos de acompanhamento do fluxo"
      data-testid="sales-order-flow-analytics"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Acompanhamento de fluxo
          </h2>
          <p className="text-xs text-muted-foreground">
            CFD, burnup, burndown e riscos com base no WIP atual dos snapshots.
          </p>
        </div>
        <p
          className="text-xs text-muted-foreground"
          data-testid="sales-order-flow-analytics-totals"
        >
          Escopo {model.totals.scopeOrders} · Em aberto{" "}
          {model.totals.remainingOrders} · Concluídos{" "}
          {model.totals.completedOrders}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title="WIP por etapa"
          subtitle="Distribuição atual do kanban"
          testId="sales-order-flow-chart-wip"
        >
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <BarChart data={model.wipByStage} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "#64748b" }}
                interval={0}
                angle={-28}
                textAnchor="end"
                height={56}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} />
              <Tooltip />
              <Bar dataKey="orderCount" name="Pedidos" radius={[4, 4, 0, 0]}>
                {model.wipByStage.map((point, index) => (
                  <Cell
                    key={point.stage}
                    fill={STAGE_COLORS[index % STAGE_COLORS.length]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="CFD (snapshot)"
          subtitle="Cumulativo de pedidos que já chegaram a cada etapa"
          testId="sales-order-flow-chart-cfd"
        >
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <AreaChart data={model.cfd} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "#64748b" }}
                interval={0}
                angle={-28}
                textAnchor="end"
                height={56}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} />
              <Tooltip />
              <Legend />
              <Area
                type="monotone"
                dataKey="cumulativeReached"
                name="Cumulativo"
                stroke="#6366f1"
                fill="#6366f1"
                fillOpacity={0.25}
              />
              <Area
                type="monotone"
                dataKey="wip"
                name="WIP na etapa"
                stroke="#38bdf8"
                fill="#38bdf8"
                fillOpacity={0.35}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Burnup"
          subtitle="Escopo × concluídos × em aberto"
          testId="sales-order-flow-chart-burnup"
        >
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <BarChart data={model.burnup} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} />
              <Tooltip />
              <Bar dataKey="value" name="Pedidos" radius={[4, 4, 0, 0]}>
                {model.burnup.map((point) => (
                  <Cell key={point.key} fill={BURN_COLORS[point.key] ?? "#94a3b8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Burndown"
          subtitle="Trabalho restante frente ao escopo"
          testId="sales-order-flow-chart-burndown"
        >
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <BarChart data={model.burndown} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} />
              <Tooltip />
              <Bar dataKey="value" name="Pedidos" radius={[4, 4, 0, 0]}>
                {model.burndown.map((point) => (
                  <Cell key={point.key} fill={BURN_COLORS[point.key] ?? "#94a3b8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Riscos operacionais"
          subtitle="Alertas do funil ativo"
          testId="sales-order-flow-chart-risks"
          className="lg:col-span-2"
        >
          {riskPie.length === 0 ? (
            <p className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
              Sem pedidos ativos para compor o gráfico de riscos.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <PieChart>
                <Pie
                  data={riskPie}
                  dataKey="value"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={95}
                  paddingAngle={2}
                >
                  {riskPie.map((point) => (
                    <Cell
                      key={point.key}
                      fill={RISK_COLORS[point.key] ?? "#94a3b8"}
                    />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </section>
  );
}

function ChartCard({
  title,
  subtitle,
  testId,
  children,
  className,
}: {
  title: string;
  subtitle: string;
  testId: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "rounded-xl border border-border bg-card p-3 shadow-sm",
        className
      )}
      data-testid={testId}
    >
      <header className="mb-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
      </header>
      {children}
    </article>
  );
}
