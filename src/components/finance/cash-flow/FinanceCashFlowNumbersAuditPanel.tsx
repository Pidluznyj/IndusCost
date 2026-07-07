import React, { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Clock, Shield } from "lucide-react";
import { AdminKpiSection } from "@/src/components/admin/adminUi";
import { MetricCard } from "@/src/components/ui/MetricCard";
import type { FinanceCashFlowAuditPayload } from "@/src/lib/financeCashFlowDataset";
import type { FinanceCashFlowReconciliation } from "@/src/lib/financeCashFlowDashboardTypes";
import type { FinanceDataSanitization } from "@/src/lib/financeInternalGroupExclusions";
import { fetchJsonOk } from "@/src/lib/http";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";
import { cn } from "@/src/lib/utils";

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"
      )}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {label}
    </span>
  );
}

type Props = {
  appliedQuery: string;
  active: boolean;
  dataSanitization?: FinanceDataSanitization;
  reconciliation: FinanceCashFlowReconciliation;
  lastSyncAt?: string | null;
};

export function FinanceCashFlowNumbersAuditPanel({
  appliedQuery,
  active,
  dataSanitization,
  reconciliation,
  lastSyncAt,
}: Props) {
  const [audit, setAudit] = useState<FinanceCashFlowAuditPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = appliedQuery
      ? `/api/finance/cash-flow/audit?${appliedQuery}`
      : "/api/finance/cash-flow/audit";
    void fetchJsonOk<FinanceCashFlowAuditPayload>(url)
      .then((data) => {
        if (!cancelled) setAudit(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Falha ao carregar auditoria.");
          setAudit(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, appliedQuery]);

  const timelineOk =
    reconciliation.receivable.matchesLedger &&
    reconciliation.payable.matchesLedger &&
    reconciliation.netMatchesLedger;

  const portfolioOk =
    reconciliation.receivable.matchesArOpen && reconciliation.payable.matchesApOpen;

  const apIntercompanyExcluded =
    dataSanitization != null
      ? (dataSanitization.ignoredInternalGroupPayables ?? 0) +
        (dataSanitization.ignoredPurchaseOrderAgendaPayables ?? 0)
      : audit?.exclusions.apIntercompanyOrPurchaseOrder;

  const syncLoadingValue = loading && !audit ? "…" : undefined;

  return (
    <div className="space-y-4" data-testid="cash-flow-numbers-audit-content">
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Qualidade dos dados e conferência técnica com Contas a Receber e Contas a Pagar. Os
        números da tela não mudam — esta seção só explica origem e exclusões.
      </p>

      <div className="flex flex-wrap gap-2">
        <StatusPill ok={timelineOk} label="Período × ledger" />
        <StatusPill ok={portfolioOk} label="Carteira × AR/AP" />
      </div>

      <AdminKpiSection
        title="Freshness e cutoff Nomus"
        eyebrow="Auditoria técnica · fluxo de caixa"
        minColumnWidth={180}
        testId="cash-flow-audit-sync-kpi"
      >
        <MetricCard
          label="Última sync (visão combinada)"
          value={lastSyncAt ? formatFinanceDateTime(lastSyncAt) : "—"}
          subtitle="Maior syncedAt entre CR e CP no recorte carregado"
          variant="info"
          icon={<Clock className="h-3.5 w-3.5" />}
        />
        <MetricCard
          label="Cutoff AR (Nomus)"
          value={
            syncLoadingValue ??
            (audit?.syncCutoffs.ar ? formatFinanceDateTime(audit.syncCutoffs.ar) : "—")
          }
          subtitle="Data-base da última sync de Contas a Receber"
          variant="neutral"
          loading={loading && !audit}
          icon={<Clock className="h-3.5 w-3.5" />}
        />
        <MetricCard
          label="Cutoff AP (Nomus)"
          value={
            syncLoadingValue ??
            (audit?.syncCutoffs.ap ? formatFinanceDateTime(audit.syncCutoffs.ap) : "—")
          }
          subtitle="Data-base da última sync de Contas a Pagar"
          variant="neutral"
          loading={loading && !audit}
          icon={<Clock className="h-3.5 w-3.5" />}
        />
      </AdminKpiSection>

      <AdminKpiSection
        title="Exclusões gerenciais"
        eyebrow="Escopo filtrado · saneamento AR/AP"
        minColumnWidth={160}
        testId="cash-flow-audit-exclusions-kpi"
      >
        <MetricCard
          label="AR stale"
          value={String(dataSanitization?.ignoredStaleReceivables ?? audit?.exclusions.arStale ?? "—")}
          variant="warning"
          icon={<Shield className="h-3.5 w-3.5" />}
        />
        <MetricCard
          label="AR vencido sem NF"
          value={String(
            dataSanitization?.ignoredOverdueWithoutFiscalDocumentReceivables ??
              audit?.exclusions.arOverdueWithoutFiscalDocument ??
              "—"
          )}
          variant="warning"
          icon={<Shield className="h-3.5 w-3.5" />}
        />
        <MetricCard
          label="AP stale"
          value={String(dataSanitization?.ignoredStalePayables ?? audit?.exclusions.apStale ?? "—")}
          variant="warning"
          icon={<Shield className="h-3.5 w-3.5" />}
        />
        <MetricCard
          label="AP intercompany / PC"
          value={String(apIntercompanyExcluded ?? "—")}
          subtitle="Intercompany e pedido de compra (type=2) na agenda gerencial"
          variant="neutral"
          icon={<Shield className="h-3.5 w-3.5" />}
        />
      </AdminKpiSection>

      {audit ? (
        <div className="text-[10px] text-muted-foreground space-y-1">
          <p>
            Portfólio carregado: {audit.counts.arPortfolio} CR · {audit.counts.apPortfolio} CP ·
            Período: {audit.counts.arPeriod} CR · {audit.counts.apPeriod} CP
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
