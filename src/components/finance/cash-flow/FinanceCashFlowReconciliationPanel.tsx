import React from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import type { FinanceCashFlowReconciliation } from "@/src/lib/financeCashFlowDashboardTypes";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass, financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

function MatchBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"
      )}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {label}
    </span>
  );
}

function ReconciliationRow({
  label,
  value,
  compareLabel,
  compareValue,
  delta,
  matches,
}: {
  label: string;
  value: number;
  compareLabel: string;
  compareValue: number;
  delta: number;
  matches: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between py-2 border-b border-[#F3F4F6] last:border-0">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">{label}</p>
        <p className="text-lg font-bold tabular-nums text-[#111827]">{formatFinanceCurrency(value)}</p>
      </div>
      <div className="text-right shrink-0 space-y-1">
        <p className="text-[11px] text-[#6B7280]">
          {compareLabel}:{" "}
          <span className="font-semibold text-[#374151]">{formatFinanceCurrency(compareValue)}</span>
        </p>
        <div className="flex items-center justify-end gap-2">
          {Math.abs(delta) >= 0.01 ? (
            <span className="text-[11px] tabular-nums text-[#6B7280]">
              Δ {formatFinanceCurrency(delta)}
            </span>
          ) : null}
          <MatchBadge ok={matches} label={matches ? "Conferido" : "Divergência"} />
        </div>
      </div>
    </div>
  );
}

export function FinanceCashFlowReconciliationPanel({
  reconciliation,
}: {
  reconciliation: FinanceCashFlowReconciliation;
}) {
  const { receivable, payable, netCashFlow, netMatchesLedger, periodLabel, notes } = reconciliation;

  return (
    <section className={financeBiSectionClass} data-testid="cash-flow-reconciliation">
      <div className="px-5 py-3 border-b border-[#E5E7EB]">
        <h2 className="text-sm font-bold text-[#111827]">Conferência do período</h2>
        <p className="text-[11px] text-[#6B7280] mt-0.5">
          {periodLabel} — entradas de Contas a Receber, saídas de Contas a Pagar. Saldo = entradas −
          saídas.
        </p>
        <p className="text-[10px] text-[#6B7280] mt-1 italic">
          Faturamento (NF-e) não entra no caixa. Os valores abaixo refletem apenas títulos AR/AP do
          período filtrado.
        </p>
      </div>
      <div className="p-5 space-y-4">
        <div className={`${financeBiCardClass} p-4`}>
          <ReconciliationRow
            label="Entradas (Fluxo de Caixa)"
            value={receivable.cashFlowInflow}
            compareLabel="Contas a Receber (ledger)"
            compareValue={receivable.ledgerInflow}
            delta={receivable.deltaVsLedger}
            matches={receivable.matchesLedger}
          />
          <ReconciliationRow
            label="Saídas (Fluxo de Caixa)"
            value={payable.cashFlowOutflow}
            compareLabel="Contas a Pagar (ledger)"
            compareValue={payable.ledgerOutflow}
            delta={payable.deltaVsLedger}
            matches={payable.matchesLedger}
          />
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pt-3 mt-1">
            <div>
              <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">
                Saldo líquido
              </p>
              <p
                className={cn(
                  "text-xl font-bold tabular-nums",
                  netCashFlow >= 0 ? "text-[#059669]" : "text-[#DC2626]"
                )}
              >
                {formatFinanceCurrency(netCashFlow)}
              </p>
            </div>
            <MatchBadge ok={netMatchesLedger} label={netMatchesLedger ? "Conferido" : "Divergência"} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className={`${financeBiCardClass} p-4 space-y-2`}>
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#6B7280]">
              Carteira a receber (aberto)
            </h3>
            <p className="text-base font-bold tabular-nums text-[#111827]">
              {formatFinanceCurrency(receivable.cashFlowOpenPortfolio)}
            </p>
            <p className="text-[11px] text-[#6B7280]">
              Card AR Em Aberto: {formatFinanceCurrency(receivable.arDashboardOpen)}
            </p>
            <MatchBadge
              ok={receivable.matchesArOpen}
              label={receivable.matchesArOpen ? "Bate com AR" : "Diverge do AR"}
            />
          </div>
          <div className={`${financeBiCardClass} p-4 space-y-2`}>
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#6B7280]">
              Carteira a pagar (aberto)
            </h3>
            <p className="text-base font-bold tabular-nums text-[#111827]">
              {formatFinanceCurrency(payable.cashFlowOpenPortfolio)}
            </p>
            <p className="text-[11px] text-[#6B7280]">
              Card AP Em Aberto: {formatFinanceCurrency(payable.apDashboardOpen)}
            </p>
            <MatchBadge
              ok={payable.matchesApOpen}
              label={payable.matchesApOpen ? "Bate com AP" : "Diverge do AP"}
            />
          </div>
        </div>

        {notes.length > 0 ? (
          <ul className="text-[11px] text-[#6B7280] space-y-1 list-disc pl-4">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
