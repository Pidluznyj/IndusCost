import React from "react";
import { cn } from "@/src/lib/utils";
import {
  displayFinanceText,
  formatFinanceCalculatedStatus,
  formatFinanceCurrency,
  formatFinanceCurrencyCompact,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceDaysOverdue,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import type { FinanceArDashboardPayload } from "@/src/lib/financeAccountsReceivableDashboardTypes";
import {
  FinanceArAgingChart,
  FinanceArMonthlyScheduleChart,
  FinanceArPaymentMethodChart,
  FinanceArTopDebtorsChart,
} from "@/src/components/finance/FinanceAccountsReceivableCharts";
import { ContextualDashboardKpiCard } from "@/src/components/contextual/ContextualDashboardKpiCard";
import {
  FinanceArLoadingBlock,
  FinanceArScrollableTable,
  FinanceArStickyTableHead,
} from "@/src/components/finance/FinanceAccountsReceivableUiShared";

export function statusBadgeClass(status: string): string {
  switch (status) {
    case "overdue":
      return "bg-red-100 text-red-900 border-red-200";
    case "dueToday":
      return "bg-amber-100 text-amber-900 border-amber-200";
    case "upcoming":
      return "bg-green-100 text-green-900 border-green-200";
    case "suspended":
      return "bg-orange-100 text-orange-900 border-orange-200";
    case "settled":
      return "bg-slate-100 text-slate-700 border-slate-200";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold",
        statusBadgeClass(status)
      )}
    >
      {formatFinanceCalculatedStatus(status)}
    </span>
  );
}

export function FinanceArKpiGrid({
  cards,
  loading,
}: {
  cards: FinanceArDashboardPayload["cards"] | undefined;
  loading: boolean;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <Kpi label="Valor em aberto" value={formatFinanceCurrencyCompact(cards?.totalOpenAmount)} hint="Soma balanceReceivable > 0" loading={loading} />
      <Kpi label="Valor vencido" value={formatFinanceCurrencyCompact(cards?.overdueAmount)} hint="Vencimento anterior a hoje" loading={loading} />
      <Kpi label="Valor a vencer" value={formatFinanceCurrencyCompact(cards?.upcomingAmount)} hint="Vencimento futuro" loading={loading} />
      <Kpi label="Recebido no mês" value={formatFinanceCurrencyCompact(cards?.receivedThisMonthAmount)} hint="Baixas no mês corrente" loading={loading} />
      <Kpi label="% inadimplência" value={formatFinancePercent(cards?.delinquencyRate)} hint="Vencido ÷ em aberto" loading={loading} />
      <Kpi label="Títulos em aberto" value={formatFinanceInteger(cards?.openTitlesCount)} hint="Saldo positivo" loading={loading} />
      <Kpi label="Clientes em atraso" value={formatFinanceInteger(cards?.overdueCustomersCount)} hint="Clientes com título vencido" loading={loading} />
      <Kpi label="Vencendo em 7 dias" value={formatFinanceCurrencyCompact(cards?.dueNext7DaysAmount)} hint="Hoje até +7 dias" loading={loading} />
      <Kpi label="Vencendo em 30 dias" value={formatFinanceCurrencyCompact(cards?.dueNext30DaysAmount)} hint="Hoje até +30 dias" loading={loading} />
    </div>
  );
}

function Kpi({ label, value, hint, loading }: { label: string; value: string; hint: string; loading: boolean }) {
  return <ContextualDashboardKpiCard label={label} value={loading ? "…" : value} hint={hint} />;
}

export function FinanceArOverviewTab({
  data,
  loading,
}: {
  data: FinanceArDashboardPayload | null;
  loading: boolean;
}) {
  if (!data && loading) return <FinanceArLoadingBlock label="visão geral" />;
  if (!data) return <TabEmpty message="Sem dados para visão geral." />;

  return (
    <div className="space-y-6">
      <FinanceArKpiGrid cards={data.cards} loading={loading} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <FinanceArAgingChart buckets={data.agingBuckets ?? []} />
        <FinanceArTopDebtorsChart rows={data.topDebtors ?? []} />
        <FinanceArMonthlyScheduleChart rows={data.monthlyDueSchedule ?? []} />
        <FinanceArPaymentMethodChart rows={data.paymentMethodSummary ?? []} />
      </div>
      <CriticalTitlesSection rows={data.criticalTitles ?? []} />
    </div>
  );
}

