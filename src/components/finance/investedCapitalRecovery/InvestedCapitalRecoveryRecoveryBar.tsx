/**
 * Barra de recuperação do capital: Capital investido = Capital recuperado +
 * Capital na rua. Valores e percentuais vêm prontos do backend (população
 * comparável); aqui só se desenha o trilho — padrão das barras de
 * participação de Contas a Receber (trilho #F3F4F6 + preenchimento).
 */
import React from "react";
import { formatFinanceCurrency, formatFinancePercent } from "@/src/lib/financeAccountsReceivableFormat";

function clampPercent(value: number | null): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 100);
}

/** Percentual vem pronto do backend; null (sem capital) vira "—", nunca 0%. */
function percentLabel(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatFinancePercent(value);
}

export function InvestedCapitalRecoveryRecoveryBar({
  investedCapital,
  capitalRecovered,
  moneyOnStreet,
  recoveredPercent,
  moneyOnStreetPercent,
}: {
  investedCapital: number;
  capitalRecovered: number;
  moneyOnStreet: number;
  recoveredPercent: number | null;
  moneyOnStreetPercent: number | null;
}) {
  const recoveredWidth = clampPercent(recoveredPercent);
  const onStreetWidth = clampPercent(moneyOnStreetPercent);
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5" data-testid="icr-recovery-bar">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">
          Capital investido {formatFinanceCurrency(investedCapital)} = Capital recuperado + Capital na rua
        </p>
        <p className="text-[10px] text-[#6B7280]">População comparável: pedidos com custo resolvido</p>
      </div>
      <div
        className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-[#F3F4F6]"
        role="img"
        aria-label={`Capital recuperado ${percentLabel(recoveredPercent)} · Capital na rua ${percentLabel(moneyOnStreetPercent)}`}
      >
        <div className="h-full bg-[#059669]" style={{ width: `${recoveredWidth}%` }} data-testid="icr-recovery-bar-recovered" />
        <div className="h-full bg-[#D97706]" style={{ width: `${onStreetWidth}%` }} data-testid="icr-recovery-bar-on-street" />
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[11px]">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-[#059669]" />
          <span className="font-semibold text-[#111827]">Capital recuperado</span>
          <span className="tabular-nums font-bold text-[#047857]">{formatFinanceCurrency(capitalRecovered)}</span>
          <span className="tabular-nums text-[#6B7280]">({percentLabel(recoveredPercent)})</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-[#D97706]" />
          <span className="font-semibold text-[#111827]">Capital na rua</span>
          <span className="tabular-nums font-bold text-[#B45309]">{formatFinanceCurrency(moneyOnStreet)}</span>
          <span className="tabular-nums text-[#6B7280]">({percentLabel(moneyOnStreetPercent)})</span>
        </span>
      </div>
    </div>
  );
}
