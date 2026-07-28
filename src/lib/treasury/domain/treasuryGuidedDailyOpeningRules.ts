/**
 * Domínio — fluxo guiado de saldos iniciais do dia.
 * Reusa suggest/plan da rotina diária; sem Prisma.
 */

import type {
  TreasuryGuidedDailyOpeningAccountDto,
  TreasuryGuidedDailyOpeningSituation,
  TreasuryGuidedDailyOpeningWorkspaceDto,
} from "../contracts/treasuryDto.js";
import type { TreasuryCivilDate } from "../contracts/treasuryCivilDate.js";
import {
  TREASURY_DAILY_OPENING_DIFF_JUSTIFICATION_CODES,
  type TreasuryDailyOpeningDiffJustificationCode,
} from "../contracts/treasuryEnums.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import {
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";
import { TreasuryDomainError } from "./treasuryErrors.js";
import {
  planTreasuryDailyOpeningBalance,
  suggestTreasuryDailyOpeningBalance,
  type TreasuryDailyOpeningSuggestion,
  type TreasuryDailyAccountRoutineState,
} from "./treasuryDailyAccountRoutineRules.js";

export const TREASURY_GUIDED_DAILY_OPENING_TITLE =
  "Saldos iniciais de hoje" as const;

export const TREASURY_GUIDED_DAILY_OPENING_UI_PATH =
  "/finance/treasury/today/opening" as const;

export const TREASURY_GUIDED_DAILY_OPENING_NEXT_STEP_HREF =
  "/finance/treasury/today" as const;

export const TREASURY_DAILY_OPENING_DIFF_JUSTIFICATION_LABELS: Record<
  TreasuryDailyOpeningDiffJustificationCode,
  string
> = {
  MOVEMENT_AFTER_CLOSING: "Movimento após fechamento",
  FEE_OR_INTEREST: "Tarifa ou juros",
  CREDIT_AFTER_CLOSING: "Crédito após fechamento",
  AUTOMATIC_DEBIT: "Débito automático",
  PREVIOUS_BALANCE_INCORRECT: "Saldo anterior incorreto",
  OTHER: "Outro",
};

export const TREASURY_GUIDED_DAILY_OPENING_SITUATION_LABELS: Record<
  TreasuryGuidedDailyOpeningSituation,
  string
> = {
  CONFIRMED: "Confirmado",
  READY_TO_CONFIRM: "Pronto para confirmar",
  NEEDS_MANUAL: "Informar manualmente",
  EDITED_WITH_DIFF: "Alterado — justificar",
  INACTIVE: "Conta inativa",
};

export type TreasuryGuidedDailyOpeningAccountSeed = {
  accountId: string;
  accountCode: string;
  accountName: string;
  bank: string | null;
  isActive: boolean;
  previousClosedPosition: {
    closingId: string;
    civilDate: string;
    observedBalance: string;
  } | null;
  currentOpening: {
    amount: TreasuryMoneyString;
    version: number;
  } | null;
};

export type TreasuryGuidedDailyOpeningSaveItemInput = {
  accountId: string;
  expectedVersion: number;
  /** Confirma sugestão sem edição. */
  confirmSuggested?: boolean;
  /** Valor informado (obrigatório se não confirmar sugestão). */
  amount?: string | null;
  notes?: string | null;
  justificationCode?: TreasuryDailyOpeningDiffJustificationCode | null;
  justificationDetail?: string | null;
};

function money(value: string): TreasuryMoneyString {
  return normalizeTreasuryMoneyString(value);
}

export function isTreasuryDailyOpeningDiffJustificationCode(
  value: unknown
): value is TreasuryDailyOpeningDiffJustificationCode {
  return (
    typeof value === "string" &&
    (TREASURY_DAILY_OPENING_DIFF_JUSTIFICATION_CODES as readonly string[]).includes(
      value
    )
  );
}

