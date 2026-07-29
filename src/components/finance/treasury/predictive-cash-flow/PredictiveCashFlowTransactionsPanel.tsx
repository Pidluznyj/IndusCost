import React, { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Plus } from "lucide-react";
import type {
  PredictiveCashFlowAccount,
  PredictiveCashFlowTransaction,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import {
  formatPredictiveCashFlowDate,
  formatPredictiveCashFlowMoney,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { createTreasuryManualLedgerEntry } from "@/src/lib/treasury/treasuryManualLedgerApi.js";
import { todayCivilDateLocal } from "@/src/lib/treasury/treasuryAgendaUi.js";

export type PredictiveCashFlowTransactionsPanelProps = {
  transactions: readonly PredictiveCashFlowTransaction[];
  accounts: readonly PredictiveCashFlowAccount[];
  disabled?: boolean;
  onChanged: () => void;
};

function glassInputClass() {
  return "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky-400/40";
}

function normalizeAmountInput(raw: string): string | null {
  const n = Number(String(raw).replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

export function PredictiveCashFlowTransactionsPanel({
  transactions,
  accounts,
  disabled,
  onChanged,
}: PredictiveCashFlowTransactionsPanelProps) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayCivilDateLocal());
  const [type, setType] = useState<"receivable" | "payable">("receivable");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(
    () =>
      [...transactions].sort((a, b) => {
        const byDate = a.date.localeCompare(b.date);
        if (byDate !== 0) return byDate;
        return a.description.localeCompare(b.description);
      }),
    [transactions]
  );

  React.useEffect(() => {
    if (!accountId && accounts[0]?.id) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = normalizeAmountInput(amount);
    if (!amt) {
      setError("Informe um valor válido maior que zero.");
      return;
    }
    if (!accountId) {
      setError("Selecione uma conta.");
      return;
    }
    if (!date.trim()) {
      setError("Informe a data.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createTreasuryManualLedgerEntry({
        accountId,
        civilDate: date.trim(),
        amount: amt,
        // CREDIT = entrada (a receber); DEBIT = saída (a pagar)
        direction: type === "receivable" ? "CREDIT" : "DEBIT",
        nature: "MANUAL",
        memo: description.trim() || null,
      });
      setDescription("");
      setAmount("");
      onChanged();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível gravar o lançamento manual."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="flex h-full min-h-[22rem] flex-col rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl"
      data-testid="predictive-cf-transactions"
    >
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-100">Lançamentos</h3>
        <p className="text-xs text-slate-400">
          Títulos e movimentos da projeção canônica · novos manuais vão ao ledger
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="mb-3 grid grid-cols-1 gap-2 border-b border-white/10 pb-3 sm:grid-cols-2 lg:grid-cols-6"
      >
        <input
          className={`${glassInputClass()} lg:col-span-2`}
          placeholder="Descrição"
          value={description}
          disabled={disabled || busy}
          onChange={(e) => setDescription(e.target.value)}
        />
        <input
          className={glassInputClass()}
          placeholder="Valor"
          value={amount}
          disabled={disabled || busy}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input
          type="date"
          className={glassInputClass()}
          value={date}
          disabled={disabled || busy}
          onChange={(e) => setDate(e.target.value)}
        />
        <select
          className={glassInputClass()}
          value={type}
          disabled={disabled || busy}
          onChange={(e) =>
            setType(e.target.value === "payable" ? "payable" : "receivable")
          }
        >
          <option value="receivable">A receber</option>
          <option value="payable">A pagar</option>
        </select>
        <select
          className={glassInputClass()}
          value={accountId}
          disabled={disabled || busy || accounts.length === 0}
          onChange={(e) => setAccountId(e.target.value)}
        >
          {accounts.length === 0 ? (
            <option value="">Sem contas</option>
          ) : (
            accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))
          )}
        </select>
        <button
          type="submit"
          disabled={disabled || busy || accounts.length === 0}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-emerald-500/20 px-3 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-50 sm:col-span-2 lg:col-span-6"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar lançamento
        </button>
        {error ? (
          <p className="text-xs text-rose-400 sm:col-span-2 lg:col-span-6">
            {error}
          </p>
        ) : null}
      </form>

      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {sorted.length === 0 ? (
          <li className="py-8 text-center text-sm text-slate-500">
            Nenhum lançamento no horizonte selecionado.
          </li>
        ) : (
          sorted.map((tx) => {
            const receivable = tx.type === "receivable";
            return (
              <li
                key={tx.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/20 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      receivable ? "bg-emerald-400" : "bg-rose-400"
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-100">
                      {tx.description}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {formatPredictiveCashFlowDate(tx.date)}
                      {tx.isPaid ? " · realizado" : ""}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {receivable ? (
                    <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <ArrowUpRight className="h-3.5 w-3.5 text-rose-400" />
                  )}
                  <span
                    className={`text-sm tabular-nums ${
                      receivable ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {formatPredictiveCashFlowMoney(tx.amount)}
                  </span>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
