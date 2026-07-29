import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CommercialMarginTier } from "./commercialMarginCore.js";
import { calculatePriceTableItemFromFrozenCost } from "./priceTablePublication.js";
import { calculateProposalItemCommercialMargin } from "./proposalCommercialMargin.js";
import {
  PROPOSAL_COMMERCIAL_MARGIN_FREEZE_KEY,
  PROPOSAL_COMMERCIAL_MARGIN_UPDATE_TO_CURRENT_TABLE_ACTION,
  buildProposalCommercialMarginAuditEntries,
  buildProposalCommercialMarginFreeze,
  buildUpdateProposalItemToCurrentTableComparison,
  mergeCommercialMarginFreezeIntoPricingSnapshot,
  readExplicitNumberField,
  readProposalCommercialMarginFreeze,
  recalculateProposalCommercialMarginFromFrozenFormation,
} from "./proposalCommercialMarginSnapshot.js";
import { roundPricingMoney } from "./pricingCalculations.js";

const TAX = 0.2875;
const OTHER = 0.02;
const FREIGHT_RATE = 0.03;
const FREIGHT_ABS = 0;
const COST = 100;

function formPrice(marginPercent: number, commissionPercent: number) {
  const formed = calculatePriceTableItemFromFrozenCost(COST, {
    taxRate: TAX,
    commissionRate: commissionPercent / 100,
    otherRate: OTHER,
    freightRate: FREIGHT_RATE,
    freight: FREIGHT_ABS,
    marginRate: marginPercent / 100,
  });
  assert.equal(formed.ok, true);
  if (!formed.ok) throw new Error(formed.message);
  return formed.result.salePrice;
}

function sampleTiers(): CommercialMarginTier[] {
  return [
    {
      id: "band-33",
      marginRate: 0.33,
      salePrice: formPrice(33, 6),
      commissionRate: 0.06,
    },
    {
      id: "band-48",
      marginRate: 0.48,
      salePrice: formPrice(48, 4.5),
      commissionRate: 0.045,
    },
    {
      id: "band-57.5",
      marginRate: 0.575,
      salePrice: formPrice(57.5, 3),
      commissionRate: 0.03,
    },
  ];
}

function buildCompleteFreeze(tiers = sampleTiers()) {
  const p33 = tiers[0]!.salePrice;
  const marginItem = calculateProposalItemCommercialMargin({
    quantity: 2,
    referenceTableUnitPrice: p33,
    negotiatedGrossUnitPrice: p33,
    finalNetUnitPrice: p33,
    finalNetLineValue: roundPricingMoney(2 * p33),
    informedDiscountRate: 0,
    informedDiscountValue: 0,
    frozenCostUnit: COST,
    taxRate: TAX,
    freightRate: FREIGHT_RATE,
    freightAbsoluteUnit: FREIGHT_ABS,
    otherVariablesRate: OTHER,
    tiers,
    formationContextId: "v1|v2|v3",
    referenceDate: "2024-06-15",
  });
  assert.equal(marginItem.isComplete, true);
  return buildProposalCommercialMarginFreeze({
    formationContextId: "v1|v2|v3",
    priceTableId: "pt-atacado",
    priceTableVersionId: "ver-1",
    referenceDate: "2024-06-15",
    productId: "prod-1",
    marginItem,
    frozenCostUnit: { presence: "value", value: COST },
    taxRate: { presence: "value", value: TAX },
    freightRate: { presence: "value", value: FREIGHT_RATE },
    freightAbsoluteUnit: { presence: "value", value: FREIGHT_ABS },
    otherVariablesRate: { presence: "value", value: OTHER },
    informedDiscountRate: { presence: "value", value: 0 },
    informedDiscountValue: { presence: "value", value: 0 },
    tiers,
    capturedAt: "2024-06-15T12:00:00.000Z",
  });
}

