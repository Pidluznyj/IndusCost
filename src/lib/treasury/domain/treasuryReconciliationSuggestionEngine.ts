/**
 * Motor determinístico de sugestões de conciliação bancária.
 * Funções puras / testáveis — sem Express, sem Prisma, sem I/O.
 *
 * MVP: apenas sugere (score + motivos + faixa). Nunca aplica match.
 * Exclui títulos cancelados ou integralmente realizados.
 */

import { diffCivilDays } from "@/src/lib/financeCivilDate.js";
import type {
  TreasuryBankMovementDirection,
  TreasuryBankMovementReconciliationStatus,
  TreasuryReconciliationSuggestionConfidenceBand,
  TreasuryReconciliationSuggestionReasonCode,
  TreasurySide,
} from "../contracts/treasuryEnums.js";
import {
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";
import { normalizeTaxIdDigits } from "./treasuryReceivableQueryRules.js";

export const TREASURY_RECONCILIATION_SUGGESTION_ALGORITHM_VERSION =
  "1.0.0" as const;

/** Pesos (soma máxima teórica 100 com todos os sinais). */
export const TREASURY_RECONCILIATION_SUGGESTION_WEIGHTS = {
  AMOUNT_EXACT: 40,
  DOCUMENT_MATCH: 20,
  TAX_ID_MATCH: 15,
  DATE_PROXIMITY: 10,
  NAME_SIMILAR: 10,
  HISTORY_MATCH: 5,
} as const;

export const TREASURY_RECONCILIATION_SUGGESTION_DEFAULTS = {
  maxSuggestionsPerMovement: 5,
  dateWindowDays: 7,
  minScore: 35,
  highMinScore: 80,
  mediumMinScore: 55,
} as const;

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

export type TreasuryReconciliationMovementSeed = {
  id: string;
  accountId: string;
  direction: TreasuryBankMovementDirection;
  amount: TreasuryMoneyString;
  postedCivilDate: string;
  documentNumber?: string | null;
  counterpartyName?: string | null;
  description?: string | null;
  reconciliationStatus?: TreasuryBankMovementReconciliationStatus;
  reconciledAmount?: TreasuryMoneyString | null;
};

export type TreasuryReconciliationTitleSeed = {
  side: TreasurySide;
  officialTitleId: string;
  externalId: number;
  counterpartyName?: string | null;
  counterpartyTaxId?: string | null;
  documentNumber?: string | null;
  description?: string | null;
  invoiceNumber?: string | null;
  dueDate?: string | null;
  openBalance: TreasuryMoneyString;
  /** Cancelado / removido na origem — nunca sugerir. */
  isCancelled: boolean;
  /** Integralmente realizado (saldo aberto zero / settled). */
  isSettled: boolean;
  /**
   * Histórico: quantas conciliações bem-sucedidas prévias
   * ligam o mesmo contraparte/taxId (ou título) a esta conta.
   */
  priorSuccessfulMatchCount?: number;
};

export type TreasuryReconciliationSuggestionScoreBreakdown = {
  AMOUNT_EXACT: number;
  DOCUMENT_MATCH: number;
  TAX_ID_MATCH: number;
  DATE_PROXIMITY: number;
  NAME_SIMILAR: number;
  HISTORY_MATCH: number;
};

export type TreasuryReconciliationSuggestionCandidate = {
  suggestionKey: string;
  movementId: string;
  side: TreasurySide;
  officialTitleId: string;
  externalId: number;
  suggestedAmount: TreasuryMoneyString;
  /** Pontuação 0..100 (inteiro). */
  score: number;
  confidence: TreasuryReconciliationSuggestionConfidenceBand;
  reasons: TreasuryReconciliationSuggestionReasonCode[];
  scoreBreakdown: TreasuryReconciliationSuggestionScoreBreakdown;
};

export type TreasuryReconciliationSuggestionEngineOptions = {
  maxSuggestionsPerMovement?: number;
  dateWindowDays?: number;
  minScore?: number;
  highMinScore?: number;
  mediumMinScore?: number;
};

export type TreasuryReconciliationSuggestionEngineInput = {
  companyCode: string;
  asOfCivilDate: string;
  movements: readonly TreasuryReconciliationMovementSeed[];
  titles: readonly TreasuryReconciliationTitleSeed[];
  options?: TreasuryReconciliationSuggestionEngineOptions;
};

export type TreasuryReconciliationSuggestionEngineResult = {
  algorithmVersion: typeof TREASURY_RECONCILIATION_SUGGESTION_ALGORITHM_VERSION;
  suggestions: TreasuryReconciliationSuggestionCandidate[];
  unmatchedMovementIds: string[];
  excludedTitleIds: string[];
  /** Sempre false no MVP — documentação explícita do contrato. */
  autoMatched: false;
};

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function normalizeLooseText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeDocumentToken(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function tokenizeName(value: string | null | undefined): string[] {
  const normalized = normalizeLooseText(value)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];
  const stop = new Set([
    "de",
    "da",
    "do",
    "das",
    "dos",
    "e",
    "ltda",
    "me",
    "sa",
    "s/a",
    "eireli",
  ]);
  return normalized
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !stop.has(t));
}

