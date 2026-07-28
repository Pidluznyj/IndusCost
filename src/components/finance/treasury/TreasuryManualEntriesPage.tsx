import React, { useCallback, useEffect, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_ACCOUNTS_PATH,
  TREASURY_LEDGER_ENTRIES_PATH,
} from "@/src/lib/treasury/contracts/treasuryContracts.js";
import type { TreasuryLedgerEntryDto } from "@/src/lib/treasury/contracts/treasuryDto.js";

type AccountOption = { id: string; code: string; name: string };

/**
 * Lançamentos manuais locais — não alteram títulos oficiais Nomus.
 */
export function TreasuryManualEntriesPage() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("");
  const [items, setItems] = useState<TreasuryLedgerEntryDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("0.00");
  const [direction, setDirection] = useState<"DEBIT" | "CREDIT">("DEBIT");
  const [civilDate, setCivilDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [memo, setMemo] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const accRes = await fetchJsonOk<{
        items: Array<{ id: string; code: string; name: string }>;
      }>(`${TREASURY_ACCOUNTS_PATH}?pageSize=100`);
      setAccounts(accRes.items ?? []);
      if (!accountId && accRes.items?.[0]) {
        setAccountId(accRes.items[0].id);
      }
      const q = new URLSearchParams();
      if (accountId) q.set("accountId", accountId);
      const listRes = await fetchJsonOk<{ items: TreasuryLedgerEntryDto[] }>(
        `${TREASURY_LEDGER_ENTRIES_PATH}?${q.toString()}`
      );
      setItems(listRes.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar lançamentos.");
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await fetchJsonOk(`${TREASURY_LEDGER_ENTRIES_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          civilDate,
          amount,
          direction,
          nature: "MANUAL",
          memo: memo || null,
          counterpartRef: null,
        }),
      });
      setMemo("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar lançamento.");
    }
  }

  async function onReverse(entry: TreasuryLedgerEntryDto) {
    const justification = window.prompt("Justificativa da reversão:");
    if (!justification?.trim()) return;
    setError(null);
    try {
      await fetchJsonOk(`${TREASURY_LEDGER_ENTRIES_PATH}/${entry.id}/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: entry.version,
          justification,
        }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao reverter.");
    }
  }

  return (
    <div className="space-y-4" data-testid="treasury-manual-entries-page">
      <div>
        <h2 className="text-lg font-semibold">Lançamentos manuais</h2>
        <p className="text-sm text-muted-foreground">
          Extrato local da conta. Não altera títulos oficiais Nomus nem apaga
          histórico (use reversão).
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          Conta
          <select
            className="ml-2 rounded border px-2 py-1"
            value={accountId}
            onChange={(ev) => setAccountId(ev.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <form
        onSubmit={onCreate}
        className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2"
      >
        <label className="text-sm">
          Data
          <input
            type="date"
            className="ml-2 rounded border px-2 py-1"
            value={civilDate}
            onChange={(ev) => setCivilDate(ev.target.value)}
            required
          />
        </label>
        <label className="text-sm">
          Valor
          <input
            className="ml-2 rounded border px-2 py-1"
            value={amount}
            onChange={(ev) => setAmount(ev.target.value)}
            required
          />
        </label>
        <label className="text-sm">
          Direção
          <select
            className="ml-2 rounded border px-2 py-1"
            value={direction}
            onChange={(ev) =>
              setDirection(ev.target.value as "DEBIT" | "CREDIT")
            }
          >
            <option value="DEBIT">Débito</option>
            <option value="CREDIT">Crédito</option>
          </select>
        </label>
        <label className="text-sm sm:col-span-2">
          Memo
          <input
            className="ml-2 w-full rounded border px-2 py-1"
            value={memo}
            onChange={(ev) => setMemo(ev.target.value)}
          />
        </label>
        <button
          type="submit"
          className="rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
        >
          Criar lançamento
        </button>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2">Data</th>
              <th>Direção</th>
              <th>Valor</th>
              <th>Status</th>
              <th>Memo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-border/60">
                <td className="py-2">{item.civilDate}</td>
                <td>{item.direction}</td>
                <td>{item.amount}</td>
                <td>{item.status}</td>
                <td>{item.memo}</td>
                <td>
                  {item.status === "ACTIVE" && item.nature !== "REVERSAL" ? (
                    <button
                      type="button"
                      className="text-xs font-semibold text-destructive"
                      onClick={() => void onReverse(item)}
                    >
                      Reverter
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-4 text-muted-foreground">
                  Nenhum lançamento neste filtro.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
