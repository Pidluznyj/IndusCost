import React from "react";
import {
  TREASURY_ACCOUNT_TYPES,
  TREASURY_ACCOUNT_LIQUIDITIES,
  TREASURY_BALANCE_ORIGINS,
} from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_ACCOUNT_TYPE_LABELS,
  TREASURY_BALANCE_ORIGIN_LABELS,
  TREASURY_LIQUIDITY_LABELS,
  type TreasuryAccountFormState,
} from "@/src/lib/treasury/treasuryAccountsUi.js";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";
import { cn } from "@/src/lib/utils";

type Props = {
  mode: "create" | "edit";
  form: TreasuryAccountFormState;
  saving: boolean;
  error: string | null;
  onChange: (next: TreasuryAccountFormState) => void;
  onClose: () => void;
  onSave: () => void;
};

export function TreasuryAccountFormDialog({
  mode,
  form,
  saving,
  error,
  onChange,
  onClose,
  onSave,
}: Props) {
  const set = <K extends keyof TreasuryAccountFormState>(
    key: K,
    value: TreasuryAccountFormState[K]
  ) => onChange({ ...form, [key]: value });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="treasury-account-form-title"
        data-testid="treasury-account-form-dialog"
        className={cn(
          "max-h-[92vh] w-full overflow-y-auto rounded-t-xl border border-border bg-card p-4 shadow-sm sm:max-w-2xl sm:rounded-xl sm:p-5"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="treasury-account-form-title"
          className="text-lg font-semibold text-foreground"
        >
          {mode === "create" ? "Nova conta financeira" : "Editar conta financeira"}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Agência e número devem ser informados já mascarados (ex.: ****-1 /
          ******89). Dados sensíveis não são armazenados em claro na UI.
        </p>

        {error ? (
          <p
            className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            data-testid="treasury-account-form-error"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {mode === "create" ? (
            <>
              <label className="space-y-1 text-sm">
                <span className={financeModuleFilterLabelClass()}>
                  Empresa (código)
                </span>
                <input
                  className={financeModuleFilterFieldClass()}
                  value={form.companyCode}
                  onChange={(e) => set("companyCode", e.target.value)}
                  data-testid="treasury-account-field-company-code"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className={financeModuleFilterLabelClass()}>
                  Empresa (nome)
                </span>
                <input
                  className={financeModuleFilterFieldClass()}
                  value={form.companyName}
                  onChange={(e) => set("companyName", e.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className={financeModuleFilterLabelClass()}>Código</span>
                <input
                  className={financeModuleFilterFieldClass()}
                  value={form.code}
                  onChange={(e) => set("code", e.target.value)}
                  data-testid="treasury-account-field-code"
                />
              </label>
            </>
          ) : null}

          <label className="space-y-1 text-sm sm:col-span-2">
            <span className={financeModuleFilterLabelClass()}>Nome</span>
            <input
              className={financeModuleFilterFieldClass()}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              data-testid="treasury-account-field-name"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className={financeModuleFilterLabelClass()}>Instituição</span>
            <input
              className={financeModuleFilterFieldClass()}
              value={form.institutionName}
              onChange={(e) => set("institutionName", e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className={financeModuleFilterLabelClass()}>
              Código instituição
            </span>
            <input
              className={financeModuleFilterFieldClass()}
              value={form.institutionCode}
              onChange={(e) => set("institutionCode", e.target.value)}
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className={financeModuleFilterLabelClass()}>Tipo</span>
            <select
              className={financeModuleFilterFieldClass()}
              value={form.accountType}
              onChange={(e) =>
                set("accountType", e.target.value as TreasuryAccountFormState["accountType"])
              }
            >
              {TREASURY_ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TREASURY_ACCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className={financeModuleFilterLabelClass()}>Liquidez</span>
            <select
              className={financeModuleFilterFieldClass()}
              value={form.liquidity}
              onChange={(e) =>
                set("liquidity", e.target.value as TreasuryAccountFormState["liquidity"])
              }
              data-testid="treasury-account-field-liquidity"
            >
              {TREASURY_ACCOUNT_LIQUIDITIES.map((t) => (
                <option key={t} value={t}>
                  {TREASURY_LIQUIDITY_LABELS[t]}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className={financeModuleFilterLabelClass()}>
              Agência (mascarada)
            </span>
            <input
              className={financeModuleFilterFieldClass()}
              value={form.agencyMasked}
              onChange={(e) => set("agencyMasked", e.target.value)}
              placeholder="****-1"
              autoComplete="off"
              data-testid="treasury-account-field-agency"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className={financeModuleFilterLabelClass()}>
              Conta (mascarada)
            </span>
            <input
              className={financeModuleFilterFieldClass()}
              value={form.accountNumberMasked}
              onChange={(e) => set("accountNumberMasked", e.target.value)}
              placeholder="******89"
              autoComplete="off"
              data-testid="treasury-account-field-account-number"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className={financeModuleFilterLabelClass()}>Saldo mínimo</span>
            <input
              className={financeModuleFilterFieldClass()}
              value={form.minimumBalance}
              onChange={(e) => set("minimumBalance", e.target.value)}
              inputMode="decimal"
              data-testid="treasury-account-field-minimum-balance"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className={financeModuleFilterLabelClass()}>
              Origem padrão do saldo
            </span>
            <select
              className={financeModuleFilterFieldClass()}
              value={form.defaultBalanceOrigin}
              onChange={(e) =>
                set(
                  "defaultBalanceOrigin",
                  e.target.value as TreasuryAccountFormState["defaultBalanceOrigin"]
                )
              }
            >
              {TREASURY_BALANCE_ORIGINS.map((t) => (
                <option key={t} value={t}>
                  {TREASURY_BALANCE_ORIGIN_LABELS[t]}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className={financeModuleFilterLabelClass()}>Ordem</span>
            <input
              className={financeModuleFilterFieldClass()}
              value={form.sortOrder}
              onChange={(e) => set("sortOrder", e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className={financeModuleFilterLabelClass()}>
              ID conta Nomus (opcional)
            </span>
            <input
              className={financeModuleFilterFieldClass()}
              value={form.nomusBankAccountId}
              onChange={(e) => set("nomusBankAccountId", e.target.value)}
            />
          </label>

          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.includeInConsolidated}
              onChange={(e) => set("includeInConsolidated", e.target.checked)}
              data-testid="treasury-account-field-consolidated"
            />
            <span>Incluir no consolidado</span>
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.allowNegativeBalance}
              onChange={(e) => set("allowNegativeBalance", e.target.checked)}
            />
            <span>Permitir saldo negativo</span>
          </label>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
            className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            disabled={saving}
            onClick={onSave}
            data-testid="treasury-account-form-save"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