/** Similaridade por Jaccard de tokens (0..1). */
export function treasuryNameSimilarity(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  const ta = tokenizeName(a);
  const tb = tokenizeName(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setA = new Set(ta);
  const setB = new Set(tb);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  if (union <= 0) return 0;
  return intersection / union;
}

function extractDigitsBlob(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => normalizeTaxIdDigits(p))
    .filter(Boolean)
    .join("");
}

function movementRemainingAmount(
  movement: TreasuryReconciliationMovementSeed
): TreasuryMoneyString {
  const amount = normalizeTreasuryMoneyString(movement.amount);
  const reconciled = normalizeTreasuryMoneyString(
    movement.reconciledAmount ?? "0.00"
  );
  const remaining = subtractTreasuryMoney(amount, reconciled);
  if (compareTreasuryMoney(remaining, "0.00") <= 0) return "0.00";
  return remaining;
}

function isMovementEligible(
  movement: TreasuryReconciliationMovementSeed
): boolean {
  const status = movement.reconciliationStatus ?? "PENDING";
  if (status === "MATCHED" || status === "IGNORED") return false;
  return compareTreasuryMoney(movementRemainingAmount(movement), "0.00") > 0;
}

function isTitleEligible(title: TreasuryReconciliationTitleSeed): boolean {
  if (title.isCancelled || title.isSettled) return false;
  try {
    return compareTreasuryMoney(title.openBalance, "0.00") > 0;
  } catch {
    return false;
  }
}

function directionCompatible(
  direction: TreasuryBankMovementDirection,
  side: TreasurySide
): boolean {
  if (direction === "CREDIT" && side === "AR") return true;
  if (direction === "DEBIT" && side === "AP") return true;
  return false;
}

function classifyConfidence(
  score: number,
  options: Required<
    Pick<
      TreasuryReconciliationSuggestionEngineOptions,
      "highMinScore" | "mediumMinScore" | "minScore"
    >
  >
): TreasuryReconciliationSuggestionConfidenceBand | null {
  if (score < options.minScore) return null;
  if (score >= options.highMinScore) return "HIGH";
  if (score >= options.mediumMinScore) return "MEDIUM";
  return "LOW";
}

function resolveOptions(
  options?: TreasuryReconciliationSuggestionEngineOptions
): Required<TreasuryReconciliationSuggestionEngineOptions> {
  return {
    maxSuggestionsPerMovement:
      options?.maxSuggestionsPerMovement ??
      TREASURY_RECONCILIATION_SUGGESTION_DEFAULTS.maxSuggestionsPerMovement,
    dateWindowDays:
      options?.dateWindowDays ??
      TREASURY_RECONCILIATION_SUGGESTION_DEFAULTS.dateWindowDays,
    minScore:
      options?.minScore ?? TREASURY_RECONCILIATION_SUGGESTION_DEFAULTS.minScore,
    highMinScore:
      options?.highMinScore ??
      TREASURY_RECONCILIATION_SUGGESTION_DEFAULTS.highMinScore,
    mediumMinScore:
      options?.mediumMinScore ??
      TREASURY_RECONCILIATION_SUGGESTION_DEFAULTS.mediumMinScore,
  };
}