export function FinanceArAgingTab({ data }: { data: FinanceArDashboardPayload | null }) {
  if (!data?.agingBuckets?.length) return <TabEmpty message="Nenhuma faixa de aging disponível." />;
  return (
    <div className="space-y-4">
      <FinanceArAgingChart buckets={data.agingBuckets} />
      <SimpleTable
        headers={["Faixa", "Valor", "Títulos", "Clientes", "% carteira"]}
        rows={data.agingBuckets.map((b) => [
          b.label,
          formatFinanceCurrency(b.amount),
          formatFinanceInteger(b.count),
          formatFinanceInteger(b.customersCount),
          formatFinancePercent(b.percentOfOpenAmount),
        ])}
      />
    </div>
  );
}

export function FinanceArScheduleTab({ data }: { data: FinanceArDashboardPayload | null }) {
  const buckets = data?.scheduleBuckets ?? [];
  const monthly = data?.monthlyDueSchedule ?? [];
  if (!buckets.length && !monthly.length) return <TabEmpty message="Sem agenda de recebimentos." />;

  return (
    <div className="space-y-6">
      <SimpleTable
        headers={["Período", "Valor previsto", "Títulos", "Clientes", "Principais clientes"]}
        rows={buckets.map((b) => [
          b.label,
          formatFinanceCurrency(b.amount),
          formatFinanceInteger(b.count),
          formatFinanceInteger(b.customersCount),
          b.topClients
            .map((c) => `${displayFinanceText(c.personName)} (${formatFinanceCurrencyCompact(c.amount)})`)
            .join(" · ") || "—",
        ])}
      />
      <div>
        <h4 className="text-sm font-bold mb-2">Por mês de vencimento</h4>
        <SimpleTable
          headers={["Mês", "Em aberto", "Vencido", "A vencer", "Títulos"]}
          rows={monthly.map((m) => [
            `${String(m.month).padStart(2, "0")}/${m.year}`,
            formatFinanceCurrency(m.openAmount),
            formatFinanceCurrency(m.overdueAmount),
            formatFinanceCurrency(m.upcomingAmount),
            formatFinanceInteger(m.titlesCount),
          ])}
        />
      </div>
    </div>
  );
}

export function FinanceArCustomersTab({ data }: { data: FinanceArDashboardPayload | null }) {
  const rows = data?.customerRanking ?? [];
  if (!rows.length) return <TabEmpty message="Nenhum cliente em aberto na seleção." />;

  return (
    <SimpleTable
      headers={[
        "Cliente",
        "CNPJ",
        "Em aberto",
        "Vencido",
        "A vencer",
        "Títulos",
        "Mais antigo venc.",
        "Dias atraso",
        "% carteira",
        "Ação sugerida",
      ]}
      rows={rows.map((r) => [
        displayFinanceText(r.personName),
        displayFinanceText(r.personCnpj),
        formatFinanceCurrency(r.totalOpenAmount),
        formatFinanceCurrency(r.overdueAmount),
        formatFinanceCurrency(r.upcomingAmount),
        formatFinanceInteger(r.titlesCount),
        formatFinanceDate(r.oldestOverdueDate),
        formatFinanceDaysOverdue(r.maxDaysOverdue),
        formatFinancePercent(r.percentOfPortfolio),
        r.suggestedAction,
      ])}
    />
  );
}

