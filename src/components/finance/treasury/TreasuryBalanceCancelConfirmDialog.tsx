/**
 * Confirmação de exclusão (cancelamento lógico) de um saldo informado.
 * Restrito a SUPER_ADMIN — exige justificativa.
 */

import React, { useMemo, useState } from "react";
import type { TreasuryBalanceSnapshotDto } from "@/src/lib/treasury/contracts/index.js";
import {
  formatTreasuryBalanceCurrencyPtBr,
  formatTreasuryBalanceDateTimePtBr,
} from "@/src/lib/treasury/treasuryBalancesUi.js";

export function TreasuryBalanceCancelConfirmDialog(props: {
  row: TreasuryBalanceSnapshotDto | null;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { row, busy, error, onCancel, onConfirm } = props;
  const [reason, setReason] = useState("");

  const canSubmit = useMemo(
    () => reason.trim().length >= 3 && !busy,
    [reason, busy]
  );

  if (!row) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="treasury-balance-cancel-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="treasury-balance-cancel-title"
    >
      <div className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-card p-5 shadow-lg">
        <div>
          <h2
            id="treasury-balance-cancel-title"
            className="text-base font-semibold text-foreground"
          >
            Excluir saldo informado
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            O registro deixa de valer em todos os cálculos (saldo atual,
            projeção, relatórios, linha do tempo do Caixa e fechamento
            diário), mas fica preservado no histórico/auditoria. Ação
            restrita a SUPER_ADMIN.
          </p>
        </div>

        <dl className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Referência</dt>
            <dd>{formatTreasuryBalanceDateTimePtBr(row.referenceAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Disponível</dt>
            <dd>
              {formatTreasuryBalanceCurrencyPtBr(
                row.operationalAvailableBalance
              )}
            </dd>
          </div>
        </dl>

        <label className="block space-y-1 text-sm">
          <span className="font-medium">Motivo da exclusão (obrigatório)</span>
          <textarea
            className="min-h-[80px] w-full rounded-lg border border-border bg-background px-3 py-2"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            data-testid="treasury-balance-cancel-reason"
            placeholder="Explique o motivo da exclusão…"
          />
        </label>

        {error ? (
          <p
            className="text-sm text-destructive"
            data-testid="treasury-balance-cancel-error"
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
            Voltar
          </button>
          <button
            type="button"
            className="rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
            disabled={!canSubmit}
            data-testid="treasury-balance-cancel-submit"
            onClick={() => onConfirm(reason.trim())}
          >
            {busy ? "Excluindo…" : "Confirmar exclusão"}
          </button>
        </div>
      </div>
    </div>
  );
}
