import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CommercialMarginTier } from "./commercialMarginCore.js";
import { calculatePriceTableItemFromFrozenCost } from "./priceTablePublication.js";
import { calculateProposalItemCommercialMargin } from "./proposalCommercialMargin.js";
import {
  PROPOSAL_COMMERCIAL_PRICING_SNAPSHOT_COLUMN,
  PROPOSAL_COMMERCIAL_PRICING_SNAPSHOT_SCHEMA_VERSION,
  buildProposalCommercialMarginFreeze,
  buildProposalItemCommercialPricingSnapshotWrite,
  parseProposalCommercialPricingSnapshot,
  readExplicitNumberField,
  resolveProposalItemCommercialPricingSnapshot,
  serializeProposalCommercialPricingSnapshot,
  toProposalCommercialPricingSnapshot,
} from "./proposalCommercialMarginSnapshot.js";
import { roundPricingMoney } from "./pricingCalculations.js";

const MIGRATION =
  "prisma/migrations/20260829120000_proposal_item_commercial_pricing_snapshot/migration.sql";

const TAX = 0.2875;
const OTHER = 0.02;
const FREIGHT_RATE = 0.03;
const FREIGHT_ABS = 0;
const COST = 100;

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

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
  ];
}

function buildSnapshot() {
  const tiers = sampleTiers();
  const p33 = tiers[0]!.salePrice;
  const marginItem = calculateProposalItemCommercialMargin({
    quantity: 2,
    referenceTableUnitPrice: p33,
    negotiatedGrossUnitPrice: p33,
    finalNetUnitPrice: p33,
    finalNetLineValue: roundPricingMoney(2 * p33),
    frozenCostUnit: COST,
    taxRate: TAX,
    freightRate: FREIGHT_RATE,
    freightAbsoluteUnit: FREIGHT_ABS,
    otherVariablesRate: OTHER,
    tiers,
    formationContextId: "v1|v2",
    referenceDate: "2024-06-15",
  });
  assert.equal(marginItem.isComplete, true);
  const freeze = buildProposalCommercialMarginFreeze({
    formationContextId: "v1|v2",
    priceTableId: "pt-1",
    priceTableVersionId: "ver-1",
    referenceDate: "2024-06-15",
    productId: "prod-1",
    marginItem,
    frozenCostUnit: { presence: "value", value: COST },
    taxRate: { presence: "value", value: TAX },
    freightRate: { presence: "value", value: FREIGHT_RATE },
    freightAbsoluteUnit: { presence: "value", value: 0 },
    otherVariablesRate: { presence: "value", value: OTHER },
    informedDiscountRate: { presence: "value", value: 0 },
    informedDiscountValue: { presence: "value", value: 0 },
    tiers,
  });
  return toProposalCommercialPricingSnapshot(freeze);
}

describe("proposalCommercialPricingSnapshot — migration aditiva", () => {
  it("arquivo de migration existe e só adiciona coluna nullable", () => {
    assert.ok(existsSync(MIGRATION));
    const sql = read(MIGRATION);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS "commercialPricingSnapshotJson"/);
    assert.match(sql, /JSONB/i);
    assert.doesNotMatch(sql, /DROP\s+/i);
    assert.doesNotMatch(sql, /DELETE\s+/i);
    assert.doesNotMatch(sql, /UPDATE\s+/i);
    assert.doesNotMatch(sql, /DEFAULT\s+0/);
    assert.doesNotMatch(sql, /DEFAULT\s+'\{/);
    assert.doesNotMatch(sql, /SET\s+"commercialPricingSnapshotJson"/i);
  });

  it("schema Prisma declara a coluna nullable sem default", () => {
    const schema = read("prisma/schema.prisma");
    assert.match(schema, /commercialPricingSnapshotJson\s+Json\?/);
    assert.doesNotMatch(
      schema,
      /commercialPricingSnapshotJson\s+Json\s+@default/
    );
  });
});

