/**
 * Série YTD de conversão de propostas. Sem filtros da listagem.
 */
import type { PrismaClient } from "@prisma/client";
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
  const rows = await prisma.proposal.findMany({
    where: {
      commercialDate: { gte: window.gte, lt: window.lt },
    },
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
