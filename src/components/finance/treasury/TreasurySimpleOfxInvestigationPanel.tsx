/**
 * Painel — assistente simples de investigação OFX / divergência.
 */

import React from "react";
import type { TreasuryBankMovementDto } from "@/src/lib/treasury/contracts/index.js";
import type { TreasuryReconciliationSuggestionCandidate } from "@/src/lib/treasury/domain/treasuryReconciliationSuggestionEngine.js";
import type { TreasurySimpleOfxInvestigationResultDto } from "@/src/lib/treasury/domain/treasurySimpleOfxInvestigationRules.js";
import type { TreasurySimpleOfxUnidentifiedOption } from "@/src/lib/treasury/domain/treasurySimpleOfxInvestigationRules.js";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import {
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import {
  TREASURY_SIMPLE_OFX_DENIED_MESSAGE,
  TREASURY_SIMPLE_OFX_LABELS,
  TREASURY_SIMPLE_OFX_PAGE_TITLE,
  TREASURY_SIMPLE_OFX_UNIDENTIFIED_OPTIONS_UI,
  formatTreasurySimpleOfxMoney,
  type TreasurySimpleOfxStep,
  type TreasurySimpleOfxViewKind,
} from "@/src/lib/treasury/treasurySimpleOfxInvestigationUi.js";

export type TreasurySimpleOfxMovementView = {
  movement: TreasuryBankMovementDto;
  suggestions: TreasuryReconciliationSuggestionCandidate[];
};

export type TreasurySimpleOfxInvestigationPanelProps = {
  viewKind: TreasurySimpleOfxViewKind;
  step: TreasurySimpleOfxStep;
  error: string | null;
  canManage: boolean;
  importSlot: React.ReactNode;
  movements: TreasurySimpleOfxMovementView[];
  result: TreasurySimpleOfxInvestigationResultDto | null;
  busyId: string | null;
  selectedOtherTitleId: Record<string, string>;
  onStepChange: (step: TreasurySimpleOfxStep) => void;
  onConfirmSuggestion: (
    movement: TreasuryBankMovementDto,
    suggestion: TreasuryReconciliationSuggestionCandidate
  ) => void;
  onOtherTitleChange: (movementId: string, titleId: string) => void;
  onConfirmOtherTitle: (movement: TreasuryBankMovementDto) => void;
  onCreateManual: (
    movement: TreasuryBankMovementDto,
    option: TreasurySimpleOfxUnidentifiedOption
  ) => void;
  onUnmatch: (movement: TreasuryBankMovementDto) => void;
  onRefresh: () => void;
  onDismissError?: () => void;
};

export function TreasurySimpleOfxInvestigationPanel(
  props: TreasurySimpleOfxInvestigationPanelProps
) {
  const {
    viewKind,
    step,
    error,
    canManage,
    importSlot,
    movements,
    result,
    busyId,
    selectedOtherTitleId,
    onStepChange,
    onConfirmSuggestion,
    onOtherTitleChange,
    onConfirmOtherTitle,
    onCreateManual,
    onUnmatch,
    onRefresh,
    onDismissError,
  } = props;

  if (viewKind === "denied") {
    return (
      <PermissionDenied
        message={TREASURY_SIMPLE_OFX_DENIED_MESSAGE}
        testId="treasury-simple-ofx-denied"
      />
    );
  }

  if (viewKind === "loading") {
    return (
      <div data-testid="treasury-simple-ofx-loading">
        <FinanceModuleLoadingBlock label="Carregando conferência bancária…" />
      </div>
    );
  }

  if (viewKind === "error") {
    return (
      <div data-testid="treasury-simple-ofx-error">
        <FinanceModuleErrorBanner
          message={error ?? "Não foi possível carregar a conferência."}
          onRetry={onRefresh}
          onDismiss={onDismissError}
        />
      </div>
    );
  }

  const unexplained = movements.filter(
    (m) =>
      m.movement.reconciliationStatus === "PENDING" ||
      m.movement.reconciliationStatus === "UNMATCHED" ||
      m.movement.reconciliationStatus === "PARTIAL"
  );

  return (
    <div className="space-y-4" data-testid="treasury-simple-ofx-ready">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">
          {TREASURY_SIMPLE_OFX_PAGE_TITLE}
        </h2>
        <p className="text-sm text-muted-foreground">
          {TREASURY_SIMPLE_OFX_LABELS.noAutoMatch} Sem baixa no Nomus.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" data-testid="treasury-simple-ofx-steps">
        {(
          [
            ["import", "1. Importar extrato"],
            ["investigate", "2. Correspondências"],
            ["result", "3. Resultado"],
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

      {step === "import" ? (
        <div data-testid="treasury-simple-ofx-step-import">{importSlot}</div>
      ) : null}

      {step === "investigate" ? (
        <div className="space-y-3" data-testid="treasury-simple-ofx-step-investigate">
          {unexplained.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum movimento pendente nesta conta.
            </p>
          ) : (
            unexplained.map(({ movement, suggestions }) => (
              <article
                key={movement.id}
                className="rounded-xl border border-border bg-card p-4 shadow-sm"
                data-testid={`treasury-simple-ofx-movement-${movement.id}`}
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold">
                      {movement.description ??
                        movement.counterpartyName ??
                        "Movimento do banco"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {movement.postedCivilDate} · {movement.direction}
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums">
                    {formatTreasurySimpleOfxMoney(movement.amount)}
                  </p>
                </div>

                {suggestions.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {TREASURY_SIMPLE_OFX_LABELS.possibleMatch}
                    </p>
                    {suggestions.slice(0, 3).map((s) => (
                      <div
                        key={s.suggestionKey}
                        className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <p className="text-sm">
                          Título {s.externalId} ·{" "}
                          {formatTreasurySimpleOfxMoney(s.suggestedAmount)} ·
                          score {s.score}
                        </p>
                        <button
                          type="button"
                          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                          disabled={!canManage || busyId === movement.id}
                          onClick={() => onConfirmSuggestion(movement, s)}
                        >
                          {TREASURY_SIMPLE_OFX_LABELS.confirm}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {TREASURY_SIMPLE_OFX_LABELS.stillUnidentified}
                  </p>
                )}

                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="flex-1 space-y-1 text-sm">
                    <span className="text-xs font-semibold text-muted-foreground">
                      {TREASURY_SIMPLE_OFX_LABELS.chooseOtherTitle}
                    </span>
                    <input
                      className="w-full rounded-lg border border-border bg-background px-3 py-2"
                      placeholder="ID do título oficial"
                      value={selectedOtherTitleId[movement.id] ?? ""}
                      onChange={(e) =>
                        onOtherTitleChange(movement.id, e.target.value)
                      }
                      disabled={!canManage}
                    />
                  </label>
                  <button
                    type="button"
                    className="rounded-lg border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50"
                    disabled={!canManage || busyId === movement.id}
                    onClick={() => onConfirmOtherTitle(movement)}
                  >
                    {TREASURY_SIMPLE_OFX_LABELS.confirm}
                  </button>
                </div>

                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {TREASURY_SIMPLE_OFX_LABELS.createManualLedger}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {TREASURY_SIMPLE_OFX_UNIDENTIFIED_OPTIONS_UI.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                        disabled={!canManage || busyId === movement.id}
                        onClick={() => onCreateManual(movement, opt.id)}
                        data-testid={`treasury-simple-ofx-manual-${opt.id}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {movement.reconciliationStatus === "PARTIAL" ||
                movement.reconciliationStatus === "MATCHED" ? (
                  <button
                    type="button"
                    className="mt-3 text-sm font-semibold text-muted-foreground underline disabled:opacity-50"
                    disabled={!canManage || busyId === movement.id}
                    onClick={() => onUnmatch(movement)}
                  >
                    {TREASURY_SIMPLE_OFX_LABELS.unmatch}
                  </button>
                ) : null}
              </article>
            ))
          )}

          <button
            type="button"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            onClick={() => onStepChange("result")}
          >
            Ver resultado
          </button>
        </div>
      ) : null}

      {step === "result" && result ? (
        <div
          className="space-y-3 rounded-xl border border-border bg-card p-4"
          data-testid="treasury-simple-ofx-step-result"
        >
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">
                {result.labels.divergenceBefore}
              </dt>
              <dd className="text-sm font-semibold tabular-nums">
                {formatTreasurySimpleOfxMoney(result.divergenceBefore)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {result.labels.explainedMovements}
              </dt>
              <dd className="text-sm font-semibold tabular-nums">
                {formatTreasurySimpleOfxMoney(result.explainedAmount)} (
                {result.explainedCount})
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {result.labels.unexplainedMovements}
              </dt>
              <dd className="text-sm font-semibold tabular-nums">
                {formatTreasurySimpleOfxMoney(result.unexplainedAmount)} (
                {result.unexplainedCount})
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {result.labels.remainingDivergence}
              </dt>
              <dd className="text-sm font-semibold tabular-nums">
                {formatTreasurySimpleOfxMoney(result.remainingDivergence)}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
            onClick={() => onStepChange("investigate")}
          >
            Voltar às correspondências
          </button>
        </div>
      ) : null}
    </div>
  );
}
