/**
 * Painel — saldos iniciais guiados do dia.
 */

import React from "react";
import type {
  TreasuryDailyOpeningDiffJustificationCode,
  TreasuryGuidedDailyOpeningAccountDto,
  TreasuryGuidedDailyOpeningWorkspaceDto,
} from "@/src/lib/treasury/contracts/index.js";
import { TREASURY_DAILY_OPENING_DIFF_JUSTIFICATION_CODES } from "@/src/lib/treasury/contracts/index.js";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import {
  TREASURY_TODAY_OPENING_DENIED_MESSAGE,
  TREASURY_TODAY_OPENING_DIFF_LABELS,
  TREASURY_TODAY_OPENING_EMPTY_DESCRIPTION,
  TREASURY_TODAY_OPENING_EMPTY_TITLE,
  TREASURY_TODAY_OPENING_JUSTIFICATION_OPTIONS,
  TREASURY_TODAY_OPENING_PAGE_TITLE,
  formatTreasuryTodayOpeningCivilDate,
  formatTreasuryTodayOpeningMoney,
  resolveTreasuryTodayOpeningDraftDiff,
  type TreasuryTodayOpeningDraftRow,
  type TreasuryTodayOpeningViewKind,
} from "@/src/lib/treasury/treasuryTodayOpeningUi.js";

export type TreasuryTodayOpeningPanelProps = {
  viewKind: TreasuryTodayOpeningViewKind;
  data: TreasuryGuidedDailyOpeningWorkspaceDto | null;
  drafts: Record<string, TreasuryTodayOpeningDraftRow>;
  error: string | null;
  saving: boolean;
  canManage: boolean;
  onDraftChange: (
    accountId: string,
    patch: Partial<TreasuryTodayOpeningDraftRow>
  ) => void;
  onConfirmAll: () => void;
  onSave: () => void;
  onRefresh: () => void;
  onDismissError?: () => void;
};

function AccountRow(props: {
  account: TreasuryGuidedDailyOpeningAccountDto;
  draft: TreasuryTodayOpeningDraftRow;
  canManage: boolean;
  onDraftChange: (
    accountId: string,
    patch: Partial<TreasuryTodayOpeningDraftRow>
  ) => void;
}) {
  const { account, draft, canManage, onDraftChange } = props;
  const diff = resolveTreasuryTodayOpeningDraftDiff(account, draft);
  const showDiff = draft.editing && diff.hasDifference && diff.validAmount;

  return (
    <article
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
      data-testid={`treasury-opening-account-${account.accountId}`}
    >
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))_auto] lg:items-start">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">
            {account.accountName}
          </h3>
          <p className="text-xs text-muted-foreground">
            {account.bank ?? account.accountCode}
          </p>
          <p
            className="text-xs font-medium text-foreground"
            data-testid={`treasury-opening-account-${account.accountId}-situation`}
          >
            Situação: {account.situationLabel}
          </p>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Saldo final anterior
          </p>
          <p className="mt-1 text-sm font-semibold tabular-nums">
            {formatTreasuryTodayOpeningMoney(account.previousClosingBalance)}
          </p>
        </div>

        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Saldo inicial de hoje
            </span>
            <input
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm tabular-nums"
              value={draft.displayAmount}
              disabled={!canManage || account.situation === "INACTIVE"}
              onChange={(e) =>
                onDraftChange(account.accountId, {
                  displayAmount: e.target.value,
                  editing: true,
                })
              }
              inputMode="decimal"
              aria-label={`Saldo inicial de ${account.accountName}`}
              data-testid={`treasury-opening-account-${account.accountId}-amount`}
            />
          </label>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Situação
          </p>
          <p className="mt-1 text-sm font-medium">{account.situationLabel}</p>
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-accent"
            disabled={!canManage}
            onClick={() =>
              onDraftChange(account.accountId, {
                editing: true,
                displayAmount: draft.displayAmount,
              })
            }
            data-testid={`treasury-opening-account-${account.accountId}-edit`}
          >
            Editar
          </button>
        </div>
      </div>

      {showDiff ? (
        <div
          className="mt-4 space-y-3 rounded-lg border border-amber-200 bg-amber-50/70 p-3"
          data-testid={`treasury-opening-account-${account.accountId}-diff`}
        >
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">
                {TREASURY_TODAY_OPENING_DIFF_LABELS.previous}
              </dt>
              <dd className="font-semibold tabular-nums">
                {formatTreasuryTodayOpeningMoney(diff.previousClosingBalance)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {TREASURY_TODAY_OPENING_DIFF_LABELS.informed}
              </dt>
              <dd className="font-semibold tabular-nums">
                {formatTreasuryTodayOpeningMoney(diff.informedOpeningBalance)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {TREASURY_TODAY_OPENING_DIFF_LABELS.difference}
              </dt>
              <dd className="font-semibold tabular-nums">
                {formatTreasuryTodayOpeningMoney(diff.difference)}
              </dd>
            </div>
          </dl>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-foreground">
              Motivo da diferença
            </span>
            <select
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={draft.justificationCode}
              onChange={(e) =>
                onDraftChange(account.accountId, {
                  justificationCode: e.target
                    .value as TreasuryDailyOpeningDiffJustificationCode | "",
                })
              }
              data-testid={`treasury-opening-account-${account.accountId}-justification`}
            >
              <option value="">Selecione…</option>
              {TREASURY_DAILY_OPENING_DIFF_JUSTIFICATION_CODES.map((code) => (
                <option key={code} value={code}>
                  {TREASURY_TODAY_OPENING_JUSTIFICATION_OPTIONS[code]}
                </option>
              ))}
            </select>
          </label>
          {draft.justificationCode === "OTHER" ? (
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-foreground">
                Descreva o motivo
              </span>
              <input
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={draft.justificationDetail}
                onChange={(e) =>
                  onDraftChange(account.accountId, {
                    justificationDetail: e.target.value,
                  })
                }
              />
            </label>
          ) : null}
        </div>
      ) : null}

      <label className="mt-3 block space-y-1">
        <span className="text-xs text-muted-foreground">Observação (opcional)</span>
        <input
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          value={draft.notes}
          disabled={!canManage}
          onChange={(e) =>
            onDraftChange(account.accountId, { notes: e.target.value })
          }
          data-testid={`treasury-opening-account-${account.accountId}-notes`}
        />
      </label>
    </article>
  );
}

