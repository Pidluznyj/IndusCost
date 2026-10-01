/**
 * Completude executiva. Não é risco jurídico.
 * Claimants só vêm de party ACTIVE confirmada — nunca de entityId da descoberta.
 */

import type {
  CaseCoverageStatus,
  CaseDataCoverage,
  CoverageFieldKey,
  CoverageSourceFact,
  ExposureCaseListItem,
  ExposureExecutiveParty,
  ExposureGroupEntity,
  LegalCasePole,
  LegalExposureSource,
} from "./legalExposureContracts.js";
import {
  CASE_CLAIMANT_MISSING_COPY,
  CASE_POLE_UNCONFIRMED_COPY,
  PARTY_ROLE_CONFLICT_COPY,
} from "./legalExposureContracts.js";
import {
  buildCoverageSourceMatrix,
  buildFieldDiagnoses,
  buildPublicCoverageCompare,
  coverageMissingReasonsFromDiagnoses,
  emptySourceFacts,
  sourceFactsFromRecords,
} from "./legalExposureCoverageDiagnosis.js";

export const COVERAGE_STATUSES = ["FOUND", "MISSING", "CONFLICT", "NOT_AVAILABLE"] as const;

function statusOf(found: boolean, conflict = false, available = true): CaseCoverageStatus {
  if (conflict) return "CONFLICT";
  if (!available) return "NOT_AVAILABLE";
  return found ? "FOUND" : "MISSING";
}

export function partyIdentityKey(input: {
  documentNormalized?: string | null;
  normalizedName: string;
  personType?: string | null;
}): string {
  const document = (input.documentNormalized ?? "").replace(/\D/g, "");
  if (document) return `doc:${document}`;
  return `name:${input.normalizedName}:${input.personType ?? ""}`;
}

export function polesConflict(poles: LegalCasePole[]): boolean {
  const known = new Set(poles.filter((pole) => pole !== "UNKNOWN"));
  return known.has("ACTIVE") && known.has("PASSIVE");
}

export function confirmedClaimants(parties: ExposureExecutiveParty[]): ExposureExecutiveParty[] {
  return parties.filter((row) => row.pole === "ACTIVE" && !row.roleConflict && !row.isGroupEntity);
}

export function confirmedGroupDefendants(groupEntities: ExposureGroupEntity[]): ExposureGroupEntity[] {
  return groupEntities.filter((row) => row.pole === "PASSIVE");
}

export function buildOppositionCaption(input: {
  claimants: ExposureExecutiveParty[];
  groupEntities: ExposureGroupEntity[];
}): {
  claimantLabel: string;
  defendantLabel: string;
  conflict: boolean;
  caption: string;
} {
  const groupConflict = input.groupEntities.some((row) => row.confidence === "UNCONFIRMED" && row.pole === "UNKNOWN");
  const partyConflict = input.claimants.some((row) => row.roleConflict);
  const groupById = new Map(input.groupEntities.map((row) => [row.id, row]));
  const activeGroup = input.groupEntities.filter((row) => row.pole === "ACTIVE");
  const passiveGroup = confirmedGroupDefendants(input.groupEntities);
  const unknownGroup = input.groupEntities.filter((row) => row.pole === "UNKNOWN");
  const external = confirmedClaimants(input.claimants);

  const sameEntityBothSides = activeGroup.some((row) => passiveGroup.some((other) => other.id === row.id));
  const claimantIsAlsoDefendant = external.some(
    (row) => row.entityId && groupById.get(row.entityId)?.pole === "PASSIVE"
  );
  const conflict = partyConflict || sameEntityBothSides || claimantIsAlsoDefendant || groupConflict;

  if (conflict) {
    return {
      claimantLabel: PARTY_ROLE_CONFLICT_COPY,
      defendantLabel: PARTY_ROLE_CONFLICT_COPY,
      conflict: true,
      caption: PARTY_ROLE_CONFLICT_COPY,
    };
  }

  const claimantLabel =
    external.map((row) => row.name).join("; ") ||
    (activeGroup.length && passiveGroup.length
      ? activeGroup.map((row) => row.legalName).join("; ")
      : CASE_CLAIMANT_MISSING_COPY);
  if (!external.length && !passiveGroup.length && unknownGroup.length) {
    const unconfirmed = unknownGroup
      .map((row) => `${row.legalName} · ${CASE_POLE_UNCONFIRMED_COPY}`)
      .join("; ");
    return {
      claimantLabel: CASE_CLAIMANT_MISSING_COPY,
      defendantLabel: unconfirmed,
      conflict: false,
      caption: unconfirmed,
    };
  }
  const defendantLabel =
    passiveGroup.map((row) => row.legalName).join(", ") ||
    input.groupEntities.map((row) => row.legalName).join(", ") ||
    "empresa do grupo não identificada";

  const sameName =
    claimantLabel !== CASE_CLAIMANT_MISSING_COPY &&
    claimantLabel.trim().toUpperCase() === defendantLabel.trim().toUpperCase();
  if (sameName) {
    return {
      claimantLabel: PARTY_ROLE_CONFLICT_COPY,
      defendantLabel: PARTY_ROLE_CONFLICT_COPY,
      conflict: true,
      caption: PARTY_ROLE_CONFLICT_COPY,
    };
  }

  return {
    claimantLabel,
    defendantLabel,
    conflict: false,
    caption: `${claimantLabel} × ${defendantLabel}`,
  };
}

