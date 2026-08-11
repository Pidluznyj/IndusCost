import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CASH_SUPPORT_AUTO_JUSTIFICATION_PREFIX,
  CASH_SUPPORT_AUTO_MIN_SCORE_GAP,
  CASH_SUPPORT_AUTO_RECONCILE_RULE_VERSION,
  buildCashSupportAutoIdempotencyKey,
  buildCashSupportAutoJustification,
  planCashSupportAutoReconciliation,
} from "./cashSupportAutoReconcile.js";
import {
  TREASURY_RECONCILIATION_SUGGESTION_ALGORITHM_VERSION,
  type TreasuryReconciliationSuggestionCandidate,
  type TreasuryReconciliationSuggestionEngineResult,
} from "./treasuryReconciliationSuggestionEngine.js";

function candidate(
  overrides: Partial<TreasuryReconciliationSuggestionCandidate> = {}
): TreasuryReconciliationSuggestionCandidate {
  return {
    suggestionKey: "mov-1|900",
    movementId: "mov-1",
    allocations: [
      {
        side: "AR",
        officialTitleId: "900",
        externalId: 900,
        suggestedAmount: "1000.00",
      },
    ],
    totalSuggestedAmount: "1000.00",
    score: 85,
    confidence: "HIGH",
    reasons: ["AMOUNT_EXACT", "DOCUMENT_MATCH"],
    scoreBreakdown: {
      AMOUNT_EXACT: 40,
      DOCUMENT_MATCH: 20,
      TAX_ID_MATCH: 15,
      DATE_PROXIMITY: 10,
      NAME_SIMILAR: 0,
      HISTORY_MATCH: 0,
    },
    ...overrides,
  };
}

function engineResult(
  suggestions: TreasuryReconciliationSuggestionCandidate[],
  unmatchedMovementIds: string[] = []
): TreasuryReconciliationSuggestionEngineResult {
  return {
    algorithmVersion: TREASURY_RECONCILIATION_SUGGESTION_ALGORITHM_VERSION,
    suggestions,
    unmatchedMovementIds,
    excludedTitleIds: [],
    autoMatched: false,
  };
}

