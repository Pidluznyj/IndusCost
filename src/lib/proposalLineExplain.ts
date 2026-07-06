import type { CalculationExplanation } from "../types/calculation";

function brMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

/**
 * Explica a margem da linha com o mesmo racional de `updateItem` em ProposalModule (fonte única no cliente para esta tela).
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
  const gross = params.quantity * params.negotiatedPrice;
  const net = gross - params.discountValue;
  const totalCost = params.quantity * params.unitCost;
  return {
    title: "Margem líquida da linha",
    description:
      "Após desconto sobre o bruto da linha, aplica-se tributo e comissão sobre a base líquida; abatem-se frete e custo industrial total (quantidade × custo unitário do motor).",
    formulaText:
      "líquido = qtd × negociado − desconto; marginValue = líquido − impostos − comissão − frete − (qtd × unitCost); marginPerc = marginValue / líquido × 100 (se líquido > 0).",
    inputs: [
      { label: "Quantidade", value: String(params.quantity) },
      { label: "Bruto (qtd × negociado)", value: brMoney(gross) },
      { label: "Desconto", value: brMoney(params.discountValue) },
      { label: "Líquido", value: brMoney(net) },
      { label: "Impostos (sobre líquido)", value: brMoney(params.taxesValue) },
      { label: "Comissão (sobre líquido)", value: brMoney(params.commissionValue) },
      { label: "Frete", value: brMoney(params.freightValue) },
      { label: "Custo total (qtd × CIU)", value: brMoney(totalCost) },
    ],
    resultLabel: "Margem valor",
    resultValue: params.marginValue,
    notes: `Margem % sobre o líquido: ${params.marginPerc.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%.`,
    source: "Formulário de proposta (ProposalModule — mesma sequência do cálculo em tela)",
  };
}