describe("proposalCommercialMarginSnapshot — contrato e zero vs ausência", () => {
  it("preserva zero explícito, null e chave ausente", () => {
    const freeze = buildCompleteFreeze();
    freeze.freightAbsoluteUnit = 0;
    freeze.otherVariablesRate = 0;
    const snap = mergeCommercialMarginFreezeIntoPricingSnapshot(
      {
        priceSource: "PRICE_TABLE",
        item: { salePrice: 1, frozenTotalCost: COST },
        proposalDefaults: { suggestedPrice: 1 },
      },
      freeze
    );

    const stored = (snap[PROPOSAL_COMMERCIAL_MARGIN_FREEZE_KEY] as Record<string, unknown>);
    assert.equal(stored.freightAbsoluteUnit, 0);
    assert.equal(stored.otherVariablesRate, 0);

    // null explícito
    stored.taxRate = null;
    assert.deepEqual(readExplicitNumberField(stored, "taxRate"), { presence: "null" });

    // zero explícito
    assert.deepEqual(readExplicitNumberField(stored, "freightAbsoluteUnit"), {
      presence: "value",
      value: 0,
    });

    // chave ausente
    delete stored.formationContextId;
    assert.deepEqual(readExplicitNumberField(stored, "formationContextId"), {
      presence: "absent",
    });

    // snapshot antigo sem freeze → null (não inventa zero)
    assert.equal(
      readProposalCommercialMarginFreeze({ item: { frozenTotalCost: COST } }),
      null
    );
  });

  it("merge é aditivo e não remove payload publicado", () => {
    const freeze = buildCompleteFreeze();
    const snap = mergeCommercialMarginFreezeIntoPricingSnapshot(
      {
        item: { frozenTotalCost: COST, salePrice: 10 },
        proposalDefaults: { commissionPerc: 6 },
        formulaSnapshotJson: { rates: { taxRate: TAX } },
      },
      freeze
    );
    assert.equal((snap.item as { frozenTotalCost: number }).frozenTotalCost, COST);
    assert.ok(snap.proposalDefaults);
    assert.ok(snap.formulaSnapshotJson);
    assert.ok(snap[PROPOSAL_COMMERCIAL_MARGIN_FREEZE_KEY]);
  });
});

describe("proposalCommercialMarginSnapshot — reabertura histórica", () => {
  it("reabre com mesma formação/faixas/comissão/margem", () => {
    const tiers = sampleTiers();
    const freeze = buildCompleteFreeze(tiers);
    const snap = mergeCommercialMarginFreezeIntoPricingSnapshot({}, freeze);
    const loaded = readProposalCommercialMarginFreeze(snap);
    assert.ok(loaded);
    assert.equal(loaded!.formationContextId, "v1|v2|v3");
    assert.equal(loaded!.priceTableVersionId, "ver-1");
    assert.equal(loaded!.tiers.length, 3);
    assert.equal(loaded!.commercialMarginRate, freeze.commercialMarginRate);
    assert.equal(loaded!.calculatedCommissionRate, 0.06);

    // Nova publicação da tabela (preço diferente) NÃO entra no recálculo histórico.
    const publishedNewPrice = freeze.referenceTableUnitPrice! * 1.5;
    const { marginItem, freeze: next } =
      recalculateProposalCommercialMarginFromFrozenFormation({
        freeze: loaded!,
        quantity: loaded!.quantity,
        negotiatedGrossUnitPrice: loaded!.negotiatedGrossUnitPrice!,
        informedDiscountRate: 0,
        informedDiscountValue: 0,
        referenceTableUnitPrice: loaded!.referenceTableUnitPrice,
      });

    assert.equal(marginItem.isComplete, true);
    assert.equal(next.formationContextId, loaded!.formationContextId);
    assert.equal(next.priceTableVersionId, loaded!.priceTableVersionId);
    assert.deepEqual(
      next.tiers.map((t) => t.salePrice),
      loaded!.tiers.map((t) => t.salePrice)
    );
    assert.equal(next.commercialMarginRate, loaded!.commercialMarginRate);
    assert.notEqual(publishedNewPrice, next.referenceTableUnitPrice);
  });

  it("alteração de desconto recalcula derivados com formação congelada", () => {
    const tiers = sampleTiers();
    const freeze = buildCompleteFreeze(tiers);
    const p48 = tiers[1]!.salePrice;
    // Negocia no preço da faixa 48%, aplica desconto que empurra o líquido.
    const { marginItem, freeze: next } =
      recalculateProposalCommercialMarginFromFrozenFormation({
        freeze: {
          ...freeze,
          referenceTableUnitPrice: p48,
          negotiatedGrossUnitPrice: p48,
        },
        quantity: 5,
        negotiatedGrossUnitPrice: p48,
        informedDiscountRate: 0.1,
        referenceTableUnitPrice: p48,
      });

    assert.equal(marginItem.isComplete, true);
    assert.ok((marginItem.explicitDiscount ?? 0) > 0);
    assert.equal(next.priceTableVersionId, freeze.priceTableVersionId);
    assert.deepEqual(next.tiers, freeze.tiers);
    assert.ok(next.finalNetUnitPrice != null);
    assert.ok(next.finalNetUnitPrice! < p48);
    // Comissão segue o líquido (possível mudança de faixa), não a tabela vigente.
    assert.ok(next.calculatedCommissionRate != null);
  });
});

