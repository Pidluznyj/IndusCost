/**
 * Margem oficial de Proposta — mesma regra do Pedido de Venda
 * (`salesOrderMarginMath`):
 *
 *   receita (PV) = qtd × negociado − desconto
 *   custo        = qtd × unitCost  (custo de produção vigente na data)
 *   margem R$    = receita − custo
 *   margem %     = margem R$ / receita × 100
 *
 * Comissão e frete são campos comerciais (tabela) e NÃO entram na margem,
 * para a comparação proposta × pedido permanecer alinhada.
 * Imposto também fica fora da margem oficial (igual listagem de Pedidos).
 */
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";

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
   * Custo unitário de produção. Se null/undefined, margem fica indisponível
   * (não tratar como zero — evita falso 100%).
   */
  unitCost: number | null | undefined;
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
  const commissionPerc = Math.max(0, safeFinite(input.commissionPerc));
  const freightPerc = Math.max(0, safeFinite(input.freightPerc));
  const freightAbs = Math.max(0, safeFinite(input.freightValue));

  const gross = roundPricingMoney(quantity * negotiatedPrice);
  const net = roundPricingMoney(Math.max(0, gross - discountValue));
  const taxesValue = roundPricingMoney(net * (taxesPerc / 100));
  const commissionValue = roundPricingMoney(net * (commissionPerc / 100));
  const freightValue = roundPricingMoney(net * (freightPerc / 100) + freightAbs);

  const rawCost = input.unitCost;
  const hasCost =
    rawCost != null && rawCost !== ("" as unknown) && Number.isFinite(Number(rawCost));
  if (!hasCost) {
    return {
      gross,
      net,
      totalCost: null,
      taxesValue,
      commissionValue,
      freightValue,
      netSalesAmount: net,
      marginValue: null,
      marginPerc: null,
      costMissing: true,
    };
  }

  const unitCost = Math.max(0, Number(rawCost));
  const totalCost = roundPricingMoney(quantity * unitCost);
  const marginValue = roundPricingMoney(net - totalCost);
  const marginPerc =
    net > 0 ? roundPricingPercent((marginValue / net) * 100) : null;

  return {
    gross,
    net,
    totalCost,
    taxesValue,
    commissionValue,
    freightValue,
    netSalesAmount: net,
    marginValue,
    marginPerc,
    costMissing: false,
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
