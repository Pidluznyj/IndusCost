import React from "react";
import {
  Bar,
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
  Layers,
  PieChart,
  TrendingUp,
} from "lucide-react";
import type { FinanceCostCenterDashboardPayload } from "@/src/lib/financeCostCenterDashboard";
import { resolveCostCenterClassificationScopeLabel } from "@/src/lib/financeCostCenterAllocationMetrics";
import { formatFinanceCurrency, formatFinancePercent } from "@/src/lib/financeAccountsReceivableFormat";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";
import { FinanceKpiCard } from "@/src/components/finance/shared/FinanceKpiCard";
import { FinanceModuleEmptyState } from "@/src/components/finance/shared/FinanceModuleStates";
import {
  FinanceBillingChartShell,
  FINANCE_BILLING_CHART_HEIGHT,
} from "@/src/components/finance/billing/FinanceBillingChartShell";
import { FinanceCostCenterAnnualSpendingChart } from "@/src/components/finance/cost-centers/FinanceCostCenterAnnualSpendingChart";
import { resolveCostCenterDisplayName } from "@/src/lib/financeCostCenterAnnualSpendingChart";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

type Props = {
  data: FinanceCostCenterDashboardPayload | null;
  loading: boolean;
};

function monthLabel(year: number, month: number): string {
  return `${String(month).padStart(2, "0")}/${year}`;
}

