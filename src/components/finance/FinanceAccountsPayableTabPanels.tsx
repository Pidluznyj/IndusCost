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
} from "@/src/lib/financeAccountsPayableFormat";
import type { FinanceApDashboardPayload } from "@/src/lib/financeAccountsPayableDashboardTypes";
import {
  FinanceApAgingChart,
  FinanceApMonthlyScheduleChart,
  FinanceApPaymentMethodChart,
  FinanceApTopDebtorsChart,
} from "@/src/components/finance/FinanceAccountsPayableCharts";
import { ContextualDashboardKpiCard } from "@/src/components/contextual/ContextualDashboardKpiCard";
import {
  FinanceApLoadingBlock,
  FinanceApScrollableTable,
  FinanceApStickyTableHead,
} from "@/src/components/finance/FinanceAccountsPayableUiShared";

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

export function FinanceApKpiGrid({
  cards,
  loading,
}: {
  cards: FinanceApDashboardPayload["cards"] | undefined;
  loading: boolean;
}) {
  const topSupplierLabel = cards?.topSupplier
    ? `${cards.topSupplier.personName ?? "—"} (${formatFinanceCurrencyCompact(cards.topSupplier.totalOpenAmount)})`
    : "—";
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <Kpi label="Valor total a pagar" value={formatFinanceCurrencyCompact(cards?.totalPayableAmount)} hint="Soma valor original filtrado" loading={loading} />
      <Kpi label="Valor em aberto" value={formatFinanceCurrencyCompact(cards?.totalOpenAmount)} hint="Saldo a pagar > 0" loading={loading} />
      <Kpi label="Valor vencido" value={formatFinanceCurrencyCompact(cards?.overdueAmount)} hint="Vencimento anterior a hoje" loading={loading} />
      <Kpi label="Valor a vencer" value={formatFinanceCurrencyCompact(cards?.upcomingAmount)} hint="Vencimento futuro" loading={loading} />
      <Kpi label="Pago no mês" value={formatFinanceCurrencyCompact(cards?.paidThisMonthAmount)} hint="Pagamentos no mês corrente" loading={loading} />
      <Kpi label="Vencendo hoje" value={formatFinanceCurrencyCompact(cards?.dueTodayAmount)} hint="Vence no dia atual" loading={loading} />
      <Kpi label="Vencendo em 7 dias" value={formatFinanceCurrencyCompact(cards?.dueNext7DaysAmount)} hint="Hoje até +7 dias" loading={loading} />
      <Kpi label="Vencendo em 30 dias" value={formatFinanceCurrencyCompact(cards?.dueNext30DaysAmount)} hint="Hoje até +30 dias" loading={loading} />
      <Kpi label="Títulos em aberto" value={formatFinanceInteger(cards?.openTitlesCount)} hint="Saldo positivo" loading={loading} />
      <Kpi label="Fornecedores com atraso" value={formatFinanceInteger(cards?.overdueSuppliersCount)} hint="Fornecedores com título vencido" loading={loading} />
      <Kpi label="% atraso sobre carteira" value={formatFinancePercent(cards?.overduePercent)} hint="Vencido ÷ em aberto" loading={loading} />
      <Kpi label="Maior fornecedor credor" value={topSupplierLabel} hint="Maior saldo em aberto" loading={loading} />
    </div>
  );
}

function Kpi({ label, value, hint, loading }: { label: string; value: string; hint: string; loading: boolean }) {
  return <ContextualDashboardKpiCard label={label} value={loading ? "…" : value} hint={hint} />;
}

export function FinanceApOverviewTab({
  data,
  loading,
}: {
  data: FinanceApDashboardPayload | null;
  loading: boolean;
}) {
  if (!data && loading) return <FinanceApLoadingBlock label="visão geral" />;
  if (!data) return <TabEmpty message="Sem dados para visão geral." />;

  return (
    <div className="space-y-6">
      <FinanceApKpiGrid cards={data.cards} loading={loading} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <FinanceApAgingChart buckets={data.agingBuckets ?? []} />
        <FinanceApTopDebtorsChart rows={data.topSuppliers ?? []} />
        <FinanceApMonthlyScheduleChart rows={data.monthlyDueSchedule ?? []} />
        <FinanceApPaymentMethodChart rows={data.paymentMethodSummary ?? []} />
      </div>
      <CriticalTitlesSection rows={data.criticalTitles ?? []} />
    </div>
  );
}

export function FinanceApAgingTab({ data }: { data: FinanceApDashboardPayload | null }) {
  if (!data?.agingBuckets?.length) return <TabEmpty message="Nenhuma faixa de aging disponível." />;
  return (
    <div className="space-y-4">
      <FinanceApAgingChart buckets={data.agingBuckets} />
      <SimpleTable
        headers={["Faixa", "Valor", "Títulos", "Fornecedores", "% carteira"]}
        rows={data.agingBuckets.map((b) => [
          b.label,
          formatFinanceCurrency(b.amount),
          formatFinanceInteger(b.count),
          formatFinanceInteger(b.suppliersCount),
          formatFinancePercent(b.percentOfOpenAmount),
        ])}
      />
    </div>
  );
}