export function computeTreasuryGuidedDailyOpeningDifference(input: {
  previousClosingBalance: string | null;
  informedOpeningBalance: string;
}): {
  hasDifference: boolean;
  difference: TreasuryMoneyString | null;
  previousClosingBalance: TreasuryMoneyString | null;
  informedOpeningBalance: TreasuryMoneyString;
} {
  const informed = money(input.informedOpeningBalance);
  if (input.previousClosingBalance == null || input.previousClosingBalance === "") {
    return {
      hasDifference: false,
      difference: null,
      previousClosingBalance: null,
      informedOpeningBalance: informed,
    };
  }
  const previous = money(input.previousClosingBalance);
  const difference = subtractTreasuryMoney(informed, previous);
  return {
    hasDifference: compareTreasuryMoney(difference, "0.00") !== 0,
    difference,
    previousClosingBalance: previous,
    informedOpeningBalance: informed,
  };
}

export function assertTreasuryGuidedDailyOpeningJustification(input: {
  hasDifference: boolean;
  justificationCode: TreasuryDailyOpeningDiffJustificationCode | null | undefined;
  justificationDetail?: string | null;
}): {
  code: TreasuryDailyOpeningDiffJustificationCode | null;
  reasonText: string | null;
} {
  if (!input.hasDifference) {
    return { code: null, reasonText: null };
  }
  if (!isTreasuryDailyOpeningDiffJustificationCode(input.justificationCode)) {
    throw new TreasuryDomainError(
      "REQUIRED_FIELD",
      "Informe o motivo da diferença entre o saldo final anterior e o saldo inicial de hoje.",
      "justificationCode"
    );
  }
  if (input.justificationCode === "OTHER") {
    const detail = input.justificationDetail?.trim() ?? "";
    if (!detail) {
      throw new TreasuryDomainError(
        "REQUIRED_FIELD",
        "Descreva o motivo quando a opção for Outro.",
        "justificationDetail"
      );
    }
    return {
      code: input.justificationCode,
      reasonText: `${TREASURY_DAILY_OPENING_DIFF_JUSTIFICATION_LABELS.OTHER}: ${detail}`,
    };
  }
  return {
    code: input.justificationCode,
    reasonText:
      TREASURY_DAILY_OPENING_DIFF_JUSTIFICATION_LABELS[input.justificationCode],
  };
}

export function deriveTreasuryGuidedDailyOpeningSituation(input: {
  isActive: boolean;
  suggestion: TreasuryDailyOpeningSuggestion;
  currentOpeningAmount: string | null;
}): TreasuryGuidedDailyOpeningSituation {
  if (!input.isActive) return "INACTIVE";
  if (input.currentOpeningAmount != null) return "CONFIRMED";
  if (input.suggestion.requiresManualInput || input.suggestion.suggestedAmount == null) {
    return "NEEDS_MANUAL";
  }
  return "READY_TO_CONFIRM";
}

export function buildTreasuryGuidedDailyOpeningAccountDto(
  seed: TreasuryGuidedDailyOpeningAccountSeed
): TreasuryGuidedDailyOpeningAccountDto {
  const suggestion = suggestTreasuryDailyOpeningBalance({
    accountIsActive: seed.isActive,
    previousClosedPosition: seed.previousClosedPosition,
  });
  const situation = deriveTreasuryGuidedDailyOpeningSituation({
    isActive: seed.isActive,
    suggestion,
    currentOpeningAmount: seed.currentOpening?.amount ?? null,
  });

  return {
    accountId: seed.accountId,
    accountCode: seed.accountCode,
    accountName: seed.accountName,
    bank: seed.bank,
    previousClosingBalance: suggestion.suggestedAmount,
    previousClosingCivilDate: suggestion.sourceCivilDate,
    previousClosingId: suggestion.sourceClosingId,
    suggestedOpeningBalance: suggestion.suggestedAmount,
    currentOpeningBalance: seed.currentOpening?.amount ?? null,
    expectedVersion: seed.currentOpening?.version ?? 0,
    situation,
    situationLabel: TREASURY_GUIDED_DAILY_OPENING_SITUATION_LABELS[situation],
    requiresManualInput: suggestion.requiresManualInput,
    canConfirmSuggested:
      situation === "READY_TO_CONFIRM" && suggestion.suggestedAmount != null,
  };
}

