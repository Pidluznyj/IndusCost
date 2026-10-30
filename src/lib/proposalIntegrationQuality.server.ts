/**
 * Leitura do diagnóstico de qualidade da integração de propostas (somente leitura).
 */
import { PROPOSAL_NOMUS_SOURCE_SYSTEM } from "./proposalCommercialEligibility.js";
import {
  summarizeProposalIntegrationQuality,
  type ProposalIntegrationQualityReport,
} from "./proposalIntegrationQuality.js";

type Reader = {
  proposal: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        number: number;
        externalProposalCode: string | null;
        status: string;
        totalNetValue: unknown;
        totalGrossValue: unknown;
        externalRawPayload: unknown;
        Customer?: { companyName?: string | null } | null;
        salesOrder?: { id: string } | null;
        _count?: { items?: number } | null;
      }>
    >;
  };
};

export async function loadProposalIntegrationQuality(db: Reader): Promise<ProposalIntegrationQualityReport> {
  const rows = await db.proposal.findMany({
    where: { sourceSystem: PROPOSAL_NOMUS_SOURCE_SYSTEM, totalNetValue: { lte: 0 } },
    select: {
      id: true,
      number: true,
      externalProposalCode: true,
      status: true,
      totalNetValue: true,
      totalGrossValue: true,
      externalRawPayload: true,
      Customer: { select: { companyName: true } },
      salesOrder: { select: { id: true } },
      _count: { select: { items: true } },
    },
    orderBy: [{ number: "asc" }],
  });
  return summarizeProposalIntegrationQuality(
    rows.map((row) => ({
      id: row.id,
      number: row.number,
      externalProposalCode: row.externalProposalCode,
      customerName: row.Customer?.companyName ?? null,
      status: String(row.status),
      totalNetValue: row.totalNetValue as never,
      totalGrossValue: row.totalGrossValue as never,
      mappedItemCount: Number(row._count?.items ?? 0),
      hasSalesOrder: row.salesOrder != null,
      externalRawPayload: row.externalRawPayload,
    }))
  );
}
