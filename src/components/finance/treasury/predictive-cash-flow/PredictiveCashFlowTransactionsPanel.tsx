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
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";

export type PredictiveCashFlowTransactionsPanelProps = {
  transactions: readonly PredictiveCashFlowTransaction[];
  accounts: readonly PredictiveCashFlowAccount[];
  disabled?: boolean;
  onChanged: () => void;
};

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
      className="rounded-xl border border-border bg-card p-5 shadow-sm"
      data-testid="predictive-cf-transactions"
    >
      <div className="mb-5">
        <h3 className="text-base font-semibold text-foreground">Lançamentos</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Títulos e movimentos da projeção canônica · novos manuais vão ao ledger
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="mb-5 grid grid-cols-1 gap-3 border-b border-border pb-5 sm:grid-cols-2 lg:grid-cols-3"
      >
        <label className="space-y-1.5 sm:col-span-2 lg:col-span-3">
          <span className={financeModuleFilterLabelClass()}>Descrição</span>
          <input
            className={financeModuleFilterFieldClass()}
            placeholder="Descrição"
            value={description}
            disabled={disabled || busy}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="space-y-1.5">
          <span className={financeModuleFilterLabelClass()}>Valor</span>
          <input
            className={financeModuleFilterFieldClass()}
            placeholder="0,00"
            value={amount}
            disabled={disabled || busy}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="space-y-1.5">
          <span className={financeModuleFilterLabelClass()}>Data</span>
          <input
            type="date"
            className={financeModuleFilterFieldClass()}
            value={date}
            disabled={disabled || busy}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="space-y-1.5">
          <span className={financeModuleFilterLabelClass()}>Tipo</span>
          <select
            className={financeModuleFilterFieldClass()}
            value={type}
            disabled={disabled || busy}
            onChange={(e) =>
              setType(e.target.value === "payable" ? "payable" : "receivable")
            }
          >
            <option value="receivable">A receber</option>
            <option value="payable">A pagar</option>
          </select>
        </label>
        <label className="space-y-1.5 sm:col-span-2 lg:col-span-2">
          <span className={financeModuleFilterLabelClass()}>Conta</span>
          <select
            className={financeModuleFilterFieldClass()}
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
        </label>
        <div className="flex items-end sm:col-span-2 lg:col-span-1">
          <button
            type="submit"
            disabled={disabled || busy || accounts.length === 0}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Adicionar lançamento
          </button>
        </div>
        {error ? (
          <p className="text-sm text-rose-700 sm:col-span-2 lg:col-span-3">
            {error}
          </p>
        ) : null}
      </form>

      <ul className="space-y-2">
        {sorted.length === 0 ? (
          <li className="rounded-lg border border-dashed border-border px-3 py-10 text-center text-sm text-muted-foreground">
            Nenhum lançamento no horizonte selecionado.
          </li>
        ) : (
          sorted.map((tx) => {
            const receivable = tx.type === "receivable";
            return (
              <li
                key={tx.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      receivable ? "bg-emerald-600" : "bg-rose-600"
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {tx.description}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatPredictiveCashFlowDate(tx.date)}
                      {tx.isPaid ? " · realizado" : ""}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {receivable ? (
                    <ArrowDownLeft className="h-4 w-4 text-emerald-700" />
                  ) : (
                    <ArrowUpRight className="h-4 w-4 text-rose-700" />
                  )}
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      receivable ? "text-emerald-700" : "text-rose-700"
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
