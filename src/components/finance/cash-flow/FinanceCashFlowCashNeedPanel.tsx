import React from "react";
import { AlertTriangle, CircleDollarSign } from "lucide-react";
import type { FinanceCashFlowDashboardPayload } from "@/src/lib/financeCashFlowDashboardTypes";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

export function FinanceCashFlowCashNeedPanel({
  cards,
  cashForecast,
  conservativeScenario,
  stressScenario,
}: Pick<
  FinanceCashFlowDashboardPayload,
  "cards" | "cashForecast" | "conservativeScenario" | "stressScenario"
>) {
  const horizon12 = cashForecast.horizons.next12Months;
  const worstMonth = horizon12.worstMonth;
  const baseNeed = cards.cashNeedAmount > 0 ? cards.cashNeedAmount : horizon12.maxCashNeed;

  return (
    <div className={`${financeBiCardClass} p-5 space-y-4`} data-testid="cash-flow-cash-need-panel">
      <div className="flex items-start gap-2">
        <CircleDollarSign className="h-5 w-5 text-[#D97706] shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-bold text-[#111827]">Necessidade de Caixa</h3>
          <p className="text-[11px] text-[#6B7280] mt-0.5">
            Quanto dinheiro pode ser necessário nos próximos meses — por cenário
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <NeedCard
          label="Cenário base"
          value={baseNeed}
          sub="Déficit atual ou maior pressão mensal"
        />
        <NeedCard
          label="Cenário conservador"
          value={conservativeScenario.cashNeedConservative}
          sub={conservativeScenario.disclaimer}
          highlight={conservativeScenario.cashNeedConservative > baseNeed}
        />
        <NeedCard
          label="Cenário crítico"
          value={stressScenario.cashNeedStress}
          sub={stressScenario.disclaimer}
          critical
        />
      </div>

      {worstMonth ? (
        <p className="text-sm text-[#111827]">
          Mês de maior pressão projetada:{" "}
          <span className="font-semibold">{worstMonth.monthLabel}</span> (
          {formatFinanceCurrency(worstMonth.projectedNet)} líquido).
        </p>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
            Vencido a receber
          </p>
          <p className="font-bold text-emerald-700 tabular-nums">
            {formatFinanceCurrency(cards.overdueReceivableAmount)}
          </p>
          <p className="text-[11px] text-emerald-800/80 mt-0.5">
            Cobrança efetiva reduz a necessidade de caixa.
          </p>
        </div>
        <div className="rounded-lg border border-red-100 bg-red-50/50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-red-800">
            Vencido a pagar
          </p>
          <p className="font-bold text-red-700 tabular-nums">
            {formatFinanceCurrency(cards.overduePayableAmount)}
          </p>
          <p className="text-[11px] text-red-800/80 mt-0.5">Pressiona o caixa imediatamente.</p>
        </div>
      </div>

      {conservativeScenario.cashNeedConservative > baseNeed && worstMonth ? (
        <p className="text-sm text-[#374151] border-l-2 border-amber-400 pl-3">
          Se apenas 80% dos recebíveis forem realizados no prazo, a necessidade estimada de caixa
          sobe para {formatFinanceCurrency(conservativeScenario.cashNeedConservative)} em{" "}
          {worstMonth.monthLabel}.
        </p>
      ) : null}

      {stressScenario.monthsAtRiskStress > 0 ? (
        <div className="flex items-center gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Cenário crítico: {stressScenario.monthsAtRiskStress} mês(es) com fluxo líquido negativo
            no horizonte de 12 meses.
          </span>
        </div>
      ) : null}
    </div>
  );
}

function NeedCard({
  label,
  value,
  sub,
  highlight = false,
  critical = false,
}: {
  label: string;
  value: number;
  sub: string;
  highlight?: boolean;
  critical?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-3 space-y-1",
        critical
          ? "border-red-200 bg-red-50/40"
          : highlight
            ? "border-amber-200 bg-amber-50/40"
            : "border-[#E5E7EB] bg-[#F9FAFB]"
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">{label}</p>
      <p
        className={cn(
          "text-lg font-bold tabular-nums",
          value > 0 ? "text-[#DC2626]" : "text-[#059669]"
        )}
      >
        {value > 0 ? formatFinanceCurrency(value) : "Sem necessidade"}
      </p>
      <p className="text-[10px] text-[#6B7280] leading-snug">{sub}</p>
    </div>
  );
}
