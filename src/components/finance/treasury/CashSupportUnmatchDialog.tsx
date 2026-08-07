/**
 * Desfazer (soft-unmatch) de conciliação no Apoio ao Caixa (CS-016).
 * Delega ao motor oficial (`unmatchTreasuryReconciliation`) — registro
 * preservado, não é exclusão.
 */

import React, { useState } from "react";
import type { TreasuryReconciliationMatchDto } from "@/src/lib/treasury/contracts/index.js";
import { formatTreasuryBankMoney } from "@/src/lib/treasury/treasuryBankMovementsUi.js";

export function CashSupportUnmatchDialog(props: {
  open: boolean;
  match: TreasuryReconciliationMatchDto | null;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (input: { reason: string }) => void;
}) {
  const { open, match, busy, error, onCancel, onConfirm } = props;
  const [reason, setReason] = useState("");

  if (!open || !match) return null;
  const canSubmit = reason.trim().length >= 3 && !busy;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="cash-support-unmatch-dialog"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md space-y-3 rounded-xl border border-border bg-card p-5 shadow-lg">
        <h2 className="text-base font-semibold text-foreground">Desfazer conciliação</h2>
        <p className="text-xs text-muted-foreground">
          O match volta a PENDING/PARTIAL, o histórico é preservado (soft) e o movimento
          recupera a capacidade liberada. Não altera títulos oficiais Nomus.
        </p>
        <p className="text-xs">
          Valor: <strong>{formatTreasuryBankMoney(match.matchedAmount)}</strong>
        </p>
        <textarea
          className="w-full rounded border border-border px-2 py-1 text-xs"
          placeholder="Motivo (obrigatório)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-testid="cash-support-unmatch-reason"
        />
        {error ? (
          <p className="text-xs text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="text-xs text-muted-foreground" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
            disabled={!canSubmit}
            onClick={() => onConfirm({ reason: reason.trim() })}
            data-testid="cash-support-unmatch-submit"
          >
            {busy ? "Enviando…" : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
