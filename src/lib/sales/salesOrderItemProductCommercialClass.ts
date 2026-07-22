/**
 * Classificação comercial do produto no fluxo de pedidos.
 *
 * Distingue atendimento por estoque/revenda vs fabricação — sem inventar cadastro novo.
 * Fontes: Product.type, Product.costingMode, presença de roteiro/BOM.
 */

import { normalizeProductCostingMode } from "@/src/lib/productCostingModeValidation.js";
import type { ItemType } from "@/src/types/product.js";
import type { SalesOrderItemProductCommercialClass } from "./salesOrderItemProductionRequirement.js";

export type ResolveSalesOrderItemProductCommercialClassInput = {
  productType?: ItemType | string | null;
  costingMode?: string | null;
  hasProductRouting?: boolean | null;
  hasProductBom?: boolean | null;
  routingStepCount?: number | null;
  bomLineCount?: number | null;
};

function hasRouting(input: ResolveSalesOrderItemProductCommercialClassInput): boolean {
  if (input.hasProductRouting === true) return true;
  return typeof input.routingStepCount === "number" && input.routingStepCount > 0;
}

function hasBom(input: ResolveSalesOrderItemProductCommercialClassInput): boolean {
  if (input.hasProductBom === true) return true;
  return typeof input.bomLineCount === "number" && input.bomLineCount > 0;
}

/**
 * Infere classificação comercial quando há evidência suficiente.
 * Retorna null quando ambíguo — motor OP-48 decide com demais sinais.
 */
export function resolveSalesOrderItemProductCommercialClass(
  input: ResolveSalesOrderItemProductCommercialClassInput = {}
): SalesOrderItemProductCommercialClass | null {
  const productType =
    typeof input.productType === "string" ? input.productType.trim().toUpperCase() : null;
  const costingMode =
    input.costingMode != null && String(input.costingMode).trim()
      ? normalizeProductCostingMode(input.costingMode)
      : null;
  const routing = hasRouting(input);
  const bom = hasBom(input);

  // Matéria-prima / insumo comprado — revenda ou consumo, sem OP de venda.
  if (productType === "MATERIAL") {
    return "RESALE";
  }

  // Processo produtivo próprio com roteiro → fabricado.
  if (costingMode === "OWN_PROCESS" && routing) {
    return "MANUFACTURED";
  }

  // Sem roteiro produtivo: típico de pronta entrega / estoque (BOM pode existir só para custeio).
  if (!routing && costingMode != null && costingMode !== "OWN_PROCESS") {
    return "STOCK";
  }

  // Produto acabado sem roteiro nem BOM — estoque.
  if (productType === "PRODUCT" && !routing && !bom) {
    return "STOCK";
  }

  // Componente sem roteiro — peça comprada ou estoque, não linha de OP.
  if (productType === "COMPONENT" && !routing) {
    return "STOCK";
  }

  return null;
}
