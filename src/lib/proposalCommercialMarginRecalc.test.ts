import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CommercialMarginTier } from "./commercialMarginCore.js";
import { calculatePriceTableItemFromFrozenCost } from "./priceTablePublication.js";
import {
  assertProposalCommercialRecalcApplyConfirmation,
  aggregateProposalCommercialRecalcPreview,
  buildUnavailableCommercialPricingSnapshot,
  classifyProposalCommercialMarginSource,
  computeSnapshotFromFormation,
  formatProposalCommercialRecalcPreview,
  isProposalImported,
  itemNeedsRecalc,
  parseProposalCommercialRecalcCliArgs,
  PROPOSAL_COMMERCIAL_RECALC_CONFIRM,
  resolveProposalCommercialRecalcItem,
  snapshotsDiffer,
  type ProposalCommercialRecalcItemInput,
  type ProposalCommercialRecalcItemResult,
} from "./proposalCommercialMarginRecalc.js";
import {
  parseProposalCommercialPricingSnapshot,
  serializeProposalCommercialPricingSnapshot,
} from "./proposalCommercialMarginSnapshot.js";

const COST = 100;
const TAX = 0.2875;
const OTHER = 0.02;
const FREIGHT_RATE = 0.03;
const FREIGHT_ABS = 0;

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

function buildTiers(): CommercialMarginTier[] {
  const bands = [
    { marginPct: 33, commissionPercent: 6 },
    { marginPct: 48, commissionPercent: 4.5 },
    { marginPct: 57.5, commissionPercent: 3 },
  ];
  return bands.map((b, i) => ({
    id: `band-${b.marginPct}`,
    marginRate: b.marginPct / 100,
    salePrice: formPrice(b.marginPct, b.commissionPercent),
    commissionRate: b.commissionPercent / 100,
    order: i + 1,
  }));
}

function baseItem(
  overrides: Partial<ProposalCommercialRecalcItemInput> = {}
): ProposalCommercialRecalcItemInput {
  const tiers = buildTiers();
  const mid = tiers[1]!.salePrice;
  return {
    proposalItemId: "item-1",
    proposalId: "prop-1",
    proposalNumber: 100,
    productId: "prod-1",
    quantity: 10,
    suggestedPrice: mid,
    negotiatedPrice: mid,
    discountPerc: 0,
    discountValue: 0,
    priceTableId: "pt-1",
    priceTableVersionId: null,
    commercialPricingSnapshotJson: null,
    proposalReferenceDate: "2026-03-15",
    isImported: false,
    ...overrides,
  };
}

describe("proposalCommercialMarginRecalc — CLI e segurança", () => {
  it("default é dry-run", () => {
    const args = parseProposalCommercialRecalcCliArgs([]);
    assert.equal(args.dryRun, true);
    assert.equal(args.apply, false);
  });

  it("apply exige confirmação explícita", () => {
    const args = parseProposalCommercialRecalcCliArgs(["--apply"]);
    assert.throws(
      () => assertProposalCommercialRecalcApplyConfirmation(args),
      /RECALCULATE_PROPOSAL_MARGINS/
    );
  });

  it("apply com token correto passa", () => {
    const args = parseProposalCommercialRecalcCliArgs([
      "--apply",
      `--confirm-apply=${PROPOSAL_COMMERCIAL_RECALC_CONFIRM}`,
    ]);
    assert.equal(args.apply, true);
    assert.doesNotThrow(() => assertProposalCommercialRecalcApplyConfirmation(args));
  });

  it("não permite dry-run e apply juntos", () => {
    assert.throws(
      () => parseProposalCommercialRecalcCliArgs(["--dry-run", "--apply"]),
      /somente --dry-run ou --apply/
    );
  });

  it("parseia filtros", () => {
    const args = parseProposalCommercialRecalcCliArgs([
      "--dry-run",
      "--source=IMPORTED",
      "--limit=25",
      "--only-missing",
      "--proposal-code=ABC",
      "--json",
    ]);
    assert.equal(args.source, "IMPORTED");
    assert.equal(args.limit, 25);
    assert.equal(args.onlyMissing, true);
    assert.equal(args.proposalCode, "ABC");
    assert.equal(args.json, true);
  });
});