describe("proposalCommercialPricingSnapshot — legado e snapshot completo", () => {
  it("null legado permanece null (sem zero falso)", () => {
    assert.equal(parseProposalCommercialPricingSnapshot(null), null);
    assert.equal(parseProposalCommercialPricingSnapshot(undefined), null);
    assert.equal(
      resolveProposalItemCommercialPricingSnapshot({
        commercialPricingSnapshotJson: null,
        pricingSnapshotJson: { item: { frozenTotalCost: COST } },
      }),
      null
    );
  });

  it("snapshot completo exige schemaVersion e preserva faixas/margem", () => {
    const snapshot = buildSnapshot();
    assert.equal(snapshot.schemaVersion, PROPOSAL_COMMERCIAL_PRICING_SNAPSHOT_SCHEMA_VERSION);
    const serialized = serializeProposalCommercialPricingSnapshot(snapshot);
    assert.equal(serialized.schemaVersion, 1);
    assert.ok(Array.isArray(serialized.tiers));
    assert.equal((serialized.tiers as unknown[]).length, 2);

    const parsed = parseProposalCommercialPricingSnapshot(serialized);
    assert.ok(parsed);
    assert.equal(parsed!.formationContextId, "v1|v2");
    assert.equal(parsed!.priceTableVersionId, "ver-1");
    assert.equal(parsed!.calculatedCommissionRate, 0.06);
    assert.ok(parsed!.commercialMarginRate != null);
    assert.equal(parsed!.freightAbsoluteUnit, 0);
  });

  it("JSON sem schemaVersion é rejeitado", () => {
    assert.equal(
      parseProposalCommercialPricingSnapshot({
        formationContextId: "x",
        tiers: [],
      }),
      null
    );
  });

  it("zero explícito ≠ null ≠ ausente", () => {
    const snapshot = buildSnapshot();
    const serialized = serializeProposalCommercialPricingSnapshot(snapshot);
    serialized.freightAbsoluteUnit = 0;
    serialized.taxRate = null;
    delete (serialized as { otherVariablesRate?: unknown }).otherVariablesRate;

    assert.deepEqual(readExplicitNumberField(serialized, "freightAbsoluteUnit"), {
      presence: "value",
      value: 0,
    });
    assert.deepEqual(readExplicitNumberField(serialized, "taxRate"), {
      presence: "null",
    });
    assert.deepEqual(readExplicitNumberField(serialized, "otherVariablesRate"), {
      presence: "absent",
    });
  });

  it("serialização Decimal-like vira número JSON-safe", () => {
    const snapshot = buildSnapshot();
    const withDecimal = {
      ...snapshot,
      frozenCostUnit: { toNumber: () => 100 } as unknown as number,
      informedDiscountRate: { toNumber: () => 0 } as unknown as number,
      tiers: snapshot.tiers.map((t) => ({
        ...t,
        salePrice: { toNumber: () => t.salePrice } as unknown as number,
      })),
    };
    const serialized = serializeProposalCommercialPricingSnapshot(withDecimal);
    assert.equal(typeof serialized.frozenCostUnit, "number");
    assert.equal(serialized.frozenCostUnit, 100);
    assert.equal(serialized.informedDiscountRate, 0);
    assert.equal(typeof (serialized.tiers as Array<{ salePrice: unknown }>)[0]!.salePrice, "number");
    // Round-trip JSON
    const roundTrip = JSON.parse(JSON.stringify(serialized));
    const parsed = parseProposalCommercialPricingSnapshot(roundTrip);
    assert.ok(parsed);
    assert.equal(parsed!.frozenCostUnit, 100);
  });
});

describe("proposalCommercialPricingSnapshot — criação de item / write", () => {
  it("write omite coluna quando snapshot ausente (legado)", () => {
    const write = buildProposalItemCommercialPricingSnapshotWrite(null);
    assert.equal(Object.keys(write).length, 0);
  });

  it("write inclui coluna oficial com schemaVersion", () => {
    const snapshot = buildSnapshot();
    const write = buildProposalItemCommercialPricingSnapshotWrite(snapshot);
    assert.ok(
      Object.prototype.hasOwnProperty.call(
        write,
        PROPOSAL_COMMERCIAL_PRICING_SNAPSHOT_COLUMN
      )
    );
    const json = (write as { commercialPricingSnapshotJson: Record<string, unknown> })
      .commercialPricingSnapshotJson;
    assert.equal(json.schemaVersion, 1);
    assert.ok(Array.isArray(json.tiers));
  });

  it("server create input aceita commercialPricingSnapshotJson", () => {
    const serverSrc = read("server.ts");
    assert.match(serverSrc, /commercialPricingSnapshotJson/);
    assert.match(
      serverSrc,
      /hasOwnProperty\.call\(item,\s*"commercialPricingSnapshotJson"\)/
    );
  });
});