export function buildTreasuryGuidedDailyOpeningWorkspace(input: {
  civilDate: TreasuryCivilDate;
  asOf?: Date | string;
  accounts: readonly TreasuryGuidedDailyOpeningAccountSeed[];
}): TreasuryGuidedDailyOpeningWorkspaceDto {
  const accounts = input.accounts.map(buildTreasuryGuidedDailyOpeningAccountDto);
  return {
    ok: true,
    civilDate: input.civilDate,
    asOf: formatTreasuryTimestampIso(
      input.asOf instanceof Date
        ? input.asOf
        : input.asOf
          ? new Date(input.asOf)
          : new Date()
    ),
    title: TREASURY_GUIDED_DAILY_OPENING_TITLE,
    accounts,
    confirmableCount: accounts.filter((a) => a.canConfirmSuggested).length,
    pendingCount: accounts.filter(
      (a) =>
        a.situation === "NEEDS_MANUAL" || a.situation === "READY_TO_CONFIRM"
    ).length,
    confirmedCount: accounts.filter((a) => a.situation === "CONFIRMED").length,
  };
}

export function planTreasuryGuidedDailyOpeningSaveItem(input: {
  seed: TreasuryGuidedDailyOpeningAccountSeed;
  civilDate: string;
  item: TreasuryGuidedDailyOpeningSaveItemInput;
  actorUserId: string;
  recordedAt: Date | string;
  currentState?: TreasuryDailyAccountRoutineState | null;
}): ReturnType<typeof planTreasuryDailyOpeningBalance> & {
  justificationCode: TreasuryDailyOpeningDiffJustificationCode | null;
  difference: TreasuryMoneyString | null;
} {
  if (!input.seed.isActive) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Conta financeira inativa não admite saldo inicial.",
      "accountId"
    );
  }

  const suggestion = suggestTreasuryDailyOpeningBalance({
    accountIsActive: input.seed.isActive,
    previousClosedPosition: input.seed.previousClosedPosition,
  });

  const confirm = Boolean(input.item.confirmSuggested);
  let amount: string | null | undefined = input.item.amount;
  let confirmSuggestedAmount: string | null | undefined = null;

  if (confirm) {
    if (suggestion.suggestedAmount == null) {
      throw new TreasuryDomainError(
        "VALIDATION_ERROR",
        "Não há saldo sugerido para confirmar nesta conta.",
        "confirmSuggested"
      );
    }
    confirmSuggestedAmount = suggestion.suggestedAmount;
    amount = null;
  }

  const informedForDiff =
    confirmSuggestedAmount ??
    (amount != null && String(amount).trim() !== ""
      ? money(String(amount))
      : null);

  if (informedForDiff == null) {
    throw new TreasuryDomainError(
      "REQUIRED_FIELD",
      "Informe ou confirme o saldo inicial.",
      "amount"
    );
  }

  const diff = computeTreasuryGuidedDailyOpeningDifference({
    previousClosingBalance: suggestion.suggestedAmount,
    informedOpeningBalance: informedForDiff,
  });

  const justification = assertTreasuryGuidedDailyOpeningJustification({
    hasDifference: diff.hasDifference,
    justificationCode: input.item.justificationCode,
    justificationDetail: input.item.justificationDetail,
  });

  const planned = planTreasuryDailyOpeningBalance({
    accountId: input.seed.accountId,
    civilDate: input.civilDate,
    current: input.currentState ?? null,
    expectedVersion: input.item.expectedVersion,
    amount: confirm ? null : amount,
    confirmSuggestedAmount: confirm ? confirmSuggestedAmount : null,
    suggestion,
    actorUserId: input.actorUserId,
    recordedAt: input.recordedAt,
    notes: input.item.notes,
    reason: justification.reasonText,
  });

  return {
    ...planned,
    justificationCode: justification.code,
    difference: diff.difference,
  };
}
