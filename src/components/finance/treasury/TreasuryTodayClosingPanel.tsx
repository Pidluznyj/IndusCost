/**
 * Painel — saldos finais, divergências e fechamento guiado.
 */

import React from "react";
import { Link } from "react-router-dom";
import type {
  TreasuryGuidedDailyClosingAccountDto,
  TreasuryGuidedDailyClosingWorkspaceDto,
} from "@/src/lib/treasury/contracts/index.js";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import {
  TREASURY_TODAY_CLOSING_DENIED_MESSAGE,
  TREASURY_TODAY_CLOSING_EMPTY_DESCRIPTION,
  TREASURY_TODAY_CLOSING_EMPTY_TITLE,
  TREASURY_TODAY_CLOSING_PAGE_TITLE,
  formatTreasuryTodayClosingMoney,
  resolveTreasuryTodayClosingDraftDivergence,
  type TreasuryTodayClosingDraftRow,
  type TreasuryTodayClosingStep,
  type TreasuryTodayClosingViewKind,
} from "@/src/lib/treasury/treasuryTodayClosingUi.js";

export type TreasuryTodayClosingPanelProps = {
  viewKind: TreasuryTodayClosingViewKind;
  step: TreasuryTodayClosingStep;
  data: TreasuryGuidedDailyClosingWorkspaceDto | null;
  drafts: Record<string, TreasuryTodayClosingDraftRow>;
  error: string | null;
  saving: boolean;
  closing: boolean;
  canManage: boolean;
  canClose: boolean;
  caveatDrafts: Record<string, string>;
  onDraftChange: (
    accountId: string,
    patch: Partial<TreasuryTodayClosingDraftRow>
  ) => void;
  onCaveatChange: (code: string, message: string) => void;
  onStepChange: (step: TreasuryTodayClosingStep) => void;
  onSave: () => void;
  onCloseDay: (withCaveats: boolean) => void;
  onRefresh: () => void;
  onDismissError?: () => void;
};

