/**
 * Barras de composição da Recuperação do Dinheiro Investido. Valores e
 * percentuais vêm prontos do backend; a largura dos segmentos é só a
 * proporção visual entre valores já reconciliados (mesmo critério das barras
 * de faixa da tela) — nenhuma regra econômica aqui. Trilho no padrão das
 * barras de participação de Contas a Receber.
 */
import React from "react";
import { formatFinanceCurrency, formatFinancePercent } from "@/src/lib/financeAccountsReceivableFormat";
import { cn } from "@/src/lib/utils";

function clampPercent(value: number | null): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 100);
}

/** Percentual vem pronto do backend; null (sem capital) vira "—", nunca 0%. */
function percentLabel(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatFinancePercent(value);
}

/**
 * Capital investido = Capital recuperado + Capital na rua, com os percentuais
 * oficiais (`capitalRecoveredPercent` / `moneyOnStreetPercent`).
 */
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
    <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5" data-testid="icr-recovery-bar">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-bold text-[#111827]">Recuperação do capital investido</p>
        <p className="text-xs font-bold tabular-nums text-[#111827]" title="Capital investido (pedidos com custo resolvido)">
          {formatFinanceCurrency(investedCapital)}
        </p>
      </div>
      <div
        className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-[#E5E7EB]"
        role="img"
        aria-label={`Capital recuperado ${percentLabel(recoveredPercent)} · Capital na rua ${percentLabel(moneyOnStreetPercent)}`}
      >
        <div className="h-full bg-[#059669]" style={{ width: `${recoveredWidth}%` }} data-testid="icr-recovery-bar-recovered" />
        <div className="h-full bg-[#DC2626]" style={{ width: `${onStreetWidth}%` }} data-testid="icr-recovery-bar-on-street" />
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[11px]">
        <div>
          <p className="text-sm font-extrabold tabular-nums text-[#047857]">{formatFinanceCurrency(capitalRecovered)}</p>
          <p className="text-[#6B7280]">Capital recuperado · {percentLabel(recoveredPercent)}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-extrabold tabular-nums text-[#DC2626]">{formatFinanceCurrency(moneyOnStreet)}</p>
          <p className="text-[#6B7280]">Capital na rua · {percentLabel(moneyOnStreetPercent)}</p>
        </div>
      </div>
    </div>
  );
}

function share(part: number, total: number): number {
  if (!(total > 0)) return 0;
  return clampPercent((Math.max(part, 0) / total) * 100);
}

/**
 * Recebíveis em aberto = Capital a recuperar + Ganho a receber (+ Não
 * classificado, dos pedidos sem custo). Só proporção visual entre os três
 * totais do backend.
 */
export function InvestedCapitalRecoveryReceivablesBar({
  outstandingTotal,
  capitalReceivableCovered,
  gainReceivable,
  unclassified,
}: {
  outstandingTotal: number;
  capitalReceivableCovered: number;
  gainReceivable: number;
  unclassified: number;
}) {
  const segments = [
    { key: "capital", label: "Capital a recuperar", amount: capitalReceivableCovered, color: "bg-[#2563EB]", text: "text-[#1D4ED8]", desc: "É o seu dinheiro voltando." },
    { key: "gain", label: "Ganho a receber", amount: gainReceivable, color: "bg-[#7C3AED]", text: "text-[#6D28D9]", desc: "É o excedente econômico ainda dentro dos CRs." },
    { key: "unclassified", label: "Não classificado", amount: unclassified, color: "bg-[#9CA3AF]", text: "text-[#6B7280]", desc: "CR aberto de pedidos sem custo resolvido; não vira capital nem ganho." },
  ];
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5" data-testid="icr-receivables-bar">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-bold text-[#111827]">Recebíveis em aberto = capital a recuperar + ganho a receber</p>
        <p className="text-xs font-bold tabular-nums text-[#111827]" title="Falta receber (CR real em aberto)">
          {formatFinanceCurrency(outstandingTotal)}
        </p>
      </div>
      <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-[#E5E7EB]" role="img" aria-label="Composição dos recebíveis em aberto">
        {segments.map((segment) => (
          <div
            key={segment.key}
            className={cn("h-full", segment.color)}
            style={{ width: `${share(segment.amount, outstandingTotal)}%` }}
            title={`${segment.label}: ${formatFinanceCurrency(segment.amount)}`}
            data-testid={`icr-receivables-bar-${segment.key}`}
          />
        ))}
      </div>
      <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-3">
        {segments.map((segment) => (
          <div key={segment.key} className="min-w-0">
            <p className={cn("text-sm font-extrabold tabular-nums", segment.text)}>{formatFinanceCurrency(segment.amount)}</p>
            <p className="font-semibold text-[#111827]">{segment.label}</p>
            <p className="text-[#6B7280]">{segment.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
