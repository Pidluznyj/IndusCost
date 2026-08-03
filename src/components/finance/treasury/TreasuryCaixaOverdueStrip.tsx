/**
 * Caixa — Passo 6: "O que está atrasado?"
 *
 * Faixa ancorada no presente, separada da linha do tempo. Atrasado é ESTOQUE:
 * não pertence a nenhum dia, porque não se sabe quando (nem se) vai entrar.
 * O motor canônico não joga CR vencido sem promessa na projeção — se jogasse,
 * a data em que o caixa vira negativo viria otimista demais. Aqui o valor fica
 * visível sem contaminar a previsão.
 *
 * Só renderiza quando há atraso — não ocupa espaço à toa.
 */

import React from "react";
import { AlertTriangle } from "lucide-react";
import type {
  TreasuryCaixaOverdue,
  TreasuryCaixaOverdueSide,
} from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import { formatPredictiveCashFlowMoney } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";

export type TreasuryCaixaOverdueStripProps = {
  overdue: TreasuryCaixaOverdue | null;
};

function Side({
  title,
  side,
  tone,
}: {
  title: string;
  side: TreasuryCaixaOverdueSide;
  tone: "receivable" | "payable";
}) {
  if (side.count === 0) return null;
  const valueClass = tone === "receivable" ? "text-[#065F46]" : "text-[#991B1B]";
  return (
    <div className="min-w-0 flex-1" data-testid={`caixa-overdue-${tone}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-[#92400E]">
        {title}
      </p>
      <p className={`mt-0.5 text-xl font-extrabold tabular-nums ${valueClass}`}>
        {formatPredictiveCashFlowMoney(side.total)}
        <span className="ml-1.5 text-[11px] font-normal text-[#92400E]">
          {side.count} {side.count === 1 ? "título" : "títulos"}
        </span>
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {side.buckets.map((b) => (
          <span
            key={b.key}
            className="rounded border border-[#FDE68A] bg-white px-1.5 py-0.5 text-[10px] text-[#92400E]"
            title={`${b.label}: ${formatPredictiveCashFlowMoney(b.amount)}`}
            data-testid={`caixa-overdue-${tone}-${b.key}`}
          >
            {b.label}:{" "}
            <span className="font-semibold tabular-nums">
              {formatPredictiveCashFlowMoney(b.amount)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function TreasuryCaixaOverdueStrip({
  overdue,
}: TreasuryCaixaOverdueStripProps) {
  if (!overdue) return null;
  const hasAny = overdue.receivable.count > 0 || overdue.payable.count > 0;
  if (!hasAny) return null;

  return (
    <section
      className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 shadow-sm"
      data-testid="caixa-overdue-strip"
    >
      <div className="mb-2 flex items-center gap-1.5">
        <AlertTriangle className="h-4 w-4 text-[#D97706]" aria-hidden />
        <h2 className="text-sm font-semibold text-[#92400E]">
          Atrasados — vencidos e ainda não liquidados
        </h2>
      </div>

      <div className="flex flex-wrap gap-6">
        <Side
          title="A receber"
          side={overdue.receivable}
          tone="receivable"
        />
        <Side title="A pagar" side={overdue.payable} tone="payable" />
      </div>

      <p className="mt-2 text-[11px] leading-snug text-[#92400E]">
        Estes valores <strong>não entram na previsão</strong> da linha do tempo —
        não há data confiável para eles. Para trazer um a receber para a
        projeção, registre uma promessa de pagamento com a data esperada.
      </p>
    </section>
  );
}
