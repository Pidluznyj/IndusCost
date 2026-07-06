import React from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import {
  formatCashFlowKpiDisplay,
  resolveCashFlowNetPositionTone,
} from "@/src/lib/financeCashFlowDisplay";
import { cn } from "@/src/lib/utils";

export function FinanceCashFlowNetPositionHero({
  posicaoLiquida,
  receivableOpen,
  payableOpen,
  statusLabel,
  coverageRatio,
}: {
  posicaoLiquida: number;
  receivableOpen: number;
  payableOpen: number;
  statusLabel?: string;
  coverageRatio?: number | null;
}) {
  const tone = resolveCashFlowNetPositionTone(posicaoLiquida);
  const value = formatCashFlowKpiDisplay(posicaoLiquida);
  const receivable = formatCashFlowKpiDisplay(receivableOpen);
  const payable = formatCashFlowKpiDisplay(payableOpen);

  return (
    <div
      data-testid="cash-flow-net-position-hero"
      className={cn(
        financeBiCardClass,
        "p-5 sm:p-6 border-l-4",
        tone.isSurplus ? "border-l-[#059669]" : "border-l-[#DC2626]"
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#6B7280]">
            Posição líquida de caixa
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {tone.isSurplus ? (
              <ArrowUpRight className="h-6 w-6 text-[#059669] shrink-0" aria-hidden />
            ) : (
              <ArrowDownRight className="h-6 w-6 text-[#DC2626] shrink-0" aria-hidden />
            )}
            <p
              data-testid="kpi-net-position"
              className={cn(
                "text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight tabular-nums break-words",
                tone.isSurplus ? "text-[#059669]" : "text-[#DC2626]"
              )}
              title={value.full}
            >
              {value.display}
            </p>
          </div>
          <p
            className={cn(
              "text-sm font-semibold",
              tone.isSurplus ? "text-[#059669]" : "text-[#DC2626]"
            )}
          >
            {statusLabel ?? tone.statusLabel}
          </p>
          {coverageRatio != null ? (
            <p className="text-[11px] text-[#6B7280]">
              Cobertura receber/pagar:{" "}
              <span className="font-semibold text-[#111827] tabular-nums">
                {coverageRatio.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×
              </span>
            </p>
          ) : null}
          <p className="text-[11px] text-[#6B7280] leading-relaxed max-w-2xl">
            Total a receber em aberto menos total a pagar em aberto — indica se o caixa projetado
            fecha com sobra ou falta.
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:gap-4 shrink-0 min-w-[220px]">
          <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5 min-w-0">
            <dt className="text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">
              A receber
            </dt>
            <dd
              className="text-lg font-bold text-[#059669] tabular-nums break-words leading-tight mt-0.5"
              title={receivable.full}
            >
              {receivable.display}
            </dd>
          </div>
          <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5 min-w-0">
            <dt className="text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">
              A pagar
            </dt>
            <dd
              className="text-lg font-bold text-[#DC2626] tabular-nums break-words leading-tight mt-0.5"
              title={payable.full}
            >
              {payable.display}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
