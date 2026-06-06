import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4 space-y-3 min-h-[280px] flex flex-col">
      <div>
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        {subtitle ? <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p> : null}
      </div>
      {empty ? (
        <p className="text-sm text-muted-foreground flex-1 flex items-center justify-center">
          Sem dados para exibir com os filtros atuais.
        </p>
      ) : (
        <div className="flex-1 min-h-[220px]">{children}</div>
      )}
    </div>
  );
}

export function FinanceArAgingChart({ buckets }: { buckets: FinanceArAgingBucket[] }) {
  const data = (buckets ?? []).map((b) => ({
    label: b.label,
    amount: b.amount,
    count: b.count,
  }));
  const empty = data.every((d) => d.amount === 0 && d.count === 0);

  return (
    <ChartCard title="Aging de recebíveis" subtitle="Saldo em aberto por faixa de vencimento" empty={empty}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10 }}
            interval={0}
            angle={-25}
            textAnchor="end"
            height={60}
          />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatFinanceCurrencyCompact(v)} width={72} />
          <Tooltip
            formatter={(value: number, name: string) =>
              name === "amount" ? formatFinanceCurrency(value) : formatFinanceInteger(value)
            }
            labelFormatter={(label) => String(label)}
          />
          <Bar dataKey="amount" name="Valor" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
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
    <ChartCard title="Agenda mensal de vencimentos" subtitle="Distribuição por mês de vencimento" empty={empty}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatFinanceCurrencyCompact(v)} width={72} />
          <Tooltip formatter={(value: number) => formatFinanceCurrency(value)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="overdue" name="Vencido" stackId="a" fill="#ef4444" />
          <Bar dataKey="upcoming" name="A vencer" stackId="a" fill="#22c55e" radius={[4, 4, 0, 0]} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function FinanceArTopDebtorsChart({ rows }: { rows: FinanceArTopDebtor[] }) {
  const data = (rows ?? []).slice(0, 10).map((r) => ({
    label: (r.personName ?? r.personCnpj ?? "Cliente").slice(0, 24),
    totalOpenAmount: r.totalOpenAmount,
    overdueAmount: r.overdueAmount,
  }));
  const empty = data.length === 0;

  return (
    <ChartCard title="Top 10 clientes devedores" subtitle="Ranking por saldo em aberto" empty={empty}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
          <XAxis type="number" tickFormatter={(v) => formatFinanceCurrencyCompact(v)} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 10 }} />
          <Tooltip formatter={(value: number) => formatFinanceCurrency(value)} />
          <Bar dataKey="totalOpenAmount" name="Em aberto" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
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
    <ChartCard title="Resumo por forma de pagamento" subtitle="Saldo em aberto e vencido" empty={empty}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={56} />
          <YAxis tickFormatter={(v) => formatFinanceCurrencyCompact(v)} tick={{ fontSize: 11 }} width={72} />
          <Tooltip formatter={(value: number) => formatFinanceCurrency(value)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="openAmount" name="Em aberto" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          <Bar dataKey="overdueAmount" name="Vencido" fill="#ef4444" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
