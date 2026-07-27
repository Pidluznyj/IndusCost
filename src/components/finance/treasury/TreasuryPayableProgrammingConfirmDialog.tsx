import React from "react";
import type { TreasuryPayableProgrammingImpactDto } from "@/src/lib/treasury/contracts/index.js";
import {
  describeTreasuryPayableProgrammingRisk,
  formatTreasuryPayableMoney,
} from "@/src/lib/treasury/treasuryPayablesUi.js";

type Props = {
  accountLabel: string;
  impact: TreasuryPayableProgrammingImpactDto;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function TreasuryPayableProgrammingConfirmDialog({
  accountLabel,
  impact,
  saving,
  onCancel,
  onConfirm,
}: Props) {
  const risk = describeTreasuryPayableProgrammingRisk(impact);
  const risky =
    impact.createsNegativeAccountBalance ||
    impact.createsNegativeConsolidatedBalance;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="treasury-payable-program-confirm-title"
        data-testid="treasury-payable-program-confirm-dialog"
        className="w-full max-w-md rounded-t-xl border border-border bg-card p-4 shadow-sm sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="treasury-payable-program-confirm-title"
          className="text-lg font-semibold"
        >
          Confirmar programação
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">{accountLabel}</p>

        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Valor programado</dt>
            <dd className="font-semibold tabular-nums">
              {formatTreasuryPayableMoney(impact.scheduledAmount)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Saldo conta (antes)</dt>
            <dd className="tabular-nums">
              {formatTreasuryPayableMoney(impact.accountBalanceBefore)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Saldo projetado da conta</dt>
            <dd
              className={`font-semibold tabular-nums ${
                impact.createsNegativeAccountBalance ? "text-rose-700" : ""
              }`}
              data-testid="treasury-payable-program-account-after"
            >
              {formatTreasuryPayableMoney(impact.accountBalanceAfter)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Saldo consolidado (antes)</dt>
            <dd className="tabular-nums">
              {formatTreasuryPayableMoney(impact.consolidatedBalanceBefore)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Saldo consolidado projetado</dt>
            <dd
              className={`font-semibold tabular-nums ${
                impact.createsNegativeConsolidatedBalance ? "text-rose-700" : ""
              }`}
              data-testid="treasury-payable-program-consolidated-after"
            >
              {formatTreasuryPayableMoney(impact.consolidatedBalanceAfter)}
            </dd>
          </div>
        </dl>

        <div
          className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
            risky
              ? "border-rose-200 bg-rose-50 text-rose-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
          data-testid="treasury-payable-program-risk"
          role="status"
        >
          {risk}
          {impact.alerts.length > 0 ? (
            <ul className="mt-1 list-disc pl-4 text-xs">
              {impact.alerts.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="mt-4 flex justify-end gap-2">
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
            data-testid="treasury-payable-program-confirm"
          >
            {saving ? "Confirmando…" : "Confirmar programação"}
          </button>
        </div>
      </div>
    </div>
  );
}
