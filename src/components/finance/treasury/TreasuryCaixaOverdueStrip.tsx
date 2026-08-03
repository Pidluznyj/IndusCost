/**
 * Caixa — Passo 6: "O que está atrasado?"
 *
 * Fechado por padrão: uma linha com os dois totais. O detalhe por faixa de
 * atraso abre sob demanda — em tabela alinhada, não em selos soltos, porque
 * comparar seis valores lado a lado exige coluna, não sopa de etiquetas.
 *
 * Atrasado é ESTOQUE: não pertence a nenhum dia da linha do tempo, porque não
 * se sabe quando (nem se) vai entrar. Por isso fica fora da previsão.
 *
 * Só renderiza quando há atraso.
 */

import React, { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import type {
  TreasuryCaixaOverdue,
  TreasuryCaixaOverdueSide,
} from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import { formatPredictiveCashFlowMoney } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";

export type TreasuryCaixaOverdueStripProps = {
  overdue: TreasuryCaixaOverdue | null;
};

function SideDetail({
  title,
  side,
  tone,
}: {
  title: string;
  side: TreasuryCaixaOverdueSide;
  tone: "receivable" | "payable";
}) {
  if (side.count === 0) return null;
  const amountClass =
    tone === "receivable" ? "text-[#065F46]" : "text-[#991B1B]";
  return (
    <div className="min-w-[15rem] flex-1" data-testid={`caixa-overdue-${tone}`}>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#92400E]">
        {title}
      </p>
      <table className="w-full text-xs">
        <tbody>
          {side.buckets.map((b) => (
            <tr key={b.key} data-testid={`caixa-overdue-${tone}-${b.key}`}>
              <td className="py-0.5 pr-2 text-[#92400E]">{b.label}</td>
              <td className="py-0.5 pr-2 text-right text-[11px] text-[#B45309]">
                {b.count}
              </td>
              <td
                className={`py-0.5 text-right font-semibold tabular-nums ${amountClass}`}
              >
                {formatPredictiveCashFlowMoney(b.amount)}
              </td>
            </tr>
          ))}
          <tr className="border-t border-[#FDE68A]">
            <td className="pt-1 pr-2 font-bold text-[#92400E]">Total</td>
            <td className="pt-1 pr-2 text-right text-[11px] font-bold text-[#B45309]">
              {side.count}
            </td>
            <td
              className={`pt-1 text-right font-extrabold tabular-nums ${amountClass}`}
            >
              {formatPredictiveCashFlowMoney(side.total)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function TreasuryCaixaOverdueStrip({
  overdue,
}: TreasuryCaixaOverdueStripProps) {
  const [open, setOpen] = useState(false);
  if (!overdue) return null;
  const { receivable, payable } = overdue;
  if (receivable.count === 0 && payable.count === 0) return null;

  return (
    <section
      className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB]"
      data-testid="caixa-overdue-strip"
      data-open={open}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left"
        data-testid="caixa-overdue-toggle"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-[#92400E]" aria-hidden />
        ) : (
          <ChevronRight
            className="h-4 w-4 shrink-0 text-[#92400E]"
            aria-hidden
          />
        )}
        <AlertTriangle className="h-4 w-4 shrink-0 text-[#D97706]" aria-hidden />
        <span className="text-sm font-semibold text-[#92400E]">Atrasados</span>

        <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs">
          {receivable.count > 0 ? (
            <span className="text-[#92400E]">
              A receber{" "}
              <span className="font-bold tabular-nums text-[#065F46]">
                {formatPredictiveCashFlowMoney(receivable.total)}
              </span>{" "}
              <span className="text-[11px]">({receivable.count})</span>
            </span>
          ) : null}
          {payable.count > 0 ? (
            <span className="text-[#92400E]">
              A pagar{" "}
              <span className="font-bold tabular-nums text-[#991B1B]">
                {formatPredictiveCashFlowMoney(payable.total)}
              </span>{" "}
              <span className="text-[11px]">({payable.count})</span>
            </span>
          ) : null}
          <span className="text-[11px] text-[#B45309]">
            {open ? "ocultar" : "ver faixas"}
          </span>
        </span>
      </button>

      {open ? (
        <div className="border-t border-[#FDE68A] px-4 py-3">
          <div className="flex flex-wrap gap-8">
            <SideDetail
              title="A receber — por tempo de atraso"
              side={receivable}
              tone="receivable"
            />
            <SideDetail
              title="A pagar — por tempo de atraso"
              side={payable}
              tone="payable"
            />
          </div>
          <p className="mt-3 text-[11px] leading-snug text-[#92400E]">
            Estes valores <strong>não entram na previsão</strong> da linha do
            tempo — não há data confiável para eles. Para trazer um a receber
            para a projeção, registre uma promessa de pagamento com a data
            esperada.
          </p>
        </div>
      ) : null}
    </section>
  );
}
