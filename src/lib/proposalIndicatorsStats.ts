import type { Proposal, ProposalStatus } from "@/src/types/commercial";

const STATUS_ORDER: ProposalStatus[] = [
  "DRAFT",
  "ANALYSIS",
  "SENT",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "CANCELED",
];

export function proposalStatusCounts(rows: Proposal[]): Record<ProposalStatus, number> {
  const out = {} as Record<ProposalStatus, number>;
  for (const s of STATUS_ORDER) out[s] = 0;
  for (const r of rows) {
    out[r.status]++;
  }
  return out;
}

export function proposalFinancialRollup(rows: Proposal[]) {
  let totalNet = 0;
  let marginSum = 0;
  let withMargin = 0;
  for (const r of rows) {
    totalNet += Number(r.totalNetValue) || 0;
    const m = Number(r.totalMarginPerc);
    if (Number.isFinite(m)) {
      marginSum += m;
      withMargin++;
    }
  }
  return {
    totalNet,
    avgMarginPerc: withMargin > 0 ? marginSum / withMargin : 0,
    ticketMedio: rows.length > 0 ? totalNet / rows.length : 0,
  };
}

export function proposalStatusChartData(counts: Record<ProposalStatus, number>) {
  const total = STATUS_ORDER.reduce((s, k) => s + counts[k], 0);
  return STATUS_ORDER.map((key) => ({
    key,
    value: counts[key],
    pct: total > 0 ? (counts[key] / total) * 100 : 0,
  }));
}
