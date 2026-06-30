/**
 * Contexto fiscal oficial para margem Nomus — TaxRule configurada + ProductPricing.
 */
import type { PrismaClient } from "@prisma/client";
import {
  loadProductTaxPercentIndex,
  resolveDefaultSalesTaxPercent,
  resolveSalesTaxRuleById,
} from "./averageSalesTaxEngine.js";
import type { SalesMarginNomusConfig } from "./salesMarginNomusConfig.js";
import { loadSalesMarginNomusConfig } from "./salesMarginNomusConfig.js";
import type { SalesMarginTaxContext } from "./salesMarginRulesEngine.types.js";

export type OfficialSalesMarginTaxContext = SalesMarginTaxContext & {
  defaultTaxRuleId: string | null;
  taxRuleSource: string;
};

export async function resolveOfficialSalesMarginTaxContext(
  db: Pick<PrismaClient, "productPricing" | "taxRule" | "indirectCost">,
  productIds: string[],
  config?: SalesMarginNomusConfig | null
): Promise<OfficialSalesMarginTaxContext> {
  const loaded = config ?? (await loadSalesMarginNomusConfig(db)).config;
  const productTaxIndex = await loadProductTaxPercentIndex(db, productIds);

  if (loaded.defaultTaxRuleId) {
    const rule = await resolveSalesTaxRuleById(db, loaded.defaultTaxRuleId);
    if (rule) {
      return {
        productTaxIndex,
        defaultTaxPercent: rule.totalPercent,
        defaultTaxLabel: rule.name,
        defaultTaxRuleId: rule.id,
        taxRuleSource: "salesMargin.nomus.defaultTaxRuleId (Parâmetros Globais)",
      };
    }
  }

  const fallback = await resolveDefaultSalesTaxPercent(db);
  return {
    productTaxIndex,
    defaultTaxPercent: fallback.percent,
    defaultTaxLabel: fallback.label,
    defaultTaxRuleId: null,
    taxRuleSource: "primeira TaxRule ACTIVE (fallback automático)",
  };
}