function documentMatches(
  movement: TreasuryReconciliationMovementSeed,
  title: TreasuryReconciliationTitleSeed
): boolean {
  const movementDocs = [
    normalizeDocumentToken(movement.documentNumber),
    normalizeDocumentToken(movement.description),
  ].filter((d) => d.length >= 4);

  const titleDocs = [
    normalizeDocumentToken(title.documentNumber),
    normalizeDocumentToken(title.invoiceNumber),
    normalizeDocumentToken(title.description),
  ].filter((d) => d.length >= 4);

  if (movementDocs.length === 0 || titleDocs.length === 0) return false;

  for (const md of movementDocs) {
    for (const td of titleDocs) {
      if (md === td) return true;
      if (md.includes(td) || td.includes(md)) return true;
    }
  }
  return false;
}

function taxIdMatches(
  movement: TreasuryReconciliationMovementSeed,
  title: TreasuryReconciliationTitleSeed
): boolean {
  const titleTax = normalizeTaxIdDigits(title.counterpartyTaxId);
  if (titleTax.length < 11) return false;
  const blob = extractDigitsBlob([
    movement.description,
    movement.counterpartyName,
    movement.documentNumber,
  ]);
  if (!blob) return false;
  return blob.includes(titleTax);
}

function dateProximityPoints(
  movement: TreasuryReconciliationMovementSeed,
  title: TreasuryReconciliationTitleSeed,
  windowDays: number
): number {
  if (!title.dueDate) return 0;
  const days = Math.abs(
    diffCivilDays(movement.postedCivilDate, title.dueDate)
  );
  if (days > windowDays) return 0;
  if (days === 0) return TREASURY_RECONCILIATION_SUGGESTION_WEIGHTS.DATE_PROXIMITY;
  // Decai linearmente até a borda da janela.
  const ratio = 1 - days / windowDays;
  return Math.round(
    TREASURY_RECONCILIATION_SUGGESTION_WEIGHTS.DATE_PROXIMITY * ratio
  );
}

function scorePair(
  movement: TreasuryReconciliationMovementSeed,
  title: TreasuryReconciliationTitleSeed,
  options: Required<TreasuryReconciliationSuggestionEngineOptions>
): TreasuryReconciliationSuggestionCandidate | null {
  if (!directionCompatible(movement.direction, title.side)) return null;

  const remaining = movementRemainingAmount(movement);
  const open = normalizeTreasuryMoneyString(title.openBalance);
  // Movimento maior que saldo aberto → não sugerir (evita falso positivo parcial agressivo).
  if (compareTreasuryMoney(remaining, open) > 0) return null;

  const reasons: TreasuryReconciliationSuggestionReasonCode[] = [
    "DIRECTION_COMPATIBLE",
  ];
  const breakdown: TreasuryReconciliationSuggestionScoreBreakdown = {
    AMOUNT_EXACT: 0,
    DOCUMENT_MATCH: 0,
    TAX_ID_MATCH: 0,
    DATE_PROXIMITY: 0,
    NAME_SIMILAR: 0,
    HISTORY_MATCH: 0,
  };

  if (compareTreasuryMoney(remaining, open) === 0) {
    breakdown.AMOUNT_EXACT =
      TREASURY_RECONCILIATION_SUGGESTION_WEIGHTS.AMOUNT_EXACT;
    reasons.push("AMOUNT_EXACT");
  }

  if (documentMatches(movement, title)) {
    breakdown.DOCUMENT_MATCH =
      TREASURY_RECONCILIATION_SUGGESTION_WEIGHTS.DOCUMENT_MATCH;
    reasons.push("DOCUMENT_MATCH");
  }

  if (taxIdMatches(movement, title)) {
    breakdown.TAX_ID_MATCH =
      TREASURY_RECONCILIATION_SUGGESTION_WEIGHTS.TAX_ID_MATCH;
    reasons.push("TAX_ID_MATCH");
  }

  const datePts = dateProximityPoints(movement, title, options.dateWindowDays);
  if (datePts > 0) {
    breakdown.DATE_PROXIMITY = datePts;
    reasons.push("DATE_PROXIMITY");
  }

  const nameSim = treasuryNameSimilarity(
    movement.counterpartyName ?? movement.description,
    title.counterpartyName
  );
  if (nameSim >= 0.5) {
    breakdown.NAME_SIMILAR = Math.round(
      TREASURY_RECONCILIATION_SUGGESTION_WEIGHTS.NAME_SIMILAR * nameSim
    );
    if (breakdown.NAME_SIMILAR > 0) reasons.push("NAME_SIMILAR");
  }

  const history = title.priorSuccessfulMatchCount ?? 0;
  if (history > 0) {
    breakdown.HISTORY_MATCH = Math.min(
      TREASURY_RECONCILIATION_SUGGESTION_WEIGHTS.HISTORY_MATCH,
      history >= 2
        ? TREASURY_RECONCILIATION_SUGGESTION_WEIGHTS.HISTORY_MATCH
        : 3
    );
    reasons.push("HISTORY_MATCH");
  }

  const score =
    breakdown.AMOUNT_EXACT +
    breakdown.DOCUMENT_MATCH +
    breakdown.TAX_ID_MATCH +
    breakdown.DATE_PROXIMITY +
    breakdown.NAME_SIMILAR +
    breakdown.HISTORY_MATCH;

  const confidence = classifyConfidence(score, options);
  if (!confidence) return null;

  const suggestionKey = [
    movement.id,
    title.side,
    title.officialTitleId,
    remaining,
  ].join("|");

  return {
    suggestionKey,
    movementId: movement.id,
    side: title.side,
    officialTitleId: title.officialTitleId,
    externalId: title.externalId,
    suggestedAmount: remaining,
    score,
    confidence,
    reasons,
    scoreBreakdown: breakdown,
  };
}