describe("cashSupportAutoReconcile — barreiras conservadoras", () => {
  it("HIGH único vira auto-aceitável com idempotencyKey determinística", () => {
    const plan = planCashSupportAutoReconciliation(engineResult([candidate()]));
    assert.equal(plan.autoAcceptable.length, 1);
    assert.equal(plan.needsReview.length, 0);
    const decision = plan.autoAcceptable[0]!;
    assert.equal(
      decision.idempotencyKey,
      `AUTO|${TREASURY_RECONCILIATION_SUGGESTION_ALGORITHM_VERSION}|${CASH_SUPPORT_AUTO_RECONCILE_RULE_VERSION}|mov-1|900`
    );
    assert.equal(decision.ruleVersion, CASH_SUPPORT_AUTO_RECONCILE_RULE_VERSION);
  });

  it("MEDIUM nunca é auto — vai para revisão", () => {
    const plan = planCashSupportAutoReconciliation(
      engineResult([candidate({ score: 60, confidence: "MEDIUM" })])
    );
    assert.equal(plan.autoAcceptable.length, 0);
    assert.equal(plan.needsReview.length, 1);
  });

  it("dois CRs de mesmo valor (dois candidatos HIGH próximos) ⇒ REVISAR, nunca auto", () => {
    // Cenário do teste 3 da missão: CR#1 e CR#2 de R$ 500,00 para o mesmo
    // movimento — o gap de score entre eles é < mínimo ⇒ ambíguo.
    const plan = planCashSupportAutoReconciliation(
      engineResult([
        candidate({ suggestionKey: "mov-1|900", score: 85 }),
        candidate({
          suggestionKey: "mov-1|901",
          score: 85 - (CASH_SUPPORT_AUTO_MIN_SCORE_GAP - 1),
          allocations: [
            { side: "AR", officialTitleId: "901", externalId: 901, suggestedAmount: "1000.00" },
          ],
        }),
      ])
    );
    assert.equal(plan.autoAcceptable.length, 0);
    assert.equal(plan.needsReview.length, 2);
  });

  it("segundo candidato claramente abaixo (gap >= mínimo) não bloqueia o primeiro", () => {
    const plan = planCashSupportAutoReconciliation(
      engineResult([
        candidate({ suggestionKey: "mov-1|900", score: 90 }),
        candidate({
          suggestionKey: "mov-1|901",
          score: 90 - CASH_SUPPORT_AUTO_MIN_SCORE_GAP,
          confidence: "MEDIUM",
          allocations: [
            { side: "AR", officialTitleId: "901", externalId: 901, suggestedAmount: "1000.00" },
          ],
        }),
      ])
    );
    assert.equal(plan.autoAcceptable.length, 1);
    assert.equal(plan.autoAcceptable[0]!.candidate.suggestionKey, "mov-1|900");
  });

  it("mesmo título disputado por dois movimentos auto-aceitáveis ⇒ ambos para revisão", () => {
    const plan = planCashSupportAutoReconciliation(
      engineResult([
        candidate({ suggestionKey: "mov-1|900", movementId: "mov-1" }),
        candidate({ suggestionKey: "mov-2|900", movementId: "mov-2" }),
      ])
    );
    assert.equal(plan.autoAcceptable.length, 0);
    assert.equal(plan.needsReview.length, 2);
  });

  it("título com candidato HIGH de OUTRO movimento (não auto) também derruba para revisão", () => {
    const plan = planCashSupportAutoReconciliation(
      engineResult([
        candidate({ suggestionKey: "mov-1|900", movementId: "mov-1", score: 90 }),
        // mov-2 tem dois candidatos próximos (não auto), mas um deles é HIGH
        // sobre o título 900 — competição real pelo mesmo centavo.
        candidate({ suggestionKey: "mov-2|900", movementId: "mov-2", score: 84 }),
        candidate({
          suggestionKey: "mov-2|901",
          movementId: "mov-2",
          score: 82,
          allocations: [
            { side: "AR", officialTitleId: "901", externalId: 901, suggestedAmount: "1000.00" },
          ],
        }),
      ])
    );
    assert.equal(
      plan.autoAcceptable.length,
      0,
      "título 900 disputado por mov-2 HIGH — mov-1 não pode ser auto"
    );
  });

  it("plano é determinístico e idempotente (mesma entrada ⇒ mesma saída)", () => {
    const input = engineResult(
      [
        candidate({ suggestionKey: "mov-2|902", movementId: "mov-2", allocations: [
          { side: "AR", officialTitleId: "902", externalId: 902, suggestedAmount: "70.00" },
        ] }),
        candidate({ suggestionKey: "mov-1|900", movementId: "mov-1" }),
      ],
      ["mov-9"]
    );
    const a = planCashSupportAutoReconciliation(input);
    const b = planCashSupportAutoReconciliation(input);
    assert.deepEqual(a, b);
    assert.deepEqual(
      a.autoAcceptable.map((d) => d.candidate.suggestionKey),
      ["mov-1|900", "mov-2|902"],
      "ordenado por suggestionKey"
    );
    assert.equal(a.summary.unmatchedCount, 1);
    assert.equal(a.summary.movementsAnalyzed, 3);
  });

  it("justificativa AUTO carrega o prefixo do marcador e score/motivos", () => {
    const text = buildCashSupportAutoJustification(candidate());
    assert.ok(text.startsWith(CASH_SUPPORT_AUTO_JUSTIFICATION_PREFIX));
    assert.ok(text.includes("score 85"));
    assert.ok(text.includes("AMOUNT_EXACT"));
  });

  it("idempotencyKey inclui versão do algoritmo E da regra — mudar regra gera chave nova", () => {
    const key = buildCashSupportAutoIdempotencyKey(candidate());
    assert.ok(key.includes(TREASURY_RECONCILIATION_SUGGESTION_ALGORITHM_VERSION));
    assert.ok(key.includes(CASH_SUPPORT_AUTO_RECONCILE_RULE_VERSION));
  });
});