function AccountFinalBalanceCard(props: {
  account: TreasuryGuidedDailyClosingAccountDto;
  draft: TreasuryTodayClosingDraftRow;
  canManage: boolean;
  onDraftChange: (
    accountId: string,
    patch: Partial<TreasuryTodayClosingDraftRow>
  ) => void;
}) {
  const { account, draft, canManage, onDraftChange } = props;
  const live = resolveTreasuryTodayClosingDraftDivergence(account, draft);

  return (
    <article
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
      data-testid={`treasury-closing-account-${account.accountId}`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {account.accountName}
          </h3>
          <p className="text-xs text-muted-foreground">
            {account.bank ?? account.accountCode}
          </p>
          <p className="mt-1 text-xs font-medium">
            Situação: {account.situationLabel}
          </p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 xl:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Saldo inicial</dt>
          <dd className="font-semibold tabular-nums">
            {formatTreasuryTodayClosingMoney(account.openingBalance)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Entradas realizadas</dt>
          <dd className="font-semibold tabular-nums">
            {formatTreasuryTodayClosingMoney(account.realizedInflows)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Saídas realizadas</dt>
          <dd className="font-semibold tabular-nums">
            {formatTreasuryTodayClosingMoney(account.realizedOutflows)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Transferências</dt>
          <dd className="font-semibold tabular-nums">
            {formatTreasuryTodayClosingMoney(account.transfersNet)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Lançamentos locais</dt>
          <dd className="font-semibold tabular-nums">
            {formatTreasuryTodayClosingMoney(account.localNet)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Saldo realizado calculado</dt>
          <dd className="font-semibold tabular-nums">
            {formatTreasuryTodayClosingMoney(account.realizedClosingBalance)}
          </dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="block space-y-1">
            <span className="text-muted-foreground">
              Saldo final visto no banco
            </span>
            <input
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm tabular-nums"
              value={draft.displayAmount}
              disabled={!canManage || !account.canInformClosing}
              onChange={(e) =>
                onDraftChange(account.accountId, {
                  displayAmount: e.target.value,
                })
              }
              inputMode="decimal"
              aria-label={`Saldo final de ${account.accountName}`}
              data-testid={`treasury-closing-account-${account.accountId}-amount`}
            />
          </label>
        </div>
        <div>
          <dt className="text-muted-foreground">Divergência</dt>
          <dd className="font-semibold tabular-nums">
            {formatTreasuryTodayClosingMoney(
              live.divergence ?? account.divergence
            )}
          </dd>
        </div>
      </dl>

      {(live.divergenceMessage ?? account.divergenceMessage) ? (
        <p
          className="mt-3 text-sm font-medium text-rose-700"
          data-testid={`treasury-closing-account-${account.accountId}-divergence-msg`}
        >
          {live.divergenceMessage ?? account.divergenceMessage}
        </p>
      ) : null}
    </article>
  );
}

export function TreasuryTodayClosingPanel(props: TreasuryTodayClosingPanelProps) {
  const {
    viewKind,
    step,
    data,
    drafts,
    error,
    saving,
    closing,
    canManage,
    canClose,
    caveatDrafts,
    onDraftChange,
    onCaveatChange,
    onStepChange,
    onSave,
    onCloseDay,
    onRefresh,
    onDismissError,
  } = props;

  if (viewKind === "denied") {
    return (
      <PermissionDenied
        message={TREASURY_TODAY_CLOSING_DENIED_MESSAGE}
        testId="treasury-today-closing-denied"
      />
    );
  }

  if (viewKind === "loading") {
    return (
      <div data-testid="treasury-today-closing-loading">
        <FinanceModuleLoadingBlock label="Carregando saldos finais…" />
      </div>
    );
  }

  if (viewKind === "error") {
    return (
      <div data-testid="treasury-today-closing-error">
        <FinanceModuleErrorBanner
          message={error ?? "Não foi possível carregar os saldos finais."}
          onRetry={onRefresh}
          onDismiss={onDismissError}
        />
      </div>
    );
  }

  if (viewKind === "empty" || !data) {
    return (
      <div data-testid="treasury-today-closing-empty">
        <FinanceModuleEmptyState
          title={TREASURY_TODAY_CLOSING_EMPTY_TITLE}
          description={TREASURY_TODAY_CLOSING_EMPTY_DESCRIPTION}
        />
      </div>
    );
  }

  const gates = data.closeGates;
  const divergenceAccounts = data.accounts.filter(
    (a) => a.situation === "HAS_DIVERGENCE"
  );

  return (
    <div className="space-y-4" data-testid="treasury-today-closing-ready">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">
          {TREASURY_TODAY_CLOSING_PAGE_TITLE}
        </h2>
        <p className="text-sm text-muted-foreground">
          O fechamento formal usa o sistema já existente. Nada é lançado
          automaticamente no Nomus.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" data-testid="treasury-today-closing-steps">
        {(
          [
            ["final-balances", "1. Saldo final"],
            ["divergences", "2. Divergências"],
            ["close", "3. Fechamento"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
              step === id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background"
            }`}
            onClick={() => onStepChange(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <FinanceModuleErrorBanner
          message={error}
          onRetry={onRefresh}
          onDismiss={onDismissError}
        />
      ) : null}

      {step === "final-balances" ? (
        <div className="space-y-3" data-testid="treasury-today-closing-step-final">
          {data.accounts.map((account) => {
            const draft = drafts[account.accountId];
            if (!draft) return null;
            return (
              <React.Fragment key={account.accountId}>
                <AccountFinalBalanceCard
                  account={account}
                  draft={draft}
                  canManage={canManage}
                  onDraftChange={onDraftChange}
                />
              </React.Fragment>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              disabled={!canManage || saving}
              onClick={onSave}
              data-testid="treasury-today-closing-save"
            >
              {saving ? "Salvando…" : "Salvar saldos finais"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
              onClick={() => onStepChange("divergences")}
            >
              Ir para divergências
            </button>
          </div>
        </div>
      ) : null}

      {step === "divergences" ? (
        <div className="space-y-3" data-testid="treasury-today-closing-step-divergences">
          {divergenceAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma diferença entre o saldo do banco e o saldo calculado.
            </p>
          ) : (
            divergenceAccounts.map((account) => (
              <div
                key={account.accountId}
                className="rounded-xl border border-rose-200 bg-rose-50/60 p-4"
              >
                <p className="text-sm font-semibold">{account.accountName}</p>
                <p className="mt-1 text-sm text-rose-700">
                  {account.divergenceMessage}
                </p>
              </div>
            ))
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {data.investigationActions.map((action) => (
              <Link
                key={action.id}
                to={action.href}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold hover:bg-muted/40"
                data-testid={`treasury-closing-action-${action.id}`}
              >
                {action.label}
              </Link>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            As opções acima só abrem telas existentes. Nenhum lançamento é
            criado automaticamente.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
              onClick={() => onStepChange("final-balances")}
            >
              Voltar e revisar
            </button>
            <button
              type="button"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              onClick={() => onStepChange("close")}
            >
              Ir para fechamento
            </button>
          </div>
        </div>
      ) : null}

      {step === "close" ? (
        <div className="space-y-3" data-testid="treasury-today-closing-step-close">
          <ul className="space-y-2 text-sm" data-testid="treasury-today-closing-gates">
            <li>
              Saldos iniciais informados:{" "}
              {gates.openingsInformed ? "Sim" : "Não"}
            </li>
            <li>
              Saldos finais informados:{" "}
              {gates.closingsInformed ? "Sim" : "Não"}
            </li>
            <li>
              Divergências: {gates.hasDivergences ? "Há diferenças" : "Nenhuma"}
            </li>
            <li>
              Movimentos sem identificação: {gates.unidentifiedMovementsCount}
            </li>
            <li>Contas não vinculadas: {gates.unlinkedAccountsCount}</li>
            <li>Transferências em trânsito: {gates.transfersInTransitCount}</li>
            <li>
              Ressalvas necessárias:{" "}
              {gates.requiredCaveatCodes.length > 0
                ? gates.requiredCaveatCodes.join(", ")
                : "Nenhuma"}
            </li>
          </ul>

          {gates.absoluteBlocks.length > 0 ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50/70 p-3 text-sm">
              <p className="font-semibold">Bloqueios</p>
              <ul className="mt-1 list-disc pl-5">
                {gates.absoluteBlocks.map((b) => (
                  <li key={b.code}>{b.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {gates.requiredCaveatCodes.map((code) => (
            <label key={code} className="block space-y-1 text-sm">
              <span className="font-semibold">Ressalva: {code}</span>
              <textarea
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
                rows={2}
                value={caveatDrafts[code] ?? ""}
                onChange={(e) => onCaveatChange(code, e.target.value)}
                disabled={!canClose}
              />
            </label>
          ))}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
              onClick={() => onStepChange("final-balances")}
            >
              Voltar e revisar
            </button>
            <button
              type="button"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              disabled={!canClose || closing || !gates.canCloseWithoutCaveats}
              onClick={() => onCloseDay(false)}
              data-testid="treasury-today-closing-close"
            >
              {closing ? "Fechando…" : "Fechar o dia"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold disabled:opacity-50"
              disabled={!canClose || closing || !gates.canCloseWithCaveats}
              onClick={() => onCloseDay(true)}
              data-testid="treasury-today-closing-close-caveats"
            >
              Fechar com ressalvas
            </button>
          </div>

          {gates.dayAlreadyClosed ? (
            <p className="text-sm text-muted-foreground">
              O dia já está fechado. Reabertura usa o fluxo versionado na tela
              avançada de fechamento.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
