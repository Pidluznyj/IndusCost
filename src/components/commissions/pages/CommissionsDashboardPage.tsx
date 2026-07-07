import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Calculator,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiButtonAccentClass, financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceKpiCard } from "@/src/components/finance/shared/FinanceKpiCard";
import { COMMISSIONS_RECALCULATE_PERMISSIONS } from "@/src/lib/commissionsPermissions";
import { getCommissionsSectionPath } from "@/src/lib/commissionsNavigation";
import {
  CommissionsErrorBanner,
  CommissionsEmptyState,
  CommissionsKpiSection,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import { CommissionsDashboardCharts } from "@/src/components/commissions/dashboard/CommissionsDashboardCharts";
import { CommissionsDashboardFiltersPanel } from "@/src/components/commissions/dashboard/CommissionsDashboardFiltersPanel";
import {
  buildPendingByDueDateBuckets,
  filterUpcomingReleases,
} from "@/src/components/commissions/dashboard/commissionsDashboardLabels";
import {
  EMPTY_COMMISSIONS_DASHBOARD_FILTERS,
  resolveCommissionsRecalculatePeriod,
  type CommissionsDashboardFilters,
} from "@/src/components/commissions/dashboard/commissionsDashboardFilters";
import { useCommissionsDashboardData } from "@/src/components/commissions/dashboard/useCommissionsDashboardData";

function formatDueDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
}

