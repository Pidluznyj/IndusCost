/**
 * Auto-conciliação CONSERVADORA — seleção dos candidatos que podem virar
 * match automático persistido (Conciliação Bancária / Apoio ao Caixa).
 *
 * REGRA DE OURO: auto-match ≠ baixa oficial. Nada aqui toca o Nomus; o match
 * é evidência operacional (TreasuryReconciliationMatch) criada pelo serviço
 * oficial `treasuryReconciliationMatchService.accept` — com idempotencyKey.
 *
 * Só é auto-aceitável o candidato que passa TODAS as barreiras:
 *   1. confiança HIGH do motor (score >= highMinScore; HIGH exige valor exato
 *      + pelo menos mais um sinal forte — documento, CNPJ/CPF ou data+nome);
 *   2. valor: cobre exatamente o disponível do movimento (sem sobra inventada);
 *   3. candidato ÚNICO para o movimento: o segundo colocado do mesmo movimento
 *      precisa estar claramente abaixo (gap mínimo) ou nem existir — dois CRs
 *      de mesmo valor geram dois candidatos próximos ⇒ REVISAR, nunca auto;
 *   4. título sem concorrência: nenhum OUTRO movimento tem candidato HIGH para
 *      o MESMO título — senão os dois viram revisão;
 *   5. direção/datas/janela já garantidas pelo motor (CR=entrada, CP=saída,
 *      janela `dateWindowDays`).
 *
 * Valor sozinho NUNCA basta: com apenas AMOUNT_EXACT (40 pts) o candidato não
 * alcança HIGH (>= 80) — precisa de documento/CNPJ/data+nome. Determinístico
 * e auditável: cada aceite carrega score, reasons e algorithmVersion.
 */

import {
  TREASURY_RECONCILIATION_SUGGESTION_ALGORITHM_VERSION,
  type TreasuryReconciliationSuggestionCandidate,
  type TreasuryReconciliationSuggestionEngineResult,
} from "./treasuryReconciliationSuggestionEngine.js";

export const CASH_SUPPORT_AUTO_RECONCILE_RULE_VERSION = "AUTO-1.0.0" as const;

/**
 * Prefixo da justificativa gravada em matches automáticos.
 * O grid usa este marcador para distinguir origem 🟢 Automático × 🔵 Manual.
 */
export const CASH_SUPPORT_AUTO_JUSTIFICATION_PREFIX = "[AUTO]" as const;

export function buildCashSupportAutoJustification(
  candidate: TreasuryReconciliationSuggestionCandidate
): string {
  return (
    `${CASH_SUPPORT_AUTO_JUSTIFICATION_PREFIX} Conciliação automática ` +
    `${CASH_SUPPORT_AUTO_RECONCILE_RULE_VERSION} — score ${candidate.score} ` +
    `(${candidate.confidence}); sinais: ${candidate.reasons.join(", ")}.`
  );
}

/** Gap mínimo de score entre 1º e 2º candidato do mesmo movimento para o 1º ser único. */
export const CASH_SUPPORT_AUTO_MIN_SCORE_GAP = 15;

export type CashSupportAutoAcceptDecision = {
  candidate: TreasuryReconciliationSuggestionCandidate;
  /** Chave idempotente do aceite automático — repetir o auto-run não duplica. */
  idempotencyKey: string;
  ruleVersion: typeof CASH_SUPPORT_AUTO_RECONCILE_RULE_VERSION;
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

/**
 * Classifica o resultado do motor em auto-aceitáveis × revisão × sem match.
 * Puro e determinístico — nenhuma escrita aqui.
 */
export function planCashSupportAutoReconciliation(
  engineResult: TreasuryReconciliationSuggestionEngineResult
): CashSupportAutoReconcilePlan {
  const byMovement = new Map<string, TreasuryReconciliationSuggestionCandidate[]>();
  for (const candidate of engineResult.suggestions) {
    const arr = byMovement.get(candidate.movementId) ?? [];
    arr.push(candidate);
    byMovement.set(candidate.movementId, arr);
  }

  // Passo 1 — melhor candidato por movimento que passa nas barreiras 1–3.
  const provisional = new Map<string, TreasuryReconciliationSuggestionCandidate>();
  const needsReview: TreasuryReconciliationSuggestionCandidate[] = [];

  for (const [movementId, candidates] of byMovement.entries()) {
    const sorted = [...candidates].sort((a, b) => b.score - a.score);
    const best = sorted[0]!;
    const runnerUp = sorted[1] ?? null;

    const isHigh = best.confidence === "HIGH";
    const uniqueEnough =
      runnerUp == null || best.score - runnerUp.score >= CASH_SUPPORT_AUTO_MIN_SCORE_GAP;

    if (isHigh && uniqueEnough) {
      provisional.set(movementId, best);
    } else {
      needsReview.push(...sorted);
    }
  }

  // Passo 2 — barreira 4: título disputado por mais de um movimento auto-aceitável
  // (ou por candidato HIGH de outro movimento) derruba TODOS para revisão.
  const titleClaims = new Map<string, string[]>(); // officialTitleId -> movementIds
  for (const [movementId, candidate] of provisional.entries()) {
    for (const alloc of candidate.allocations) {
      const arr = titleClaims.get(alloc.officialTitleId) ?? [];
      arr.push(movementId);
      titleClaims.set(alloc.officialTitleId, arr);
    }
  }
  const highTitleClaimsFromOthers = new Map<string, Set<string>>();
  for (const candidate of engineResult.suggestions) {
    if (candidate.confidence !== "HIGH") continue;
    for (const alloc of candidate.allocations) {
      const set = highTitleClaimsFromOthers.get(alloc.officialTitleId) ?? new Set<string>();
      set.add(candidate.movementId);
      highTitleClaimsFromOthers.set(alloc.officialTitleId, set);
    }
  }

  const autoAcceptable: CashSupportAutoAcceptDecision[] = [];
  for (const [movementId, candidate] of provisional.entries()) {
    const contested = candidate.allocations.some((alloc) => {
      const claimers = titleClaims.get(alloc.officialTitleId) ?? [];
      if (claimers.length > 1) return true;
      const highClaimers = highTitleClaimsFromOthers.get(alloc.officialTitleId);
      return highClaimers != null && [...highClaimers].some((id) => id !== movementId);
    });
    if (contested) {
      needsReview.push(candidate);
      continue;
    }
    autoAcceptable.push({
      candidate,
      idempotencyKey: buildCashSupportAutoIdempotencyKey(candidate),
      ruleVersion: CASH_SUPPORT_AUTO_RECONCILE_RULE_VERSION,
    });
  }

  // Determinístico para persistência/testes.
  autoAcceptable.sort((a, b) =>
    a.candidate.suggestionKey.localeCompare(b.candidate.suggestionKey)
  );
  needsReview.sort((a, b) => b.score - a.score || a.suggestionKey.localeCompare(b.suggestionKey));

  const movementsAnalyzed =
    byMovement.size + engineResult.unmatchedMovementIds.length;

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
