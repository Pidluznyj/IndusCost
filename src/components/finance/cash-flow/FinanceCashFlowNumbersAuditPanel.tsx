import React, { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import type { FinanceCashFlowAuditPayload } from "@/src/lib/financeCashFlowDataset";
import type { FinanceCashFlowReconciliation } from "@/src/lib/financeCashFlowDashboardTypes";
import type { FinanceDataSanitization } from "@/src/lib/financeInternalGroupExclusions";
import { fetchJsonOk } from "@/src/lib/http";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";
import { cn } from "@/src/lib/utils";

function AuditMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">{label}</p>
      <p className="text-sm font-bold text-[#111827] tabular-nums mt-0.5">{value}</p>
      {hint ? <p className="text-[10px] text-[#6B7280] mt-1">{hint}</p> : null}
    </div>
  );
}

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

  return (
    <div className="space-y-4" data-testid="cash-flow-numbers-audit-content">
      <p className="text-[11px] text-[#6B7280] leading-relaxed">
        Qualidade dos dados e conferência técnica com Contas a Receber e Contas a Pagar. Os
        números da tela não mudam — esta seção só explica origem e exclusões.
      </p>

      <div className="flex flex-wrap gap-2">
        <StatusPill ok={timelineOk} label="Período × ledger" />
        <StatusPill ok={portfolioOk} label="Carteira × AR/AP" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        <AuditMetric
          label="Última sync (visão combinada)"
          value={lastSyncAt ? formatFinanceDateTime(lastSyncAt) : "—"}
          hint="Maior syncedAt entre CR e CP no recorte carregado."
        />
        <AuditMetric
          label="Cutoff AR (Nomus)"
          value={
            loading && !audit ? (
              <Loader2 className="h-4 w-4 animate-spin text-[#6B7280]" />
            ) : audit?.syncCutoffs.ar ? (
              formatFinanceDateTime(audit.syncCutoffs.ar)
            ) : (
              "—"
            )
          }
        />
        <AuditMetric
          label="Cutoff AP (Nomus)"
          value={
            loading && !audit ? (
              <Loader2 className="h-4 w-4 animate-spin text-[#6B7280]" />
            ) : audit?.syncCutoffs.ap ? (
              formatFinanceDateTime(audit.syncCutoffs.ap)
            ) : (
              "—"
            )
          }
        />
      </div>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-[#6B7280] mb-2">
          Exclusões gerenciais (escopo filtrado)
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          <AuditMetric
            label="AR stale"
            value={dataSanitization?.ignoredStaleReceivables ?? audit?.exclusions.arStale ?? "—"}
          />
          <AuditMetric
            label="AR vencido sem NF"
            value={
              dataSanitization?.ignoredOverdueWithoutFiscalDocumentReceivables ??
              audit?.exclusions.arOverdueWithoutFiscalDocument ??
              "—"
            }
          />
          <AuditMetric
            label="AP stale"
            value={dataSanitization?.ignoredStalePayables ?? audit?.exclusions.apStale ?? "—"}
          />
          <AuditMetric
            label="AP intercompany / PC"
            value={apIntercompanyExcluded ?? "—"}
            hint="Intercompany e pedido de compra (type=2) na agenda gerencial."
          />
        </div>
      </div>

      {audit ? (
        <div className="text-[10px] text-[#6B7280] space-y-1">
          <p>
            Portfólio carregado: {audit.counts.arPortfolio} CR · {audit.counts.apPortfolio} CP ·
            Período: {audit.counts.arPeriod} CR · {audit.counts.apPeriod} CP
          </p>
        </div>
      ) : null}

      {error ? <p className="text-[11px] text-red-700">{error}</p> : null}
    </div>
  );
}
