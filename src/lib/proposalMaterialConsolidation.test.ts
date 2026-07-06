import assert from "node:assert/strict";
import test from "node:test";
import { buildProposalMaterialConsolidation, formatAdaptiveCurrency, formatAdaptiveNumber } from "./proposalMaterialConsolidation.ts";
import type { ProposalItem } from "../types/commercial.ts";

const items: ProposalItem[] = [
  {
    productId: "prod-1",
    Product: { id: "prod-1", sku: "SKU-1", name: "Produto A" } as any,
    quantity: 10,
    unitCost: 0,
    suggestedPrice: 0,
    negotiatedPrice: 0.456789,
    discountPerc: 0,
    discountValue: 0,
    marginValue: 0,
    marginPerc: 12.5,
    taxesPerc: 0,
    taxesValue: 0,
    commissionPerc: 0,
    commissionValue: 0,
    freightValue: 0,
  },
  {
    productId: "prod-2",
    Product: { id: "prod-2", sku: "SKU-2", name: "Produto B" } as any,
    quantity: 5,
    unitCost: 0,
    suggestedPrice: 0,
    negotiatedPrice: 10,
    discountPerc: 0,
    discountValue: 0,
    marginValue: 0,
    marginPerc: 5,
    taxesPerc: 0,
    taxesValue: 0,
    commissionPerc: 0,
    commissionValue: 0,
    freightValue: 0,
  },
];

test("consolida materias-primas por materialId e preserva rastreabilidade", () => {
  const result = buildProposalMaterialConsolidation(items, [
    {
      productId: "prod-1",
      openBook: {
        consolidatedMaterials: [
          {
            materialId: "mat-1",
            code: "MAT-1",
            description: "Resina X",
            unit: "kg",
            quantity: 0.25,
            totalCost: 2.5,
            unitCostEffective: 10,
          },
        ],
      },
    },
    {
      productId: "prod-2",
      openBook: {
        consolidatedMaterials: [
          {
            materialId: "mat-1",
            code: "MAT-1",
            description: "Resina X",
            unit: "kg",
            quantity: 0.1,
            totalCost: 1,
            unitCostEffective: 10,
          },
          {
            materialId: "mat-2",
            code: "MAT-2",
            description: "Pigmento Y",
            unit: "kg",
            quantity: 0.000321,
            totalCost: 0.00321,
            unitCostEffective: 10,
          },
        ],
      },
    },
  ]);

  assert.equal(result.rows.length, 2);
  assert.equal(result.totalMp, 30.01605);

  const mat1 = result.rows.find((row) => row.materialId === "mat-1");
  assert.ok(mat1);
  assert.equal(mat1.quantityTotal, 3);
  assert.equal(mat1.totalCost, 30);
  assert.equal(mat1.origins.length, 2);

  const mat2 = result.rows.find((row) => row.materialId === "mat-2");
  assert.ok(mat2);
  assert.equal(mat2.quantityTotal, 0.001605);
  assert.ok(Math.abs((mat2.totalCost ?? 0) - 0.01605) < 1e-9);
});

test("explicita ausencia de preco sem mascarar", () => {
  const result = buildProposalMaterialConsolidation(items.slice(0, 1), [
    {
      productId: "prod-1",
      openBook: {
        consolidatedMaterials: [
          {
            materialId: "mat-3",
            code: "MAT-3",
            description: "Carga Z",
            unit: "kg",
            quantity: 1,
            totalCost: 0,
            unitCostEffective: null,
          },
        ],
      },
    },
  ]);

  assert.equal(result.rows[0]?.missingPrice, true);
});

test("formatacao adaptativa preserva numeros pequenos sem poluir os grandes", () => {
  assert.equal(formatAdaptiveNumber(12.3456), "12,35");
  assert.equal(formatAdaptiveNumber(0.000321), "0,000321");
  assert.equal(formatAdaptiveCurrency(10.456), "R$ 10,46");
  assert.equal(formatAdaptiveCurrency(0.00321), "R$ 0,00321");
});
