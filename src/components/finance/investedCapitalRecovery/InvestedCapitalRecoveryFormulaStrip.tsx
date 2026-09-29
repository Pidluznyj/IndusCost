/**
 * Fórmula visual "Resultado = Termo + Termo (+ Termo)" da Recuperação do
 * Dinheiro Investido. Só APRESENTA números que o backend já reconciliou —
 * nenhuma soma ou subtração acontece aqui. Padrão visual dos badges de sinal
 * do fluxo da DRE (One Page), em tokens do BI Financeiro.
 */
import React from "react";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { FinanceBiCalcTooltip } from "@/src/components/finance/bi/FinanceBiCalcTooltip";
import { cn } from "@/src/lib/utils";

export type InvestedCapitalRecoveryFormulaTerm = {
  label: string;
  amount: number | null;
  /** Legenda curta abaixo do valor (ex.: "dinheiro colocado"). */
  detail?: string;
  hint?: string;
};

function TermBox({
  term,
  emphasize = false,
}: {
  term: InvestedCapitalRecoveryFormulaTerm;
  emphasize?: boolean;
}) {
  const negative = term.amount != null && term.amount < 0;
  return (
    <div
      className={cn(
        "min-w-0 flex-1 rounded-lg border px-3 py-2",
        emphasize ? "border-[#BFDBFE] bg-[#EFF6FF]" : "border-[#E5E7EB] bg-white"
      )}
      data-testid="icr-formula-term"
    >
      <p className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">
        {term.label}
        {term.hint ? <FinanceBiCalcTooltip rule={term.hint} /> : null}
      </p>
      <p
        className={cn(
          "mt-0.5 whitespace-nowrap tabular-nums",
          emphasize ? "text-sm font-extrabold text-[#111827]" : "text-sm font-bold text-[#111827]",
          negative && "text-[#DC2626]"
        )}
      >
        {term.amount == null ? "—" : formatFinanceCurrency(term.amount)}
      </p>
      {term.detail ? <p className="mt-0.5 text-[10px] text-[#6B7280]">{term.detail}</p> : null}
    </div>
  );
}

function OperatorBadge({ sign }: { sign: "=" | "+" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-sm font-bold",
        sign === "="
          ? "border-[#BFDBFE] bg-[#EFF6FF] text-[#2563EB]"
          : "border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]"
      )}
    >
      {sign}
    </span>
  );
}

export function InvestedCapitalRecoveryFormulaStrip({
  title,
  result,
  terms,
  note,
  testId,
}: {
  /** Título da fórmula (ex.: "Composição do capital investido"). */
  title?: string;
  result: InvestedCapitalRecoveryFormulaTerm;
  terms: InvestedCapitalRecoveryFormulaTerm[];
  /** Observação curta abaixo da fórmula (ex.: população considerada). */
  note?: string;
  testId?: string;
}) {
  const readable = `${result.label} = ${terms.map((term) => term.label).join(" + ")}`;
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5" data-testid={testId} aria-label={readable}>
      {title ? <p className="mb-2 text-xs font-bold text-[#111827]">{title}</p> : null}
      <div className="flex flex-wrap items-stretch gap-2">
        <TermBox term={result} emphasize />
        <div className="flex items-center"><OperatorBadge sign="=" /></div>
        {terms.map((term, index) => (
          <React.Fragment key={term.label}>
            {index > 0 ? (
              <div className="flex items-center"><OperatorBadge sign="+" /></div>
            ) : null}
            <TermBox term={term} />
          </React.Fragment>
        ))}
      </div>
      {note ? <p className="mt-1.5 text-[10px] text-[#6B7280]">{note}</p> : null}
    </div>
  );
}
