import type { CalculationExplanation } from "../types/calculation";
import { calculateProposalLineMargin } from "./proposalLineMargin.js";

function brMoney(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

/**
 * Explica a margem da linha — mesma regra oficial do Pedido de Venda.
 */
export function buildProposalLineMarginExplanation(params: {
  quantity: number;
  negotiatedPrice: number;
  discountValue: number;
  taxesValue: number;
  commissionValue: number;
  freightValue: number;
  unitCost: number | null;
  marginValue: number | null;
  marginPerc: number | null;
}): CalculationExplanation {
  const computed = calculateProposalLineMargin({
    quantity: params.quantity,
    negotiatedPrice: params.negotiatedPrice,
    discountValue: params.discountValue,
    unitCost: params.unitCost,
  });
  return {
    title: "Margem da linha (igual Pedido de Venda)",
    description:
      "Receita negociada (após desconto) menos custo de produção vigente na data da proposta. Comissão e frete são comerciais e não entram na margem — igual ao Pedido.",
    formulaText:
      "receita = qtd × negociado − desconto; custo = qtd × unitCost(produção vigente); marginValue = receita − custo; marginPerc = marginValue / receita × 100.",
    inputs: [
      { label: "Quantidade", value: String(params.quantity) },
      { label: "Bruto (qtd × negociado)", value: brMoney(computed.gross) },
      { label: "Desconto", value: brMoney(params.discountValue) },
      { label: "Receita vendida", value: brMoney(computed.net) },
      { label: "Custo total (produção vigente)", value: brMoney(computed.totalCost) },
      {
        label: "Comissão (fora da margem)",
        value: brMoney(params.commissionValue),
      },
      { label: "Frete (fora da margem)", value: brMoney(params.freightValue) },
    ],
    resultLabel: "Margem valor",
    resultValue: params.marginValue ?? 0,
    notes:
      params.marginPerc == null
        ? params.unitCost == null || params.unitCost <= 0
          ? "Margem indisponível: sem custo de produção vigente (ou custo zerado) — mesma regra do Pedido de Venda."
          : "Margem indisponível."
        : `Margem % sobre a receita: ${params.marginPerc.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%.`,
    source: "Formulário de proposta — motor Pedido de Venda (custo vigente)",
  };
}