export function buildCaseDataCoverage(input: {
  item: Pick<
    ExposureCaseListItem,
    | "claimants"
    | "otherDefendants"
    | "groupEntities"
    | "className"
    | "subjects"
    | "claimValueFormatted"
    | "movementCount"
    | "attorneys"
    | "nextHearing"
    | "currentStatus"
    | "evidenceSources"
    | "processNumber"
    | "tribunal"
    | "systemName"
    | "secrecy"
  >;
  consultedSources?: LegalExposureSource[];
  sourceFacts?: CoverageSourceFact[];
}): CaseDataCoverage {
  const opposition = buildOppositionCaption(input.item);
  const claimantConflict = opposition.conflict || input.item.claimants.some((row) => row.roleConflict);
  const groupPoleConflict = input.item.groupEntities.some((row) =>
    polesConflict(input.item.claimants.filter((party) => party.entityId === row.id).map((party) => party.pole))
  );
  const fields: CaseDataCoverage["fields"] = {
    claimant: statusOf(confirmedClaimants(input.item.claimants).length > 0, claimantConflict),
    defendants: statusOf(
      confirmedGroupDefendants(input.item.groupEntities).length > 0 || input.item.otherDefendants.length > 0
    ),
    groupPoles: statusOf(
      input.item.groupEntities.length > 0 && input.item.groupEntities.every((row) => row.pole !== "UNKNOWN"),
      groupPoleConflict || opposition.conflict
    ),
    class: statusOf(Boolean(input.item.className)),
    subjects: statusOf(input.item.subjects.length > 0),
    claimValue: statusOf(Boolean(input.item.claimValueFormatted)),
    movements: statusOf(input.item.movementCount > 0),
    attorneys: statusOf(input.item.attorneys.length > 0),
    hearings: statusOf(Boolean(input.item.nextHearing)),
    status: statusOf(Boolean(input.item.currentStatus?.trim())),
  };
  const values = Object.values(fields);
  const found = values.filter((row) => row === "FOUND").length;
  const coverageScore = Math.round((found / values.length) * 100);
  const consulted = input.consultedSources ?? input.item.evidenceSources;
  const facts =
    input.sourceFacts ??
    sourceFactsFromRecords({
      className: input.item.className,
      claimValueFormatted: input.item.claimValueFormatted,
      currentStatus: input.item.currentStatus,
      groupCnpjs: input.item.groupEntities.map((row) => row.cnpj),
      groupNames: input.item.groupEntities.map((row) => row.legalName),
      parties: [
        ...input.item.claimants.map((row) => ({
          source: row.sources[0] ?? "DATAJUD",
          pole: row.pole,
          name: row.name,
        })),
        ...input.item.otherDefendants.map((row) => ({
          source: row.sources[0] ?? "DATAJUD",
          pole: row.pole,
          name: row.name,
        })),
      ],
      movements: input.item.movementCount > 0 ? [{ source: "DATAJUD" as const }] : [],
      attorneys: input.item.attorneys.flatMap((row) => row.sources.map((source) => ({ source }))),
      hearings: input.item.nextHearing ? [{ source: input.item.nextHearing.source }] : [],
      subjects: input.item.subjects.map((row) => ({ source: row.source })),
      evidences: consulted.map((source) => ({ source, lastSeenAt: new Date().toISOString() })),
    });
  const fieldDiagnoses = buildFieldDiagnoses({
    fields,
    facts,
    secrecy: input.item.secrecy ?? null,
    tribunal: input.item.tribunal,
    itemSources: {
      claimant: confirmedClaimants(input.item.claimants).flatMap((row) => row.sources),
      defendants: [
        ...confirmedGroupDefendants(input.item.groupEntities).flatMap((row) => row.sources),
        ...input.item.otherDefendants.flatMap((row) => row.sources),
      ],
      groupPoles: input.item.groupEntities.flatMap((row) => row.sources),
      class: consulted.filter((source) => source === "DATAJUD" || source === "TRIBUNAL_PUBLIC"),
      subjects: input.item.subjects.map((row) => row.source),
      claimValue: consulted.filter((source) => source === "ESCAVADOR" || source === "JUSBRASIL" || source === "DATAJUD"),
      movements: consulted.filter((source) => source === "DATAJUD" || source === "TRIBUNAL_PUBLIC" || source === "ESCAVADOR"),
      attorneys: input.item.attorneys.flatMap((row) => row.sources),
      hearings: input.item.nextHearing ? [input.item.nextHearing.source] : [],
      status: consulted.filter((source) => source === "DATAJUD" || source === "TRIBUNAL_PUBLIC"),
    },
  });
  const sourceMatrix = buildCoverageSourceMatrix(facts);
  const winningSources = Object.fromEntries(
    (Object.keys(fieldDiagnoses) as CoverageFieldKey[]).map((field) => [field, fieldDiagnoses[field].sources])
  ) as CaseDataCoverage["winningSources"];
  return {
    fields,
    fieldDiagnoses,
    sourceMatrix,
    winningSources,
    publicCompare: buildPublicCoverageCompare({
      processNumber: input.item.processNumber,
      tribunal: input.item.tribunal,
      system: input.item.systemName,
      datajud: facts.find((row) => row.source === "DATAJUD") ?? null,
    }),
    coverageScore,
    consultedSources: consulted,
    missingReasons: coverageMissingReasonsFromDiagnoses(fieldDiagnoses),
    opposition,
  };
}

export function coverageMissingReasons(
  fields: CaseDataCoverage["fields"],
  consulted: LegalExposureSource[]
): string[] {
  const dummyFacts = emptySourceFacts();
  const diagnoses = buildFieldDiagnoses({
    fields,
    facts: dummyFacts.map((row) =>
      consulted.includes(row.source) ? { ...row, attemptOutcome: "SUCCESS", lastSeenAt: new Date().toISOString() } : row
    ),
    secrecy: null,
    itemSources: {},
  });
  return coverageMissingReasonsFromDiagnoses(diagnoses);
}

export function coverageScoreOf(coverage: CaseDataCoverage): number {
  return coverage.coverageScore;
}