describe("proposalCommercialMarginRecalc — classificação de fonte", () => {
  it("prioriza snapshot completo", () => {
    const tiers = buildTiers();
    const computed = computeSnapshotFromFormation({
      formation: {
        formationContextId: "v1|v2|v3",
        referenceDate: "2026-03-15",
        frozenCostUnit: COST,
        taxRate: TAX,
        freightRate: FREIGHT_RATE,
        freightAbsoluteUnit: FREIGHT_ABS,
        otherVariablesRate: OTHER,
        tiers,
      },
      productId: "prod-1",
      quantity: 2,
      suggestedPrice: tiers[1]!.salePrice,
      negotiatedPrice: tiers[1]!.salePrice,
      discountPerc: 0,
      discountValue: 0,
      priceTableVersionId: "ver-1",
    });
    assert.equal(computed.isComplete, true);
    const className = classifyProposalCommercialMarginSource({
      commercialPricingSnapshotJson: serializeProposalCommercialPricingSnapshot(
        computed.snapshot
      ),
      priceTableVersionId: "ver-1",
    });
    assert.equal(className, "EXACT_PROPOSAL_FORMATION_SNAPSHOT");
  });

  it("usa versão explícita quando snapshot incompleto", () => {
    assert.equal(
      classifyProposalCommercialMarginSource({
        commercialPricingSnapshotJson: null,
        priceTableVersionId: "ver-1",
      }),
      "EXACT_PROPOSAL_PRICE_TABLE_VERSION"
    );
  });

  it("reconstrói pela data da proposta", () => {
    assert.equal(
      classifyProposalCommercialMarginSource({
        commercialPricingSnapshotJson: null,
        priceTableVersionId: null,
      }),
      "RECONSTRUCTED_FROM_PROPOSAL_DATE"
    );
  });

  it("marca UNAVAILABLE com reasonCode", () => {
    const snap = buildUnavailableCommercialPricingSnapshot({
      reasonCode: "HISTORICAL_FORMATION_NOT_FOUND",
      referenceDate: "2026-01-01",
    });
    assert.equal(snap.calculationSource, "UNAVAILABLE");
    assert.ok(snap.warnings.length > 0);
    assert.match(snap.warnings[0]!, /formação/i);
  });
});

describe("proposalCommercialMarginRecalc — interna / importada / existente", () => {
  it("detecta proposta importada e interna", () => {
    assert.equal(isProposalImported({ externalProposalId: 99 }), true);
    assert.equal(isProposalImported({ sourceSystem: "NOMUS" }), true);
    assert.equal(isProposalImported({ externalProposalId: null, sourceSystem: null }), false);
    assert.equal(isProposalImported({ sourceSystem: "" }), false);
  });

  it("recalcula proposta interna reconstruída", () => {
    const tiers = buildTiers();
    const item = baseItem({ isImported: false, priceTableVersionId: null });
    const result = resolveProposalCommercialRecalcItem({
      item,
      formation: {
        formationContextId: "a|b|c",
        referenceDate: item.proposalReferenceDate,
        frozenCostUnit: COST,
        taxRate: TAX,
        freightRate: FREIGHT_RATE,
        freightAbsoluteUnit: FREIGHT_ABS,
        otherVariablesRate: OTHER,
        tiers,
      },
    });
    assert.equal(result.sourceClass, "RECONSTRUCTED_FROM_PROPOSAL_DATE");
    assert.equal(result.isComplete, true);
    assert.equal(result.changed, true);
    assert.ok(result.commercialMarginPercent != null);
  });

  it("recalcula proposta importada via versão", () => {
    const tiers = buildTiers();
    const item = baseItem({
      isImported: true,
      priceTableVersionId: "ver-imported",
      proposalNumber: 501,
    });
    const result = resolveProposalCommercialRecalcItem({
      item,
      formation: {
        formationContextId: "a|b|c",
        referenceDate: "2025-12-01",
        frozenCostUnit: COST,
        taxRate: TAX,
        freightRate: FREIGHT_RATE,
        freightAbsoluteUnit: FREIGHT_ABS,
        otherVariablesRate: OTHER,
        tiers,
      },
    });
    assert.equal(result.sourceClass, "EXACT_PROPOSAL_PRICE_TABLE_VERSION");
    assert.equal(result.isComplete, true);
  });

  it("proposta existente com snapshot completo recalcula derivados", () => {
    const tiers = buildTiers();
    const first = computeSnapshotFromFormation({
      formation: {
        formationContextId: "a|b|c",
        referenceDate: "2026-03-15",
        frozenCostUnit: COST,
        taxRate: TAX,
        freightRate: FREIGHT_RATE,
        freightAbsoluteUnit: FREIGHT_ABS,
        otherVariablesRate: OTHER,
        tiers,
      },
      productId: "prod-1",
      quantity: 10,
      suggestedPrice: tiers[1]!.salePrice,
      negotiatedPrice: tiers[1]!.salePrice * 0.95,
      discountPerc: 5,
      discountValue: 0,
    });
    const item = baseItem({
      negotiatedPrice: tiers[1]!.salePrice * 0.95,
      discountPerc: 5,
      commercialPricingSnapshotJson: serializeProposalCommercialPricingSnapshot(
        first.snapshot
      ),
    });
    const result = resolveProposalCommercialRecalcItem({ item });
    assert.equal(result.sourceClass, "EXACT_PROPOSAL_FORMATION_SNAPSHOT");
    assert.equal(result.isComplete, true);
  });
});