describe("proposalCommercialMarginSnapshot — atualização explícita de tabela", () => {
  it("exige confirmação e lista diferenças; não é silenciosa", () => {
    const current = buildCompleteFreeze();
    const proposed = {
      ...current,
      priceTableVersionId: "ver-999",
      formationContextId: "new-ctx",
      referenceTableUnitPrice: (current.referenceTableUnitPrice ?? 0) + 10,
      commercialMarginRate: 0.4,
      commercialMarginValue: 999,
      calculatedCommissionRate: 0.05,
      capturedAt: "2026-01-01T00:00:00.000Z",
    };
    const cmp = buildUpdateProposalItemToCurrentTableComparison({
      currentFreeze: current,
      proposedFreeze: proposed,
    });
    assert.equal(
      cmp.actionLabel,
      PROPOSAL_COMMERCIAL_MARGIN_UPDATE_TO_CURRENT_TABLE_ACTION
    );
    assert.equal(cmp.requiresConfirmation, true);
    assert.equal(cmp.silentUpdateForbidden, true);
    assert.ok(cmp.changedFields.includes("priceTableVersionId"));
    assert.ok(cmp.changedFields.includes("commercialMarginRate"));
  });
});

describe("proposalCommercialMarginSnapshot — auditoria oficial", () => {
  it("monta entradas para CommercialAuditLog (valor anterior/novo)", () => {
    const before = buildCompleteFreeze();
    const after = {
      ...before,
      negotiatedGrossUnitPrice: (before.negotiatedGrossUnitPrice ?? 0) - 5,
      commercialMarginRate: 0.3,
    };
    const entries = buildProposalCommercialMarginAuditEntries({
      proposalItemId: "item-1",
      performedBy: "user-1",
      reason: "ajuste comercial",
      action: "PROPOSAL_ITEM_PRICE_CHANGE",
      before,
      after,
      fields: ["negotiatedGrossUnitPrice", "commercialMarginRate"],
    });
    assert.equal(entries.length, 2);
    assert.equal(entries[0]!.entityType, "ProposalItem");
    assert.equal(entries[0]!.oldValue, String(before.negotiatedGrossUnitPrice));
    assert.equal(entries[0]!.newValue, String(after.negotiatedGrossUnitPrice));
    assert.equal(entries[0]!.performedBy, "user-1");
    assert.equal(entries[0]!.reason, "ajuste comercial");
  });
});

describe("proposalCommercialMarginSnapshot — independência", () => {
  it("não importa adapters de Pedido nem Prisma", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/proposalCommercialMarginSnapshot.ts"),
      "utf8"
    );
    assert.doesNotMatch(src, /salesOrderCommercialMargin/);
    assert.doesNotMatch(src, /from ["'].*prisma/);
    assert.doesNotMatch(src, /ATACADO/);
  });
});
