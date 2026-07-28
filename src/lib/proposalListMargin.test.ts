import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  enrichProposalListRowMargin,
  resolveProposalOfficialMarginFromItems,
} from "./proposalListMargin.js";

describe("proposalListMargin", () => {
  it("resumo pondera % pela receita (paridade Pedido)", () => {
    const resolved = resolveProposalOfficialMarginFromItems([
      {
        quantity: 1,
        negotiatedPrice: 1000,
        discountValue: 0,
        unitCost: 600,
      },
      {
        quantity: 1,
        negotiatedPrice: 100,
        discountValue: 0,
        unitCost: 10,
      },
    ]);
    assert.equal(resolved.totalMarginValue, 490);
    assert.equal(resolved.totalMarginPerc, 44.55);
    assert.equal(resolved.itemCount, 2);
  });

  it("custo zero/ausente não inventa 100% (paridade Pedido)", () => {
    const missing = resolveProposalOfficialMarginFromItems([
      {
        quantity: 1,
        negotiatedPrice: 407.4,
        unitCost: null,
        productId: "p1",
      },
    ]);
    assert.equal(missing.totalMarginPerc, null);
    assert.equal(missing.totalMarginValue, null);

    const zeroCost = resolveProposalOfficialMarginFromItems([
      {
        quantity: 1,
        negotiatedPrice: 407.4,
        unitCost: 0,
        productId: "p1",
      },
    ]);
    // CUSTO_ZERO no motor do Pedido → margem indisponível
    assert.equal(zeroCost.totalMarginPerc, null);
    assert.equal(zeroCost.totalMarginValue, null);
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
          unitCost: 600,
        },
      ],
    });
    assert.equal(enriched.marginSource, "ITEMS");
    assert.equal(enriched.totalMarginPerc, 40);
    assert.equal((enriched as { items?: unknown }).items, undefined);
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
