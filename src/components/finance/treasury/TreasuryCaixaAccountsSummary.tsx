/**
 * Caixa — Passo 1: "Quanto eu tenho agora?"
 *
 * Bloco de leitura: saldo de cada banco + a soma. Sem edição (o lançamento de
 * saldo entra no Passo 2). O consolidado usa a soma canônica da Tesouraria
 * (`sumPredictiveAccountBalances`), que já respeita conta inativa e conta fora
 * do consolidado — sem regra paralela aqui.
 */

import React from "react";
import { Link } from "react-router-dom";
import { Landmark } from "lucide-react";
import type { PredictiveCashFlowAccount } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import {
  formatPredictiveCashFlowMoney,
  sumPredictiveAccountBalances,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";

export type TreasuryCaixaAccountsSummaryProps = {
  accounts: readonly PredictiveCashFlowAccount[];
  loading?: boolean;
};

export function TreasuryCaixaAccountsSummary({
  accounts,
  loading = false,
}: TreasuryCaixaAccountsSummaryProps) {
  const consolidated = sumPredictiveAccountBalances(accounts);
  const countedAccounts = accounts.filter(
    (a) => a.isActive && a.includeInConsolidated
  );

  return (
    <section
      className="rounded-lg border border-[#BFDBFE] bg-[#F8FAFC] p-4 shadow-sm"
      data-testid="caixa-accounts-summary"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#1E3A8A]/70">
            Caixa hoje
          </p>
          <p
            className="mt-0.5 text-3xl font-extrabold tabular-nums tracking-tight text-[#1E3A8A]"
            data-testid="caixa-accounts-summary-total"
          >
            {loading ? "—" : formatPredictiveCashFlowMoney(consolidated)}
          </p>
          <p className="mt-0.5 text-xs text-[#6B7280]">
            Soma do saldo informado {countedAccounts.length === 1 ? "de" : "das"}{" "}
            {countedAccounts.length}{" "}
            {countedAccounts.length === 1 ? "conta" : "contas"}
          </p>
        </div>
        <Link
          to="/finance/treasury/accounts"
          className="shrink-0 text-xs font-semibold text-[#2563EB] hover:underline"
        >
          Gerenciar contas
        </Link>
      </div>

      <ul
        className="mt-3 space-y-1 border-t border-[#E5E7EB] pt-3"
        data-testid="caixa-accounts-summary-list"
      >
        {loading ? (
          <li className="px-1 py-2 text-xs text-[#6B7280]">
            Carregando contas…
          </li>
        ) : accounts.length === 0 ? (
          <li className="rounded-md border border-dashed border-[#E5E7EB] bg-white px-3 py-4 text-center text-xs text-[#6B7280]">
            Nenhuma conta cadastrada ainda.{" "}
            <Link
              to="/finance/treasury/accounts"
              className="font-semibold text-[#2563EB] hover:underline"
            >
              Cadastrar em Contas
            </Link>
          </li>
        ) : (
          accounts.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-md bg-white px-2.5 py-2"
              data-testid={`caixa-account-${a.id}`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Landmark className="h-4 w-4 shrink-0 text-[#6B7280]" aria-hidden />
                <p className="truncate text-sm font-semibold text-[#111827]">
                  {a.name}
                  {a.institutionName ? (
                    <span className="font-normal text-[#6B7280]">
                      {" · "}
                      {a.institutionName}
                    </span>
                  ) : null}
                </p>
                {!a.includeInConsolidated ? (
                  <span className="shrink-0 rounded border border-[#E5E7EB] bg-[#F9FAFB] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#6B7280]">
                    fora da soma
                  </span>
                ) : null}
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums text-[#111827]">
                {formatPredictiveCashFlowMoney(a.initialBalance)}
              </p>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
