import React from "react";
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
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  Percent,
  Receipt,
  TrendingUp,
} from "lucide-react";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import type { MetricCardVariant } from "@/src/components/ui/MetricCard";
import {
  resolveFulfillmentKpiVariant,
  toFiniteMetricNumber,
} from "@/src/lib/salesOrderManagementMetricCards";
import type {
  SalesOrderFulfillmentCharts,
  SalesOrderFulfillmentKpis,
} from "@/src/lib/salesOrderManagementFulfillment";
import { formatCurrency } from "@/src/lib/utils";

function ChartCard({
  title,
  subtitle,
  children,
  empty,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  empty?: boolean;
}) {
  if (empty) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 min-h-[260px]">
        <h3 className="text-sm font-bold">{title}</h3>
        {subtitle ? <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p> : null}
        <p className="mt-8 text-sm text-muted-foreground text-center">Sem dados no filtro atual.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-card p-4 min-h-[260px] flex flex-col">
      <div>
        <h3 className="text-sm font-bold">{title}</h3>
        {subtitle ? <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p> : null}
      </div>
      <div className="flex-1 min-h-[200px] mt-2">{children}</div>
    </div>
  );
}

type FulfillmentCardConfig = {
  key: string;
  icon: React.ElementType;
  label: string;
  amount?: number | null;
  amountFormat?: "currency" | "number" | "percent";
  formattedValue?: string;
  hint?: string;
  variant?: MetricCardVariant;
};

function buildFulfillmentCards(kpis: SalesOrderFulfillmentKpis | null): FulfillmentCardConfig[] {
  const n = (value: number | null | undefined) => toFiniteMetricNumber(value);

  return [
    {
      key: "totalOrders",
      icon: FileText,
      label: "Total pedidos",
      amount: n(kpis?.totalOrders),
      amountFormat: "number",
      hint: "Pedidos únicos no filtro (sem duplicar por NF).",
    },
    {
      key: "totalSold",
      icon: DollarSign,
      label: "Valor vendido",
      amount: n(kpis?.totalSoldValue),
      amountFormat: "currency",
      hint: "Soma de totalNetValue dos pedidos.",
    },
    {
      key: "totalInvoiced",
      icon: Receipt,
      label: "Valor faturado (NF)",
      amount: n(kpis?.totalInvoicedValue),
      amountFormat: "currency",
      hint: "Soma das NF-es vinculadas.",
    },
    {
      key: "gap",
      icon: TrendingUp,
      label: "Gap vendido × faturado",
      amount: n(kpis?.soldInvoicedGap),
      amountFormat: "currency",
      hint: "Diferença entre vendido e faturado.",
    },
    {
      key: "withNfe",
      icon: CheckCircle2,
      label: "Com NF",
      amount: n(kpis?.ordersWithNfe),
      amountFormat: "number",
    },
    {
      key: "withoutNfe",
      icon: FileText,
      label: "Sem NF",
      amount: n(kpis?.ordersWithoutNfe),
      amountFormat: "number",
    },
    {
      key: "onTime",
      icon: CheckCircle2,
      label: "Entregues/faturados no prazo",
      amount: n(kpis?.deliveredOnTime),
      amountFormat: "number",
    },
    {
      key: "late",
      icon: AlertTriangle,
      label: "Entregues/faturados com atraso",
      amount: n(kpis?.deliveredLate),
      amountFormat: "number",
    },
    {
      key: "pendingOnTime",
      icon: Clock,
      label: "Pendentes no prazo",
      amount: n(kpis?.pendingOnTime),
      amountFormat: "number",
    },
    {
      key: "pendingLate",
      icon: AlertTriangle,
      label: "Pendentes atrasados",
      amount: n(kpis?.pendingLate),
      amountFormat: "number",
    },
    {
      key: "partial",
      icon: Percent,
      label: "Parciais",
      amount: n(kpis?.partialCount),
      amountFormat: "number",
    },
    {
      key: "cut",
      icon: AlertTriangle,
      label: "Com corte",
      amount: n(kpis?.withCutCount),
      amountFormat: "number",
    },
    {
      key: "review",
      icon: AlertTriangle,
      label: "Revisar dados",
      amount: n(kpis?.needsReviewCount),
      amountFormat: "number",
    },
    {
      key: "sla",
      icon: Clock,
      label: "SLA médio (dias)",
      formattedValue:
        kpis?.averageSlaDays != null && Number.isFinite(kpis.averageSlaDays)
          ? kpis.averageSlaDays.toFixed(1)
          : "—",
      hint: "Média de dias entre emissão do pedido e NF.",
    },
    {
      key: "onTimePct",
      icon: Percent,
      label: "% no prazo",
      amount: n(kpis?.onTimePercent),
      amountFormat: "percent",
    },
    {
      key: "avgFulfillment",
      icon: Percent,
      label: "% atendimento médio",
      amount: n(kpis?.averageFulfilledPercent),
      amountFormat: "percent",
    },
    {
      key: "avgInvoiced",
      icon: Percent,
      label: "% faturamento médio",
      amount: n(kpis?.averageInvoicedPercent),
      amountFormat: "percent",
    },
  ];
}

