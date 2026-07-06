import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  FinanceArAgingBucket,
  FinanceArMonthlyDue,
  FinanceArPaymentSummary,
  FinanceArTopDebtor,
} from "@/src/lib/financeAccountsReceivableDashboardTypes";
import {
  formatFinanceCurrency,
  formatFinanceCurrencyCompact,
  formatFinanceInteger,
  formatFinanceMonthLabel,
} from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceBiEmptyState } from "@/src/components/finance/bi/FinanceBiEmptyState";

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
      <FinanceBiEmptyState
        title={title}
        description={subtitle ?? "Sem dados para exibir com os filtros aplicados."}
      />
    );
  }

  return (
    <div className={`${financeBiCardClass} p-5 space-y-3 min-h-[300px] flex flex-col`}>
      <div>
        <h3 className="text-sm font-bold text-[#111827]">{title}</h3>
        {subtitle ? <p className="text-[11px] text-[#6B7280] mt-0.5">{subtitle}</p> : null}
      </div>
      <div className="flex-1 min-h-[230px]">{children}</div>
    </div>
  );
}

/** Mapa de cores semânticas por bucket de aging */
const AGING_BUCKET_COLORS: Record<string, string> = {
  upcoming: "#059669",
  dueToday: "#D97706",
  overdue1to7: "#FB923C",
  overdue8to15: "#F97316",
  overdue16to30: "#EA580C",
  overdue31to60: "#DC2626",
  overdue61to90: "#B91C1C",
  overdue90plus: "#991B1B",
};