describe("proposalCommercialMarginRecalc — margem parcial, faixas, indisponível", () => {
  it("indisponível quando formação falha", () => {
    const result = resolveProposalCommercialRecalcItem({
      item: baseItem(),
      formationFailureReason: "PRODUCT_WITHOUT_PRICE_FORMATION",
    });
    assert.equal(result.sourceClass, "UNAVAILABLE");
    assert.equal(result.reasonCode, "PRODUCT_WITHOUT_PRICE_FORMATION");
    assert.equal(result.isComplete, false);
    assert.ok(result.nextSnapshot);
    assert.equal(result.nextSnapshot!.calculationSource, "UNAVAILABLE");
  });

  it("agrega preview com várias faixas e reasonCodes", () => {
    const tiers = buildTiers();
    const formation = {
      formationContextId: "a|b|c",
      referenceDate: "2026-03-15",
      frozenCostUnit: COST,
      taxRate: TAX,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
      tiers,
    };
    const prices = [
      tiers[0]!.salePrice * 0.9,
      tiers[1]!.salePrice,
      tiers[2]!.salePrice * 1.05,
    ];
    const results: ProposalCommercialRecalcItemResult[] = prices.map((price, idx) =>
      resolveProposalCommercialRecalcItem({
        item: baseItem({
          proposalItemId: `item-${idx}`,
          negotiatedPrice: price,
          suggestedPrice: tiers[1]!.salePrice,
        }),
        formation,
      })
    );
    results.push(
      resolveProposalCommercialRecalcItem({
        item: baseItem({ proposalItemId: "item-missing", proposalId: "prop-2" }),
        formationFailureReason: "COST_NOT_FOUND",
      })
    );
    const preview = aggregateProposalCommercialRecalcPreview(
      results,
      new Set(["prop-1", "prop-2"])
    );
    assert.equal(preview.proposalsAnalyzed, 2);
    assert.equal(preview.itemsAnalyzed, 4);
    assert.ok(preview.itemsComplete >= 3);
    assert.ok(preview.itemsUnavailable >= 1);
    assert.ok(preview.byReasonCode.COST_NOT_FOUND >= 1);
    assert.ok(Object.keys(preview.marginBandCounts).length >= 2);
    assert.ok(preview.coveragePercent != null);
    const text = formatProposalCommercialRecalcPreview(preview, "dry-run");
    assert.match(text, /Propostas analisadas/);
    assert.match(text, /reasonCode/);
  });

  it("only-missing ignora snapshot completo", () => {
    const tiers = buildTiers();
    const computed = computeSnapshotFromFormation({
      formation: {
        formationContextId: "a|b|c",
        referenceDate: "2026-03-15",
        frozenCostUnit: COST,
        taxRate: TAX,
        freightRate: FREIGHT_RATE,
        freightAbsoluteUnit: FREIGHT_ABS,
        otherVariablesRate: OTHER,
        tiers,
      },
      productId: "prod-1",
      quantity: 1,
      suggestedPrice: tiers[1]!.salePrice,
      negotiatedPrice: tiers[1]!.salePrice,
      discountPerc: 0,
      discountValue: 0,
    });
    const complete = baseItem({
      commercialPricingSnapshotJson: serializeProposalCommercialPricingSnapshot(
        computed.snapshot
      ),
    });
    assert.equal(itemNeedsRecalc(complete, true), false);
    assert.equal(itemNeedsRecalc(baseItem(), true), true);
  });
});

