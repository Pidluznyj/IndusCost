/**
 * Auto-conciliação CONSERVADORA — seleção dos candidatos que podem virar
 * match automático persistido (Conciliação Bancária / Apoio ao Caixa).
 *
 * REGRA DE OURO: auto-match ≠ baixa oficial. Nada aqui toca o Nomus; o match
 * é evidência operacional (TreasuryReconciliationMatch) criada pelo serviço
 * oficial `treasuryReconciliationMatchService.accept` — com idempotencyKey.
 *
 * Duas vias de auto-aceite, ambas determinísticas e auditáveis:
 *
 * VIA A — HIGH_CONFIDENCE: confiança HIGH do motor (valor exato + sinal
 *   forte: documento, CNPJ/CPF ou combinação identificada) E o candidato é
 *   claramente o melhor de CADA movimento envolvido (gap mínimo sobre o 2º).
 *
 * VIA B — UNIQUE_EXACT_VALUE ("pode conciliar por valor quando houver
 *   certeza"): valor EXATO (1:1 ou combinação exata) E unicidade estrita —
 *   o candidato é o ÚNICO que toca cada movimento envolvido e o ÚNICO que
 *   referencia cada título envolvido, em todo o resultado do motor. Dois
 *   CRs de mesmo valor geram dois candidatos no mesmo movimento ⇒ a
 *   unicidade quebra ⇒ REVISAR, nunca automático.
 *
 * Barreira final (ambas as vias): dois auto-aceitáveis que compartilhem
 * movimento OU título derrubam AMBOS para revisão — nenhum centavo é
 * alocado duas vezes e o motor nunca escolhe arbitrariamente.
 */

import {
  TREASURY_RECONCILIATION_SUGGESTION_ALGORITHM_VERSION,
  type TreasuryReconciliationSuggestionCandidate,
  type TreasuryReconciliationSuggestionEngineResult,
} from "./treasuryReconciliationSuggestionEngine.js";

export const CASH_SUPPORT_AUTO_RECONCILE_RULE_VERSION = "AUTO-1.1.0" as const;

/**
 * Prefixo da justificativa gravada em matches automáticos.
 * O grid usa este marcador para distinguir origem 🟢 Automático × 🔵 Manual.
 */
export const CASH_SUPPORT_AUTO_JUSTIFICATION_PREFIX = "[AUTO]" as const;

/** Gap mínimo de score entre 1º e 2º candidato do mesmo movimento (via A). */
export const CASH_SUPPORT_AUTO_MIN_SCORE_GAP = 15;

export type CashSupportAutoAcceptRule = "HIGH_CONFIDENCE" | "UNIQUE_EXACT_VALUE";

/** Motivos de valor exato aceitos pela via B. */
const EXACT_VALUE_REASONS = new Set([
  "AMOUNT_EXACT",
  "AMOUNT_COMBINATION_EXACT",
  "MOVEMENT_COMBINATION_EXACT",
]);

export type CashSupportAutoAcceptDecision = {
  candidate: TreasuryReconciliationSuggestionCandidate;
  /** Chave idempotente do aceite automático — repetir o auto-run não duplica. */
  idempotencyKey: string;
  ruleVersion: typeof CASH_SUPPORT_AUTO_RECONCILE_RULE_VERSION;
  /** Qual via autorizou o aceite — vai para a justificativa (auditoria). */
  rule: CashSupportAutoAcceptRule;
};

export type CashSupportAutoReconcilePlan = {
  /** Aceites seguros (persistir via matchService.accept). */
  autoAcceptable: CashSupportAutoAcceptDecision[];
  /** Candidatos que existem mas não passaram nas barreiras — ficam como sugestão. */
  needsReview: TreasuryReconciliationSuggestionCandidate[];
  /** Movimentos sem nenhum candidato. */
  unmatchedMovementIds: string[];
  summary: {
    movementsAnalyzed: number;
    autoAcceptableCount: number;
    needsReviewCount: number;
    unmatchedCount: number;
  };
};