export function FinanceCostCenterOverviewTab({ data, loading }: Props) {
  if (!loading && !data) {
    return (
      <FinanceModuleEmptyState
        title="Sem dados para exibir"
        description="Ajuste os filtros ou aguarde a sincronização de contas a pagar para montar a visão gerencial."
      />
    );
  }

  const summary = data?.summary;
  const diagnostics = data?.audit.diagnostics;
  const filtersApplied = data?.audit.filtersApplied;
  const scopeOpenOnly = diagnostics?.scopeUsed === "open_only";
  const scopeLabel = resolveCostCenterClassificationScopeLabel(
    filtersApplied?.status,
    diagnostics?.scopeUsed ?? "all_in_filter"
  );
  const byCostCenter = data?.byCostCenter ?? [];
  const unclassifiedTop = data?.unclassified.topUnclassifiedSuppliers ?? [];
  const monthly = data?.monthlySeries.totals ?? [];

  const ccChartData = byCostCenter.slice(0, 12).map((row) => ({
    name: resolveCostCenterDisplayName(row.name, row.code, row.costCenterId),
    amount: row.amount,
    code: row.code,
  }));

  const unclassifiedChartData = unclassifiedTop.slice(0, 8).map((row) => ({
    name: row.name.length > 18 ? `${row.name.slice(0, 18)}…` : row.name,
    amount: row.amount,
  }));

  const monthlyChartData = monthly.map((row) => ({
    name: monthLabel(row.year, row.month),
    classified: row.classifiedAmount,
    unclassified: row.unclassifiedAmount,
  }));

  return (
    <div className="space-y-6" data-testid="finance-cost-centers-overview-tab">
      <div
        className="rounded-xl border border-border/80 bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
        data-testid="finance-cost-centers-overview-scope-hint"
      >
        <p>
          <span className="font-medium text-foreground">Sem classificação</span> = títulos sem
          alocação completa no escopo filtrado (diferença real em centro de custo, tolerância de R$
          0,01).
          {scopeOpenOnly
            ? " O escopo atual considera apenas AP em aberto (saldo &gt; 0)."
            : " A classificação considera o escopo do filtro atual — com Status = Todos, inclui títulos pagos e em aberto."}
        </p>
        <p className="mt-1">
          <span className="font-medium text-foreground">Fornecedor sem regra</span> = cadastro sem
          regra automática ativa — não entra no valor financeiro de sem classificação quando o
          título já está alocado.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <FinanceKpiCard
          label={scopeLabel}
          value={formatFinanceKpiCurrency(summary?.totalAmount ?? 0)}
          icon={Layers}
          loading={loading}
        />
        <FinanceKpiCard
          label="Total classificado"
          value={formatFinanceKpiCurrency(summary?.classifiedAmount ?? 0)}
          icon={PieChart}
          loading={loading}
        />
        <FinanceKpiCard
          label="Total sem classificação"
          value={formatFinanceKpiCurrency(summary?.unclassifiedAmount ?? 0)}
          helperText="Títulos sem alocação completa no escopo filtrado."
          icon={TrendingUp}
          loading={loading}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <FinanceKpiCard
          label="Em aberto"
          value={formatFinanceKpiCurrency(summary?.openAmount ?? 0)}
          helperText="Indicador auxiliar — não define o escopo da classificação."
          loading={loading}
        />
        <FinanceKpiCard
          label="Vencido"
          value={formatFinanceKpiCurrency(summary?.overdueAmount ?? 0)}
          helperText="Indicador auxiliar no escopo filtrado."
          loading={loading}
        />
        <FinanceKpiCard
          label="Pago/liquidado"
          value={formatFinanceKpiCurrency(summary?.paidAmount ?? 0)}
          helperText="Indicador auxiliar no escopo filtrado."
          loading={loading}
        />
        <FinanceKpiCard
          label="% classificado"
          value={formatFinancePercent(summary?.classifiedPercentage ?? 0)}
          loading={loading}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <FinanceKpiCard
          label="Centros ativos"
          value={String(summary?.costCentersCount ?? 0)}
          loading={loading}
        />
        <FinanceKpiCard
          label="Fornecedores com regra"
          value={String(summary?.suppliersWithRules ?? 0)}
          loading={loading}
        />
        <FinanceKpiCard
          label="Fornecedores sem regra"
          value={String(summary?.suppliersWithoutRules ?? 0)}
          helperText="Cadastros ativos sem regra automática (contagem, não valor financeiro)."
          loading={loading}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <FinanceBillingChartShell
          title="AP por centro de custo"
          subtitle="Valores classificados no escopo do filtro aplicado."
          empty={ccChartData.length === 0}
        >
          <ResponsiveContainer width="100%" height={FINANCE_BILLING_CHART_HEIGHT}>
            <ComposedChart data={ccChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatFinanceCurrency(v)} width={90} />
              <Tooltip
                formatter={(v: number) => formatFinanceCurrency(v)}
                labelFormatter={(label, items) => {
                  const code = (items?.[0]?.payload as { code?: string } | undefined)?.code;
                  return code ? `${label} (${code})` : label;
                }}
              />
              <Bar dataKey="amount" name="Valor" fill="#1e3a5f" radius={[4, 4, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </FinanceBillingChartShell>

        <FinanceBillingChartShell
          title="Sem classificação por fornecedor"
          subtitle="Apenas o valor sem alocação real de centro de custo (não inclui fornecedor sem regra já classificado)."
          empty={unclassifiedChartData.length === 0}
        >
          <ResponsiveContainer width="100%" height={FINANCE_BILLING_CHART_HEIGHT}>
            <ComposedChart data={unclassifiedChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatFinanceCurrency(v)} width={90} />
              <Tooltip formatter={(v: number) => formatFinanceCurrency(v)} />
              <Bar dataKey="amount" name="Valor" fill="#b45309" radius={[4, 4, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </FinanceBillingChartShell>
      </div>

      <FinanceBillingChartShell
        title="Evolução mensal — classificado x sem classificação"
        subtitle="Totais por mês de vencimento dos títulos considerados."
        empty={monthlyChartData.length === 0}
      >
        <ResponsiveContainer width="100%" height={FINANCE_BILLING_CHART_HEIGHT}>
          <ComposedChart data={monthlyChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatFinanceCurrency(v)} width={90} />
            <Tooltip formatter={(v: number) => formatFinanceCurrency(v)} />
            <Legend />
            <Line type="monotone" dataKey="classified" name="Classificado" stroke="#1e3a5f" strokeWidth={2} />
            <Line type="monotone" dataKey="unclassified" name="Sem classificação" stroke="#b45309" strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
      </FinanceBillingChartShell>

      <FinanceCostCenterAnnualSpendingChart
        chart={data?.annualSpendingChart}
        loading={loading}
      />

      {summary && summary.totalAmount === 0 && !loading ? (
        <div className={cn(financeBiCardClass)}>
          <FinanceModuleEmptyState
            title="Nenhum título no filtro"
            description="Cadastre centros de custo e regras por fornecedor, ou amplie o período para ver a distribuição."
          />
        </div>
      ) : null}
    </div>
  );
}
