import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  enrichProposalListRowMargin,
  resolveProposalOfficialMarginFromItems,
} from "./proposalListMargin.js";

describe("proposalListMargin", () => {
  it("resumo pondera % pela receita PV (não média simples)", () => {
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
    // (1000 − 100 imposto − 600 custo) / 1000 = 30%
    assert.equal(enriched.totalMarginPerc, 30);
    assert.equal((enriched as { items?: unknown }).items, undefined);
  });

  it("Atacado com comissão/frete da tabela → margem de formação ~32%", () => {
    const resolved = resolveProposalOfficialMarginFromItems([
      {
        quantity: 1,
        negotiatedPrice: 3.423215,
        discountValue: 0,
        taxesPerc: 28.75,
        unitCost: 1.172451,
        commissionPerc: 2,
        pricingSnapshotJson: {
          proposalDefaults: { freightPercent: 3, freightAbsolute: 0 },
        },
      },
    ]);
    assert.ok(
      Math.abs(resolved.totalMarginPerc - 32) < 0.05,
      `expected ~32%, got ${resolved.totalMarginPerc}`
    );
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
