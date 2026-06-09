import React from "react";
import { Link } from "react-router-dom";
import type { BillingDashboardTab } from "@/src/lib/executiveDashboardTypes";
import type { FinanceBillingDashboardPayload } from "@/src/lib/financeBillingDashboardTypes";
import {
  formatExecutiveCompactCurrency,
  formatExecutiveCurrency,
  formatExecutiveInteger,
  formatExecutivePercent,
} from "@/src/lib/executiveDashboardFormatters";
import { getFinanceBillingYearColor } from "@/src/lib/financeBillingChartTheme";
import { FinanceBillingExecutiveCard } from "@/src/components/finance/billing/FinanceBillingExecutiveCard";
import { FinanceBillingSourceBadge } from "@/src/components/finance/billing/FinanceBillingSourceBadge";
import { FinanceBillingMonthlyComparisonChart } from "@/src/components/finance/billing/FinanceBillingMonthlyComparisonChart";
import { FinanceBillingAccumulatedChart } from "@/src/components/finance/billing/FinanceBillingAccumulatedChart";
import { FinanceBillingProjectionChart } from "@/src/components/finance/billing/FinanceBillingProjectionChart";
import { ExecutiveTargetPanel } from "@/src/components/dashboard/ExecutiveDashboardCharts";
import { FinanceFilterScopeNote } from "@/src/components/finance/FinanceFilterScopeBanner";
import {
  FINANCE_BILLING_EXECUTIVE_YEAR_SCOPE,
  FINANCE_BILLING_MULTI_YEAR_SCOPE,
  FINANCE_BILLING_PROJECTION_SCOPE,
  FINANCE_BILLING_RECENT_ORDERS_SCOPE,
  FINANCE_BILLING_YTD_SCOPE,
} from "@/src/lib/financeFilterScope";

