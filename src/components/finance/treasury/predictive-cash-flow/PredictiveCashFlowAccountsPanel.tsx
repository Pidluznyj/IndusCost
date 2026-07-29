import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Pencil } from "lucide-react";
import type { PredictiveCashFlowAccount } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import {
  formatPredictiveCashFlowMoney,
  sumPredictiveAccountBalances,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { cn } from "@/src/lib/utils";
import { PredictiveCashFlowBalanceCorrectDialog } from "./PredictiveCashFlowBalanceCorrectDialog.js";

export type PredictiveCashFlowAccountsPanelProps = {
  accounts: readonly PredictiveCashFlowAccount[];
  companyCode: string | null;
  disabled?: boolean;
  isSuperAdmin?: boolean;
  onChanged: () => void;
  variant?: "full" | "hero";
};

export function PredictiveCashFlowAccountsPanel({
  accounts,
  companyCode: _companyCode,
  disabled,
  isSuperAdmin = false,
  onChanged,
  variant = "full",
}: PredictiveCashFlowAccountsPanelProps) {
  const [editing, setEditing] = useState<PredictiveCashFlowAccount | null>(null);
  const consolidated = sumPredictiveAccountBalances(accounts);
  const isHero = variant === "hero";

  return (
    <section
      className={cn(
        "rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-none",
        isHero && "border-[#BFDBFE] bg-[#F8FAFC]"
      )}
      data-testid="predictive-cf-accounts"
      data-variant={variant}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-extrabold tracking-tight text-[#111827]">
            Contas
          </h3>
          <p className="mt-1 text-sm text-[#6B7280]">
            Saldos canônicos · consolidado{" "}
            <span
              className="font-semibold tabular-nums text-[#059669]"
              data-testid="predictive-cf-accounts-consolidated"
            >
              {formatPredictiveCashFlowMoney(consolidated)}
            </span>
          </p>
          {isHero ? (
            <p className="mt-1 text-xs text-[#6B7280]">
              Clique na conta para informar saldo inicial e final do dia. Dias
              passados: somente SUPER_ADMIN (com log).
            </p>
          ) : null}
        </div>
        <Link
          to="/finance/treasury/accounts"
          className="text-sm font-semibold text-[#2563EB] hover:underline"
        >
          Gerenciar
        </Link>
      </div>

      <ul className="space-y-2" data-testid="predictive-cf-accounts-list">
        {accounts.length === 0 ? (
          <li className="rounded-lg border border-dashed border-[#E5E7EB] px-3 py-6 text-center text-sm text-[#6B7280]">
            Nenhuma conta ativa.{" "}
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
                disabled={disabled}
                onClick={() => setEditing(a)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-lg border border-[#E5E7EB] bg-white px-3 py-3 text-left transition",
                  "hover:border-[#93C5FD] hover:bg-[#EFF6FF]",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"
                )}
                data-testid={`predictive-cf-account-${a.id}`}
                aria-label={`Informar saldos do dia — ${a.name}`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Building2 className="h-4 w-4 shrink-0 text-[#6B7280]" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#111827]">
                      {a.name}
                    </p>
                    <p className="truncate text-xs text-[#6B7280]">
                      {a.institutionName}
                    </p>
                  </div>
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

      {editing ? (
        <PredictiveCashFlowBalanceCorrectDialog
          account={editing}
          open
          disabled={disabled}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      ) : null}
    </section>
  );
}