describe("proposalCommercialMarginRecalc — idempotência e não alteração comercial", () => {
  it("segunda resolução sem mudança retorna changed=false", () => {
    const tiers = buildTiers();
    const formation = {
      formationContextId: "a|b|c",
      referenceDate: "2026-03-15",
      frozenCostUnit: COST,
      taxRate: TAX,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
      tiers,
    };
    const item = baseItem();
    const first = resolveProposalCommercialRecalcItem({ item, formation });
    assert.equal(first.changed, true);
    const second = resolveProposalCommercialRecalcItem({
      item: {
        ...item,
        commercialPricingSnapshotJson: serializeProposalCommercialPricingSnapshot(
          first.nextSnapshot!
        ),
      },
      formation,
    });
    assert.equal(second.changed, false);
    assert.equal(
      snapshotsDiffer(first.nextSnapshot, second.nextSnapshot),
      false
    );
  });

  it("não altera preços/descontos/qty nas colunas comerciais (só snapshot)", () => {
    const tiers = buildTiers();
    const item = baseItem({
      suggestedPrice: 111,
      negotiatedPrice: 100,
      discountPerc: 7,
      discountValue: 12,
      quantity: 3,
    });
    const result = resolveProposalCommercialRecalcItem({
      item,
      formation: {
        formationContextId: "a|b|c",
        referenceDate: "2026-03-15",
        frozenCostUnit: COST,
        taxRate: TAX,
        freightRate: FREIGHT_RATE,
        freightAbsoluteUnit: FREIGHT_ABS,
        otherVariablesRate: OTHER,
        tiers,
      },
    });
    const snap = parseProposalCommercialPricingSnapshot(
      serializeProposalCommercialPricingSnapshot(result.nextSnapshot!)
    );
    assert.ok(snap);
    // Snapshot registra os valores comerciais atuais — não inventa novos preços.
    assert.equal(snap!.referenceTableUnitPrice, 111);
    assert.equal(snap!.negotiatedGrossUnitPrice, 100);
    assert.equal(snap!.informedDiscountRate, 0.07);
    assert.equal(snap!.informedDiscountValue, 12);
  });
});

describe("proposalCommercialMarginRecalc — independência / auditoria / performance", () => {
  it("módulos e script não consultam Pedido nem importam server.ts", () => {
    const files = [
      "src/lib/proposalCommercialMarginRecalc.ts",
      "src/lib/proposalCommercialMarginRecalc.server.ts",
      "scripts/recalculateProposalCommercialMargins.ts",
    ];
    for (const rel of files) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      assert.doesNotMatch(src, /salesOrderCommercialMargin/);
      assert.doesNotMatch(src, /from ["'][^"']*\/server(?:\.ts)?["']/);
      assert.doesNotMatch(src, /SalesOrderItem/);
      assert.doesNotMatch(src, /db\.salesOrder\b/);
      assert.doesNotMatch(src, /import\s+.*nomus/i);
    }
  });

  it("apply registra intenção de auditoria no adapter", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/proposalCommercialMarginRecalc.server.ts"),
      "utf8"
    );
    assert.match(src, /PROPOSAL_ITEM_COMMERCIAL_MARGIN_RECALC/);
    assert.match(src, /commercialAuditLog\.create/);
    assert.match(src, /\$transaction/);
    assert.match(src, /proposalItem\.update/);
    // Apply só escreve o snapshot comercial derivado.
    assert.match(
      src,
      /data:\s*\{\s*commercialPricingSnapshotJson:/
    );
  });

  it("dry-run path no script não chama apply sem confirmação", () => {
    const src = readFileSync(
      join(process.cwd(), "scripts/recalculateProposalCommercialMargins.ts"),
      "utf8"
    );
    assert.match(src, /--dry-run/);
    assert.match(src, /confirm-apply/);
    assert.match(src, /RECALCULATE_PROPOSAL_MARGINS/);
    assert.doesNotMatch(src, /from ["'][^"']*\/server\.ts["']/);
  });
});