/* ─── Visão Geral ─────────────────────────────────────────────── */
export function FinanceBillingOverviewView({
  data,
  loading,
}: {
  data: FinanceBillingDashboardPayload | null;
  loading: boolean;
}) {
  const tab = data?.tab;
  if (!tab?.available && !loading) {
    return (
      <p className="text-sm text-muted-foreground p-6">
        Sem dados de faturamento para o ano selecionado.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <FinanceBillingSourceBadge variant="official" />
        <FinanceFilterScopeNote className="flex-1">
          {FINANCE_BILLING_EXECUTIVE_YEAR_SCOPE}
        </FinanceFilterScopeNote>
        <p className="text-[11px] text-muted-foreground w-full">{tab?.marketBillingNote}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <FinanceBillingExecutiveCard
          label={`Faturamento ${data?.selectedYear ?? ""}`}
          value={formatExecutiveCompactCurrency(
            tab?.multiYearSummary.find((s) => s.year === data?.selectedYear)?.yearTotal
          )}
          sub="Total do ano (mercado)"
          loading={loading}
          colorClass="text-green-700 dark:text-green-400"
        />
        <FinanceBillingExecutiveCard
          label="Faturamento mês atual"
          value={formatExecutiveCompactCurrency(tab?.target.actual)}
          sub={tab?.periodLabel}
          loading={loading}
        />
        <FinanceBillingExecutiveCard
          label="Meta do mês (+30%)"
          value={formatExecutiveCompactCurrency(tab?.target.target)}
          sub={`Base: ${tab?.target.formatted.previousPeriod}`}
          loading={loading}
        />
        <FinanceBillingExecutiveCard
          label="% Atingimento meta"
          value={formatExecutivePercent(tab?.target.achievementPercent, 1)}
          sub={`Gap: ${tab?.target.formatted.gap}`}
          loading={loading}
          colorClass={
            (tab?.target.achievementPercent ?? 0) >= 100
              ? "text-green-700"
              : (tab?.target.achievementPercent ?? 0) >= 80
                ? "text-amber-600"
                : "text-red-600"
          }
        />
      </div>

      <FinanceFilterScopeNote>{FINANCE_BILLING_MULTI_YEAR_SCOPE}</FinanceFilterScopeNote>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {tab ? (
          <FinanceBillingMonthlyComparisonChart
            points={tab.multiYearMonthly}
            selectedYear={data?.selectedYear ?? new Date().getFullYear()}
          />
        ) : null}
        {tab ? (
          <FinanceBillingProjectionChart
            data={tab.realizedVsProjected}
            selectedYear={data?.selectedYear ?? new Date().getFullYear()}
          />
        ) : null}
      </div>

      {tab ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
            <h3 className="text-sm font-bold mb-3">Top clientes — mercado</h3>
            {tab.topCustomers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem faturamento no ano.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground text-left">
                    <th className="pb-2">Cliente</th>
                    <th className="pb-2">Pedidos</th>
                    <th className="pb-2">Faturamento</th>
                  </tr>
                </thead>
                <tbody>
                  {tab.topCustomers.slice(0, 5).map((r) => (
                    <tr key={r.customerId} className="border-b border-border/40">
                      <td className="py-2">{r.customerName}</td>
                      <td className="py-2">{formatExecutiveInteger(r.orderCount)}</td>
                      <td className="py-2">{formatExecutiveCurrency(r.totalNetValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
            <div className="flex justify-between mb-1">
              <h3 className="text-sm font-bold">Faturamentos recentes</h3>
              <Link to="/sales-orders" className="text-xs font-bold text-primary hover:underline">
                Ver pedidos
              </Link>
            </div>
            <FinanceFilterScopeNote className="mb-3">
              {FINANCE_BILLING_RECENT_ORDERS_SCOPE}
            </FinanceFilterScopeNote>
            {tab.recentInvoicedOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum faturamento recente.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground text-left">
                    <th className="pb-2">Pedido</th>
                    <th className="pb-2">Cliente</th>
                    <th className="pb-2">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {tab.recentInvoicedOrders.slice(0, 5).map((r) => (
                    <tr key={r.orderId} className="border-b border-border/40">
                      <td className="py-2 font-medium">{r.orderCode}</td>
                      <td className="py-2">{r.customerName}</td>
                      <td className="py-2">{formatExecutiveCurrency(r.totalNetValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

/* ─── Acumulado ───────────────────────────────────────────────── */
export function FinanceBillingAccumulatedView({
  data,
  loading,
}: {
  data: FinanceBillingDashboardPayload | null;
  loading: boolean;
}) {
  const tab = data?.tab;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <FinanceBillingSourceBadge variant="official" />
        <FinanceFilterScopeNote>{FINANCE_BILLING_YTD_SCOPE}</FinanceFilterScopeNote>
      </div>
      <FinanceFilterScopeNote>{FINANCE_BILLING_MULTI_YEAR_SCOPE}</FinanceFilterScopeNote>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {tab?.multiYearSummary.map((s) => (
          <div key={s.year}>
            <FinanceBillingExecutiveCard
              label={`Acumulado YTD ${s.year}`}
              value={formatExecutiveCompactCurrency(s.ytdTotal)}
              sub={`Total ano: ${formatExecutiveCompactCurrency(s.yearTotal)}`}
              loading={loading}
              hint={`Cor: ${getFinanceBillingYearColor(s.year)}`}
            />
          </div>
        ))}
        <FinanceBillingExecutiveCard
          label="Meta acumulada YTD"
          value={formatExecutiveCompactCurrency(
            tab?.accumulatedEvolution[tab.accumulatedEvolution.length - 1]?.accumulatedTarget
          )}
          sub="Ano anterior × 1,30 acumulado"
          loading={loading}
        />
      </div>
      {tab ? (
        <FinanceBillingAccumulatedChart series={tab.accumulatedEvolution} config={tab.chartSeries} />
      ) : null}
    </div>
  );
}

/* ─── Mês a Mês ───────────────────────────────────────────────── */
export function FinanceBillingMonthlyView({
  data,
  loading,
}: {
  data: FinanceBillingDashboardPayload | null;
  loading: boolean;
}) {
  const tab = data?.tab;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <FinanceBillingSourceBadge variant="official" />
        <FinanceFilterScopeNote>{FINANCE_BILLING_EXECUTIVE_YEAR_SCOPE}</FinanceFilterScopeNote>
      </div>
      <FinanceFilterScopeNote>{FINANCE_BILLING_MULTI_YEAR_SCOPE}</FinanceFilterScopeNote>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {tab?.multiYearSummary.map((s) => (
          <div key={s.year}>
            <FinanceBillingExecutiveCard
              label={`Mês atual ${s.year}`}
              value={formatExecutiveCompactCurrency(s.currentMonthValue)}
              sub={data?.periodLabel}
              loading={loading}
            />
          </div>
        ))}
        <FinanceBillingExecutiveCard
          label="% Meta mês"
          value={formatExecutivePercent(tab?.target.achievementPercent, 1)}
          sub={`Meta: ${tab?.target.formatted.target}`}
          loading={loading}
        />
      </div>
      {tab ? (
        <FinanceBillingMonthlyComparisonChart
          points={tab.multiYearMonthly}
          selectedYear={data?.selectedYear ?? new Date().getFullYear()}
        />
      ) : null}
    </div>
  );
}

/* ─── Projeção ────────────────────────────────────────────────── */
export function FinanceBillingProjectionView({
  data,
  loading,
}: {
  data: FinanceBillingDashboardPayload | null;
  loading: boolean;
}) {
  const tab = data?.tab;
  if (!tab) return null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <FinanceBillingSourceBadge variant="official" />
        <FinanceFilterScopeNote>{FINANCE_BILLING_PROJECTION_SCOPE}</FinanceFilterScopeNote>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <FinanceBillingExecutiveCard
          label="Média diária YTD"
          value={tab.projection.formatted.dailyAverage}
          sub={tab.projection.ytdDailyAverageHint}
          loading={loading}
        />
        <FinanceBillingExecutiveCard
          label="Faturado realizado"
          value={tab.realizedVsProjected.formatted.realized}
          sub="Mês corrente"
          loading={loading}
        />
        <FinanceBillingExecutiveCard
          label="Projeção do mês"
          value={tab.projection.formatted.projectedMonth}
          sub={`${tab.projection.workdaysInMonth} dias úteis`}
          loading={loading}
          colorClass="text-blue-700"
        />
        <FinanceBillingExecutiveCard
          label="Meta do ano"
          value={tab.yearComparison.formatted.annualTarget}
          sub={`Base: ${tab.yearComparison.formatted.previousYearTotal}`}
          loading={loading}
        />
        <FinanceBillingExecutiveCard
          label="Projeção anual"
          value={tab.projection.formatted.projectedYear}
          sub={`${tab.projection.workdaysInYear} dias úteis`}
          loading={loading}
          colorClass="text-blue-700"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <FinanceBillingProjectionChart
          data={tab.realizedVsProjected}
          selectedYear={data?.selectedYear ?? new Date().getFullYear()}
        />
        <ExecutiveTargetPanel title="Meta do mês — realizado vs ano anterior (+30%)" target={tab.target} />
      </div>

      <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
        <h3 className="text-sm font-bold mb-1">Comparativo anual YTD</h3>
        <FinanceFilterScopeNote className="mb-3">{FINANCE_BILLING_YTD_SCOPE}</FinanceFilterScopeNote>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "YTD ano atual", value: tab.yearComparison.formatted.yearToDateCurrent },
            { label: "YTD ano anterior", value: tab.yearComparison.formatted.yearToDatePrevious },
            { label: "Ano anterior (total)", value: tab.yearComparison.formatted.previousYearTotal },
            { label: "Meta anual (+30%)", value: tab.yearComparison.formatted.annualTarget },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-border/50 bg-background/50 p-3">
              <p className="text-[10px] font-bold uppercase text-muted-foreground">{item.label}</p>
              <p className="mt-1 text-lg font-black">{item.value}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
