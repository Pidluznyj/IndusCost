/**
 * QA: project amortization application mode COST vs FINAL_PRICE + pricing margin separation.
 * Usage: npx tsx scripts/qaProjectAmortizationApplicationMode.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  calculateAmortizationAllocation,
  computeAmortizationConfig,
} from "../src/lib/projectsCostAmortization.js";
import { calculateSalePriceFromCost } from "../src/lib/pricingCalculations.js";
import { computeProjectPricingItem } from "../src/lib/projectsPricing.js";

const BASE = 1.29;
const QTY = 1000;
const ALLOCATED = 80; // 0.08 per unit
const UNIT_AMORT = 0.08;

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

function ok(label: string) {
  console.log(`OK  ${label}`);
}

// 1) COST
section("1. Modo COST");
{
  const row = calculateAmortizationAllocation(ALLOCATED, 100, QTY, BASE, "COST");
  assert.equal(row.unitAmortizedCost, UNIT_AMORT);
  assert.equal(row.costComponentUnit, UNIT_AMORT);
  assert.equal(row.priceAddOnUnit, 0);
  assert.equal(row.finalUnitCost, 1.37);
  ok(`custo final ${row.finalUnitCost}, priceAddOn ${row.priceAddOnUnit}`);
}

// 2) FINAL_PRICE
section("2. Modo FINAL_PRICE");
{
  const row = calculateAmortizationAllocation(ALLOCATED, 100, QTY, BASE, "FINAL_PRICE");
  assert.equal(row.unitAmortizedCost, UNIT_AMORT);
  assert.equal(row.costComponentUnit, 0);
  assert.equal(row.priceAddOnUnit, UNIT_AMORT);
  assert.equal(row.finalUnitCost, BASE);
  ok(`custo final ${row.finalUnitCost}, priceAddOn ${row.priceAddOnUnit}`);
}

// 3–4) Distribution / balance
section("3–4. Percentual e saldo");
{
  const computed = computeAmortizationConfig(
    {
      sourceType: "MOLD",
      sourceId: "mold-1",
      sourceDescriptionSnapshot: "Molde da Haste",
      sourceTotalCostSnapshot: 100,
      passThroughPercent: 100,
      allocations: [
        {
          targetItemId: "a",
          targetItemType: "SIMULATION",
          targetDescriptionSnapshot: "Item A",
          targetBaseUnitCostSnapshot: BASE,
          allocationPercent: 60,
          amortizationQuantity: QTY,
          applicationMode: "COST",
        },
        {
          targetItemId: "b",
          targetItemType: "SIMULATION",
          targetDescriptionSnapshot: "Item B",
          targetBaseUnitCostSnapshot: BASE,
          allocationPercent: 40,
          amortizationQuantity: QTY,
          applicationMode: "FINAL_PRICE",
        },
      ],
    },
    [
      {
        targetItemId: "a",
        targetItemType: "SIMULATION",
        displayName: "A",
        displayCode: "A",
        baseUnitCost: BASE,
        suggestedQuantity: QTY,
        entityKind: "simulation_ref",
      },
      {
        targetItemId: "b",
        targetItemType: "SIMULATION",
        displayName: "B",
        displayCode: "B",
        baseUnitCost: BASE,
        suggestedQuantity: QTY,
        entityKind: "simulation_ref",
      },
    ]
  );
  assert.equal(computed.distributionPercentTotal, 100);
  assert.equal(computed.unallocatedAmount, 0);
  assert.equal(computed.status, "DISTRIBUTED");
  ok(`distribuído 100%, saldo ${computed.unallocatedAmount}`);
}

// 5) Pricing FINAL_PRICE — no margin on add-on
section("5. Formação de Preço — FINAL_PRICE sem margem sobre add-on");
{
  const product = calculateSalePriceFromCost({
    cost: BASE,
    taxPercent: 0,
    targetMarginPercent: 50,
  });
  assert.equal(product.ok, true);
  if (!product.ok) throw new Error(product.error);

  const priced = computeProjectPricingItem(
    {
      targetItemId: "a",
      targetItemType: "SIMULATION",
      displayName: "Item",
      baseUnitCost: BASE,
      unitAmortizedCost: 0,
      amortizationPriceAddOnUnit: UNIT_AMORT,
      finalUnitCost: BASE,
    },
    {
      fiscalRuleId: "tax-1",
      fiscalRuleName: "Test",
      taxPercent: 0,
      targetMarginPercent: 50,
    }
  );
  assert.equal(priced.calculatedProductPrice, product.suggestedPrice);
  assert.equal(priced.marginAmount, product.marginAmount);
  assert.equal(priced.projectRecoveryValue, UNIT_AMORT);
  assert.ok(priced.suggestedPrice != null);
  assert.equal(
    Number((priced.suggestedPrice! - product.suggestedPrice).toFixed(3)),
    UNIT_AMORT
  );
  // Margin must equal product margin — recovery is separate
  assert.equal(priced.marginAmount, product.marginAmount);
  assert.notEqual(priced.marginAmount, (product.marginAmount ?? 0) + UNIT_AMORT);
  ok(
    `preço produto ${priced.calculatedProductPrice}, final ${priced.suggestedPrice}, margem ${priced.marginAmount}, recovery ${priced.projectRecoveryValue}`
  );
}

// 6) Pricing COST — legacy
section("6. Formação de Preço — COST preserva comportamento");
{
  const finalCost = 1.37;
  const expected = calculateSalePriceFromCost({
    cost: finalCost,
    taxPercent: 0,
    targetMarginPercent: 50,
  });
  assert.equal(expected.ok, true);
  if (!expected.ok) throw new Error(expected.error);

  const priced = computeProjectPricingItem(
    {
      targetItemId: "a",
      targetItemType: "SIMULATION",
      displayName: "Item",
      baseUnitCost: BASE,
      unitAmortizedCost: UNIT_AMORT,
      amortizationPriceAddOnUnit: 0,
      finalUnitCost: finalCost,
    },
    {
      fiscalRuleId: "tax-1",
      fiscalRuleName: "Test",
      taxPercent: 0,
      targetMarginPercent: 50,
    }
  );
  assert.equal(priced.suggestedPrice, expected.suggestedPrice);
  assert.equal(priced.projectRecoveryValue, 0);
  assert.equal(priced.amortizationPriceAddOnUnit, 0);
  ok(`preço ${priced.suggestedPrice} sobre custo ${finalCost}`);
}

// 7) Default COST
section("7. Default COST para amortizações antigas");
{
  const row = calculateAmortizationAllocation(ALLOCATED, 100, QTY, BASE);
  assert.equal(row.applicationMode, "COST");
  assert.equal(row.finalUnitCost, 1.37);
  ok("sem modo explícito → COST");
}

// 8) Sem Prisma no frontend
section("8. Sem Prisma no frontend");
{
  const modal = readFileSync(
    join(process.cwd(), "src", "components", "projects", "ProjectCostAmortizationModal.tsx"),
    "utf8"
  );
  const tab = readFileSync(
    join(process.cwd(), "src", "components", "projects", "ProjectGuidedCostsTab.tsx"),
    "utf8"
  );
  assert.doesNotMatch(modal, /@prisma\/client|from ["']@\/src\/lib\/prisma/);
  assert.doesNotMatch(tab, /@prisma\/client|from ["']@\/src\/lib\/prisma/);
  ok("componentes sem Prisma");
}

// Schema default
section("Schema / migration");
{
  const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  assert.match(schema, /enum ProjectAmortizationApplicationMode/);
  assert.match(schema, /applicationMode\s+ProjectAmortizationApplicationMode\s+@default\(COST\)/);
  const migration = readFileSync(
    join(
      process.cwd(),
      "prisma",
      "migrations",
      "20260724180000_project_amortization_application_mode",
      "migration.sql"
    ),
    "utf8"
  );
  assert.match(migration, /DEFAULT 'COST'/);
  ok("enum + default COST");
}

console.log("\nQA project amortization application mode: PASS\n");
