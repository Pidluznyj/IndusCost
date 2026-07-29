import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculatePriceTableItemFromFrozenCost } from "./priceTablePublication.js";
import {
  enrichProposalListRowMargin,
  resolveProposalCommercialMarginFromItems,
  resolveProposalOfficialMarginFromItems,
} from "./proposalListMargin.js";
import { previewProposalCommercialMargins } from "./proposalCommercialMarginPreview.js";
import { serializeProposalCommercialPricingSnapshot } from "./proposalCommercialMarginSnapshot.js";

const TAX = 0.2875;
const OTHER = 0.02;
const FREIGHT_RATE = 0.03;
const COST = 100;

function formPrice(marginPercent: number, commissionPercent: number) {
  const formed = calculatePriceTableItemFromFrozenCost(COST, {
    taxRate: TAX,
    commissionRate: commissionPercent / 100,
    otherRate: OTHER,
    freightRate: FREIGHT_RATE,
    freight: 0,
    marginRate: marginPercent / 100,
  });
  assert.equal(formed.ok, true);
  if (!formed.ok) throw new Error(formed.message);
  return formed.result.salePrice;
}

describe("proposalListMargin", () => {
  it("oficial: resumo pondera % pela receita (paridade Pedido)", () => {
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

  it("oficial: custo zero/ausente não inventa 100% (paridade Pedido)", () => {
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
    assert.equal(zeroCost.totalMarginPerc, null);
    assert.equal(zeroCost.totalMarginValue, null);
  });

  it("comercial: listagem bate com a margem total do formulário", () => {
    const p48 = formPrice(48, 4.5);
    const formation = {
      formationContextId: "v1|v2",
      referenceDate: "2024-06-15",
      frozenCostUnit: COST,
      taxRate: TAX,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: 0,
      otherVariablesRate: OTHER,
      tiers: [
        {
          id: "band-33",
          marginRate: 0.33,
          salePrice: formPrice(33, 6),
          commissionRate: 0.06,
        },
        {
          id: "band-48",
          marginRate: 0.48,
          salePrice: p48,
          commissionRate: 0.045,
        },
      ],
    };

    const formPreview = previewProposalCommercialMargins([
      {
        quantity: 2,
        suggestedPrice: p48,
        negotiatedPrice: p48,
        discountPerc: 0,
        discountValue: 0,
        priceTableId: "pt",
        commercialFormation: formation,
      },
    ]);
    assert.equal(formPreview.byIndex[0]!.isComplete, true);
    const snap = formPreview.snapshots[0];
    assert.ok(snap);

    const listResolved = resolveProposalCommercialMarginFromItems([
      {
        quantity: 2,
        suggestedPrice: p48,
        negotiatedPrice: p48,
        discountPerc: 0,
        discountValue: 0,
        priceTableId: "pt",
        commercialPricingSnapshotJson:
          serializeProposalCommercialPricingSnapshot(snap),
      },
    ]);

    assert.equal(
      listResolved.totalMarginPerc,
      formPreview.summary.proposalCommercialMarginTotalPercent
    );
    assert.equal(
      listResolved.totalMarginValue,
      formPreview.summary.proposalCommercialMarginTotalValue
    );
  });

  it("enrich usa margem comercial dos itens e remove o array do DTO", () => {
    const p48 = formPrice(48, 4.5);
    const formation = {
      formationContextId: "v1|v2",
      referenceDate: "2024-06-15",
      frozenCostUnit: COST,
      taxRate: TAX,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: 0,
      otherVariablesRate: OTHER,
      tiers: [
        {
          id: "band-33",
          marginRate: 0.33,
          salePrice: formPrice(33, 6),
          commissionRate: 0.06,
        },
        {
          id: "band-48",
          marginRate: 0.48,
          salePrice: p48,
          commissionRate: 0.045,
        },
      ],
    };
    const formPreview = previewProposalCommercialMargins([
      {
        quantity: 1,
        suggestedPrice: p48,
        negotiatedPrice: p48,
        discountPerc: 0,
        priceTableId: "pt",
        commercialFormation: formation,
      },
    ]);
    const snap = formPreview.snapshots[0];
    assert.ok(snap);

    const enriched = enrichProposalListRowMargin({
      id: "p1",
      number: 1,
      totalMarginPerc: 100,
      totalMarginValue: 999,
      items: [
        {
          quantity: 1,
          suggestedPrice: p48,
          negotiatedPrice: p48,
          discountPerc: 0,
          commercialPricingSnapshotJson:
            serializeProposalCommercialPricingSnapshot(snap),
        },
      ],
    });
    assert.equal(enriched.marginSource, "ITEMS");
    assert.equal(
      enriched.totalMarginPerc,
      formPreview.summary.proposalCommercialMarginTotalPercent
    );
    assert.equal((enriched as { items?: unknown }).items, undefined);
  });

  it("comercial: Entre faixas (snapshot) aparece na listagem", () => {
    const p33 = formPrice(33, 6);
    const p48 = formPrice(48, 4.5);
    const mid = (p33 + p48) / 2;
    const formation = {
      formationContextId: "v1|v2",
      referenceDate: "2024-06-15",
      frozenCostUnit: COST,
      taxRate: TAX,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: 0,
      otherVariablesRate: OTHER,
      tiers: [
        { id: "band-33", marginRate: 0.33, salePrice: p33, commissionRate: 0.06 },
        { id: "band-48", marginRate: 0.48, salePrice: p48, commissionRate: 0.045 },
      ],
    };

    const formPreview = previewProposalCommercialMargins([
      {
        quantity: 1,
        suggestedPrice: p48,
        negotiatedPrice: mid,
        discountPerc: 0,
        priceTableId: "pt",
        commercialFormation: formation,
      },
    ]);
    assert.equal(formPreview.byIndex[0]!.tierPosition, "BETWEEN_TIERS");
    assert.equal(formPreview.byIndex[0]!.isComplete, true);
    const snap = formPreview.snapshots[0];
    assert.ok(snap);

    const listResolved = resolveProposalCommercialMarginFromItems([
      {
        quantity: 1,
        suggestedPrice: p48,
        negotiatedPrice: mid,
        discountPerc: 0,
        commercialPricingSnapshotJson:
          serializeProposalCommercialPricingSnapshot(snap),
      },
    ]);
    assert.equal(
      listResolved.totalMarginPerc,
      formPreview.summary.proposalCommercialMarginTotalPercent
    );
  });

  it("comercial: snapshot com margem já calculada (sem faixas) ainda exibe na lista", () => {
    const snap = {
      schemaVersion: 1 as const,
      formationContextId: "ctx",
      priceTableId: null,
      priceTableVersionId: null,
      referenceDate: "2026-07-29",
      referenceTableUnitPrice: 100,
      negotiatedGrossUnitPrice: 100,
      informedDiscountRate: 0,
      informedDiscountValue: 0,
      finalNetUnitPrice: 100,
      finalNetLineValue: 509.2,
      frozenCostUnit: null,
      taxRate: null,
      freightRate: null,
      freightAbsoluteUnit: null,
      otherVariablesRate: null,
      tiers: [] as [],
      calculatedCommissionRate: 0.05,
      commercialMarginRate: 0.4309,
      commercialMarginValue: 219.4,
      calculationSource: "PROPOSAL_PRICE_FORMATION" as const,
      warnings: [],
    };
    const listResolved = resolveProposalCommercialMarginFromItems([
      {
        quantity: 4,
        negotiatedPrice: 100,
        commercialPricingSnapshotJson:
          serializeProposalCommercialPricingSnapshot(snap),
      },
    ]);
    assert.equal(listResolved.totalMarginPerc, 43.09);
    assert.equal(listResolved.totalMarginValue, 219.4);
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