export function TreasuryTodayOpeningPanel(props: TreasuryTodayOpeningPanelProps) {
  const {
    viewKind,
    data,
    drafts,
    error,
    saving,
    canManage,
    onDraftChange,
    onConfirmAll,
    onSave,
    onRefresh,
    onDismissError,
  } = props;

  if (viewKind === "denied") {
    return (
      <PermissionDenied
        message={TREASURY_TODAY_OPENING_DENIED_MESSAGE}
        testId="treasury-opening-denied"
      />
    );
  }

  if (viewKind === "loading") {
    return (
      <div data-testid="treasury-opening-loading">
        <FinanceModuleLoadingBlock label="Carregando saldos iniciais…" />
      </div>
    );
  }

  if (viewKind === "error") {
    return (
      <div data-testid="treasury-opening-error">
        <FinanceModuleErrorBanner
          message={error ?? "Não foi possível carregar os saldos iniciais."}
          onRetry={onRefresh}
          onDismiss={onDismissError}
        />
      </div>
    );
  }

  if (viewKind === "empty" || !data) {
    return (
      <div data-testid="treasury-opening-empty">
        <FinanceModuleEmptyState
          title={TREASURY_TODAY_OPENING_EMPTY_TITLE}
          description={TREASURY_TODAY_OPENING_EMPTY_DESCRIPTION}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="treasury-opening-ready">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">
            {data.title || TREASURY_TODAY_OPENING_PAGE_TITLE}
          </h2>
          <p className="text-sm text-muted-foreground" data-testid="treasury-opening-date">
            {formatTreasuryTodayOpeningCivilDate(data.civilDate)}
          </p>
          <p className="text-xs text-muted-foreground">
            {data.confirmableCount} prontas para confirmar · {data.pendingCount}{" "}
            pendentes · {data.confirmedCount} já confirmadas
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-accent"
            disabled={!canManage || data.confirmableCount === 0 || saving}
            onClick={onConfirmAll}
            data-testid="treasury-opening-confirm-all"
          >
            Confirmar todos sem divergência
          </button>
          <button
            type="button"
            className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            disabled={!canManage || saving}
            onClick={onSave}
            data-testid="treasury-opening-save"
          >
            {saving ? "Salvando…" : "Salvar e continuar"}
          </button>
        </div>
      </div>

      {/* Cabeçalho tabular apenas em desktop amplo — cards no restante */}
      <div className="hidden xl:grid xl:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))_auto] xl:gap-3 xl:px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Conta</span>
        <span className="text-right">Saldo final anterior</span>
        <span className="text-right">Saldo inicial de hoje</span>
        <span>Situação</span>
        <span className="text-right">Ações</span>
      </div>

      <div className="space-y-3" data-testid="treasury-opening-accounts">
        {data.accounts.map((account) => {
          const draft = drafts[account.accountId];
          if (!draft) return null;
          return (
            <React.Fragment key={account.accountId}>
              <AccountRow
                account={account}
                draft={draft}
                canManage={canManage}
                onDraftChange={onDraftChange}
              />
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
