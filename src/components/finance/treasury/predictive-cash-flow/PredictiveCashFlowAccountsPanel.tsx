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

export type PredictiveCashFlowAccountsPanelProps = {
  accounts: readonly PredictiveCashFlowAccount[];
  companyCode: string | null;
  disabled?: boolean;
  onChanged: () => void;
};

function glassInputClass() {
  return "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky-400/40";
}

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
      className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl"
      data-testid="predictive-cf-accounts"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Contas</h3>
          <p className="text-xs text-slate-400">
            Saldos canônicos · consolidado{" "}
            <span className="tabular-nums text-emerald-400">
              {formatPredictiveCashFlowMoney(consolidated)}
            </span>
          </p>
        </div>
        <Link
          to="/finance/treasury/accounts"
          className="text-xs text-sky-300 hover:text-sky-200"
        >
          Gerenciar
        </Link>
      </div>

      <ul className="mb-3 max-h-40 space-y-2 overflow-y-auto pr-1">
        {accounts.length === 0 ? (
          <li className="text-xs text-slate-500">Nenhuma conta ativa.</li>
        ) : (
          accounts.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-black/20 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-100">{a.name}</p>
                  <p className="truncate text-[11px] text-slate-500">
                    {a.institutionName}
                  </p>
                </div>
              </div>
              <p className="shrink-0 text-sm tabular-nums text-slate-200">
                {formatPredictiveCashFlowMoney(a.initialBalance)}
              </p>
            </li>
          ))
        )}
      </ul>

      <form onSubmit={onSubmit} className="space-y-2 border-t border-white/10 pt-3">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">
          Nova conta (grava na Tesouraria)
        </p>
        <input
          className={glassInputClass()}
          placeholder="Nome / banco"
          value={name}
          disabled={disabled || busy}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className={glassInputClass()}
          placeholder="Saldo inicial (ex: 10000,00)"
          value={initialBalance}
          disabled={disabled || busy}
          onChange={(e) => setInitialBalance(e.target.value)}
        />
        {error ? <p className="text-xs text-rose-400">{error}</p> : null}
        <button
          type="submit"
          disabled={disabled || busy}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-sky-500/20 px-3 py-2 text-sm font-medium text-sky-100 hover:bg-sky-500/30 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar conta
        </button>
      </form>
    </section>
  );
}
