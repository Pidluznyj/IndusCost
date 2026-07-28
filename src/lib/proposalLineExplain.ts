import type { CalculationExplanation } from "../types/calculation";
import { calculateProposalLineMargin } from "./proposalLineMargin.js";
import { resolveProposalFreightPercent } from "./proposalFreightPercent.js";

function brMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

/**
 * Explica a margem da linha — margem de venda comercial (formação de tabela).
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
  commissionPerc?: number;
  freightPerc?: number;
  pricingSnapshotJson?: unknown;
}): CalculationExplanation {
  const receita =
    params.quantity * params.negotiatedPrice - params.discountValue;
  const taxesPerc = receita > 0 ? (params.taxesValue / receita) * 100 : 0;
  const commissionPerc =
    params.commissionPerc != null && Number.isFinite(params.commissionPerc)
      ? params.commissionPerc
      : receita > 0
        ? (params.commissionValue / receita) * 100
        : 0;
  const freightPerc =
    params.freightPerc != null && Number.isFinite(params.freightPerc)
      ? params.freightPerc
      : resolveProposalFreightPercent(params.pricingSnapshotJson);

  const computed = calculateProposalLineMargin({
    quantity: params.quantity,
    negotiatedPrice: params.negotiatedPrice,
    discountValue: params.discountValue,
    taxesPerc,
    commissionPerc,
    freightPerc,
    unitCost: params.unitCost,
  });
  return {
    title: "Margem de venda (formação da tabela)",
    description:
      "Mesma lógica da tabela comercial: receita negociada (após desconto) menos imposto, comissão, frete e custo industrial. No preço cheio da tabela, a % aproxima a margem padrão cadastrada (ex. Atacado 30%).",
    formulaText:
      "receita = qtd × negociado − desconto; imposto/comissão/frete = receita × %; marginValue = receita − imposto − comissão − frete − (qtd × unitCost); marginPerc = marginValue / receita × 100.",
    inputs: [
      { label: "Quantidade", value: String(params.quantity) },
      { label: "Bruto (qtd × negociado)", value: brMoney(computed.gross) },
      { label: "Desconto", value: brMoney(params.discountValue) },
      { label: "Receita vendida (PV)", value: brMoney(computed.net) },
      { label: "Impostos", value: brMoney(computed.taxesValue) },
      { label: "Comissão", value: brMoney(computed.commissionValue) },
      { label: "Frete", value: brMoney(computed.freightValue) },
      { label: "Custo total (qtd × CIU)", value: brMoney(computed.totalCost) },
    ],
    resultLabel: "Margem valor",
    resultValue: params.marginValue,
    notes: `Margem % sobre a receita (PV): ${params.marginPerc.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%.`,
    source: "Formulário de proposta — margem de formação da tabela comercial",
  };
}
