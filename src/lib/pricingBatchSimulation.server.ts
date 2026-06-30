/**
 * Orquestração server-side da simulação/aplicação em lote — Formação de Preço.
 */
import type { PrismaClient } from "@prisma/client";
import { extractOfficialProductFinalUnitCost } from "./productOfficialFinalCost.js";
import {
  filterProductsForPricingBatchScope,
  parsePricingBatchItemScope,
  resolvePricingBatchItemType,
  type PricingBatchItemScope,
} from "./pricingBatchItemScope.js";
import {
  buildPricingBatchRateParams,
  computePricingBatchSuggestedPrice,
  resolvePricingBatchCostErrorMessage,
  type PricingBatchSimulateItemResult,
} from "./pricingBatchSimulation.js";

export type PricingBatchPremiseInput = {
  taxRuleId: string;
  desiredMargin?: number | null;
  commission?: number | null;
  freightOut?: number | null;
  otherVariables?: number | null;
};

export type PricingBatchSimulateInput = PricingBatchPremiseInput & {
  productIds: string[];
  itemScope?: unknown;
};

export type PricingBatchApplyInput = PricingBatchPremiseInput & {
  validResults: Array<{ productId: string; status: string }>;
  itemScope?: unknown;
};

export async function simulatePricingBatch(
  db: PrismaClient,
  input: PricingBatchSimulateInput,
  getProductCostAnalysis: (productId: string) => Promise<unknown>
): Promise<{
  itemScope: PricingBatchItemScope;
  summary: { total: number; success: number; error: number };
  results: PricingBatchSimulateItemResult[];
}> {
  const itemScope = parsePricingBatchItemScope(input.itemScope);
  const productIds = [...new Set(input.productIds.filter(Boolean))];

  if (productIds.length === 0) {
    throw new Error("Nenhum item selecionado.");
  }

  const taxRule = await db.taxRule.findUnique({
    where: { id: input.taxRuleId },
    include: { TaxComponent: true },
  });
  if (!taxRule) {
    throw new Error("Regra fiscal não encontrada.");
  }

  const taxPercent = taxRule.TaxComponent.reduce(
    (acc, component) => acc + Number(component.percentage),
    0
  );
  const rateParams = buildPricingBatchRateParams({
    taxPercent,
    commission: input.commission,
    desiredMargin: input.desiredMargin,
    otherVariables: input.otherVariables,
    freightOut: input.freightOut,
  });

  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sku: true, name: true, type: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  const scopeAllowed = new Set(
    filterProductsForPricingBatchScope(products, itemScope).map((product) => product.id)
  );

  const results: PricingBatchSimulateItemResult[] = [];
  let successCount = 0;
  let errorCount = 0;

  for (const productId of productIds) {
    const product = productById.get(productId);
    if (!product) {
      errorCount += 1;
      results.push({
        productId,
        status: "ERROR",
        message: "Item não encontrado no cadastro.",
      });
      continue;
    }

    const itemType = resolvePricingBatchItemType(product.type);
    if (!scopeAllowed.has(productId)) {
      errorCount += 1;
      results.push({
        productId,
        sku: product.sku,
        name: product.name,
        itemType,
        status: "ERROR",
        message: "Item fora do escopo selecionado (produto vs componente).",
      });
      continue;
    }

    try {
      const costData = await getProductCostAnalysis(productId);
      if (!costData || typeof costData === "object" && "error" in costData) {
        errorCount += 1;
        results.push({
          productId,
          sku: product.sku,
          name: product.name,
          itemType,
          status: "ERROR",
          message: resolvePricingBatchCostErrorMessage(costData),
        });
        continue;
      }

      const ciu = extractOfficialProductFinalUnitCost(costData);
      if (ciu == null) {
        errorCount += 1;
        results.push({
          productId,
          sku: product.sku,
          name: product.name,
          itemType,
          status: "ERROR",
          message: "Custo final da engenharia indisponível.",
        });
        continue;
      }

      const priced = computePricingBatchSuggestedPrice(ciu, rateParams);
      if (!priced.ok) {
        errorCount += 1;
        results.push({
          productId,
          sku: product.sku,
          name: product.name,
          itemType,
          status: "ERROR",
          message: priced.message,
        });
        continue;
      }

      successCount += 1;
      results.push({
        productId,
        sku: product.sku,
        name: product.name,
        itemType,
        ciu,
        suggestedPrice: priced.suggestedPrice,
        marginRate: Number(input.desiredMargin || 0),
        markup: priced.markup,
        status: "SUCCESS",
      });
    } catch (err: unknown) {
      errorCount += 1;
      results.push({
        productId,
        sku: product.sku,
        name: product.name,
        itemType,
        status: "ERROR",
        message: err instanceof Error ? err.message : "Erro genérico no motor",
      });
    }
  }

  return {
    itemScope,
    summary: { total: productIds.length, success: successCount, error: errorCount },
    results,
  };
}

export async function applyPricingBatchPremises(
  db: PrismaClient,
  input: PricingBatchApplyInput
): Promise<{ appliedCount: number; itemScope: PricingBatchItemScope }> {
  const itemScope = parsePricingBatchItemScope(input.itemScope);
  const validResults = input.validResults.filter((row) => row.status === "SUCCESS");
  if (validResults.length === 0) {
    throw new Error("Nenhum resultado válido fornecido.");
  }

  const productIds = validResults.map((row) => row.productId);
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, type: true },
  });
  const scopeAllowed = new Set(
    filterProductsForPricingBatchScope(products, itemScope).map((product) => product.id)
  );

  let appliedCount = 0;
  for (const item of validResults) {
    if (!scopeAllowed.has(item.productId)) continue;
    await db.productPricing.upsert({
      where: {
        productId_taxRuleId: { productId: item.productId, taxRuleId: input.taxRuleId },
      },
      update: {
        desiredMargin: input.desiredMargin,
        commission: input.commission,
        freightOut: input.freightOut,
        otherVariables: input.otherVariables,
      },
      create: {
        productId: item.productId,
        taxRuleId: input.taxRuleId,
        desiredMargin: input.desiredMargin,
        commission: input.commission,
        freightOut: input.freightOut,
        otherVariables: input.otherVariables,
      },
    });
    appliedCount += 1;
  }

  return { appliedCount, itemScope };
}
