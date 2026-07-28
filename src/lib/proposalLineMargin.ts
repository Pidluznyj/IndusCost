/**
 * Margem de linha de Proposta — margem de venda comercial (formação de tabela):
 *
 *   receita     = qtd × negociado − desconto
 *   imposto     = receita × taxesPerc
 *   comissão    = receita × commissionPerc
 *   frete       = receita × freightPerc (+ frete R$ absoluto legado)
 *   margem R$   = receita − imposto − comissão − frete − (qtd × unitCost)
 *   margem %    = margem R$ / receita × 100
 *
 * Alinha com a formação da tabela (ex. Atacado 30% + comissão + frete).
 * Pedido de Venda permanece com regra própria (sem comissão/frete na margem).
 */
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";

export type ProposalLineMarginInput = {
  quantity: number;
  negotiatedPrice: number;
  discountValue?: number;
  taxesPerc?: number;
  /** Comissão comercial % sobre a receita (após desconto). */
  commissionPerc?: number;
  /** Frete % sobre a receita (formação moderna da tabela). */
  freightPerc?: number;
  /** Frete R$ absoluto legado (numerador da formação antiga). */
  freightValue?: number;
  unitCost: number;
};

export type ProposalLineMarginResult = {
  gross: number;
  /** Receita após desconto (base vendida / PV) — denominador da %. */
  net: number;
  totalCost: number;
  taxesValue: number;
  commissionValue: number;
  freightValue: number;
  /** Receita após imposto (referência gerencial; não é o denominador da %). */
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
  const commissionPerc = Math.max(0, safeFinite(input.commissionPerc));
  const freightPerc = Math.max(0, safeFinite(input.freightPerc));
  const freightAbs = Math.max(0, safeFinite(input.freightValue));
  const unitCost = Math.max(0, safeFinite(input.unitCost));

  const gross = roundPricingMoney(quantity * negotiatedPrice);
  const net = roundPricingMoney(Math.max(0, gross - discountValue));
  const totalCost = roundPricingMoney(quantity * unitCost);

  const taxesValue = roundPricingMoney(net * (taxesPerc / 100));
  const commissionValue = roundPricingMoney(net * (commissionPerc / 100));
  const freightFromPerc = roundPricingMoney(net * (freightPerc / 100));
  const freightValue = roundPricingMoney(freightFromPerc + freightAbs);
  const netSalesAmount = roundPricingMoney(Math.max(0, net - taxesValue));
  const marginValue = roundPricingMoney(
    net - taxesValue - commissionValue - freightValue - totalCost
  );
  const marginPerc =
    net > 0 ? roundPricingPercent((marginValue / net) * 100) : 0;

  return {
    gross,
    net,
    totalCost,
    taxesValue,
    commissionValue,
    freightValue,
    netSalesAmount,
    marginValue,
    marginPerc,
  };
}

export function calculateProposalMarginSummary(
  lines: ReadonlyArray<ProposalLineMarginResult>
): { totalMarginValue: number; totalMarginPerc: number; totalNetSalesAmount: number } {
  let totalMarginValue = 0;
  let totalRevenue = 0;
  let totalNetSalesAmount = 0;
  for (const line of lines) {
    totalMarginValue += line.marginValue;
    totalRevenue += line.net;
    totalNetSalesAmount += line.netSalesAmount;
  }
  totalMarginValue = roundPricingMoney(totalMarginValue);
  totalRevenue = roundPricingMoney(totalRevenue);
  totalNetSalesAmount = roundPricingMoney(totalNetSalesAmount);
  const totalMarginPerc =
    totalRevenue > 0
      ? roundPricingPercent((totalMarginValue / totalRevenue) * 100)
      : 0;
  return { totalMarginValue, totalMarginPerc, totalNetSalesAmount };
}
