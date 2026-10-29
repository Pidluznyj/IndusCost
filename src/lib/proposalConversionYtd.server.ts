/**
 * Série YTD de conversão de propostas. Sem filtros da listagem.
 */
import type { PrismaClient } from "@prisma/client";
import { PROPOSAL_COMMERCIAL_METRICS_WHERE, andProposalWhere } from "./proposalCommercialEligibility.js";
import {
  buildProposalConversionYtdSeries,
  proposalCalendarYearWindow,
  saoPauloCivilYearMonth,
  type ProposalConversionYtdPayload,
} from "./proposalConversionYtd.js";

export async function loadProposalConversionYtd(
  prisma: PrismaClient,
  now: Date = new Date()
): Promise<ProposalConversionYtdPayload> {
  const { year, month: throughMonth } = saoPauloCivilYearMonth(now);
  const window = proposalCalendarYearWindow(year);
  // Mesma população comercial dos cards da listagem (proposta efetiva: líquido > 0 ou pedido vinculado).
  const rows = await prisma.proposal.findMany({
    where: andProposalWhere({ commercialDate: { gte: window.gte, lt: window.lt } }, PROPOSAL_COMMERCIAL_METRICS_WHERE),
    select: {
      status: true,
      totalNetValue: true,
      commercialDate: true,
      salesOrder: { select: { id: true } },
    },
  });

  return {
    year,
    throughMonth,
    months: buildProposalConversionYtdSeries(
      rows.flatMap((row) => {
        if (!row.commercialDate) return [];
        return [
          {
            commercialDate: row.commercialDate,
            status: row.status,
            totalNetValue: Number(row.totalNetValue ?? 0),
            hasSalesOrder: row.salesOrder != null,
          },
        ];
      }),
      { year, throughMonth }
    ),
  };
}
