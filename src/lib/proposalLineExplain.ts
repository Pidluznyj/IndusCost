import type { CalculationExplanation } from "../types/calculation";
import { calculateProposalLineMargin } from "./proposalLineMargin.js";

function brMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

/**
 * Explica a margem da linha com o mesmo racional oficial de Pedido de Venda
 * (`deductFromGross` — sem comissão/frete na margem).
 */
export function buildProposalLineMarginExplanation(params: {
  quantity: number;
  negotiatedPrice: number;
  discountValue: number;
  taxesValue: number;
  commissionValue: number;
  freightValue: number;
  unitCost: number;
  marginValue: number;
  marginPerc: number;
}): CalculationExplanation {
  const computed = calculateProposalLineMargin({
    quantity: params.quantity,
    negotiatedPrice: params.negotiatedPrice,
    discountValue: params.discountValue,
    taxesPerc:
      params.quantity * params.negotiatedPrice - params.discountValue > 0
        ? (params.taxesValue / (params.quantity * params.negotiatedPrice - params.discountValue)) * 100
        : 0,
    unitCost: params.unitCost,
  });
  return {
    title: "Margem da linha (igual Pedido de Venda)",
    description:
      "Mesma regra oficial do Pedido: receita vendida (após desconto) menos imposto estimado, menos custo industrial. Comissão e frete são comerciais e não entram na margem.",
    formulaText:
      "receita = qtd × negociado − desconto; imposto = receita × taxesPerc; líquida = receita − imposto; marginValue = líquida − (qtd × unitCost); marginPerc = marginValue / líquida × 100.",
    inputs: [
      { label: "Quantidade", value: String(params.quantity) },
      { label: "Bruto (qtd × negociado)", value: brMoney(computed.gross) },
      { label: "Desconto", value: brMoney(params.discountValue) },
      { label: "Receita vendida", value: brMoney(computed.net) },
      { label: "Impostos (sobre receita)", value: brMoney(computed.taxesValue) },
      { label: "Receita líquida gerencial", value: brMoney(computed.netSalesAmount) },
      { label: "Custo total (qtd × CIU)", value: brMoney(computed.totalCost) },
      {
        label: "Comissão (fora da margem)",
        value: brMoney(params.commissionValue),
      },
      { label: "Frete (fora da margem)", value: brMoney(params.freightValue) },
    ],
    resultLabel: "Margem valor",
    resultValue: params.marginValue,
    notes: `Margem % sobre a receita líquida gerencial: ${params.marginPerc.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%.`,
    source: "Formulário de proposta — paridade com Pedido de Venda (salesOrderResultMath)",
  };
}