export function FinanceApScheduleTab({ data }: { data: FinanceApDashboardPayload | null }) {
  const buckets = data?.scheduleBuckets ?? [];
  const monthly = data?.monthlyDueSchedule ?? [];
  if (!buckets.length && !monthly.length) return <TabEmpty message="Sem agenda de recebimentos." />;

  return (
    <div className="space-y-6">
      <SimpleTable
        headers={["Período", "Valor previsto", "Títulos", "Fornecedores", "Principais fornecedores"]}
        rows={buckets.map((b) => [
          b.label,
          formatFinanceCurrency(b.amount),
          formatFinanceInteger(b.count),
          formatFinanceInteger(b.suppliersCount),
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

export function FinanceApSuppliersTab({ data }: { data: FinanceApDashboardPayload | null }) {
  const rows = data?.supplierRanking ?? [];
  if (!rows.length) return <TabEmpty message="Nenhum fornecedor em aberto na seleção." />;

  return (
    <SimpleTable
      headers={[
        "Fornecedor",
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

export function FinanceApPaymentTab({ data }: { data: FinanceApDashboardPayload | null }) {
  const rows = data?.paymentMethodSummary ?? [];
  if (!rows.length) return <TabEmpty message="Sem formas de pagamento na seleção." />;

  return (
    <div className="space-y-4">
      <FinanceApPaymentMethodChart rows={rows} />
      <SimpleTable
        headers={["Forma", "Em aberto", "Vencido", "Títulos", "Ticket médio", "% atraso"]}
        rows={rows.map((r) => [
          r.paymentMethodName,
          formatFinanceCurrency(r.openAmount),
          formatFinanceCurrency(r.overdueAmount),
          formatFinanceInteger(r.titlesCount),
          formatFinanceCurrency(r.averageTicket),
          formatFinancePercent(r.overduePercent),
        ])}
      />
    </div>
  );
}

export function FinanceApCompaniesTab({ data }: { data: FinanceApDashboardPayload | null }) {
  const rows = data?.companySummary ?? [];
  if (!rows.length) return <TabEmpty message="Sem empresas na seleção." />;

  return (
    <SimpleTable
      headers={[
        "Empresa",
        "Em aberto",
        "Vencido",
        "A vencer",
        "Pago mês",
        "Títulos",
        "Fornecedores",
        "% atraso",
      ]}
      rows={rows.map((r) => [
        r.companyName,
        formatFinanceCurrency(r.openAmount),
        formatFinanceCurrency(r.overdueAmount),
        formatFinanceCurrency(r.upcomingAmount),
        formatFinanceCurrency(r.paidThisMonthAmount),
        formatFinanceInteger(r.titlesCount),
        formatFinanceInteger(r.suppliersCount),
        formatFinancePercent(r.overduePercent),
      ])}
    />
  );
}

function CriticalTitlesSection({
  rows,
}: {
  rows: FinanceApDashboardPayload["criticalTitles"];
}) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">Nenhum título crítico.</p>;
  }
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-bold">Títulos críticos</h4>
      <FinanceApScrollableTable>
        <FinanceApStickyTableHead>
          <tr className="text-left text-[10px] font-bold uppercase text-muted-foreground">
            <th className="p-3">ID</th>
            <th className="p-3 min-w-[140px]">Fornecedor</th>
            <th className="p-3 whitespace-nowrap">Vencimento</th>
            <th className="p-3 text-right whitespace-nowrap">Saldo</th>
            <th className="p-3">Status</th>
            <th className="p-3 text-right">Dias</th>
          </tr>
        </FinanceApStickyTableHead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.externalId} className="border-b border-border/60 hover:bg-muted/20">
              <td className="p-3 font-mono text-xs">{row.externalId}</td>
              <td className="p-3">{displayFinanceText(row.personName)}</td>
              <td className="p-3 whitespace-nowrap">{formatFinanceDate(row.dueDate)}</td>
              <td className="p-3 text-right font-semibold tabular-nums whitespace-nowrap">
                {formatFinanceCurrency(row.balancePayable)}
              </td>
              <td className="p-3">
                <StatusBadge status={row.calculatedStatus} />
              </td>
              <td className="p-3 text-right tabular-nums">{formatFinanceDaysOverdue(row.daysOverdue)}</td>
            </tr>
          ))}
        </tbody>
      </FinanceApScrollableTable>
    </div>
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <FinanceApScrollableTable tableClassName="min-w-[640px]">
      <FinanceApStickyTableHead>
        <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {headers.map((h) => (
            <th key={h} className="p-3 whitespace-nowrap">
              {h}
            </th>
          ))}
        </tr>
      </FinanceApStickyTableHead>
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
    </FinanceApScrollableTable>
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
  if (status === true) return "Pago/Baixado (Nomus)";
  if (status === false) return "Em aberto (Nomus)";
  return "—";
}

export { formatFinanceDateTime };