function compareSuggestions(
  a: TreasuryReconciliationSuggestionCandidate,
  b: TreasuryReconciliationSuggestionCandidate
): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.confidence !== b.confidence) {
    const order = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
    return order[a.confidence] - order[b.confidence];
  }
  return a.suggestionKey.localeCompare(b.suggestionKey);
}

/**
 * Gera sugestões ranqueadas para movimentos bancários × títulos oficiais abertos.
 * Não persiste e não aplica conciliação.
 */
export function runTreasuryReconciliationSuggestionEngine(
  input: TreasuryReconciliationSuggestionEngineInput
): TreasuryReconciliationSuggestionEngineResult {
  const options = resolveOptions(input.options);
  const excludedTitleIds: string[] = [];
  const eligibleTitles: TreasuryReconciliationTitleSeed[] = [];

  for (const title of input.titles) {
    if (!isTitleEligible(title)) {
      excludedTitleIds.push(title.officialTitleId);
      continue;
    }
    eligibleTitles.push(title);
  }
  excludedTitleIds.sort((a, b) => a.localeCompare(b));

  const suggestions: TreasuryReconciliationSuggestionCandidate[] = [];
  const unmatchedMovementIds: string[] = [];

  for (const movement of input.movements) {
    if (!isMovementEligible(movement)) {
      unmatchedMovementIds.push(movement.id);
      continue;
    }

    const candidates: TreasuryReconciliationSuggestionCandidate[] = [];
    for (const title of eligibleTitles) {
      const scored = scorePair(movement, title, options);
      if (scored) candidates.push(scored);
    }
    candidates.sort(compareSuggestions);
    const top = candidates.slice(0, options.maxSuggestionsPerMovement);
    if (top.length === 0) {
      unmatchedMovementIds.push(movement.id);
    } else {
      suggestions.push(...top);
    }
  }

  suggestions.sort(compareSuggestions);
  unmatchedMovementIds.sort((a, b) => a.localeCompare(b));

  return {
    algorithmVersion: TREASURY_RECONCILIATION_SUGGESTION_ALGORITHM_VERSION,
    suggestions,
    unmatchedMovementIds,
    excludedTitleIds,
    autoMatched: false,
  };
}
