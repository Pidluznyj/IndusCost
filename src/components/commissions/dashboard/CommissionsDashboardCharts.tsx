import React, { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FinanceBillingChartShell } from "@/src/components/finance/billing/FinanceBillingChartShell";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import type { CommissionsDashboardPayload } from "@/src/components/commissions/commissionsTypes";
import {
  buildPendingByDueDateBuckets,
  formatCommissionStatus,
  formatMonthYearLabel,
  type PendingDueBucket,
} from "@/src/components/commissions/dashboard/commissionsDashboardLabels";

const CHART_COLORS = {
  forecast: "#2563EB",
  confirmed: "#059669",
  released: "#D97706",
  paid: "#7C3AED",
  person: "#2563EB",
  status: "#6366F1",
  customer: "#0EA5E9",
  pending: "#DC2626",
};

function ChartTooltipCurrency({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs shadow-sm">
      {label ? <p className="mb-1 font-semibold text-[#111827]">{label}</p> : null}
      {payload.map((entry) => (
        <p key={entry.name} style={{ color: entry.color }} className="tabular-nums">
          {entry.name}: {formatFinanceCurrency(entry.value ?? 0)}
        </p>
      ))}
    </div>
  );
}

type Props = {
  dashboard: CommissionsDashboardPayload;
  pendingBuckets: PendingDueBucket[];
  loading?: boolean;
};

export function CommissionsDashboardCharts({ dashboard, pendingBuckets, loading }: Props) {
  const monthlyChartData = useMemo(
    () =>
      dashboard.monthlySeries.map((row) => ({
        name: formatMonthYearLabel(row.year, row.month),
        Prevista: row.forecastAmount,
        Confirmada: row.confirmedAmount,
        Liberada: row.releasedAmount ?? 0,
        Paga: row.paidAmount,
      })),
    [dashboard.monthlySeries]
  );

  const byPersonChartData = useMemo(
    () =>
      dashboard.byPerson.slice(0, 10).map((row) => ({
        name: row.personName.length > 22 ? `${row.personName.slice(0, 22)}…` : row.personName,
        fullName: row.personName,
        Comissão: row.commissionAmount,
      })),
    [dashboard.byPerson]
  );

  const byStatusChartData = useMemo(
    () =>
      dashboard.byStatus.map((row) => ({
        name: formatCommissionStatus(row.status),
        Comissão: row.commissionAmount,
      })),
    [dashboard.byStatus]
  );

  const topCustomersChartData = useMemo(
    () =>
      dashboard.topCustomers.map((row) => ({
        name: (row.customerName ?? "—").length > 20
          ? `${(row.customerName ?? "—").slice(0, 20)}…`
          : (row.customerName ?? "—"),
        fullName: row.customerName ?? "—",
        Comissão: row.commissionAmount,
      })),
    [dashboard.topCustomers]
  );

  const pendingChartData = useMemo(
    () =>
      pendingBuckets.map((b) => ({
        name: b.label,
        Pendente: b.amount,
      })),
    [pendingBuckets]
  );

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <FinanceBillingChartShell
        title="Prevista × Confirmada × Liberada × Paga"
        subtitle="Evolução mensal no período filtrado."
        empty={!loading && monthlyChartData.length === 0}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={monthlyChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatFinanceCurrency(Number(v))} />
            <Tooltip content={<ChartTooltipCurrency />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="Prevista" stroke={CHART_COLORS.forecast} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Confirmada" stroke={CHART_COLORS.confirmed} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Liberada" stroke={CHART_COLORS.released} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Paga" stroke={CHART_COLORS.paid} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </FinanceBillingChartShell>

      <FinanceBillingChartShell
        title="Comissão por pessoa"
        subtitle="Top comissionados no período."
        empty={!loading && byPersonChartData.length === 0}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={byPersonChartData} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => formatFinanceCurrency(Number(v))} />
            <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const row = payload[0].payload as { fullName?: string; Comissão?: number };
                return (
                  <div className="rounded-lg border bg-white px-3 py-2 text-xs shadow-sm">
                    <p className="font-semibold">{row.fullName}</p>
                    <p>{formatFinanceCurrency(row.Comissão ?? 0)}</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="Comissão" fill={CHART_COLORS.person} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </FinanceBillingChartShell>

      <FinanceBillingChartShell
        title="Comissão por status"
        subtitle="Distribuição por estágio do ciclo."
        empty={!loading && byStatusChartData.length === 0}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={byStatusChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={70} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatFinanceCurrency(Number(v))} />
            <Tooltip content={<ChartTooltipCurrency />} />
            <Bar dataKey="Comissão" fill={CHART_COLORS.status} radius={[4, 4, 0, 0]}>
              {byStatusChartData.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS.status} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </FinanceBillingChartShell>

      <FinanceBillingChartShell
        title="Top clientes por comissão"
        subtitle="Maiores volumes no período filtrado."
        empty={!loading && topCustomersChartData.length === 0}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={topCustomersChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={64} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatFinanceCurrency(Number(v))} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const row = payload[0].payload as { fullName?: string; Comissão?: number };
                return (
                  <div className="rounded-lg border bg-white px-3 py-2 text-xs shadow-sm">
                    <p className="font-semibold">{row.fullName}</p>
                    <p>{formatFinanceCurrency(row.Comissão ?? 0)}</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="Comissão" fill={CHART_COLORS.customer} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </FinanceBillingChartShell>

      <div className="xl:col-span-2">
        <FinanceBillingChartShell
          title="Comissão pendente por vencimento"
          subtitle="Saldo a liberar agrupado por faixa de vencimento da parcela."
          empty={!loading && pendingChartData.length === 0}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pendingChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatFinanceCurrency(Number(v))} />
              <Tooltip content={<ChartTooltipCurrency />} />
              <Bar dataKey="Pendente" fill={CHART_COLORS.pending} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </FinanceBillingChartShell>
      </div>
    </div>
  );
}
