/**
 * Dialog — criar transferência interna.
 */

import React from "react";
import type { TreasuryFinancialAccountDto } from "@/src/lib/treasury/contracts/index.js";
import type { TreasuryTransferFormState } from "@/src/lib/treasury/treasuryTransfersUi.js";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";
import { cn } from "@/src/lib/utils";

export function TreasuryTransferFormDialog(props: {
  open: boolean;
  accounts: TreasuryFinancialAccountDto[];
  form: TreasuryTransferFormState;
  error: string | null;
  saving: boolean;
  onChange: (next: TreasuryTransferFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!props.open) return null;
  const { form, accounts, error, saving, onChange, onClose, onSubmit } = props;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
      data-testid="treasury-transfer-form-dialog"
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "max-h-[92vh] w-full overflow-y-auto rounded-t-xl border border-border bg-card p-4 shadow-sm sm:max-w-lg sm:rounded-xl sm:p-5"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-foreground">
          Nova transferência
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Saída na origem e entrada no destino — efeito zero no consolidado.
        </p>

        {error ? (
          <p
            className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1 sm:col-span-2">
            <span className={financeModuleFilterLabelClass}>Origem</span>
            <select
              className={financeModuleFilterFieldClass}
              value={form.fromAccountId}
              onChange={(e) =>
                onChange({ ...form, fromAccountId: e.target.value })
              }
            >
              <option value="">Selecione…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className={financeModuleFilterLabelClass}>Destino</span>
            <select
              className={financeModuleFilterFieldClass}
              value={form.toAccountId}
              onChange={(e) =>
                onChange({ ...form, toAccountId: e.target.value })
              }
            >
              <option value="">Selecione…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass}>Data</span>
            <input
              type="date"
              className={financeModuleFilterFieldClass}
              value={form.civilDate}
              onChange={(e) =>
                onChange({ ...form, civilDate: e.target.value })
              }
            />
          </label>
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass}>Valor</span>
            <input
              className={financeModuleFilterFieldClass}
              value={form.amount}
              onChange={(e) => onChange({ ...form, amount: e.target.value })}
              placeholder="0.00"
            />
          </label>
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass}>Status inicial</span>
            <select
              className={financeModuleFilterFieldClass}
              value={form.status}
              onChange={(e) =>
                onChange({
                  ...form,
                  status: e.target.value as "FORECAST" | "SCHEDULED",
                })
              }
            >
              <option value="FORECAST">Prevista</option>
              <option value="SCHEDULED">Programada</option>
            </select>
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className={financeModuleFilterLabelClass}>Memo</span>
            <input
              className={financeModuleFilterFieldClass}
              value={form.memo}
              onChange={(e) => onChange({ ...form, memo: e.target.value })}
            />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            onClick={onSubmit}
            disabled={saving}
          >
            {saving ? "Salvando…" : "Criar"}
          </button>
        </div>
      </div>
    </div>
  );
}
