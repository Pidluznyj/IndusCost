import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculatePriceTableItemFromFrozenCost } from "./priceTablePublication.js";
import { previewProposalCommercialMargins } from "./proposalCommercialMarginPreview.js";
import {
  formatProposalCommercialPercent,
  proposalCommercialMarginUnavailableLabel,
} from "./proposalCommercialMarginDisplay.js";

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

describe("proposalCommercialMargin UI — prévia em tempo real", () => {
  const p33 = formPrice(33, 6);
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
      { id: "band-33", marginRate: 0.33, salePrice: p33, commissionRate: 0.06 },
      { id: "band-48", marginRate: 0.48, salePrice: p48, commissionRate: 0.045 },
    ],
  };

  it("criação/edição: alteração de preço e desconto recalcula margem", () => {
    const base = previewProposalCommercialMargins([
      {
        quantity: 2,
        suggestedPrice: p48,
        negotiatedPrice: p48,
        discountPerc: 0,
        discountValue: 0,
        priceTableId: "pt",
        priceSource: "PRICE_TABLE",
        commercialFormation: formation,
      },
    ]);
    assert.equal(base.byIndex[0]!.isComplete, true);
    assert.equal(base.byIndex[0]!.commercialMarginPercent, 48);

    const discounted = previewProposalCommercialMargins([
      {
        quantity: 2,
        suggestedPrice: p48,
        negotiatedPrice: p48,
        discountPerc: 10,
        priceTableId: "pt",
        priceSource: "PRICE_TABLE",
        commercialFormation: formation,
      },
    ]);
    assert.equal(discounted.byIndex[0]!.isComplete, true);
    assert.ok(
      (discounted.byIndex[0]!.finalNetUnitPrice ?? 0) < p48
    );
    assert.notEqual(
      discounted.byIndex[0]!.commercialMarginPercent,
      base.byIndex[0]!.commercialMarginPercent
    );
  });

  it("comissão muda de faixa com desconto", () => {
    const at48 = previewProposalCommercialMargins([
      {
        quantity: 1,
        negotiatedPrice: p48,
        suggestedPrice: p48,
        priceTableId: "pt",
        commercialFormation: formation,
      },
    ]);
    const viaDiscount = previewProposalCommercialMargins([
      {
        quantity: 1,
        negotiatedPrice: p33,
        suggestedPrice: p48,
        discountPerc: 0,
        priceTableId: "pt",
        commercialFormation: formation,
      },
    ]);
    assert.equal(at48.byIndex[0]!.commissionRate, 0.045);
    assert.equal(viaDiscount.byIndex[0]!.commissionRate, 0.06);
  });

  it("margem negativa e não calculada com motivo", () => {
    const neg = previewProposalCommercialMargins([
      {
        quantity: 1,
        negotiatedPrice: 120,
        priceTableId: "pt",
        commercialFormation: formation,
      },
    ]);
    assert.equal(neg.byIndex[0]!.isComplete, true);
    assert.ok((neg.byIndex[0]!.commercialMarginPercent ?? 0) < 0);

    const missing = previewProposalCommercialMargins([
      {
        quantity: 1,
        negotiatedPrice: 100,
        priceSource: "MANUAL",
      },
    ]);
    assert.equal(missing.byIndex[0]!.isComplete, false);
    assert.equal(
      proposalCommercialMarginUnavailableLabel(missing.byIndex[0]!.reasonCode),
      "Produto sem formação."
    );

    const manualWithFormation = previewProposalCommercialMargins([
      {
        quantity: 1,
        negotiatedPrice: p48,
        suggestedPrice: null,
        priceSource: "MANUAL",
        priceTableId: null,
        commercialFormation: formation,
      },
    ]);
    assert.equal(manualWithFormation.byIndex[0]!.isComplete, true);
    assert.equal(manualWithFormation.byIndex[0]!.commercialMarginPercent, 48);
    assert.equal(manualWithFormation.byIndex[0]!.reasonCode, null);
  });

  it("total ponderado ≠ média simples", () => {
    const preview = previewProposalCommercialMargins([
      {
        quantity: 10,
        negotiatedPrice: p33,
        suggestedPrice: p33,
        priceTableId: "pt",
        commercialFormation: formation,
      },
      {
        quantity: 1,
        negotiatedPrice: p48,
        suggestedPrice: p48,
        priceTableId: "pt",
        commercialFormation: formation,
      },
    ]);
    assert.equal(preview.summary.isComplete, true);
    const simpleAvg =
      ((preview.byIndex[0]!.commercialMarginPercent ?? 0) +
        (preview.byIndex[1]!.commercialMarginPercent ?? 0)) /
      2;
    assert.notEqual(
      preview.summary.proposalCommercialMarginTotalPercent,
      formatProposalCommercialPercent(simpleAvg) === "—"
        ? null
        : simpleAvg
    );
    assert.notEqual(
      preview.summary.proposalCommercialMarginTotalPercent,
      Math.round(simpleAvg * 100) / 100
    );
  });
});

describe("proposalCommercialMargin — PDF cliente e independência", () => {
  it("PDF do cliente não expõe margem/custo/comissão/faixas", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/proposal/ProposalClientDocument.tsx"),
      "utf8"
    );
    assert.match(src, /Não renderiza custo, margem, comissão/);
    assert.doesNotMatch(src, /commercialMargin/);
    assert.doesNotMatch(src, /commercialPricingSnapshot/);
    assert.doesNotMatch(src, /frozenCostUnit/);
  });

  it("ProposalModule usa motor puro e não duplica fórmula inversa", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/ProposalModule.tsx"),
      "utf8"
    );
    assert.match(src, /previewProposalCommercialMargins/);
    assert.doesNotMatch(src, /1\s*-\s*taxRate\s*-\s*commissionRate/);
    assert.doesNotMatch(src, /salesOrderCommercialMargin/);
  });

  it("backend stamp é autoridade no save", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.match(server, /stampProposalItemsWithCommercialMarginsForWrite/);
    const adapter = readFileSync(
      join(process.cwd(), "src/lib/proposalCommercialMargin.server.ts"),
      "utf8"
    );
    assert.match(adapter, /delete item\.commercialMarginRate/);
    assert.doesNotMatch(adapter, /salesOrderCommercialMargin/);
  });
});
