/**
 * Contexto fiscal oficial para margem Nomus — TaxRule configurada + ProductPricing.
 */
import type { PrismaClient } from "@prisma/client";
import {
  loadProductTaxPercentIndex,
  resolveSalesTaxRuleById,
} from "./averageSalesTaxEngine.js";
import type { SalesMarginNomusConfig } from "./salesMarginNomusConfig.js";
import { loadSalesMarginNomusConfig } from "./salesMarginNomusConfig.js";
import type { SalesMarginTaxContext } from "./salesMarginRulesEngine.types.js";

export type OfficialSalesMarginTaxContext = SalesMarginTaxContext & {
  defaultTaxRuleId: string | null;
  taxRuleSource: string;
  fiscalConfigComplete: boolean;
  usesTaxRuleFallback: boolean;
};

export async function resolveOfficialSalesMarginTaxContext(
  db: Pick<PrismaClient, "productPricing" | "taxRule" | "indirectCost">,
  productIds: string[],
  config?: SalesMarginNomusConfig | null
): Promise<OfficialSalesMarginTaxContext> {
  const loaded = config ?? (await loadSalesMarginNomusConfig(db)).config;
  const productTaxIndex = await loadProductTaxPercentIndex(db, productIds);

  if (loaded.taxMode === "none") {
    return {
      productTaxIndex,
      defaultTaxPercent: 0,
      defaultTaxLabel: "Sem imposto (taxMode none)",
      defaultTaxRuleId: loaded.defaultTaxRuleId,
      taxRuleSource: "taxMode none — imposto não deduzido",
      fiscalConfigComplete: true,
      usesTaxRuleFallback: false,
    };
  }

  if (loaded.defaultTaxRuleId) {
    const rule = await resolveSalesTaxRuleById(db, loaded.defaultTaxRuleId);
    if (rule && rule.status === "ACTIVE" && rule.totalPercent > 0) {
      return {
        productTaxIndex,
        defaultTaxPercent: rule.totalPercent,
        defaultTaxLabel: rule.name,
        defaultTaxRuleId: rule.id,
        taxRuleSource: "salesMargin.nomus.defaultTaxRuleId (Parâmetros Globais)",
        fiscalConfigComplete: true,
        usesTaxRuleFallback: false,
      };
    }
  }

  return {
    productTaxIndex,
    defaultTaxPercent: 0,
    defaultTaxLabel: "Configuração fiscal incompleta",
    defaultTaxRuleId: loaded.defaultTaxRuleId,
    taxRuleSource:
      "CONFIGURAÇÃO FISCAL INCOMPLETA — TaxRule padrão obrigatória não configurada ou inválida",
    fiscalConfigComplete: false,
    usesTaxRuleFallback: false,
  };
}