export function FinanceArPaymentTab({ data }: { data: FinanceArDashboardPayload | null }) {
  const rows = data?.paymentMethodSummary ?? [];
  if (!rows.length) return <TabEmpty message="Sem formas de pagamento na seleção." />;

  return (
    <div className="space-y-4">
      <FinanceArPaymentMethodChart rows={rows} />
      <SimpleTable
        headers={["Forma", "Em aberto", "Vencido", "Títulos", "Ticket médio", "% inadimplência"]}
        rows={rows.map((r) => [
          r.paymentMethodName,
          formatFinanceCurrency(r.openAmount),
          formatFinanceCurrency(r.overdueAmount),
          formatFinanceInteger(r.titlesCount),
          formatFinanceCurrency(r.averageTicket),
          formatFinancePercent(r.delinquencyRate),
        ])}
      />
    </div>
  );
}

export function FinanceArCompaniesTab({ data }: { data: FinanceArDashboardPayload | null }) {
  const rows = data?.companySummary ?? [];
  if (!rows.length) return <TabEmpty message="Sem empresas na seleção." />;

  return (
    <SimpleTable
      headers={[
        "Empresa",
        "Em aberto",
        "Vencido",
        "A vencer",
        "Recebido mês",
        "Títulos",
        "Clientes",
        "% inadimplência",
      ]}
      rows={rows.map((r) => [
        r.companyName,
        formatFinanceCurrency(r.openAmount),
        formatFinanceCurrency(r.overdueAmount),
        formatFinanceCurrency(r.upcomingAmount),
        formatFinanceCurrency(r.receivedThisMonthAmount),
        formatFinanceInteger(r.titlesCount),
        formatFinanceInteger(r.customersCount),
        formatFinancePercent(r.delinquencyRate),
      ])}
    />
  );
}

function CriticalTitlesSection({
  rows,
}: {
  rows: FinanceArDashboardPayload["criticalTitles"];
}) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">Nenhum título crítico.</p>;
  }
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-bold">Títulos críticos</h4>
      <FinanceArScrollableTable>
        <FinanceArStickyTableHead>
          <tr className="text-left text-[10px] font-bold uppercase text-muted-foreground">
            <th className="p-3">ID</th>
            <th className="p-3 min-w-[140px]">Cliente</th>
            <th className="p-3 whitespace-nowrap">Vencimento</th>
            <th className="p-3 text-right whitespace-nowrap">Saldo</th>
            <th className="p-3">Status</th>
            <th className="p-3 text-right">Dias</th>
          </tr>
        </FinanceArStickyTableHead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.externalId} className="border-b border-border/60 hover:bg-muted/20">
              <td className="p-3 font-mono text-xs">{row.externalId}</td>
              <td className="p-3">{displayFinanceText(row.personName)}</td>
              <td className="p-3 whitespace-nowrap">{formatFinanceDate(row.dueDate)}</td>
              <td className="p-3 text-right font-semibold tabular-nums whitespace-nowrap">
                {formatFinanceCurrency(row.balanceReceivable)}
              </td>
              <td className="p-3">
                <StatusBadge status={row.calculatedStatus} />
              </td>
              <td className="p-3 text-right tabular-nums">{formatFinanceDaysOverdue(row.daysOverdue)}</td>
            </tr>
          ))}
        </tbody>
      </FinanceArScrollableTable>
    </div>
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <FinanceArScrollableTable tableClassName="min-w-[640px]">
      <FinanceArStickyTableHead>
        <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {headers.map((h) => (
            <th key={h} className="p-3 whitespace-nowrap">
              {h}
            </th>
          ))}
        </tr>
      </FinanceArStickyTableHead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={idx} className="border-b border-border/60 hover:bg-muted/20">
            {row.map((cell, cidx) => (
              <td key={cidx} className="p-3 align-top tabular-nums">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </FinanceArScrollableTable>
  );
}

export function TabLoading({ label }: { label: string }) {
  return <p className="text-sm text-muted-foreground py-6">Carregando {label}…</p>;
}

export function TabEmpty({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

export function formatNomusStatusLabel(status: boolean | null): string {
  if (status === true) return "Baixado (Nomus)";
  if (status === false) return "Em aberto (Nomus)";
  return "—";
}

export { formatFinanceDateTime };
