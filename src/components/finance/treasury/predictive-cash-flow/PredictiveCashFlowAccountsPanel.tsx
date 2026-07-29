import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Plus } from "lucide-react";
import type { PredictiveCashFlowAccount } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import {
  formatPredictiveCashFlowMoney,
  sumPredictiveAccountBalances,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { createTreasuryAccount } from "@/src/lib/treasury/treasuryAccountsApi.js";
import { createTreasuryBalanceSnapshot } from "@/src/lib/treasury/treasuryBalancesApi.js";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";

export type PredictiveCashFlowAccountsPanelProps = {
  accounts: readonly PredictiveCashFlowAccount[];
  companyCode: string | null;
  disabled?: boolean;
  onChanged: () => void;
};

export function PredictiveCashFlowAccountsPanel({
  accounts,
  companyCode,
  disabled,
  onChanged,
}: PredictiveCashFlowAccountsPanelProps) {
  const [name, setName] = useState("");
  const [initialBalance, setInitialBalance] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const consolidated = sumPredictiveAccountBalances(accounts);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyCode?.trim()) {
      setError("Informe/selecione a empresa (companyCode) antes de criar conta.");
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Informe o nome da conta.");
      return;
    }
    const balanceNum = Number(
      String(initialBalance).replace(/\./g, "").replace(",", ".")
    );
    const balance =
      Number.isFinite(balanceNum) && initialBalance.trim()
        ? balanceNum.toFixed(2)
        : "0.00";
    const code = `CX${Date.now().toString(36).slice(-6).toUpperCase()}`;
    setBusy(true);
    setError(null);
    try {
      const account = await createTreasuryAccount({
        companyCode: companyCode.trim(),
        companyName: null,
        code,
        name: trimmed,
        institutionName: trimmed,
        institutionCode: null,
        accountType: "CHECKING",
        currency: "BRL",
        agencyMasked: "****",
        accountNumberMasked: "****",
        includeInConsolidated: true,
        minimumBalance: "0.00",
        allowNegativeBalance: false,
        liquidity: "IMMEDIATE",
        defaultBalanceOrigin: "MANUAL",
        sortOrder: accounts.length,
        nomusBankAccountId: null,
      });
      await createTreasuryBalanceSnapshot(
        account.id,
        {
          referenceAt: new Date().toISOString(),
          availableBalance: balance,
          blockedBalance: "0.00",
          investmentsBalance: "0.00",
          usedLimit: "0.00",
          origin: "MANUAL",
          notes: "Saldo inicial — Fluxo Gerencial",
          justification: "Abertura via Fluxo Gerencial",
        },
        `pcf-open:${account.id}:${balance}`
      );
      setName("");
      setInitialBalance("");
      onChanged();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível criar a conta na Tesouraria."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="rounded-xl border border-border bg-card p-5 shadow-sm"
      data-testid="predictive-cf-accounts"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">Contas</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Saldos canônicos · consolidado{" "}
            <span className="font-semibold tabular-nums text-emerald-700">
              {formatPredictiveCashFlowMoney(consolidated)}
            </span>
          </p>
        </div>
        <Link
          to="/finance/treasury/accounts"
          className="text-sm font-medium text-sky-700 hover:underline"
        >
          Gerenciar
        </Link>
      </div>

      <ul className="mb-5 space-y-2">
        {accounts.length === 0 ? (
          <li className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhuma conta ativa.
          </li>
        ) : (
          accounts.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-3"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {a.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.institutionName}
                  </p>
                </div>
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                {formatPredictiveCashFlowMoney(a.initialBalance)}
              </p>
            </li>
          ))
        )}
      </ul>

      <form
        onSubmit={onSubmit}
        className="space-y-3 border-t border-border pt-4"
      >
        <p className={financeModuleFilterLabelClass()}>
          Nova conta (grava na Tesouraria)
        </p>
        <input
          className={financeModuleFilterFieldClass()}
          placeholder="Nome / banco"
          value={name}
          disabled={disabled || busy}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className={financeModuleFilterFieldClass()}
          placeholder="Saldo inicial (ex: 10000,00)"
          value={initialBalance}
          disabled={disabled || busy}
          onChange={(e) => setInitialBalance(e.target.value)}
        />
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        <button
          type="submit"
          disabled={disabled || busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm font-semibold text-sky-900 hover:bg-sky-100 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Adicionar conta
        </button>
      </form>
    </section>
  );
}