export function SalesOrderManagementFulfillmentKpis({
  kpis,
  loading,
}: {
  kpis: SalesOrderFulfillmentKpis | null;
  loading: boolean;
}) {
  const cards = buildFulfillmentCards(kpis);

  return (
    <div data-testid="sales-order-fulfillment-kpis">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Indicadores de fulfillment (NF-e)
      </p>
      <SummaryKpiGrid className="mt-2">
        {cards.map((card) => {
          const Icon = card.icon;
          const numericForVariant =
            card.amountFormat === "number" || card.amountFormat === "currency"
              ? card.amount ?? null
              : card.amount ?? null;
          const variant =
            card.variant ??
            resolveFulfillmentKpiVariant(card.key, numericForVariant);

          return (
            <MetricCard
              key={card.key}
              label={card.label}
              amount={card.amount}
              amountFormat={card.amountFormat}
              formattedValue={card.formattedValue}
              helperText={card.hint}
              variant={variant}
              icon={<Icon className="h-4 w-4" />}
              loading={loading}
            />
          );
        })}
      </SummaryKpiGrid>
    </div>
  );
}

export function SalesOrderManagementFulfillmentCharts({
  charts,
}: {
  charts: SalesOrderFulfillmentCharts | null;
}) {
  if (!charts) return null;

  const onTimeData = [
    { name: "No prazo", value: charts.onTimeVsLate.onTime },
    { name: "Atrasado", value: charts.onTimeVsLate.late },
    { name: "Pendente", value: charts.onTimeVsLate.pending },
    { name: "Revisar", value: charts.onTimeVsLate.review },
  ];

  return (
    <div className="space-y-4" data-testid="sales-order-fulfillment-charts">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Gráficos operacionais
      </p>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartCard
          title="Pedidos por status logístico"
          subtitle="Contagem por pedido (1 linha = 1 pedido)"
          empty={charts.ordersByLogisticStatus.length === 0}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={charts.ordersByLogisticStatus} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#2563eb" name="Pedidos" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Valor por status logístico"
          empty={charts.valueByLogisticStatus.length === 0}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={charts.valueByLogisticStatus} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tickFormatter={(v) => formatCurrency(v)} />
              <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Bar dataKey="value" fill="#059669" name="Valor" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="No prazo × atrasado" empty={onTimeData.every((d) => d.value === 0)}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={onTimeData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" fill="#6366f1" name="Pedidos" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="SLA médio por mês" empty={charts.slaByMonth.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={charts.slaByMonth}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="avgSlaDays" fill="#f59e0b" name="SLA médio (dias)" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Evolução vendido × faturado" empty={charts.soldVsInvoicedByMonth.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={charts.soldVsInvoicedByMonth}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={(v) => formatCurrency(v)} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Legend />
              <Bar dataKey="sold" fill="#2563eb" name="Vendido" />
              <Line type="monotone" dataKey="invoiced" stroke="#059669" name="Faturado" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Top clientes com atrasos" empty={charts.topLateCustomers.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={charts.topLateCustomers} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="label" width={100} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#dc2626" name="Pedidos atrasados" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}