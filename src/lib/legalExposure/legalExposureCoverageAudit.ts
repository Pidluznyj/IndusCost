/**
 * Relatório somente leitura da cobertura executiva.
 * Sem escrita e sem scraping. Preview de enriquecimento é opt-in e não persiste.
 */

import type { CaseCoverageStatus, CaseDataCoverage, CoverageFieldKey, ExposureCaseListItem } from "./legalExposureContracts.js";
import { COVERAGE_FIELD_LABELS, SOURCE_KIND_LABELS } from "./legalExposureContracts.js";
import { inferTribunalAlias } from "./legalTribunalPublicRegistry.js";

const FIELDS: CoverageFieldKey[] = [
  "claimant",
  "defendants",
  "groupPoles",
  "class",
  "subjects",
  "claimValue",
  "movements",
  "attorneys",
  "hearings",
  "status",
];

function percent(part: number, total: number): string {
  if (total === 0) return "0.0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function found(status: CaseCoverageStatus | undefined): boolean {
  return status === "FOUND";
}

export function coveragePercents(items: ExposureCaseListItem[]): Record<CoverageFieldKey, string> {
  const total = items.length;
  const counts = Object.fromEntries(FIELDS.map((field) => [field, 0])) as Record<CoverageFieldKey, number>;
  for (const item of items) {
    const fields = item.coverage?.fields;
    if (!fields) continue;
    for (const field of FIELDS) {
      if (found(fields[field])) counts[field] += 1;
    }
  }
  return Object.fromEntries(FIELDS.map((field) => [field, percent(counts[field], total)])) as Record<
    CoverageFieldKey,
    string
  >;
}

export function processCoverageRow(item: ExposureCaseListItem) {
  const coverage = item.coverage;
  return {
    cnj: item.processNumber,
    tribunal: item.tribunal,
    groupCompanies: item.groupEntities.map((row) => row.legalName),
    claimant: coverage?.fields.claimant ?? "MISSING",
    defendants: coverage?.fields.defendants ?? "MISSING",
    groupPole: coverage?.fields.groupPoles ?? "MISSING",
    class: coverage?.fields.class ?? "MISSING",
    subject: coverage?.fields.subjects ?? "MISSING",
    claimValue: coverage?.fields.claimValue ?? "MISSING",
    movements: coverage?.fields.movements ?? "MISSING",
    attorneys: coverage?.fields.attorneys ?? "MISSING",
    hearings: coverage?.fields.hearings ?? "MISSING",
    status: coverage?.fields.status ?? "MISSING",
    consultedSources: item.evidenceSources,
    coverageScore: coverage?.coverageScore ?? 0,
    diagnoses: coverage?.fieldDiagnoses
      ? Object.fromEntries(
          FIELDS.map((field) => [
            field,
            {
              status: coverage.fieldDiagnoses[field].status,
              cause: coverage.fieldDiagnoses[field].cause,
              line: coverage.fieldDiagnoses[field].line,
              sources: coverage.fieldDiagnoses[field].sources,
            },
          ])
        )
      : null,
    sourceMatrix: coverage?.sourceMatrix ?? [],
    publicCompare: coverage?.publicCompare ?? null,
    result: {
      claimant: coverage?.fields.claimant ?? "MISSING",
      source: coverage?.fieldDiagnoses?.claimant.sources[0] ?? null,
    },
  };
}

export function topIncompleteProcesses(items: ExposureCaseListItem[], limit = 20) {
  return [...items]
    .sort((left, right) => (left.coverage?.coverageScore ?? 0) - (right.coverage?.coverageScore ?? 0))
    .slice(0, limit)
    .map((item) => ({
      cnj: item.processNumber,
      tribunal: item.tribunal,
      coverageScore: item.coverage?.coverageScore ?? 0,
      gaps: (item.coverage?.missingReasons ?? []).slice(0, 8),
      claimantCause: item.coverage?.fieldDiagnoses?.claimant.line ?? null,
    }));
}

export function selectControlSample(items: ExposureCaseListItem[], perTribunal = 5) {
  const trt9 = items.filter((row) => inferTribunalAlias(row.processNumber, row.tribunal) === "TRT9");
  const tjpr = items.filter((row) => inferTribunalAlias(row.processNumber, row.tribunal) === "TJPR");
  const pick = (pool: ExposureCaseListItem[]) => {
    const missing = pool.filter((row) => row.coverage?.fields.claimant !== "FOUND");
    const foundRows = pool.filter((row) => row.coverage?.fields.claimant === "FOUND");
    return [...missing, ...foundRows].slice(0, perTribunal);
  };
  return { trt9: pick(trt9), tjpr: pick(tjpr) };
}

export function buildCoverageAuditReport(input: {
  items: ExposureCaseListItem[];
  configuration: unknown;
  previewSample?: Array<{
    cnj: string;
    tribunal: string | null;
    before: CaseDataCoverage | null;
    after: CaseDataCoverage | null;
    steps: Array<{ source: string; outcome: string; errorCode: string | null; message: string | null }>;
  }>;
}) {
  const items = input.items;
  const percents = coveragePercents(items);
  return {
    readOnly: true,
    externalCall: Boolean(input.previewSample?.length),
    uniqueProcesses: items.length,
    coverage: {
      claimantIdentified: percents.claimant,
      groupPolesIdentified: percents.groupPoles,
      defendantsIdentified: percents.defendants,
      claimValue: percents.claimValue,
      class: percents.class,
      subjects: percents.subjects,
      movements: percents.movements,
      attorneys: percents.attorneys,
      hearings: percents.hearings,
      status: percents.status,
    },
    topIncomplete: topIncompleteProcesses(items, 10),
    controlSample: {
      trt9: selectControlSample(items).trt9.map(processCoverageRow),
      tjpr: selectControlSample(items).tjpr.map(processCoverageRow),
    },
    previewSample: input.previewSample ?? [],
    processes: items.map(processCoverageRow),
    configuration: input.configuration,
    fieldLabels: COVERAGE_FIELD_LABELS,
    sourceLabels: SOURCE_KIND_LABELS,
  };
}
