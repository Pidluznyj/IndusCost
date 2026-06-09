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
    <div className="rounded-2xl border border-border/70 bg-white dark:bg-card shadow-sm p-5 space-y-3 min-h-[300px] flex flex-col">
      <div>
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        {subtitle ? <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p> : null}
      </div>
      {empty ? (
        <p className="text-sm text-muted-foreground flex-1 flex items-center justify-center">
          Sem dados para exibir com os filtros atuais.
        </p>
      ) : (
        <div className="flex-1 min-h-[230px]">{children}</div>
      )}
    </div>
  );
}

/** Mapa de cores semânticas por bucket de aging */
const AGING_BUCKET_COLORS: Record<string, string> = {
  upcoming: "#22c55e",
  dueToday: "#f59e0b",
  overdue1to7: "#fb923c",
  overdue8to15: "#f97316",
  overdue16to30: "#ea580c",
  overdue31to60: "#ef4444",
  overdue61to90: "#dc2626",
  overdue90plus: "#991b1b",
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
      subtitle="Saldo em aberto por faixa — cores semânticas: verde a vencer, vermelho em atraso"
      empty={empty}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => formatFinanceCurrencyCompact(v)}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={130}
            tick={{ fontSize: 10, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const entry = payload[0];
              const d = data.find((x) => x.label === label);
              return (
                <div className="rounded-xl border border-border bg-white dark:bg-card shadow-lg p-3 text-xs min-w-[180px]">
                  <p className="font-bold text-foreground mb-1">{label}</p>
                  <p className="text-muted-foreground">
                    Valor:{" "}
                    <span className="font-bold text-foreground">
                      {formatFinanceCurrency(entry.value as number)}
                    </span>
                  </p>
                  {d ? (
                    <>
                      <p className="text-muted-foreground">
                        Títulos: <span className="font-bold text-foreground">{formatFinanceInteger(d.count)}</span>
                      </p>
                      <p className="text-muted-foreground">
                        % carteira:{" "}
                        <span className="font-bold text-foreground">{d.percent.toFixed(1)}%</span>
                      </p>
                    </>
                  ) : null}
                </div>
              );
            }}
          />
          <Bar dataKey="amount" name="Valor" radius={[0, 6, 6, 0]} maxBarSize={28}>
            {data.map((entry) => (
              <Cell
                key={entry.key}
                fill={AGING_BUCKET_COLORS[entry.key] ?? "#94a3b8"}
              />
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
  const top5 = (rows ?? []).slice(0, 5);
  const data = top5.map((r) => ({
    label: (r.personName ?? r.personCnpj ?? "Cliente").slice(0, 22),
    totalOpenAmount: r.totalOpenAmount,
    overdueAmount: r.overdueAmount,
    upcomingAmount: r.upcomingAmount,
    percentOfPortfolio: r.percentOfPortfolio,
  }));
  const empty = data.length === 0;

  return (
    <ChartCard
      title="Maior Exposição por Cliente (Top 5)"
      subtitle="Saldo em aberto e vencido por cliente — agrupado por CNPJ"
      empty={empty}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "#6b7280" }}
            interval={0}
            angle={-15}
            textAnchor="end"
            height={52}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => formatFinanceCurrencyCompact(v)}
            tick={{ fontSize: 11 }}
            width={72}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const d = data.find((x) => x.label === label);
              return (
                <div className="rounded-xl border border-border bg-white dark:bg-card shadow-lg p-3 text-xs min-w-[200px]">
                  <p className="font-bold text-foreground mb-1 truncate">{label}</p>
                  {payload.map((p) => (
                    <p key={String(p.dataKey)} className="text-muted-foreground">
                      {p.name}:{" "}
                      <span className="font-bold text-foreground">
                        {formatFinanceCurrency(p.value as number)}
                      </span>
                    </p>
                  ))}
                  {d ? (
                    <p className="text-muted-foreground mt-1">
                      % carteira:{" "}
                      <span className="font-bold text-foreground">
                        {d.percentOfPortfolio.toFixed(1)}%
                      </span>
                    </p>
                  ) : null}
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="totalOpenAmount" name="Em aberto" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40} />
          <Bar dataKey="overdueAmount" name="Vencido" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={40} />
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