export function buildCashSupportAutoIdempotencyKey(
  candidate: TreasuryReconciliationSuggestionCandidate
): string {
  return [
    "AUTO",
    TREASURY_RECONCILIATION_SUGGESTION_ALGORITHM_VERSION,
    CASH_SUPPORT_AUTO_RECONCILE_RULE_VERSION,
    candidate.suggestionKey,
  ].join("|");
}

export function buildCashSupportAutoJustification(
  candidate: TreasuryReconciliationSuggestionCandidate,
  rule: CashSupportAutoAcceptRule
): string {
  const ruleLabel =
    rule === "UNIQUE_EXACT_VALUE"
      ? "valor exato com candidato único comprovado"
      : "alta confiança do motor";
  return (
    `${CASH_SUPPORT_AUTO_JUSTIFICATION_PREFIX} Conciliação automática ` +
    `${CASH_SUPPORT_AUTO_RECONCILE_RULE_VERSION} (${ruleLabel}) — score ` +
    `${candidate.score} (${candidate.confidence}); sinais: ${candidate.reasons.join(", ")}.`
  );
}

function movementIdsOf(candidate: TreasuryReconciliationSuggestionCandidate): string[] {
  return candidate.movementLegs.map((leg) => leg.movementId);
}

function titleIdsOf(candidate: TreasuryReconciliationSuggestionCandidate): string[] {
  return candidate.allocations.map((alloc) => alloc.officialTitleId);
}

/**
 * Classifica o resultado do motor em auto-aceitáveis × revisão × sem match.
 * Puro e determinístico — nenhuma escrita aqui.
 */
