import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertHumanWinnerSelection,
  buildComparisonSummaryCards,
  filterComparisonRows,
  markIncomparability,
  rankByNegotiatedCostInformative,
  type SupplierComparisonInput,
} from "./quotationComparisonEngine.js";

function baseRow(overrides: Partial<SupplierComparisonInput> = {}): SupplierComparisonInput {
  return {
    offerId: "o1",
    supplierId: "s1",
    supplierName: "Fornecedor A",
    supplierDocument: "11.111.111/0001-11",
    offerStatus: "RECEBIDA",
    currency: "BRL",
    initialUnitPriceAvg: 10,
    negotiatedUnitPriceAvg: 8,
    initialComparableCost: 100,
    negotiatedComparableCost: 80,
    totalGain: 20,
    percentGain: 20,
    freightValue: 5,
    freightIncoterm: "FOB",
    leadTimeDays: 15,
    paymentTerms: "30 dias",
    minOrderQty: 10,
    validityDate: "2026-08-01",
    quantityOffered: 100,
    quantityDemanded: 100,
    evidenceCount: 1,
    hasNegotiatedRound: true,
    isWinner: false,
    ...overrides,
  };
}

describe("quotationComparisonEngine (OP-18)", () => {
  it("bloqueia auto-pick por menor preço e exige justificativa humana", () => {
    assert.throws(
      () =>
        assertHumanWinnerSelection({
          selectionJustification: "escolhido por prazo e qualidade",
          autoPickByLowestPrice: true,
        }),
      /AUTO_PICK_FORBIDDEN/
    );
    assert.throws(
      () => assertHumanWinnerSelection({ selectionJustification: "curto" }),
      /JUSTIFICATION_REQUIRED/
    );
    const ok = assertHumanWinnerSelection({
      selectionJustification: "Prazo menor e risco técnico inferior.",
    });
    assert.match(ok, /Prazo/);
  });

  it("marca incomparabilidade por moeda e oferta incompleta", () => {
    const rows = markIncomparability(
      [
        baseRow({ offerId: "a", currency: "BRL" }),
        baseRow({
          offerId: "b",
          currency: "USD",
          supplierName: "B",
          initialComparableCost: 50,
          negotiatedComparableCost: 40,
        }),
        baseRow({
          offerId: "c",
          supplierName: "C",
          initialUnitPriceAvg: null,
          initialComparableCost: null,
        }),
      ],
      { preferredCurrency: "BRL" }
    );
    assert.equal(rows.find((r) => r.offerId === "a")?.comparable, true);
    assert.equal(rows.find((r) => r.offerId === "b")?.comparable, false);
    assert.ok(rows.find((r) => r.offerId === "b")?.alerts.some((a) => a.code === "CURRENCY_MISMATCH"));
    assert.equal(rows.find((r) => r.offerId === "c")?.comparable, false);
  });

  it("cards somam só comparáveis; ranking informativo não escolhe vencedor", () => {
    const compared = markIncomparability(
      [
        baseRow({ offerId: "cheap", negotiatedComparableCost: 50, initialComparableCost: 90 }),
        baseRow({
          offerId: "mid",
          negotiatedComparableCost: 70,
          initialComparableCost: 100,
          supplierName: "Mid",
        }),
        baseRow({
          offerId: "usd",
          currency: "USD",
          negotiatedComparableCost: 10,
          initialComparableCost: 20,
          supplierName: "USD",
        }),
      ],
      { preferredCurrency: "BRL" }
    );
    const cards = buildComparisonSummaryCards(
      compared.filter((r) => r.comparable),
      "BRL"
    );
    assert.equal(cards.comparableOfferCount, 2);
    assert.equal(cards.initialTotal, 190);
    assert.equal(cards.negotiatedTotal, 120);
    assert.equal(cards.gainedTotal, 70);
    const rank = rankByNegotiatedCostInformative(compared);
    assert.equal(rank[0], "cheap");
    assert.ok(!compared.some((r) => r.isWinner));
  });

  it("filtros por busca, evidência e comparabilidade", () => {
    const rows = markIncomparability(
      [
        baseRow({ offerId: "a", supplierName: "Alpha Metal", evidenceCount: 0 }),
        baseRow({
          offerId: "b",
          supplierName: "Beta Plast",
          evidenceCount: 2,
          currency: "EUR",
          initialComparableCost: 10,
          negotiatedComparableCost: 9,
        }),
      ],
      { preferredCurrency: "BRL" }
    );
    const filtered = filterComparisonRows(rows, {
      q: "alpha",
      onlyWithEvidence: false,
      onlyComparable: true,
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.offerId, "a");
    const withEv = filterComparisonRows(rows, { onlyWithEvidence: true });
    assert.equal(withEv.length, 1);
    assert.equal(withEv[0]?.offerId, "b");
  });
});
