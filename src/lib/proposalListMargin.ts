/**
 * Margem oficial da listagem de Propostas — mesma regra do formulário
 * (margem de formação da tabela: imposto + comissão + frete).
 */
import {
  calculateProposalLineMargin,
  calculateProposalMarginSummary,
} from "./proposalLineMargin.js";
import {
  resolveProposalFreightAbsolute,
  resolveProposalFreightPercent,
} from "./proposalFreightPercent.js";

export type ProposalListMarginItemInput = {
  quantity?: unknown;
  negotiatedPrice?: unknown;
  discountValue?: unknown;
  taxesPerc?: unknown;
  unitCost?: unknown;
  commissionPerc?: unknown;
  freightValue?: unknown;
  pricingSnapshotJson?: unknown;
};

function safeNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Recalcula margem consolidada a partir dos itens (custo da tabela/snapshot).
 * Usar na listagem e no save para não depender de totais stale no cabeçalho.
 */
export function resolveProposalOfficialMarginFromItems(
  items: ReadonlyArray<ProposalListMarginItemInput> | null | undefined
): {
  totalMarginValue: number;
  totalMarginPerc: number;
  totalNetSalesAmount: number;
  totalCost: number;
  itemCount: number;
} {
  const rows = Array.isArray(items) ? items : [];
  const lineMargins = rows.map((item) => {
    const quantity = safeNum(item.quantity);
    const unitCost = Math.max(0, safeNum(item.unitCost));
    const freightPerc = resolveProposalFreightPercent(item.pricingSnapshotJson);
    const freightAbsolute = resolveProposalFreightAbsolute(item.pricingSnapshotJson);
    return {
      ...calculateProposalLineMargin({
        quantity,
        negotiatedPrice: safeNum(item.negotiatedPrice),
        discountValue: safeNum(item.discountValue),
        taxesPerc: safeNum(item.taxesPerc),
        commissionPerc: safeNum(item.commissionPerc),
        freightPerc,
        // Sem % no snapshot: usa freightValue persistido como absoluto legado.
        freightValue: freightPerc > 0 ? freightAbsolute : freightAbsolute || safeNum(item.freightValue),
        unitCost,
      }),
      lineCost: quantity * unitCost,
    };
  });
  const summary = calculateProposalMarginSummary(lineMargins);
  const totalCost = lineMargins.reduce((acc, row) => acc + row.lineCost, 0);
  return {
    totalMarginValue: summary.totalMarginValue,
    totalMarginPerc: summary.totalMarginPerc,
    totalNetSalesAmount: summary.totalNetSalesAmount,
    totalCost: Number.isFinite(totalCost) ? totalCost : 0,
    itemCount: rows.length,
  };
}

/**
 * Anexa margem oficial ao DTO de listagem. Se não houver itens, preserva
 * os totais persistidos (legado / propostas sem linhas).
 */
export function enrichProposalListRowMargin<T extends Record<string, unknown>>(
  proposal: T & {
    items?: ReadonlyArray<ProposalListMarginItemInput> | null;
    totalMarginPerc?: unknown;
    totalMarginValue?: unknown;
  }
): T & {
  totalMarginPerc: number | null;
  totalMarginValue: number | null;
  marginSource: "ITEMS" | "HEADER" | "NONE";
} {
  const items = proposal.items;
  if (Array.isArray(items) && items.length > 0) {
    const resolved = resolveProposalOfficialMarginFromItems(items);
    const { items: _omit, ...rest } = proposal as T & {
      items?: unknown;
    };
    return {
      ...(rest as T),
      totalMarginPerc: resolved.totalMarginPerc,
      totalMarginValue: resolved.totalMarginValue,
      marginSource: "ITEMS",
    };
  }

  const headerPerc = Number(proposal.totalMarginPerc);
  const headerValue = Number(proposal.totalMarginValue);
  const hasHeader =
    Number.isFinite(headerPerc) || Number.isFinite(headerValue);
  const { items: _omit2, ...rest2 } = proposal as T & { items?: unknown };
  return {
    ...(rest2 as T),
    totalMarginPerc: Number.isFinite(headerPerc) ? headerPerc : null,
    totalMarginValue: Number.isFinite(headerValue) ? headerValue : null,
    marginSource: hasHeader ? "HEADER" : "NONE",
  };
}
