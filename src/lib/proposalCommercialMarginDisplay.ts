/**
 * Helpers de exibição da margem comercial da Proposta (browser-safe).
 * Não contém fórmula — só formatação e texto de tooltip a partir do motor.
 */
import {
  PROPOSAL_COMMERCIAL_MARGIN_REASON_LABEL,
  type ProposalCommercialMarginItemPayload,
  type ProposalCommercialMarginReasonCode,
  type ProposalCommercialMarginSummaryPayload,
} from "./proposalCommercialMargin.js";
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";

export function formatProposalCommercialMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatProposalCommercialPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${roundPricingPercent(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}%`;
}

export function proposalCommercialMarginUnavailableLabel(
  reasonCode: ProposalCommercialMarginReasonCode | null | undefined
): string {
  if (!reasonCode) return "Margem não calculada";
  switch (reasonCode) {
    case "PRICE_TABLE_NOT_SELECTED":
      return "Tabela não selecionada.";
    case "PRODUCT_WITHOUT_PRICE_FORMATION":
      return "Produto sem formação.";
    case "COST_NOT_FOUND":
      return "Custo não encontrado.";
    case "INCOMPLETE_MARGIN_TIERS":
      return "Faixas incompletas.";
    case "INVALID_FINAL_NET_PRICE":
    case "FINAL_NET_PRICE_NOT_FOUND":
      return "Preço líquido inválido.";
    case "HISTORICAL_FORMATION_AMBIGUOUS":
      return "Formação ambígua.";
    case "INCONSISTENT_PRICE_FORMATION_SET":
      return "Desconto inconsistente.";
    default:
      return PROPOSAL_COMMERCIAL_MARGIN_REASON_LABEL[reasonCode] ?? "Margem não calculada";
  }
}

export function formatProposalCommercialTierPosition(
  position: ProposalCommercialMarginItemPayload["tierPosition"]
): string {
  switch (position) {
    case "EXACT_TIER":
      return "Exato na faixa";
    case "BETWEEN_TIERS":
      return "Entre faixas";
    case "BELOW_LOWEST":
      return "Abaixo da menor faixa";
    case "ABOVE_HIGHEST":
      return "Acima da maior faixa";
    default:
      return "—";
  }
}

/** Texto do tooltip da margem comercial (uso interno). */
export function buildProposalCommercialMarginTooltipText(
  item: ProposalCommercialMarginItemPayload
): string {
  const lines: string[] = ["Margem comercial da Proposta"];

  if (!item.isComplete) {
    lines.push("");
    lines.push("Margem não calculada");
    lines.push(proposalCommercialMarginUnavailableLabel(item.reasonCode));
    for (const w of item.warnings) lines.push(`• ${w}`);
    return lines.join("\n");
  }

  const tableHint =
    item.formationContextId != null
      ? `Formação: ${item.formationContextId}`
      : "Formação congelada";

  lines.push("");
  lines.push(`1. Tabela/versão: ${item.referenceDate ?? "—"}`);
  lines.push(`2. ${tableHint}`);
  lines.push(
    `3. Preço da tabela: ${formatProposalCommercialMoney(item.referenceTableUnitPrice)}`
  );
  lines.push(
    `4. Preço negociado: ${formatProposalCommercialMoney(item.negotiatedGrossUnitPrice)}`
  );
  lines.push(
    `5. Alteração manual: ${formatProposalCommercialMoney(item.manualPriceReduction)}`
  );
  lines.push(`6. Desconto: ${formatProposalCommercialMoney(item.explicitDiscount)}`);
  lines.push(
    `7. Preço líquido: ${formatProposalCommercialMoney(item.finalNetUnitPrice)}`
  );
  lines.push(`8. Custo: ${formatProposalCommercialMoney(item.costUnit)}`);
  lines.push(
    `9. Impostos: ${formatProposalCommercialPercent((item.taxRate ?? 0) * 100)} → ${formatProposalCommercialMoney(item.taxValue)}`
  );
  lines.push(
    `10. Frete: ${formatProposalCommercialPercent((item.freightRate ?? 0) * 100)} + ${formatProposalCommercialMoney(item.freightAbsoluteUnit)} → ${formatProposalCommercialMoney(roundPricingMoney((item.freightRateValue ?? 0) + (item.freightAbsoluteValue ?? 0)))}`
  );
  lines.push(
    `11. Comissão: ${formatProposalCommercialPercent((item.commissionRate ?? 0) * 100)} → ${formatProposalCommercialMoney(item.commissionValue)}`
  );
  lines.push(
    `12. Outras variáveis: ${formatProposalCommercialPercent((item.otherVariablesRate ?? 0) * 100)} → ${formatProposalCommercialMoney(item.otherVariablesValue)}`
  );
  lines.push(
    `13. Margem R$: ${formatProposalCommercialMoney(item.commercialMarginValue)}`
  );
  lines.push(
    `14. Margem %: ${formatProposalCommercialPercent(item.commercialMarginPercent)}`
  );

  const lo = item.lowerTier;
  const hi = item.upperTier;
  const exact = item.exactTier;
  if (exact) {
    lines.push(
      `15. Faixa: ${roundPricingPercent(exact.marginRate * 100)}% · ${formatProposalCommercialMoney(exact.salePrice)}`
    );
  } else {
    lines.push(
      `15. Faixas: ${lo ? `${roundPricingPercent(lo.marginRate * 100)}% (${formatProposalCommercialMoney(lo.salePrice)})` : "—"} ↔ ${hi ? `${roundPricingPercent(hi.marginRate * 100)}% (${formatProposalCommercialMoney(hi.salePrice)})` : "—"}`
    );
  }
  lines.push(`Posição: ${formatProposalCommercialTierPosition(item.tierPosition)}`);

  if (item.warnings.length) {
    lines.push("16. Warnings:");
    for (const w of item.warnings) lines.push(`• ${w}`);
  }

  return lines.join("\n");
}

export type ProposalCommercialSummaryView = {
  referenceTableTotal: number;
  manualReductionTotal: number;
  explicitDiscountTotal: number;
  totalCommercialConcession: number;
  proposedNetValue: number;
  commercialMarginTotalValue: number | null;
  commercialMarginTotalPercent: number | null;
  coveragePercent: number | null;
  itemsCalculated: number;
  itemsUnavailable: number;
  itemsActive: number;
  isComplete: boolean;
  warnings: string[];
};

export function buildProposalCommercialSummaryView(
  items: ReadonlyArray<ProposalCommercialMarginItemPayload>,
  summary: ProposalCommercialMarginSummaryPayload
): ProposalCommercialSummaryView {
  let referenceTableTotal = 0;
  let manualReductionTotal = 0;
  let explicitDiscountTotal = 0;
  let totalCommercialConcession = 0;

  for (const item of items) {
    if (item.quantity <= 0) continue;
    const ref = item.referenceTableUnitPrice;
    if (ref != null && ref > 0) {
      referenceTableTotal += roundPricingMoney(item.quantity * ref);
    }
    manualReductionTotal += item.manualPriceReduction ?? 0;
    explicitDiscountTotal += item.explicitDiscount ?? 0;
    totalCommercialConcession += item.totalCommercialConcession ?? 0;
  }

  return {
    referenceTableTotal: roundPricingMoney(referenceTableTotal),
    manualReductionTotal: roundPricingMoney(manualReductionTotal),
    explicitDiscountTotal: roundPricingMoney(explicitDiscountTotal),
    totalCommercialConcession: roundPricingMoney(totalCommercialConcession),
    proposedNetValue: summary.proposalTotalNetValue,
    commercialMarginTotalValue: summary.proposalCommercialMarginTotalValue,
    commercialMarginTotalPercent: summary.proposalCommercialMarginTotalPercent,
    coveragePercent: summary.proposalMarginCoveragePercent,
    itemsCalculated: summary.itemsCalculated,
    itemsUnavailable: summary.itemsUnavailable,
    itemsActive: summary.itemsActive,
    isComplete: summary.isComplete,
    warnings: summary.warnings,
  };
}
