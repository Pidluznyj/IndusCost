/**
 * Read model único de movimentações para UI e PDF.
 * Novidade = descoberta (firstSeenAt) depois da última revisão do usuário.
 */

import {
  actionLevelRank,
  ACTION_CLASSIFIER_DISCLAIMER,
  classifyExposureAction,
  maxActionLevel,
  type ExposureActionLevel,
} from "./legalExposureActionClassifier.js";
import type { ExposureCaseListItem, ExposureTimelineItem, LegalExposureSource } from "./legalExposureContracts.js";
import { SOURCE_KIND_LABELS } from "./legalExposureContracts.js";
import { exposureTimelineKindLabel } from "./legalExposureFeedUi.js";

/** Implantação da flag NOVA. Histórico anterior não entra como novo na primeira visita. */
export const LEGAL_EXPOSURE_MOVEMENT_NOVELTY_BASELINE = "2026-10-01T14:00:00.000Z";

export const ACTION_TRIAGE_TOOLTIP = ACTION_CLASSIFIER_DISCLAIMER;

export type ExposureMovementDisplayKind =
  | "movement"
  | "publication"
  | "decision"
  | "hearing"
  | "communication"
  | "event";

export type ExposureCaseReadStateView = {
  userId: string;
  processNumberNormalized: string;
  lastMovementsReadAt: string | null;
};

export type ExposureMovementExecutiveItem = {
  id: string;
  kind: ExposureTimelineItem["kind"];
  displayKind: ExposureMovementDisplayKind;
  occurredAt: string | null;
  detectedAt: string;
  at: string;
  title: string;
  summary: string | null;
  source: LegalExposureSource;
  sourceLabel: string;
  courtUnit: string | null;
  isNew: boolean;
  actionLevel: ExposureActionLevel;
  actionLabel: string;
  deadlineText: string | null;
  deadlineAt: string | null;
  officialLink: string | null;
  details: string | null;
  communicationType: string | null;
  subject: string | null;
  status: string | null;
  complements: unknown;
  sourceCode: string | null;
};

export type ExposureMovementAttentionNow = {
  newCount: number;
  reviewCount: number;
  intimations: number;
  hearings: number;
  urgentCount: number;
};

export function isMovementNew(input: {
  firstSeenAt: string;
  lastMovementsReadAt?: string | null;
  baseline?: string;
}): boolean {
  const cutoff = input.lastMovementsReadAt || input.baseline || LEGAL_EXPOSURE_MOVEMENT_NOVELTY_BASELINE;
  const seen = Date.parse(input.firstSeenAt);
  const read = Date.parse(cutoff);
  if (!Number.isFinite(seen) || !Number.isFinite(read)) return false;
  return seen > read;
}

export function compareTimelineDesc(
  a: Pick<ExposureMovementExecutiveItem, "at" | "detectedAt" | "id">,
  b: Pick<ExposureMovementExecutiveItem, "at" | "detectedAt" | "id">
): number {
  const at = Date.parse(b.at) - Date.parse(a.at);
  if (at !== 0) return at;
  const detected = Date.parse(b.detectedAt) - Date.parse(a.detectedAt);
  if (detected !== 0) return detected;
  return b.id.localeCompare(a.id);
}

export function compareTimelineAsc(
  a: Pick<ExposureMovementExecutiveItem, "at" | "detectedAt" | "id">,
  b: Pick<ExposureMovementExecutiveItem, "at" | "detectedAt" | "id">
): number {
  return compareTimelineDesc(a, b) * -1;
}

export function movementDisplayKind(item: Pick<ExposureTimelineItem, "kind" | "title" | "communicationType">): ExposureMovementDisplayKind {
  if (item.kind === "hearing") return "hearing";
  if (item.kind === "publication") return "publication";
  if (item.kind === "event") return "event";
  const label = exposureTimelineKindLabel(item.kind, item.title);
  if (label === "DECISÃO") return "decision";
  if (item.kind === "communication") return "communication";
  return "movement";
}

export function toMovementExecutiveItem(
  row: ExposureTimelineItem,
  input: { lastMovementsReadAt?: string | null; baseline?: string } = {}
): ExposureMovementExecutiveItem {
  const detectedAt = row.detectedAt ?? row.at;
  const occurredAt = row.occurredAt ?? (row.at !== detectedAt ? row.at : row.occurredAt ?? row.at);
  const classified = classifyExposureAction({
    kind: row.kind,
    title: row.title,
    description: row.description,
    subject: row.subject,
    communicationType: row.communicationType,
    scheduledAt: row.kind === "hearing" ? row.at : null,
  });
  const sourceLabel = SOURCE_KIND_LABELS[row.source] ?? row.source;
  return {
    id: row.id ?? `${row.kind}:${row.at}:${row.title}`,
    kind: row.kind,
    displayKind: movementDisplayKind(row),
    occurredAt,
    detectedAt,
    at: row.at,
    title: row.title,
    summary: row.description,
    source: row.source,
    sourceLabel,
    courtUnit: row.courtUnit,
    isNew: isMovementNew({
      firstSeenAt: detectedAt,
      lastMovementsReadAt: input.lastMovementsReadAt,
      baseline: input.baseline,
    }),
    actionLevel: classified.actionLevel,
    actionLabel: classified.actionLabel,
    deadlineText: classified.deadlineText,
    deadlineAt: classified.deadlineAt,
    officialLink: row.officialLink ?? null,
    details: row.description,
    communicationType: row.communicationType,
    subject: row.subject,
    status: row.status,
    complements: row.complements,
    sourceCode: row.sourceCode,
  };
}

