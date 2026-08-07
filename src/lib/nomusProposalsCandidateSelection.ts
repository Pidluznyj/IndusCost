import { parseProposalEventDate } from "./nomusProposalsIncremental.js";

export type DiscoveredProposalRaw = Record<string, unknown>;

export type ProposalCandidateSelectionInput = {
  discoveredProposals: DiscoveredProposalRaw[];
  existingExternalIds: Set<number>;
  isIncremental: boolean;
  startDate: Date | null;
};

export type ProposalCandidateClassification = {
  proposal: DiscoveredProposalRaw;
  externalProposalId: number;
  externalProposalCode: string;
  isCandidate: boolean;
  reason: "missing_locally" | "changed_in_window" | "unchanged_outside_window" | "full_reconciliation";
  eventDate: Date | null;
};

export type CandidateSelectionResult = {
  candidates: DiscoveredProposalRaw[];
  classifications: ProposalCandidateClassification[];
  totalDiscovered: number;
  missingLocallyCount: number;
  changedInWindowCount: number;
  existingOutsideWindowCount: number;
  candidatesFound: number;
  missingLocallyPreview: Array<{
    externalProposalId: number;
    externalProposalCode: string;
    eventDate: string | null;
  }>;
  changedInWindowPreview: Array<{
    externalProposalId: number;
    externalProposalCode: string;
    eventDate: string | null;
  }>;
};

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const normalized = value.replace(/[^\d-]/g, "");
    if (!normalized) return null;
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Seleciona candidatos a importação/sync a partir das propostas descobertas no Nomus.
 * REGRA FUNDAMENTAL:
 * 1. Proposta inexistente localmente -> SEMPRE CANDIDATA (reason = "missing_locally"),
 *    independentemente de data de abertura, checkpoint ou janela incremental.
 * 2. Proposta existente localmente -> Se modo incremental, só vira candidata se eventDate >= startDate.
 * 3. Modo full (diário) -> Todas as propostas são candidatas.
 * 4. Deduplicação por externalProposalId.
 */
export function selectNomusProposalCandidates(
  input: ProposalCandidateSelectionInput
): CandidateSelectionResult {
  const { discoveredProposals, existingExternalIds, isIncremental, startDate } = input;

  const seenExternalIds = new Set<number>();
  const classifications: ProposalCandidateClassification[] = [];
  const candidates: DiscoveredProposalRaw[] = [];

  let missingLocallyCount = 0;
  let changedInWindowCount = 0;
  let existingOutsideWindowCount = 0;

  const missingLocallyPreview: CandidateSelectionResult["missingLocallyPreview"] = [];
  const changedInWindowPreview: CandidateSelectionResult["changedInWindowPreview"] = [];

  for (const proposal of discoveredProposals) {
    const externalProposalId = toInt(proposal.id);
    if (externalProposalId == null) continue;

    // Deduplicação por externalProposalId
    if (seenExternalIds.has(externalProposalId)) continue;
    seenExternalIds.add(externalProposalId);

    const externalProposalCode =
      asString(proposal.proposta) ??
      asString(proposal.codigoProposta) ??
      `NOMUS-${externalProposalId.toString().padStart(6, "0")}`;

    const eventDate = parseProposalEventDate(proposal);
    const existsLocally = existingExternalIds.has(externalProposalId);

    let isCandidate = false;
    let reason: ProposalCandidateClassification["reason"];

    if (!existsLocally) {
      isCandidate = true;
      reason = "missing_locally";
      missingLocallyCount += 1;
      if (missingLocallyPreview.length < 30) {
        missingLocallyPreview.push({
          externalProposalId,
          externalProposalCode,
          eventDate: eventDate?.toISOString() ?? null,
        });
      }
    } else if (!isIncremental) {
      isCandidate = true;
      reason = "full_reconciliation";
      changedInWindowCount += 1;
    } else {
      const inWindow = startDate != null && eventDate != null ? eventDate.getTime() >= startDate.getTime() : true;
      if (inWindow) {
        isCandidate = true;
        reason = "changed_in_window";
        changedInWindowCount += 1;
        if (changedInWindowPreview.length < 30) {
          changedInWindowPreview.push({
            externalProposalId,
            externalProposalCode,
            eventDate: eventDate?.toISOString() ?? null,
          });
        }
      } else {
        isCandidate = false;
        reason = "unchanged_outside_window";
        existingOutsideWindowCount += 1;
      }
    }

    classifications.push({
      proposal,
      externalProposalId,
      externalProposalCode,
      isCandidate,
      reason,
      eventDate,
    });

    if (isCandidate) {
      candidates.push(proposal);
    }
  }

  return {
    candidates,
    classifications,
    totalDiscovered: seenExternalIds.size,
    missingLocallyCount,
    changedInWindowCount,
    existingOutsideWindowCount,
    candidatesFound: candidates.length,
    missingLocallyPreview,
    changedInWindowPreview,
  };
}
