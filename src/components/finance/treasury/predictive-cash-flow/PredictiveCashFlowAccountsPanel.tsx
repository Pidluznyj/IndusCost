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
  companyCode,
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
        "rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5 shadow-none",
        isHero && "border-[#BFDBFE] bg-[#F8FAFC]"
      )}
      data-testid="predictive-cf-accounts"
      data-variant={variant}
      data-company-code={companyCode ?? ""}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="text-sm font-extrabold tracking-tight text-[#111827]">
              Contas
            </h3>
            <p className="truncate text-xs text-[#6B7280]">
              {companyCode ? (
                <>
                  empresa{" "}
                  <span className="font-semibold text-[#111827]">{companyCode}</span>
                  {" · "}
                </>
              ) : null}
              consolidado{" "}
              <span
                className="font-semibold tabular-nums text-[#059669]"
                data-testid="predictive-cf-accounts-consolidated"
              >
                {formatPredictiveCashFlowMoney(consolidated)}
              </span>
            </p>
          </div>
        </div>
        <Link
          to="/finance/treasury/accounts"
          className="shrink-0 text-xs font-semibold text-[#2563EB] hover:underline"
        >
          Gerenciar
        </Link>
      </div>

      <ul className="space-y-1" data-testid="predictive-cf-accounts-list">
        {accounts.length === 0 ? (
          <li className="rounded-md border border-dashed border-[#E5E7EB] px-3 py-3 text-center text-xs text-[#6B7280]">
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
                  "flex w-full items-center justify-between gap-2 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-left transition",
                  "hover:border-[#93C5FD] hover:bg-[#EFF6FF]",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"
                )}
                data-testid={`predictive-cf-account-${a.id}`}
                aria-label={`Informar saldos do dia — ${a.name}`}
                title="Informar saldo inicial e final do dia"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-[#6B7280]" />
                  <p className="truncate text-xs font-semibold text-[#111827]">
                    {a.name}
                    {a.institutionName ? (
                      <span className="font-normal text-[#6B7280]">
                        {" · "}
                        {a.institutionName}
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <p className="text-xs font-semibold tabular-nums text-[#111827]">
                    {formatPredictiveCashFlowMoney(a.initialBalance)}
                  </p>
                  <Pencil className="h-3 w-3 text-[#2563EB]" aria-hidden />
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