export function FinanceArAgingChart({ buckets }: { buckets: FinanceArAgingBucket[] }) {
  const data = (buckets ?? []).map((b) => ({
    key: b.key,
    label: b.label,
    amount: b.amount,
    count: b.count,
    percent: b.percentOfOpenAmount,
  }));
  const empty = data.every((d) => d.amount === 0 && d.count === 0);

  return (
    <ChartCard
      title="Distribuição de Vencimentos (Aging)"
      subtitle="Saldo em aberto por faixa de vencimento — filtros aplicados"
      empty={empty}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: "#6B7280" }}
            tickFormatter={(v: number) => formatFinanceCurrencyCompact(v)}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={130}
            tick={{ fontSize: 10, fill: "#6B7280" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(37,99,235,0.04)" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const entry = payload[0];
              const d = data.find((x) => x.label === label);
              return (
                <div className="rounded-lg border border-[#E5E7EB] bg-white p-3 text-xs min-w-[180px] shadow-none">
                  <p className="font-bold text-[#111827] mb-1">{label}</p>
                  <p className="text-[#6B7280]">
                    Valor:{" "}
                    <span className="font-bold text-[#111827]">
                      {formatFinanceCurrency(entry.value as number)}
                    </span>
                  </p>
                  {d ? (
                    <>
                      <p className="text-[#6B7280]">
                        Títulos:{" "}
                        <span className="font-bold text-[#111827]">{formatFinanceInteger(d.count)}</span>
                      </p>
                      <p className="text-[#6B7280]">
                        % carteira:{" "}
                        <span className="font-bold text-[#111827]">{d.percent.toFixed(1)}%</span>
                      </p>
                    </>
                  ) : null}
                </div>
              );
            }}
          />
          <Bar dataKey="amount" name="Valor" radius={[0, 4, 4, 0]} maxBarSize={24}>
            {data.map((entry) => (
              <Cell key={entry.key} fill={AGING_BUCKET_COLORS[entry.key] ?? "#94A3B8"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function FinanceArMonthlyScheduleChart({ rows }: { rows: FinanceArMonthlyDue[] }) {
  const data = (rows ?? []).map((r) => ({
    label: formatFinanceMonthLabel(r.year, r.month),
    overdue: r.overdueAmount,
    upcoming: r.upcomingAmount,
    openAmount: r.openAmount,
    titlesCount: r.titlesCount,
  }));
  const empty = data.length === 0;

  return (
    <ChartCard
      title="Agenda mensal de vencimentos"
      subtitle="Distribuição por mês de vencimento — filtros aplicados"
      empty={empty}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6B7280" }} />
          <YAxis
            tick={{ fontSize: 11, fill: "#6B7280" }}
            tickFormatter={(v) => formatFinanceCurrencyCompact(v)}
            width={72}
          />
          <Tooltip formatter={(value: number) => formatFinanceCurrency(value)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="overdue" name="Vencido" stackId="a" fill="#DC2626" />
          <Bar dataKey="upcoming" name="A vencer" stackId="a" fill="#059669" radius={[4, 4, 0, 0]} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function FinanceArTopDebtorsChart({ rows }: { rows: FinanceArTopDebtor[] }) {
  const top5 = (rows ?? []).slice(0, 5);
  const data = top5.map((r) => ({
    key: r.personCnpj ?? r.personName ?? "cliente",
    label: (r.personName ?? r.personCnpj ?? "Cliente").slice(0, 28),
    totalOpenAmount: r.totalOpenAmount,
    overdueAmount: r.overdueAmount,
    percentOfPortfolio: r.percentOfPortfolio,
  }));
  const empty = data.length === 0;
  const maxAmount = Math.max(...data.map((d) => d.totalOpenAmount), 1);

  return (
    <ChartCard
      title="Maior Exposição por Cliente (Top 5)"
      subtitle="Ranking horizontal por saldo em aberto — agrupado por CNPJ"
      empty={empty}
    >
      <div className="space-y-3 py-1">
        {data.map((d) => (
          <div key={d.key} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-semibold text-[#111827] truncate" title={d.label}>
                {d.label}
              </span>
              <span className="tabular-nums font-bold text-[#111827] shrink-0">
                {formatFinanceCurrencyCompact(d.totalOpenAmount)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-[#F3F4F6] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#2563EB]"
                style={{ width: `${Math.max(4, (d.totalOpenAmount / maxAmount) * 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-[#6B7280]">
              <span>Vencido: {formatFinanceCurrencyCompact(d.overdueAmount)}</span>
              <span>{d.percentOfPortfolio.toFixed(1)}% da carteira</span>
            </div>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

export function FinanceArPortfolioMixChart({
  openAmount,
  receivedAmount,
}: {
  openAmount: number;
  receivedAmount: number;
}) {
  const data = [
    { key: "open", label: "Em aberto", amount: openAmount, fill: "#2563EB" },
    { key: "received", label: "Recebido", amount: receivedAmount, fill: "#059669" },
  ];
  const empty = openAmount <= 0 && receivedAmount <= 0;

  return (
    <ChartCard
      title="Recebido x em aberto"
      subtitle="Totais do universo filtrado — valores originais e baixas"
      empty={empty}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6B7280" }} />
          <YAxis
            tick={{ fontSize: 11, fill: "#6B7280" }}
            tickFormatter={(v) => formatFinanceCurrencyCompact(v)}
            width={72}
          />
          <Tooltip formatter={(value: number) => formatFinanceCurrency(value)} />
          <Bar dataKey="amount" name="Valor" radius={[4, 4, 0, 0]} maxBarSize={48}>
            {data.map((entry) => (
              <Cell key={entry.key} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function FinanceArScheduleBucketsChart({
  buckets,
}: {
  buckets: Array<{ label: string; amount: number; count: number }>;
}) {
  const data = (buckets ?? []).map((b) => ({
    label: b.label,
    amount: b.amount,
    count: b.count,
  }));
  const empty = data.every((d) => d.amount === 0);

  return (
    <ChartCard
      title="Previsão próximos dias"
      subtitle="Agenda de recebimentos por janela — filtros aplicados"
      empty={empty}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#6B7280" }} />
          <YAxis
            tick={{ fontSize: 11, fill: "#6B7280" }}
            tickFormatter={(v) => formatFinanceCurrencyCompact(v)}
            width={72}
          />
          <Tooltip formatter={(value: number) => formatFinanceCurrency(value)} />
          <Bar dataKey="amount" name="Valor previsto" fill="#2563EB" radius={[4, 4, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function FinanceArPaymentMethodChart({ rows }: { rows: FinanceArPaymentSummary[] }) {
  const data = (rows ?? []).slice(0, 8).map((r) => ({
    label: (r.paymentMethodName?.trim() || "Sem forma").slice(0, 20),
    openAmount: r.openAmount,
    overdueAmount: r.overdueAmount,
    titlesCount: r.titlesCount,
  }));
  const empty = data.length === 0;

  return (
    <ChartCard
      title="Resumo por forma de pagamento"
      subtitle="Saldo em aberto e vencido — filtros aplicados"
      empty={empty}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
          <XAxis
            type="number"
            tickFormatter={(v: number) => formatFinanceCurrencyCompact(v)}
            tick={{ fontSize: 11, fill: "#6B7280" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={100}
            tick={{ fontSize: 10, fill: "#6B7280" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip formatter={(value: number) => formatFinanceCurrency(value)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="openAmount" name="Em aberto" fill="#2563EB" radius={[0, 4, 4, 0]} maxBarSize={20} />
          <Bar dataKey="overdueAmount" name="Vencido" fill="#DC2626" radius={[0, 4, 4, 0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
