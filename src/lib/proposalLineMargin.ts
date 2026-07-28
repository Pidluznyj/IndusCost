/**
 * Margem oficial de Proposta — reutiliza o motor do Pedido de Venda
 * (`calculateSalesOrderItemMargin`):
 *
 *   receita (PV) = qtd × negociado − desconto
 *   custo        = qtd × unitCost  (custo de produção vigente na data)
 *   margem R$    = receita − custo
 *   margem %     = margem R$ / receita × 100
 *
 * SEM_CUSTO / CUSTO_ZERO → margem indisponível (nunca 100% falso).
 * Comissão e frete são campos comerciais e NÃO entram na margem.
 * Imposto também fica fora da margem oficial (igual listagem de Pedidos).
 */
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";
import { calculateSalesOrderItemMargin } from "./salesOrderMarginMath.js";

export type ProposalLineMarginInput = {
  quantity: number;
  negotiatedPrice: number;
  discountValue?: number;
  /** Mantido por compatibilidade; não entra na margem oficial. */
  taxesPerc?: number;
  commissionPerc?: number;
  freightPerc?: number;
  freightValue?: number;
  /**
   * Custo unitário de produção. Se null/undefined ou ≤ 0, margem fica
   * indisponível (paridade Pedido: SEM_CUSTO / CUSTO_ZERO).
   */
  unitCost: number | null | undefined;
  /** Quando informado, alimenta o motor do Pedido (vínculo de produto). */
  productId?: string | null;
  lineId?: string | null;
};

export type ProposalLineMarginResult = {
  gross: number;
  /** Receita após desconto (PV) — denominador da %. */
  net: number;
  totalCost: number | null;
  taxesValue: number;
  commissionValue: number;
  freightValue: number;
  /** Alias gerencial: igual a `net` na regra oficial do Pedido. */
  netSalesAmount: number;
  marginValue: number | null;
  marginPerc: number | null;
  costMissing: boolean;
  /** Status do motor do Pedido (quando calculado). */
  salesOrderMarginStatus?: string;
};

function safeFinite(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toEngineUnitCost(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function calculateProposalLineMargin(
  input: ProposalLineMarginInput
): ProposalLineMarginResult {
  const quantity = Math.max(0, safeFinite(input.quantity));
  const negotiatedPrice = safeFinite(input.negotiatedPrice);
  const discountValue = Math.max(0, safeFinite(input.discountValue));
  const taxesPerc = Math.max(0, safeFinite(input.taxesPerc));
  const commissionPerc = Math.max(0, safeFinite(input.commissionPerc));
  const freightPerc = Math.max(0, safeFinite(input.freightPerc));
  const freightAbs = Math.max(0, safeFinite(input.freightValue));

  const gross = roundPricingMoney(quantity * negotiatedPrice);
  const net = roundPricingMoney(Math.max(0, gross - discountValue));
  const taxesValue = roundPricingMoney(net * (taxesPerc / 100));
  const commissionValue = roundPricingMoney(net * (commissionPerc / 100));
  const freightValue = roundPricingMoney(net * (freightPerc / 100) + freightAbs);

  const unitCost = toEngineUnitCost(input.unitCost);
  const productId =
    typeof input.productId === "string" && input.productId.trim()
      ? input.productId.trim()
      : unitCost != null
        ? "proposal-line"
        : null;

  const so = calculateSalesOrderItemMargin({
    salesOrderItemId: input.lineId?.trim() || "proposal-line",
    productId,
    quantity,
    netTotalValue: net,
    unitCost,
    costSource: unitCost == null ? "MISSING_COST" : "VERSIONED_PRODUCTION_COST",
    costConfidence: unitCost == null ? "MISSING" : "HIGH",
  });

  const costMissing =
    so.status === "SEM_CUSTO" ||
    so.status === "CUSTO_ZERO" ||
    unitCost == null ||
    unitCost <= 0;

  return {
    gross,
    net,
    totalCost: so.totalCost,
    taxesValue,
    commissionValue,
    freightValue,
    netSalesAmount: net,
    marginValue: so.marginValue,
    marginPerc: so.marginPercent,
    costMissing,
    salesOrderMarginStatus: so.status,
  };
}

export function calculateProposalMarginSummary(
  lines: ReadonlyArray<ProposalLineMarginResult>
): {
  totalMarginValue: number | null;
  totalMarginPerc: number | null;
  totalNetSalesAmount: number;
  hasAnyCost: boolean;
} {
  let totalMarginValue = 0;
  let totalRevenue = 0;
  let totalNetSalesAmount = 0;
  let hasAnyCost = false;
  let allMissing = true;

  for (const line of lines) {
    totalNetSalesAmount += line.netSalesAmount;
    if (line.costMissing || line.marginValue == null || line.marginPerc == null) {
      continue;
    }
    allMissing = false;
    hasAnyCost = true;
    totalMarginValue += line.marginValue;
    totalRevenue += line.net;
  }

  totalMarginValue = roundPricingMoney(totalMarginValue);
  totalRevenue = roundPricingMoney(totalRevenue);
  totalNetSalesAmount = roundPricingMoney(totalNetSalesAmount);

  if (allMissing || lines.length === 0) {
    return {
      totalMarginValue: null,
      totalMarginPerc: null,
      totalNetSalesAmount,
      hasAnyCost: false,
    };
  }

  const totalMarginPerc =
    totalRevenue > 0
      ? roundPricingPercent((totalMarginValue / totalRevenue) * 100)
      : null;

  return {
    totalMarginValue,
    totalMarginPerc,
    totalNetSalesAmount,
    hasAnyCost,
  };
}
