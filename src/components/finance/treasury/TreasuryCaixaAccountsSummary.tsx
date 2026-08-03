/**
 * Caixa — Passos 1 e 2: "Quanto eu tenho agora?" e "Como informo o saldo real?"
 *
 * Passo 1: saldo de cada banco + a soma. O consolidado usa a soma canônica da
 * Tesouraria (`sumPredictiveAccountBalances`), que já respeita conta inativa e
 * conta fora do consolidado — sem regra paralela aqui.
 *
 * Passo 2: clicar numa conta abre o modal canônico de saldo do dia
 * (`PredictiveCashFlowBalanceCorrectDialog`), que grava via /today/opening e
 * /today/closing com usuário, data/hora e motivo. Modal reaproveitado, não
 * reescrito — a regra de quem pode editar qual dia continua sendo dele.
 */

import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Landmark, Pencil } from "lucide-react";
import type { PredictiveCashFlowAccount } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import {
  formatPredictiveCashFlowMoney,
  sumPredictiveAccountBalances,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { PredictiveCashFlowBalanceCorrectDialog } from "@/src/components/finance/treasury/predictive-cash-flow/PredictiveCashFlowBalanceCorrectDialog";

export type TreasuryCaixaAccountsSummaryProps = {
  accounts: readonly PredictiveCashFlowAccount[];
  loading?: boolean;
  /** Dias passados só podem ser corrigidos por SUPER_ADMIN (regra do modal). */
  isSuperAdmin?: boolean;
  /** Chamado após gravar um saldo — a página recarrega as contas. */
  onChanged?: () => void;
};

export function TreasuryCaixaAccountsSummary({
  accounts,
  loading = false,
  isSuperAdmin = false,
  onChanged,
}: TreasuryCaixaAccountsSummaryProps) {
  const [editing, setEditing] = useState<PredictiveCashFlowAccount | null>(null);
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
            <li key={a.id}>
              <button
                type="button"
                onClick={() => setEditing(a)}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-transparent bg-white px-2.5 py-2 text-left transition hover:border-[#93C5FD] hover:bg-[#EFF6FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"
                data-testid={`caixa-account-${a.id}`}
                title="Informar o saldo do dia desta conta"
                aria-label={`Informar o saldo do dia — ${a.name}`}
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
                <div className="flex shrink-0 items-center gap-2">
                  <p className="text-sm font-semibold tabular-nums text-[#111827]">
                    {formatPredictiveCashFlowMoney(a.initialBalance)}
                  </p>
                  <Pencil className="h-3.5 w-3.5 text-[#2563EB]" aria-hidden />
                </div>
              </button>
            </li>
          ))
        )}
      </ul>

      {accounts.length > 0 && !loading ? (
        <p className="mt-2 text-[11px] leading-snug text-[#6B7280]">
          Clique numa conta para informar o saldo do dia. Fica registrado quem
          informou, quando e o motivo.
        </p>
      ) : null}

      {editing ? (
        <PredictiveCashFlowBalanceCorrectDialog
          account={editing}
          open
          isSuperAdmin={isSuperAdmin}
          onClose={() => setEditing(null)}
          onSaved={() => onChanged?.()}
        />
      ) : null}
    </section>
  );
}
