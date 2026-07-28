import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertNoConflictingWinners,
  computeAwardGainSnapshot,
  QuotationAwardError,
  validateAwardPackage,
  type AwardValidationInput,
} from "./quotationAwardEngine.js";

function baseInput(overrides: Partial<AwardValidationInput> = {}): AwardValidationInput {
  return {
    quotationStatus: "EM_ANALISE",
    currency: "BRL",
    mode: "SINGLE",
    justification: "Escolha por prazo e qualidade técnica.",
    finalRoundId: "round-1",
    hasClosedRound: true,
    openRoundExists: false,
    demandItems: [{ quotationItemId: "qi-1", quantityDemanded: 100 }],
    offerItems: [
      {
        offerId: "o1",
        offerItemId: "oi-1",
        quotationItemId: "qi-1",
        offerStatus: "RECEBIDA",
        unitPrice: 10,
        quantityOffered: 100,
        validityDate: "2026-12-01",
        currency: "BRL",
      },
      {
        offerId: "o2",
        offerItemId: "oi-2",
        quotationItemId: "qi-1",
        offerStatus: "RECEBIDA",
        unitPrice: 9,
        quantityOffered: 100,
        validityDate: "2026-12-01",
        currency: "BRL",
      },
    ],
    allocations: [{ offerId: "o1", quotationItemId: "qi-1", quantityAwarded: 100 }],
    rejections: [{ offerId: "o2", reason: "Prazo superior ao necessário." }],
    activeEvidenceCount: 2,
    todayIsoDate: "2026-07-21",
    existingPendingOrApprovedAward: false,
    ...overrides,
  };
}

describe("quotationAwardEngine (OP-19)", () => {
  it("valida pacote SINGLE com evidência e quantidade atendida", () => {
    const r = validateAwardPackage(baseInput());
    assert.deepEqual(r.winnerOfferIds, ["o1"]);
    assert.deepEqual(r.rejectedOfferIds, ["o2"]);
    assert.equal(r.usedEvidenceException, false);
  });

  it("bloqueia múltiplos vencedores em modo SINGLE", () => {
    assert.throws(
      () =>
        validateAwardPackage(
          baseInput({
            allocations: [
              { offerId: "o1", quotationItemId: "qi-1", quantityAwarded: 50 },
              { offerId: "o2", quotationItemId: "qi-1", quantityAwarded: 50 },
            ],
            rejections: [],
          })
        ),
      (e: unknown) => e instanceof QuotationAwardError && e.code === "CONFLICTING_WINNERS"
    );
  });

  it("permite SPLIT com rastreio por quantidade", () => {
    const r = validateAwardPackage(
      baseInput({
        mode: "SPLIT",
        allocations: [
          { offerId: "o1", quotationItemId: "qi-1", quantityAwarded: 40 },
          { offerId: "o2", quotationItemId: "qi-1", quantityAwarded: 60 },
        ],
        rejections: [],
      })
    );
    assert.equal(r.winnerOfferIds.length, 2);
  });

  it("exige cotação concluída, evidência, validade e sem rodada aberta", () => {
    assert.throws(
      () => validateAwardPackage(baseInput({ quotationStatus: "RASCUNHO" })),
      (e: unknown) => e instanceof QuotationAwardError && e.code === "QUOTATION_NOT_READY"
    );
    assert.throws(
      () => validateAwardPackage(baseInput({ activeEvidenceCount: 0 })),
      (e: unknown) => e instanceof QuotationAwardError && e.code === "EVIDENCE_REQUIRED"
    );
    assert.throws(
      () =>
        validateAwardPackage(
          baseInput({
            offerItems: [
              {
                offerId: "o1",
                offerItemId: "oi-1",
                quotationItemId: "qi-1",
                offerStatus: "RECEBIDA",
                unitPrice: 10,
                quantityOffered: 100,
                validityDate: "2020-01-01",
                currency: "BRL",
              },
            ],
            rejections: [],
          })
        ),
      (e: unknown) => e instanceof QuotationAwardError && e.code === "VALIDITY_EXPIRED"
    );
    assert.throws(
      () => validateAwardPackage(baseInput({ openRoundExists: true })),
      (e: unknown) => e instanceof QuotationAwardError && e.code === "OPEN_ROUND"
    );
  });

  it("impede vencedor e rejeitado conflitantes; calcula ganho", () => {
    assert.throws(
      () => assertNoConflictingWinners({ mode: "SINGLE", winnerOfferIds: ["a", "b"] }),
      (e: unknown) => e instanceof QuotationAwardError && e.code === "CONFLICTING_WINNERS"
    );
    assert.throws(
      () =>
        validateAwardPackage(
          baseInput({
            rejections: [{ offerId: "o1", reason: "Conflito indevido." }],
          })
        ),
      (e: unknown) => e instanceof QuotationAwardError && e.code === "WINNER_AND_REJECTED"
    );
    const gain = computeAwardGainSnapshot({
      initialComparableTotal: 200,
      awardedComparableTotal: 150,
    });
    assert.equal(gain.totalGain, 50);
    assert.equal(gain.percentGain, 25);
  });
});