export function planCashSupportAutoReconciliation(
  engineResult: TreasuryReconciliationSuggestionEngineResult
): CashSupportAutoReconcilePlan {
  const all = engineResult.suggestions;

  // Índices por movimento (cada perna) e por título (cada allocation).
  const byMovement = new Map<string, TreasuryReconciliationSuggestionCandidate[]>();
  const byTitle = new Map<string, TreasuryReconciliationSuggestionCandidate[]>();
  for (const candidate of all) {
    for (const movementId of movementIdsOf(candidate)) {
      const arr = byMovement.get(movementId) ?? [];
      arr.push(candidate);
      byMovement.set(movementId, arr);
    }
    for (const titleId of titleIdsOf(candidate)) {
      const arr = byTitle.get(titleId) ?? [];
      arr.push(candidate);
      byTitle.set(titleId, arr);
    }
  }
  for (const arr of byMovement.values()) arr.sort((a, b) => b.score - a.score);

  // Títulos com candidato HIGH — usados na barreira da via A.
  const highClaimsByTitle = new Map<string, Set<string>>();
  for (const candidate of all) {
    if (candidate.confidence !== "HIGH") continue;
    for (const titleId of titleIdsOf(candidate)) {
      const set = highClaimsByTitle.get(titleId) ?? new Set<string>();
      set.add(candidate.suggestionKey);
      highClaimsByTitle.set(titleId, set);
    }
  }

  function passesViaA(candidate: TreasuryReconciliationSuggestionCandidate): boolean {
    if (candidate.confidence !== "HIGH") return false;
    // Melhor de CADA movimento envolvido, com folga sobre o segundo.
    for (const movementId of movementIdsOf(candidate)) {
      const ranked = byMovement.get(movementId) ?? [];
      const best = ranked[0];
      if (!best || best.suggestionKey !== candidate.suggestionKey) {
        // Empate exato de score no topo também é ambiguidade.
        if (!best || best.score !== candidate.score) return false;
        if (ranked.filter((c) => c.score === candidate.score).length > 1) return false;
      }
      const runnerUp = ranked.find((c) => c.suggestionKey !== candidate.suggestionKey);
      if (runnerUp && candidate.score - runnerUp.score < CASH_SUPPORT_AUTO_MIN_SCORE_GAP) {
        return false;
      }
    }
    // Título disputado por OUTRO candidato HIGH ⇒ revisão.
    for (const titleId of titleIdsOf(candidate)) {
      const claims = highClaimsByTitle.get(titleId);
      if (claims && [...claims].some((key) => key !== candidate.suggestionKey)) {
        return false;
      }
    }
    return true;
  }

  function passesViaB(candidate: TreasuryReconciliationSuggestionCandidate): boolean {
    if (!candidate.reasons.some((r) => EXACT_VALUE_REASONS.has(r))) return false;
    // Unicidade estrita: único candidato em cada movimento E em cada título.
    for (const movementId of movementIdsOf(candidate)) {
      if ((byMovement.get(movementId) ?? []).length !== 1) return false;
    }
    for (const titleId of titleIdsOf(candidate)) {
      if ((byTitle.get(titleId) ?? []).length !== 1) return false;
    }
    return true;
  }

  // Passo 1 — vias A/B por candidato (dedup por suggestionKey).
  const provisional = new Map<
    string,
    { candidate: TreasuryReconciliationSuggestionCandidate; rule: CashSupportAutoAcceptRule }
  >();
  for (const candidate of all) {
    if (provisional.has(candidate.suggestionKey)) continue;
    if (passesViaA(candidate)) {
      provisional.set(candidate.suggestionKey, { candidate, rule: "HIGH_CONFIDENCE" });
    } else if (passesViaB(candidate)) {
      provisional.set(candidate.suggestionKey, { candidate, rule: "UNIQUE_EXACT_VALUE" });
    }
  }

  // Passo 2 — nenhum centavo duas vezes: provisionais que compartilham
  // movimento OU título derrubam TODOS os envolvidos para revisão.
  const movementClaims = new Map<string, string[]>();
  const titleClaims = new Map<string, string[]>();
  for (const { candidate } of provisional.values()) {
    for (const movementId of movementIdsOf(candidate)) {
      const arr = movementClaims.get(movementId) ?? [];
      arr.push(candidate.suggestionKey);
      movementClaims.set(movementId, arr);
    }
    for (const titleId of titleIdsOf(candidate)) {
      const arr = titleClaims.get(titleId) ?? [];
      arr.push(candidate.suggestionKey);
      titleClaims.set(titleId, arr);
    }
  }
  const contestedKeys = new Set<string>();
  for (const keys of [...movementClaims.values(), ...titleClaims.values()]) {
    if (keys.length > 1) for (const key of keys) contestedKeys.add(key);
  }

  const autoAcceptable: CashSupportAutoAcceptDecision[] = [];
  const acceptedKeys = new Set<string>();
  for (const { candidate, rule } of provisional.values()) {
    if (contestedKeys.has(candidate.suggestionKey)) continue;
    acceptedKeys.add(candidate.suggestionKey);
    autoAcceptable.push({
      candidate,
      idempotencyKey: buildCashSupportAutoIdempotencyKey(candidate),
      ruleVersion: CASH_SUPPORT_AUTO_RECONCILE_RULE_VERSION,
      rule,
    });
  }

  const needsReview = all.filter((c) => !acceptedKeys.has(c.suggestionKey));

  // Determinístico para persistência/testes.
  autoAcceptable.sort((a, b) =>
    a.candidate.suggestionKey.localeCompare(b.candidate.suggestionKey)
  );
  needsReview.sort((a, b) => b.score - a.score || a.suggestionKey.localeCompare(b.suggestionKey));

  const movementsAnalyzed = byMovement.size + engineResult.unmatchedMovementIds.length;

  return {
    autoAcceptable,
    needsReview,
    unmatchedMovementIds: [...engineResult.unmatchedMovementIds],
    summary: {
      movementsAnalyzed,
      autoAcceptableCount: autoAcceptable.length,
      needsReviewCount: needsReview.length,
      unmatchedCount: engineResult.unmatchedMovementIds.length,
    },
  };
}
