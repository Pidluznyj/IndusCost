/**
 * Margem de linha de Proposta — mesma regra oficial de Pedido de Venda
 * (`deductFromGross` via `computeSalesOrderResultItem`):
 *
 *   receita vendida = qtd × negociado − desconto
 *   imposto         = receita × taxesPerc
 *   receita líquida = receita − imposto
 *   margem R$       = receita líquida − (qtd × unitCost)
 *   margem %        = margem R$ / receita líquida × 100
 *
 * Comissão e frete permanecem campos comerciais da proposta, mas
 * **não** entram na margem (igual ao motor de Pedidos).
 */
import { computeSalesOrderResultItem } from "./salesOrderResultMath.js";
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";

export type ProposalLineMarginInput = {
  quantity: number;
  negotiatedPrice: number;
  discountValue?: number;
  taxesPerc?: number;
  unitCost: number;
};

export type ProposalLineMarginResult = {
  gross: number;
  /** Receita após desconto (base vendida / PV). */
  net: number;
  totalCost: number;
  taxesValue: number;
  /** Receita líquida gerencial (após imposto) — denominador da %. */
  netSalesAmount: number;
  marginValue: number;
  marginPerc: number;
};

function safeFinite(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function calculateProposalLineMargin(
  input: ProposalLineMarginInput
): ProposalLineMarginResult {
  const quantity = Math.max(0, safeFinite(input.quantity));
  const negotiatedPrice = safeFinite(input.negotiatedPrice);
  const discountValue = Math.max(0, safeFinite(input.discountValue));
  const taxesPerc = Math.max(0, safeFinite(input.taxesPerc));
  const unitCost = Math.max(0, safeFinite(input.unitCost));

  const gross = roundPricingMoney(quantity * negotiatedPrice);
  const net = roundPricingMoney(Math.max(0, gross - discountValue));
  const totalCost = roundPricingMoney(quantity * unitCost);

  const computed = computeSalesOrderResultItem({
    salesOrderItemId: "proposal-line",
    orderId: "proposal",
    issueMonth: 1,
    productId: null,
    quantity,
    marginStatus: "OK",
    salesAmount: net,
    costAmount: totalCost,
    taxPercent: taxesPerc,
  });

  return {
    gross,
    net,
    totalCost,
    taxesValue: computed.taxAmount,
    netSalesAmount: computed.netSalesAmount,
    marginValue: computed.marginAmount,
    marginPerc: computed.marginPercent ?? 0,
  };
}

export function calculateProposalMarginSummary(
  lines: ReadonlyArray<ProposalLineMarginResult>
): { totalMarginValue: number; totalMarginPerc: number; totalNetSalesAmount: number } {
  let totalMarginValue = 0;
  let totalNetSalesAmount = 0;
  for (const line of lines) {
    totalMarginValue += line.marginValue;
    totalNetSalesAmount += line.netSalesAmount;
  }
  totalMarginValue = roundPricingMoney(totalMarginValue);
  totalNetSalesAmount = roundPricingMoney(totalNetSalesAmount);
  const totalMarginPerc =
    totalNetSalesAmount > 0
      ? roundPricingPercent((totalMarginValue / totalNetSalesAmount) * 100)
      : 0;
  return { totalMarginValue, totalMarginPerc, totalNetSalesAmount };
}