export function CommissionsDashboardPage() {
  const auth = useAuth();
  const canRecalculate = auth.hasAnyPermission([...COMMISSIONS_RECALCULATE_PERMISSIONS]);

  const [draftFilters, setDraftFilters] = useState<CommissionsDashboardFilters>(
    EMPTY_COMMISSIONS_DASHBOARD_FILTERS
  );
  const [appliedFilters, setAppliedFilters] = useState<CommissionsDashboardFilters>(
    EMPTY_COMMISSIONS_DASHBOARD_FILTERS
  );
  const [recalculating, setRecalculating] = useState(false);
  const [recalculateError, setRecalculateError] = useState<string | null>(null);

  const { data, loading, error, reload } = useCommissionsDashboardData(appliedFilters);

  const dashboard = data.dashboard;
  const releases = data.releases?.items ?? [];
  const criticalIssues = data.criticalAudit?.items ?? [];

  const pendingBuckets = useMemo(
    () => buildPendingByDueDateBuckets(releases),
    [releases]
  );
  const upcomingReleases = useMemo(() => filterUpcomingReleases(releases, 8), [releases]);

  async function handleRecalculate() {
    if (!canRecalculate) return;
    const period = resolveCommissionsRecalculatePeriod(appliedFilters);
    const ok = window.confirm(
      `Recalcular comissões de ${period.from} até ${period.to}?\n\nEsta operação pode levar alguns minutos.`
    );
    if (!ok) return;

    setRecalculating(true);
    setRecalculateError(null);
    try {
      await fetchJsonOk("/api/commissions/recalculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: period.from,
          to: period.to,
          mode: "FULL_RECALC",
        }),
      });
      await reload();
    } catch (e: unknown) {
      setRecalculateError(
        formatCommissionsApiError(e, "Não foi possível recalcular as comissões do período.")
      );
    } finally {
      setRecalculating(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="commissions-dashboard-page">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
            Visão executiva
          </p>
          <h3 className="text-xl font-extrabold tracking-tight text-[#111827]">
            Dashboard Gerencial
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-[#6B7280]">
            Comissão por item → NF/pedido → títulos do Contas a Receber → liberação pela baixa real.
            KPIs YTD consumidos da API oficial — sem cálculo no frontend.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {canRecalculate ? (
            <button
              type="button"
              disabled={recalculating || loading}
              onClick={() => void handleRecalculate()}
              className={financeBiButtonAccentClass}
              data-testid="commissions-recalculate-btn"
            >
              {recalculating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Recalcular período
            </button>
          ) : null}
        </div>
      </div>

      <CommissionsDashboardFiltersPanel
        filters={draftFilters}
        onChange={setDraftFilters}
        onApply={() => setAppliedFilters({ ...draftFilters })}
        disabled={loading || recalculating}
      />

      {recalculateError ? (
        <CommissionsErrorBanner
          message={recalculateError}
          onDismiss={() => setRecalculateError(null)}
        />
      ) : null}

      {error ? (
        <CommissionsErrorBanner message={error} onRetry={() => void reload()} />
      ) : null}

      {dashboard?.ytd ? (
        <CommissionsKpiSection
          title={`Resumo YTD ${dashboard.ytd.year}`}
          eyebrow="Indicadores acumulados no ano"
          testId="commissions-dashboard-ytd-kpi"
        >
          <FinanceKpiCard
              label="Comissão gerada no ano"
              value=""
              amount={dashboard.ytd.generatedYtd}
              amountFormat="currency"
              icon={Calculator}
              tone="info"
              loading={loading}
            />
            <FinanceKpiCard
              label="Comissão liberada no ano"
              value=""
              amount={dashboard.ytd.releasedYtd}
              amountFormat="currency"
              icon={Wallet}
              tone="success"
              loading={loading}
            />
            <FinanceKpiCard
              label="Comissão liberada no mês"
              value=""
              amount={dashboard.ytd.payableInMonth}
              amountFormat="currency"
              icon={Banknote}
              tone="neutral"
              loading={loading}
            />
            <FinanceKpiCard
              label="Comissão futura"
              value=""
              amount={dashboard.ytd.futureCommission}
              amountFormat="currency"
              icon={Clock}
              tone="warning"
              loading={loading}
            />
            <FinanceKpiCard
              label="Comissão atrasada (inadimplência)"
              value=""
              amount={dashboard.ytd.overdueCommission}
              amountFormat="currency"
              icon={AlertTriangle}
              tone="danger"
              loading={loading}
            />
            <FinanceKpiCard
              label="% médio de comissão"
              value={`${dashboard.ytd.averageRatePercent.toFixed(2)}%`}
              amount={dashboard.ytd.commissionableBaseYtd}
              amountFormat="currency"
              icon={TrendingUp}
              tone="neutral"
              loading={loading}
            />
        </CommissionsKpiSection>
      ) : null}

      <CommissionsKpiSection
        title="Resumo das comissões"
        eyebrow="Indicadores do período filtrado"
        testId="commissions-dashboard-kpi"
      >
        <FinanceKpiCard
          label="Comissão prevista"
          value=""
          amount={dashboard?.cards.forecastAmount ?? 0}
          amountFormat="currency"
          icon={TrendingUp}
          tone="info"
          loading={loading}
        />
        <FinanceKpiCard
          label="Comissão confirmada"
          value=""
          amount={dashboard?.cards.confirmedAmount ?? 0}
          amountFormat="currency"
          icon={CheckCircle2}
          tone="success"
          loading={loading}
        />
        <FinanceKpiCard
          label="Aguardando NF-e"
          value=""
          amount={dashboard?.cards.waitingNfeAmount ?? 0}
          amountFormat="currency"
          icon={Clock}
          tone="warning"
          loading={loading}
        />
        <FinanceKpiCard
          label="Aguardando recebimento"
          value=""
          amount={dashboard?.cards.waitingReceivableAmount ?? 0}
          amountFormat="currency"
          icon={Clock}
          tone="warning"
          loading={loading}
        />
        <FinanceKpiCard
          label="Comissão liberada"
          value=""
          amount={dashboard?.cards.releasedAmount ?? 0}
          amountFormat="currency"
          icon={Wallet}
          tone="info"
          loading={loading}
        />
        <FinanceKpiCard
          label="Comissão paga"
          value=""
          amount={dashboard?.cards.paidAmount ?? 0}
          amountFormat="currency"
          icon={Banknote}
          tone="success"
          loading={loading}
        />
        <FinanceKpiCard
          label="Saldo a pagar"
          value=""
          amount={dashboard?.cards.balanceToPayAmount ?? 0}
          amountFormat="currency"
          icon={Calculator}
          tone="neutral"
          loading={loading}
        />
        <FinanceKpiCard
          label="Divergências críticas"
          value={String(dashboard?.cards.criticalDivergencesCount ?? 0)}
          icon={ShieldAlert}
          tone={
            (dashboard?.cards.criticalDivergencesCount ?? 0) > 0 ? "danger" : "neutral"
          }
          helperText={
            dashboard
              ? `${dashboard.auditSummary.unresolved} issue(s) em aberto no total`
              : undefined
          }
          loading={loading}
        />
      </CommissionsKpiSection>

      <div className="flex flex-wrap gap-2">
        {[
          { label: "Comissão Gerada", to: getCommissionsSectionPath("generated") },
          { label: "A Pagar", to: getCommissionsSectionPath("payable") },
          { label: "Futuras", to: getCommissionsSectionPath("future") },
          { label: "Atrasadas", to: getCommissionsSectionPath("overdue") },
          { label: "Auditoria", to: getCommissionsSectionPath("audit") },
        ].map((action) => (
          <Link key={action.to} to={action.to} className={financeBiButtonOutlineClass}>
            {action.label}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ))}
      </div>

      {!loading && dashboard && dashboard.cards.criticalDivergencesCount > 0 ? (
        <div
          className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3"
          data-testid="commissions-critical-alert"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-700 mt-0.5" />
              <div>
                <p className="font-semibold text-red-900">
                  {dashboard.cards.criticalDivergencesCount} divergência(s) crítica(s) em aberto
                </p>
                <p className="text-sm text-red-800 mt-1">
                  Revise os apontamentos de auditoria para corrigir inconsistências no cálculo ou
                  liberação.
                </p>
              </div>
            </div>
            <Link
              to={getCommissionsSectionPath("audit")}
              className="inline-flex items-center gap-1 text-sm font-semibold text-red-900 underline"
            >
              Ir para Auditoria
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          {criticalIssues.length > 0 ? (
            <ul className="space-y-2 text-sm text-red-900">
              {criticalIssues.map((issue) => (
                <li key={issue.id} className="rounded-lg bg-white/70 px-3 py-2 border border-red-100">
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {!loading && dashboard ? (
        <>
          <CommissionsDashboardCharts
            dashboard={dashboard}
            pendingBuckets={pendingBuckets}
            loading={loading}
          />

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-bold text-[#111827]">Próximas liberações</h3>
              <p className="text-xs text-[#6B7280]">
                Parcelas futuras com saldo de comissão ainda não liberado.
              </p>
            </div>
            {upcomingReleases.length === 0 ? (
              <CommissionsEmptyState
                title="Nenhuma liberação futura"
                description="Não há parcelas com vencimento futuro e saldo pendente de liberação."
                testId="commissions-upcoming-releases-empty"
              />
            ) : (
              <CommissionsTableScroll>
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Pessoa</th>
                    <th className="px-3 py-2 text-left font-medium">Pedido</th>
                    <th className="px-3 py-2 text-left font-medium">Vencimento</th>
                    <th className="px-3 py-2 text-right font-medium">Saldo a liberar</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {upcomingReleases.map((row) => (
                    <tr key={row.scheduleId}>
                      <td className="px-3 py-2">{row.commissionPersonName}</td>
                      <td className="px-3 py-2">{row.orderCode ?? "—"}</td>
                      <td className="px-3 py-2">{formatDueDate(row.dueDate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatFinanceCurrency(row.balanceToRelease)}
                      </td>
                      <td className="px-3 py-2">{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </CommissionsTableScroll>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
