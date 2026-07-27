import React from "react";
import { TREASURY_BALANCE_ORIGIN_LABELS } from "@/src/lib/treasury/treasuryAccountsUi.js";
import type { TreasuryCreateBalanceSnapshotBody } from "@/src/lib/treasury/treasuryBalancesApi.js";
import {
  TREASURY_BALANCE_CONFIRM_TITLE,
  formatTreasuryApiMoneyToPtBr,
  formatTreasuryBalanceDateTimePtBr,
} from "@/src/lib/treasury/treasuryBalancesUi.js";

type Props = {
  accountLabel: string;
  payload: TreasuryCreateBalanceSnapshotBody;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function TreasuryBalanceConfirmDialog({
  accountLabel,
  payload,
  saving,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="treasury-balance-confirm-title"
        data-testid="treasury-balance-confirm-dialog"
        className="w-full max-w-md rounded-t-xl border border-border bg-card p-4 shadow-sm sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="treasury-balance-confirm-title"
          className="text-lg font-semibold"
        >
          {TREASURY_BALANCE_CONFIRM_TITLE}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">{accountLabel}</p>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Disponível</dt>
            <dd className="font-semibold tabular-nums">
              {formatTreasuryApiMoneyToPtBr(payload.availableBalance)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Bloqueado</dt>
            <dd className="tabular-nums">
              {formatTreasuryApiMoneyToPtBr(payload.blockedBalance)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Aplicação</dt>
            <dd className="tabular-nums">
              {formatTreasuryApiMoneyToPtBr(payload.investmentsBalance)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Limite utilizado</dt>
            <dd className="tabular-nums">
              {formatTreasuryApiMoneyToPtBr(payload.usedLimit)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Data/hora</dt>
            <dd className="tabular-nums text-right">
              {formatTreasuryBalanceDateTimePtBr(payload.referenceAt)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Origem</dt>
            <dd>{TREASURY_BALANCE_ORIGIN_LABELS[payload.origin]}</dd>
          </div>
          {payload.notes ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Observação</dt>
              <dd className="text-right">{payload.notes}</dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            onClick={onCancel}
            disabled={saving}
          >
            Voltar
          </button>
          <button
            type="button"
            className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            onClick={onConfirm}
            disabled={saving}
            data-testid="treasury-balance-confirm-save"
          >
            {saving ? "Salvando…" : "Confirmar e salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