export function enrichTimelineItems(
  items: ExposureTimelineItem[],
  input: { lastMovementsReadAt?: string | null; baseline?: string } = {}
): ExposureMovementExecutiveItem[] {
  return items.map((row) => toMovementExecutiveItem(row, input));
}

export function sortMovementsForUi(items: ExposureMovementExecutiveItem[]): ExposureMovementExecutiveItem[] {
  return items.slice().sort(compareTimelineDesc);
}

export function sortMovementsForPdf(items: ExposureMovementExecutiveItem[]): ExposureMovementExecutiveItem[] {
  return items.slice().sort(compareTimelineAsc);
}

export function filterMovementsByKind(
  items: ExposureMovementExecutiveItem[],
  kind: string
): ExposureMovementExecutiveItem[] {
  if (!kind || kind === "all") return items;
  if (kind === "decision") return items.filter((row) => row.displayKind === "decision");
  if (kind === "movement") return items.filter((row) => row.displayKind === "movement");
  return items.filter((row) => row.kind === kind || row.displayKind === kind);
}

export function movementAttentionNow(
  items: ExposureMovementExecutiveItem[],
  nowIso: string
): ExposureMovementAttentionNow {
  const fresh = items.filter((row) => row.isNew);
  const now = Date.parse(nowIso);
  return {
    newCount: fresh.length,
    reviewCount: fresh.filter((row) => actionLevelRank(row.actionLevel) >= actionLevelRank("REVIEW")).length,
    intimations: fresh.filter((row) => /intim/i.test(`${row.title} ${row.communicationType ?? ""}`)).length,
    hearings: items.filter((row) => row.displayKind === "hearing" && Number.isFinite(Date.parse(row.at)) && Date.parse(row.at) >= now).length,
    urgentCount: fresh.filter((row) => row.actionLevel === "URGENT_REVIEW" || row.actionLevel === "DEADLINE_OR_EVENT").length,
  };
}

function futureHearings(items: ExposureMovementExecutiveItem[], nowIso: string): ExposureMovementExecutiveItem[] {
  const now = Date.parse(nowIso);
  return items.filter((row) => row.displayKind === "hearing" && Date.parse(row.at) >= now);
}

export function nextKnownEvents(
  items: ExposureMovementExecutiveItem[],
  nowIso: string
): ExposureMovementExecutiveItem[] {
  const now = Date.parse(nowIso);
  const hearings = futureHearings(items, nowIso);
  const deadlines = items.filter((row) => row.deadlineAt && Date.parse(row.deadlineAt) >= now);
  const merged = [...hearings, ...deadlines];
  const seen = new Set<string>();
  return merged
    .filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .sort((a, b) => Date.parse(a.deadlineAt ?? a.at) - Date.parse(b.deadlineAt ?? b.at));
}

export function readStateMap(
  rows: Array<{ processNumberNormalized: string; lastMovementsReadAt: string | null }>
): Map<string, string | null> {
  return new Map(rows.map((row) => [row.processNumberNormalized, row.lastMovementsReadAt]));
}

export function summarizeExecutiveMovements(
  items: ExposureMovementExecutiveItem[],
  nowIso: string
): {
  newMovementCount: number;
  highestNewActionLevel: ExposureActionLevel | null;
  attentionNowMovements: ExposureMovementAttentionNow;
  nextKnownEvents: ExposureMovementExecutiveItem[];
} {
  const newItems = items.filter((row) => row.isNew);
  const highest = maxActionLevel(newItems.map((row) => row.actionLevel));
  return {
    newMovementCount: newItems.length,
    highestNewActionLevel: highest === "NONE" ? null : highest,
    attentionNowMovements: movementAttentionNow(items, nowIso),
    nextKnownEvents: nextKnownEvents(items, nowIso),
  };
}

export function executiveToTimeline(row: ExposureMovementExecutiveItem): ExposureTimelineItem {
  return {
    id: row.id,
    kind: row.kind,
    at: row.at,
    title: row.title,
    description: row.summary,
    source: row.source,
    sourceCode: row.sourceCode,
    courtUnit: row.courtUnit,
    complements: row.complements,
    communicationType: row.communicationType,
    subject: row.subject,
    status: row.status,
    detectedAt: row.detectedAt,
    occurredAt: row.occurredAt,
    officialLink: row.officialLink,
    isNew: row.isNew,
    actionLevel: row.actionLevel,
    actionLabel: row.actionLabel,
    deadlineText: row.deadlineText,
    deadlineAt: row.deadlineAt,
    displayKind: row.displayKind,
  };
}

export function groupNoveltyFromCases(items: ExposureCaseListItem[]): {
  newMovements: number;
  processesWithNewMovements: number;
  processesNeedingReview: number;
} {
  const unique = new Map<string, ExposureCaseListItem>();
  for (const item of items) {
    if (!unique.has(item.processNumber)) unique.set(item.processNumber, item);
  }
  const rows = Array.from(unique.values());
  return {
    newMovements: rows.reduce((sum, row) => sum + (row.newMovementCount ?? 0), 0),
    processesWithNewMovements: rows.filter((row) => (row.newMovementCount ?? 0) > 0).length,
    processesNeedingReview: rows.filter((row) => row.highestNewActionLevel && row.highestNewActionLevel !== "NONE").length,
  };
}

export function detectedLaterThanOccurred(item: Pick<ExposureMovementExecutiveItem, "occurredAt" | "detectedAt">): boolean {
  if (!item.occurredAt) return false;
  const occurred = Date.parse(item.occurredAt);
  const detected = Date.parse(item.detectedAt);
  if (!Number.isFinite(occurred) || !Number.isFinite(detected)) return false;
  return detected - occurred >= 12 * 60 * 60 * 1000;
}
