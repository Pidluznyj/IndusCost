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
  runTreasuryReconciliationSuggestionEngine,
  type TreasuryReconciliationSuggestionCandidate,
  type TreasuryReconciliationSuggestionEngineResult,
} from "./treasuryReconciliationSuggestionEngine.js";

function candidate(
  overrides: Partial<TreasuryReconciliationSuggestionCandidate> = {}
): TreasuryReconciliationSuggestionCandidate {
  const movementId =
    (overrides.movementLegs?.[0]?.movementId as string | undefined) ??
    overrides.movementId ??
    "mov-1";
  return {
    suggestionKey: "mov-1|900",
    movementId,
    movementLegs: [{ movementId, suggestedAmount: "1000.00" }],
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

describe("cashSupportAutoReconcile — via A (alta confiança)", () => {
  it("HIGH único vira auto-aceitável com idempotencyKey determinística", () => {
    const plan = planCashSupportAutoReconciliation(engineResult([candidate()]));
    assert.equal(plan.autoAcceptable.length, 1);
    assert.equal(plan.needsReview.length, 0);
    const decision = plan.autoAcceptable[0]!;
    assert.equal(decision.rule, "HIGH_CONFIDENCE");
    assert.equal(
      decision.idempotencyKey,
      `AUTO|${TREASURY_RECONCILIATION_SUGGESTION_ALGORITHM_VERSION}|${CASH_SUPPORT_AUTO_RECONCILE_RULE_VERSION}|mov-1|900`
    );
  });

  it("HIGH com segundo colocado próximo (gap < mínimo) ⇒ REVISAR", () => {
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

  it("mesmo título disputado por dois movimentos HIGH ⇒ ambos para revisão", () => {
    const plan = planCashSupportAutoReconciliation(
      engineResult([
        candidate({ suggestionKey: "mov-1|900", movementLegs: [{ movementId: "mov-1", suggestedAmount: "1000.00" }] }),
        candidate({ suggestionKey: "mov-2|900", movementLegs: [{ movementId: "mov-2", suggestedAmount: "1000.00" }] }),
      ])
    );
    assert.equal(plan.autoAcceptable.length, 0);
    assert.equal(plan.needsReview.length, 2);
  });
});

describe("cashSupportAutoReconcile — via B (valor exato com unicidade comprovada)", () => {
  it("cenário da auditoria: 17.438,27 único, LOW sem identificador ⇒ AUTOMÁTICO pela via B", () => {
    // Motor REAL (não fixture): movimento e título de mesmo valor, direção
    // certa, janela ok, sem documento/CNPJ/nome — score 50 LOW.
    const engine = runTreasuryReconciliationSuggestionEngine({
      companyCode: "EMP1",
      asOfCivilDate: "2026-08-10",
      movements: [
        {
          id: "mov-ofx-1",
          accountId: "acc-1",
          direction: "CREDIT",
          amount: "17438.27",
          postedCivilDate: "2026-08-10",
          description: "PIX RECEBIDO 10/08",
          reconciliationStatus: "PENDING",
          reconciledAmount: "0.00",
        },
      ],
      titles: [
        {
          side: "AR",
          officialTitleId: "900",
          externalId: 900,
          counterpartyName: "Metalurgica Alfa Ltda",
          dueDate: "2026-08-10",
          openBalance: "17438.27",
          isCancelled: false,
          isSettled: false,
        },
      ],
    });
    assert.equal(engine.suggestions.length, 1);
    assert.equal(engine.suggestions[0]!.confidence, "LOW");
    assert.equal(engine.suggestions[0]!.score, 50);

    const plan = planCashSupportAutoReconciliation(engine);
    assert.equal(plan.autoAcceptable.length, 1, "único + valor exato ⇒ auto");
    assert.equal(plan.autoAcceptable[0]!.rule, "UNIQUE_EXACT_VALUE");
  });

  it("dois CRs de mesmo valor ⇒ dois candidatos no movimento ⇒ NUNCA automático", () => {
    const engine = runTreasuryReconciliationSuggestionEngine({
      companyCode: "EMP1",
      asOfCivilDate: "2026-08-10",
      movements: [
        {
          id: "mov-ofx-1",
          accountId: "acc-1",
          direction: "CREDIT",
          amount: "17438.27",
          postedCivilDate: "2026-08-10",
          description: "PIX RECEBIDO",
          reconciliationStatus: "PENDING",
        },
      ],
      titles: [
        {
          side: "AR",
          officialTitleId: "900",
          externalId: 900,
          counterpartyName: "Cliente A",
          dueDate: "2026-08-10",
          openBalance: "17438.27",
          isCancelled: false,
          isSettled: false,
        },
        {
          side: "AR",
          officialTitleId: "901",
          externalId: 901,
          counterpartyName: "Cliente B",
          dueDate: "2026-08-11",
          openBalance: "17438.27",
          isCancelled: false,
          isSettled: false,
        },
      ],
    });
    assert.equal(engine.suggestions.length, 2, "ambos os títulos são candidatos");
    const plan = planCashSupportAutoReconciliation(engine);
    assert.equal(plan.autoAcceptable.length, 0, "ambiguidade ⇒ revisão");
    assert.equal(plan.needsReview.length, 2);
  });

  it("valor exato mas título também candidato de outro movimento ⇒ revisão", () => {
    const plan = planCashSupportAutoReconciliation(
      engineResult([
        candidate({
          suggestionKey: "mov-1|900",
          score: 50,
          confidence: "LOW",
          reasons: ["DIRECTION_COMPATIBLE", "AMOUNT_EXACT", "DATE_PROXIMITY"],
        }),
        candidate({
          suggestionKey: "mov-2|900",
          movementLegs: [{ movementId: "mov-2", suggestedAmount: "1000.00" }],
          score: 45,
          confidence: "LOW",
          reasons: ["DIRECTION_COMPATIBLE", "AMOUNT_EXACT"],
        }),
      ])
    );
    assert.equal(plan.autoAcceptable.length, 0);
  });

  it("sem valor exato (parcial) nunca passa pela via B", () => {
    const plan = planCashSupportAutoReconciliation(
      engineResult([
        candidate({
          score: 20,
          confidence: "LOW",
          reasons: ["DIRECTION_COMPATIBLE", "DATE_PROXIMITY"],
        }),
      ])
    );
    assert.equal(plan.autoAcceptable.length, 0);
  });
});

describe("cashSupportAutoReconcile — combinações e determinismo", () => {
  it("combinação 1 título ↔ N movimentos única e exata ⇒ auto pela via B", () => {
    const combo = candidate({
      suggestionKey: "MOV-COMBINATION|AR|900|mov-1|mov-2",
      movementLegs: [
        { movementId: "mov-1", suggestedAmount: "600.00" },
        { movementId: "mov-2", suggestedAmount: "400.00" },
      ],
      score: 50,
      confidence: "LOW",
      reasons: ["MOVEMENT_COMBINATION_EXACT"],
    });
    const plan = planCashSupportAutoReconciliation(engineResult([combo]));
    assert.equal(plan.autoAcceptable.length, 1);
    assert.equal(plan.autoAcceptable[0]!.rule, "UNIQUE_EXACT_VALUE");
  });

  it("duas combinações disputando o mesmo movimento ⇒ ambas para revisão", () => {
    const comboA = candidate({
      suggestionKey: "MOV-COMBINATION|AR|900|mov-1|mov-2",
      movementLegs: [
        { movementId: "mov-1", suggestedAmount: "600.00" },
        { movementId: "mov-2", suggestedAmount: "400.00" },
      ],
      reasons: ["MOVEMENT_COMBINATION_EXACT"],
      score: 50,
      confidence: "LOW",
    });
    const comboB = candidate({
      suggestionKey: "MOV-COMBINATION|AR|901|mov-2|mov-3",
      movementLegs: [
        { movementId: "mov-2", suggestedAmount: "400.00" },
        { movementId: "mov-3", suggestedAmount: "600.00" },
      ],
      allocations: [
        { side: "AR", officialTitleId: "901", externalId: 901, suggestedAmount: "1000.00" },
      ],
      reasons: ["MOVEMENT_COMBINATION_EXACT"],
      score: 50,
      confidence: "LOW",
    });
    const plan = planCashSupportAutoReconciliation(engineResult([comboA, comboB]));
    assert.equal(plan.autoAcceptable.length, 0, "mov-2 disputado ⇒ nada automático");
    assert.equal(plan.needsReview.length, 2);
  });

  it("plano é determinístico e idempotente (mesma entrada ⇒ mesma saída)", () => {
    const input = engineResult(
      [
        candidate({
          suggestionKey: "mov-2|902",
          movementLegs: [{ movementId: "mov-2", suggestedAmount: "70.00" }],
          allocations: [
            { side: "AR", officialTitleId: "902", externalId: 902, suggestedAmount: "70.00" },
          ],
        }),
        candidate({ suggestionKey: "mov-1|900" }),
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

  it("justificativa AUTO carrega prefixo, regra aplicada e score/motivos", () => {
    const viaA = buildCashSupportAutoJustification(candidate(), "HIGH_CONFIDENCE");
    assert.ok(viaA.startsWith(CASH_SUPPORT_AUTO_JUSTIFICATION_PREFIX));
    assert.ok(viaA.includes("alta confiança"));
    assert.ok(viaA.includes("score 85"));
    const viaB = buildCashSupportAutoJustification(candidate(), "UNIQUE_EXACT_VALUE");
    assert.ok(viaB.includes("valor exato com candidato único"));
  });

  it("idempotencyKey inclui versão do algoritmo E da regra — mudar regra gera chave nova", () => {
    const key = buildCashSupportAutoIdempotencyKey(candidate());
    assert.ok(key.includes(TREASURY_RECONCILIATION_SUGGESTION_ALGORITHM_VERSION));
    assert.ok(key.includes(CASH_SUPPORT_AUTO_RECONCILE_RULE_VERSION));
    assert.equal(CASH_SUPPORT_AUTO_RECONCILE_RULE_VERSION, "AUTO-1.1.0");
  });
});
