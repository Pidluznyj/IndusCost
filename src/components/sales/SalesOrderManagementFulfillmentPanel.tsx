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
import { FinanceBiKpiCard } from "@/src/components/finance/bi/FinanceBiKpiCard";
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

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

export function SalesOrderManagementFulfillmentKpis({
  kpis,
  loading,
}: {
  kpis: SalesOrderFulfillmentKpis | null;
  loading: boolean;
}) {
  const cards = [
    {
      key: "totalOrders",
      icon: FileText,
      label: "Total pedidos",
      value: kpis ? String(kpis.totalOrders) : "—",
      hint: "Pedidos únicos no filtro (sem duplicar por NF).",
    },
    {
      key: "totalSold",
      icon: DollarSign,
      label: "Valor vendido",
      value: kpis ? formatCurrency(kpis.totalSoldValue) : "—",
      hint: "Soma de totalNetValue dos pedidos.",
    },
    {
      key: "totalInvoiced",
      icon: Receipt,
      label: "Valor faturado (NF)",
      value: kpis ? formatCurrency(kpis.totalInvoicedValue) : "—",
      hint: "Soma das NF-es vinculadas.",
    },
    {
      key: "gap",
      icon: TrendingUp,
      label: "Gap vendido × faturado",
      value: kpis ? formatCurrency(kpis.soldInvoicedGap) : "—",
      hint: "Diferença entre vendido e faturado.",
    },
    {
      key: "withNfe",
      icon: CheckCircle2,
      label: "Com NF",
      value: kpis ? String(kpis.ordersWithNfe) : "—",
    },
    {
      key: "withoutNfe",
      icon: FileText,
      label: "Sem NF",
      value: kpis ? String(kpis.ordersWithoutNfe) : "—",
    },
    {
      key: "onTime",
      icon: CheckCircle2,
      label: "Entregues/faturados no prazo",
      value: kpis ? String(kpis.deliveredOnTime) : "—",
    },
    {
      key: "late",
      icon: AlertTriangle,
      label: "Entregues/faturados com atraso",
      value: kpis ? String(kpis.deliveredLate) : "—",
    },
    {
      key: "pendingOnTime",
      icon: Clock,
      label: "Pendentes no prazo",
      value: kpis ? String(kpis.pendingOnTime) : "—",
    },
    {
      key: "pendingLate",
      icon: AlertTriangle,
      label: "Pendentes atrasados",
      value: kpis ? String(kpis.pendingLate) : "—",
    },
    {
      key: "partial",
      icon: Percent,
      label: "Parciais",
      value: kpis ? String(kpis.partialCount) : "—",
    },
    {
      key: "cut",
      icon: AlertTriangle,
      label: "Com corte",
      value: kpis ? String(kpis.withCutCount) : "—",
    },
    {
      key: "review",
      icon: AlertTriangle,
      label: "Revisar dados",
      value: kpis ? String(kpis.needsReviewCount) : "—",
    },
    {
      key: "sla",
      icon: Clock,
      label: "SLA médio (dias)",
      value: kpis?.averageSlaDays != null ? kpis.averageSlaDays.toFixed(1) : "—",
      hint: "Média de dias entre emissão do pedido e NF.",
    },
    {
      key: "onTimePct",
      icon: Percent,
      label: "% no prazo",
      value: formatPct(kpis?.onTimePercent),
    },
    {
      key: "avgFulfillment",
      icon: Percent,
      label: "% atendimento médio",
      value: formatPct(kpis?.averageFulfilledPercent),
    },
    {
      key: "avgInvoiced",
      icon: Percent,
      label: "% faturamento médio",
      value: formatPct(kpis?.averageInvoicedPercent),
    },
  ];

  return (
    <div data-testid="sales-order-fulfillment-kpis">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Indicadores de fulfillment (NF-e)
      </p>
      <div className="indus-kpi-grid mt-2">
        {cards.map((card) => (
          <div key={card.key}>
            <FinanceBiKpiCard
              icon={card.icon}
              label={card.label}
              value={loading ? "—" : card.value}
              loading={loading}
              hint={card.hint}
            />
          </div>
        ))}
      </div>
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
