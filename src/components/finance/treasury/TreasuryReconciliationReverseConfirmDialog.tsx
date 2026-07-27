/**
 * Confirmação forte de reversão de conciliação bancária.
 * Exige justificativa + digitação exata de REVERTER.
 */

import React, { useMemo, useState } from "react";
import type { TreasuryReconciliationMatchDto } from "@/src/lib/treasury/contracts/index.js";
import { TREASURY_RECONCILIATION_REVERSE_CONFIRM_PHRASE } from "@/src/lib/treasury/contracts/index.js";
import { formatTreasuryBankMoney } from "@/src/lib/treasury/treasuryBankMovementsUi.js";

export function TreasuryReconciliationReverseConfirmDialog(props: {
  open: boolean;
  match: TreasuryReconciliationMatchDto | null;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (input: { reason: string; confirmPhrase: string }) => void;
}) {
  const { open, match, busy, error, onCancel, onConfirm } = props;
  const [reason, setReason] = useState("");
  const [confirmPhrase, setConfirmPhrase] = useState("");

  const canSubmit = useMemo(() => {
    return (
      reason.trim().length >= 3 &&
      confirmPhrase.trim() === TREASURY_RECONCILIATION_REVERSE_CONFIRM_PHRASE &&
      !busy
    );
  }, [reason, confirmPhrase, busy]);

  if (!open || !match) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="treasury-reconciliation-reverse-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="treasury-reconciliation-reverse-title"
    >
      <div className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-card p-5 shadow-lg">
        <div>
          <h2
            id="treasury-reconciliation-reverse-title"
            className="text-base font-semibold text-foreground"
          >
            Reverter conciliação
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ação irreversível no fluxo operacional: o match será marcado como
            revertido (registro preservado), as alocações deixam de valer e o
            movimento volta ao saldo conciliado anterior. Não altera títulos
            oficiais Nomus.
          </p>
        </div>

        <dl className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Match</dt>
            <dd className="break-all font-mono text-xs">{match.id}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Valor</dt>
            <dd>{formatTreasuryBankMoney(match.matchedAmount, match.currency)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Data</dt>
            <dd>{match.matchedCivilDate}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Movimentos</dt>
            <dd>{match.movements.length}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Alocações</dt>
            <dd>
              {match.allocations.map((a) => a.kind).join(", ") || "—"}
            </dd>
          </div>
        </dl>

        <label className="block space-y-1 text-sm">
          <span className="font-medium">Justificativa (obrigatória)</span>
          <textarea
            className="min-h-[80px] w-full rounded-lg border border-border bg-background px-3 py-2"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            data-testid="treasury-reconciliation-reverse-reason"
            placeholder="Explique o motivo da reversão…"
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span className="font-medium">
            Digite{" "}
            <span className="font-mono text-destructive">
              {TREASURY_RECONCILIATION_REVERSE_CONFIRM_PHRASE}
            </span>{" "}
            para confirmar
          </span>
          <input
            className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono"
            value={confirmPhrase}
            onChange={(e) => setConfirmPhrase(e.target.value)}
            data-testid="treasury-reconciliation-reverse-confirm-phrase"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        {error ? (
          <p
            className="text-sm text-destructive"
            data-testid="treasury-reconciliation-reverse-error"
          >
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm"
            onClick={onCancel}
            disabled={!!busy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
            disabled={!canSubmit}
            data-testid="treasury-reconciliation-reverse-submit"
            onClick={() =>
              onConfirm({
                reason: reason.trim(),
                confirmPhrase: confirmPhrase.trim(),
              })
            }
          >
            {busy ? "Revertendo…" : "Confirmar reversão"}
          </button>
        </div>
      </div>
    </div>
  );
}
