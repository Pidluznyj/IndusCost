import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMaterialOfficialQuoteAuditRecord,
  buildMaterialOfficialQuoteSummary,
  countMaterialOfficialQuotes,
  planSetMaterialOfficialQuote,
  resolveMaterialOfficialQuotePriceBrl,
  resolveMaterialOfficialQuoteRow,
} from "./materialOfficialQuote.js";

describe("materialOfficialQuote", () => {
  it("define cotação A como oficial", () => {
    const quotes = [
      { id: "a", materialId: "m1", isOfficialReference: false },
      { id: "b", materialId: "m1", isOfficialReference: false },
    ];
    const planned = planSetMaterialOfficialQuote({
      materialId: "m1",
      quoteId: "a",
      quotes,
    });
    assert.equal(planned.ok, true);
    if (planned.ok) {
      assert.equal(planned.plan.previousQuoteId, null);
      assert.equal(planned.plan.newQuoteId, "a");
    }

    const nextQuotes = quotes.map((q) =>
      q.id === "a" ? { ...q, isOfficialReference: true } : q
    );
    assert.equal(countMaterialOfficialQuotes(nextQuotes), 1);
  });

  it("substitui oficial A por B e registra auditoria com ambos ids", () => {
    const quotes = [
      { id: "a", materialId: "m1", isOfficialReference: true },
      { id: "b", materialId: "m1", isOfficialReference: false },
    ];
    const planned = planSetMaterialOfficialQuote({
      materialId: "m1",
      quoteId: "b",
      quotes,
    });
    assert.equal(planned.ok, true);
    if (planned.ok) {
      assert.equal(planned.plan.previousQuoteId, "a");
      assert.equal(planned.plan.newQuoteId, "b");
    }

    const audit = buildMaterialOfficialQuoteAuditRecord({
      materialId: "m1",
      previousQuoteId: "a",
      newQuoteId: "b",
      changedBy: "user-1",
      changedAt: "2026-07-08T12:00:00.000Z",
    });
    assert.equal(audit.previousQuoteId, "a");
    assert.equal(audit.newQuoteId, "b");
  });

  it("mantém no máximo uma cotação oficial por material", () => {
    const quotes = [
      { id: "a", materialId: "m1", isOfficialReference: true },
      { id: "b", materialId: "m1", isOfficialReference: false },
    ];
    const after = quotes.map((q) => ({
      ...q,
      isOfficialReference: q.id === "b",
    }));
    assert.equal(countMaterialOfficialQuotes(after), 1);
    assert.equal(resolveMaterialOfficialQuoteRow(after)?.id, "b");
  });

  it("monta resumo oficial com preço BRL, fornecedor e data", () => {
    const summary = buildMaterialOfficialQuoteSummary({
      id: "q1",
      materialId: "m1",
      supplierName: "Fornecedor X",
      quoteDate: "2026-06-15",
      currency: "BRL",
      netPrice: 42.5,
      isOfficialReference: true,
    });
    assert.ok(summary);
    assert.equal(summary?.id, "q1");
    assert.equal(summary?.priceBrl, 42.5);
    assert.equal(summary?.supplierName, "Fornecedor X");
    assert.equal(summary?.quoteDate, "2026-06-15");
  });

  it("usa netPriceBrl para cotações em moeda estrangeira", () => {
    const priceBrl = resolveMaterialOfficialQuotePriceBrl({
      currency: "USD",
      netPrice: 10,
      netPriceBrl: 55.2,
    });
    assert.equal(priceBrl, 55.2);
  });
});
