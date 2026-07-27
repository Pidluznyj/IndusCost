import React from "react";
import { TREASURY_ACCOUNT_ACCESS_LEVELS } from "@/src/lib/treasury/contracts/index.js";
import type { TreasuryFinancialAccountAccessDto } from "@/src/lib/treasury/contracts/index.js";
import { TREASURY_ACCESS_LEVEL_LABELS } from "@/src/lib/treasury/treasuryAccountsUi.js";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";
import {
  FinanceModuleEmptyState,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { cn } from "@/src/lib/utils";

export type TreasuryAccessDraft = {
  userId: string;
  accessLevel: (typeof TREASURY_ACCOUNT_ACCESS_LEVELS)[number];
  canViewBalance: boolean;
  canMutateBalance: boolean;
  notes: string;
};

type Props = {
  accountLabel: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  rows: TreasuryFinancialAccountAccessDto[];
  draft: TreasuryAccessDraft;
  onDraftChange: (next: TreasuryAccessDraft) => void;
  onClose: () => void;
  onSave: () => void;
};

export function TreasuryAccountAccessDialog({
  accountLabel,
  loading,
  saving,
  error,
  rows,
  draft,
  onDraftChange,
  onClose,
  onSave,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="treasury-account-access-title"
        data-testid="treasury-account-access-dialog"
        className={cn(
          "max-h-[92vh] w-full overflow-y-auto rounded-t-xl border border-border bg-card p-4 shadow-sm sm:max-w-xl sm:rounded-xl sm:p-5"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="treasury-account-access-title"
          className="text-lg font-semibold text-foreground"
        >
          Usuários autorizados
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">{accountLabel}</p>

        {error ? (
          <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="mt-4 space-y-3">
          {loading ? (
            <FinanceModuleLoadingBlock label="Carregando acessos…" />
          ) : rows.length === 0 ? (
            <FinanceModuleEmptyState
              title="Nenhum usuário autorizado"
              description="Conceda acesso informando o ID do usuário e o nível."
            />
          ) : (
            <ul
              className="divide-y divide-border rounded-lg border border-border"
              data-testid="treasury-account-access-list"
            >
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-semibold">{row.userId}</p>
                    <p className="text-xs text-muted-foreground">
                      {TREASURY_ACCESS_LEVEL_LABELS[row.accessLevel]}
                      {row.isActive ? "" : " · revogado"}
                      {row.canViewBalance ? " · saldo" : ""}
                      {row.canMutateBalance ? " · mutar saldo" : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-xs font-semibold text-primary self-start"
                    onClick={() =>
                      onDraftChange({
                        userId: row.userId,
                        accessLevel: row.accessLevel,
                        canViewBalance: row.canViewBalance,
                        canMutateBalance: row.canMutateBalance,
                        notes: "",
                      })
                    }
                  >
                    Editar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className={financeModuleFilterLabelClass()}>ID do usuário</span>
            <input
              className={financeModuleFilterFieldClass()}
              value={draft.userId}
              onChange={(e) =>
                onDraftChange({ ...draft, userId: e.target.value })
              }
              data-testid="treasury-account-access-user-id"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className={financeModuleFilterLabelClass()}>Nível</span>
            <select
              className={financeModuleFilterFieldClass()}
              value={draft.accessLevel}
              onChange={(e) =>
                onDraftChange({
                  ...draft,
                  accessLevel: e.target
                    .value as TreasuryAccessDraft["accessLevel"],
                })
              }
            >
              {TREASURY_ACCOUNT_ACCESS_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {TREASURY_ACCESS_LEVEL_LABELS[level]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className={financeModuleFilterLabelClass()}>Notas</span>
            <input
              className={financeModuleFilterFieldClass()}
              value={draft.notes}
              onChange={(e) =>
                onDraftChange({ ...draft, notes: e.target.value })
              }
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.canViewBalance}
              onChange={(e) =>
                onDraftChange({ ...draft, canViewBalance: e.target.checked })
              }
            />
            Pode ver saldo
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.canMutateBalance}
              onChange={(e) =>
                onDraftChange({ ...draft, canMutateBalance: e.target.checked })
              }
            />
            Pode alterar saldo
          </label>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            onClick={onClose}
            disabled={saving}
          >
            Fechar
          </button>
          <button
            type="button"
            className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            disabled={saving || !draft.userId.trim()}
            onClick={onSave}
            data-testid="treasury-account-access-save"
          >
            {saving ? "Salvando…" : "Conceder / atualizar"}
          </button>
        </div>
      </div>
    </div>
  );
}
