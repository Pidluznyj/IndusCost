import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  enrichProposalListRowMargin,
  resolveProposalOfficialMarginFromItems,
} from "./proposalListMargin.js";

describe("proposalListMargin", () => {
  it("resumo pondera % pela receita líquida gerencial (não média simples)", () => {
    const resolved = resolveProposalOfficialMarginFromItems([
      {
        quantity: 1,
        negotiatedPrice: 1000,
        discountValue: 0,
        taxesPerc: 0,
        unitCost: 600,
      },
      {
        quantity: 1,
        negotiatedPrice: 100,
        discountValue: 0,
        taxesPerc: 0,
        unitCost: 10,
      },
    ]);
    assert.equal(resolved.totalMarginValue, 490);
    assert.equal(resolved.totalMarginPerc, 44.55);
    assert.equal(resolved.itemCount, 2);
  });

  it("enrich usa itens quando presentes e remove o array do DTO de lista", () => {
    const enriched = enrichProposalListRowMargin({
      id: "p1",
      number: 1,
      totalMarginPerc: 100,
      totalMarginValue: 999,
      items: [
        {
          quantity: 1,
          negotiatedPrice: 1000,
          discountValue: 0,
          taxesPerc: 10,
          unitCost: 600,
        },
      ],
    });
    assert.equal(enriched.marginSource, "ITEMS");
    assert.notEqual(enriched.totalMarginPerc, 100);
    assert.equal((enriched as { items?: unknown }).items, undefined);
    assert.ok(Number(enriched.totalMarginPerc) > 0);
    assert.ok(Number(enriched.totalMarginPerc) < 100);
  });

  it("enrich preserva cabeçalho quando não há itens", () => {
    const enriched = enrichProposalListRowMargin({
      id: "p2",
      totalMarginPerc: 25.5,
      totalMarginValue: 100,
      items: [],
    });
    assert.equal(enriched.marginSource, "HEADER");
    assert.equal(enriched.totalMarginPerc, 25.5);
    assert.equal(enriched.totalMarginValue, 100);
  });
});
