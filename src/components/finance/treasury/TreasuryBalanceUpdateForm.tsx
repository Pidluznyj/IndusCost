import React from "react";
import { TREASURY_BALANCE_ORIGINS } from "@/src/lib/treasury/contracts/index.js";
import { TREASURY_BALANCE_ORIGIN_LABELS } from "@/src/lib/treasury/treasuryAccountsUi.js";
import {
  maskTreasuryMoneyInputPtBr,
  type TreasuryBalanceFormState,
} from "@/src/lib/treasury/treasuryBalancesUi.js";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";

type Props = {
  form: TreasuryBalanceFormState;
  canManage: boolean;
  saving: boolean;
  error: string | null;
  isConflict: boolean;
  onChange: (next: TreasuryBalanceFormState) => void;
  onSubmitRequest: () => void;
  onReload: () => void;
};

export function TreasuryBalanceUpdateForm({
  form,
  canManage,
  saving,
  error,
  isConflict,
  onChange,
  onSubmitRequest,
  onReload,
}: Props) {
  const setMoney = (
    key: keyof Pick<
      TreasuryBalanceFormState,
      | "availableBalance"
      | "blockedBalance"
      | "investmentsBalance"
      | "usedLimit"
    >,
    raw: string
  ) => {
    onChange({ ...form, [key]: maskTreasuryMoneyInputPtBr(raw) });
  };

  if (!canManage) {
    return (
      <p
        className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
        data-testid="treasury-balance-form-readonly"
      >
        Você pode consultar o histórico, mas não tem permissão para informar
        novo saldo.
      </p>
    );
  }

  return (
    <form
      className="space-y-4 rounded-xl border border-border bg-card p-4"
      data-testid="treasury-balance-update-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmitRequest();
      }}
    >
      <div>
        <h3 className="text-sm font-semibold">Informar novo saldo</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Digite valores em pt-BR (ex.: 1.234,56). A API recebe strings decimais
          sem formatação monetária.
        </p>
      </div>

      {error ? (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="treasury-balance-form-error"
          role="alert"
        >
          <p>{error}</p>
          {isConflict ? (
            <button
              type="button"
              className="mt-2 text-xs font-semibold underline"
              onClick={onReload}
              data-testid="treasury-balance-conflict-reload"
            >
              Recarregar saldo atual
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className={financeModuleFilterLabelClass()}>
            Saldo disponível
          </span>
          <input
            className={financeModuleFilterFieldClass()}
            value={form.availableBalance}
            onChange={(e) => setMoney("availableBalance", e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            data-testid="treasury-balance-field-available"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className={financeModuleFilterLabelClass()}>Bloqueado</span>
          <input
            className={financeModuleFilterFieldClass()}
            value={form.blockedBalance}
            onChange={(e) => setMoney("blockedBalance", e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            data-testid="treasury-balance-field-blocked"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className={financeModuleFilterLabelClass()}>Aplicação</span>
          <input
            className={financeModuleFilterFieldClass()}
            value={form.investmentsBalance}
            onChange={(e) => setMoney("investmentsBalance", e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            data-testid="treasury-balance-field-investments"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className={financeModuleFilterLabelClass()}>
            Limite utilizado
          </span>
          <input
            className={financeModuleFilterFieldClass()}
            value={form.usedLimit}
            onChange={(e) => setMoney("usedLimit", e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            data-testid="treasury-balance-field-used-limit"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className={financeModuleFilterLabelClass()}>Data e hora</span>
          <input
            type="datetime-local"
            className={financeModuleFilterFieldClass()}
            value={form.referenceLocal}
            onChange={(e) =>
              onChange({ ...form, referenceLocal: e.target.value })
            }
            data-testid="treasury-balance-field-reference"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className={financeModuleFilterLabelClass()}>Origem</span>
          <select
            className={financeModuleFilterFieldClass()}
            value={form.origin}
            onChange={(e) =>
              onChange({
                ...form,
                origin: e.target.value as TreasuryBalanceFormState["origin"],
              })
            }
            data-testid="treasury-balance-field-origin"
          >
            {TREASURY_BALANCE_ORIGINS.map((origin) => (
              <option key={origin} value={origin}>
                {TREASURY_BALANCE_ORIGIN_LABELS[origin]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className={financeModuleFilterLabelClass()}>Observação</span>
          <textarea
            className={financeModuleFilterFieldClass()}
            rows={2}
            value={form.notes}
            onChange={(e) => onChange({ ...form, notes: e.target.value })}
            data-testid="treasury-balance-field-notes"
          />
        </label>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          disabled={saving}
          data-testid="treasury-balance-submit"
        >
          Revisar e salvar
        </button>
      </div>
    </form>
  );
}
