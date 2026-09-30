/**
 * Helpers de impressão/PDF do Exposure. Sem builder %PDF.
 * O documento visual vive nos componentes React A4.
 */

import {
  PDF_DISCLAIMER,
  SOURCE_KIND_LABELS,
  foldText,
  type ExposureCaseListItem,
  type ExposureTimelineItem,
  type LegalExposureSource,
} from "./legalExposureContracts.js";
import { isComplementarySource, sourceKindOf } from "./legalExposureAuthority.js";
import { casePoleLabel, formatExposureDate, formatExposureDateTime } from "./legalExposureCaseListUi.js";
import { exposureTimelineKindLabel } from "./legalExposureFeedUi.js";

export const EXPOSURE_LEGAL_REPORT_BODY_CLASS = "exposure-legal-report-printing";
export const EXPOSURE_CASE_PRINT_PATH = (caseId: string) => `/exposure/cases/${encodeURIComponent(caseId)}/print`;
export const EXPOSURE_GROUP_PRINT_PATH = "/exposure/reports/group/print";

export const EXPOSURE_CASE_REPORT_TITLE = "Dossiê jurídico executivo";
export const EXPOSURE_GROUP_REPORT_TITLE = "Relatório executivo de exposição jurídica";
export const EXPOSURE_PRINT_FOOTER_BRAND = "IndusCost · Exposure Jurídico";
export const EXPOSURE_PRINT_CONFIDENTIAL = "Uso interno e confidencial.";
export const EXPOSURE_PRINT_SOURCE_NOTE =
  "Os dados deste relatório representam as informações obtidas das fontes indicadas na data-base.";

export const EXPOSURE_EXECUTIVE_TIMELINE_LIMIT = 12;

export type ExposurePrintSourceRow = {
  source: string;
  label: string;
  kind: string;
  authority: string;
  lastAttemptAt: string | null;
  lastSuccessfulAt: string | null;
  result: string;
};

export type ExposureGroupPrintReport = {
  generatedAt: string;
  groupNote: string;
  totals: {
    uniqueProcesses: number;
    filteredProcesses: number;
    passive: number;
    active: number;
    multipleGroup: number;
    claimTotalFormatted: string | null;
    requiredActions: number;
    futureHearings: number;
  };
  entities: Array<{
    entityId: string;
    legalName: string;
    monitoredCases: number;
    processes: ExposureCaseListItem[];
  }>;
  processes: ExposureCaseListItem[];
};

export type ExposurePrintDashboardSource = {
  source: string;
  label: string;
  statusLabel: string;
  lastSuccessfulAt: string | null;
  lastAttemptAt?: string | null;
};

const HIGHLIGHT_TIMELINE = [
  ["distrib", "Distribuição"],
  ["audienc", "Audiência"],
  ["senten", "Sentença"],
  ["recur", "Recurso"],
  ["arquiv", "Arquivamento"],
  ["baixa", "Arquivamento"],
  ["intim", "Intimação"],
  ["public", "Publicação"],
  ["decis", "Decisão"],
] as const;

export function classifyExposurePrintTimeline(row: Pick<ExposureTimelineItem, "kind" | "title">): string {
  const folded = foldText(`${row.kind} ${row.title}`);
  for (const [needle, label] of HIGHLIGHT_TIMELINE) {
    if (folded.includes(needle.toUpperCase())) return label;
  }
  if (row.kind === "hearing") return "Audiência";
  if (row.kind === "publication") return "Publicação";
  if (row.kind === "communication") return "Comunicação";
  if (row.kind === "event") return "Evento IndusCost";
  return exposureTimelineKindLabel(row.kind, row.title);
}

export function isHighlightedPrintTimeline(row: Pick<ExposureTimelineItem, "kind" | "title">): boolean {
  const label = classifyExposurePrintTimeline(row);
  return ["Distribuição", "Audiência", "Decisão", "Sentença", "Recurso", "Publicação", "Intimação", "Arquivamento"].includes(
    label
  );
}

export function selectExecutiveTimeline(items: ExposureTimelineItem[]): {
  executive: ExposureTimelineItem[];
  annex: ExposureTimelineItem[];
} {
  const ordered = items.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (ordered.length <= EXPOSURE_EXECUTIVE_TIMELINE_LIMIT) {
    return { executive: ordered, annex: [] };
  }
  const highlighted = ordered.filter(isHighlightedPrintTimeline);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const picked = new Map<string, ExposureTimelineItem>();
  const keyOf = (row: ExposureTimelineItem) => `${row.at}|${row.kind}|${row.title}`;
  if (first) picked.set(keyOf(first), first);
  for (const row of highlighted) picked.set(keyOf(row), row);
  if (last) picked.set(keyOf(last), last);
  let executive = Array.from(picked.values()).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (executive.length > EXPOSURE_EXECUTIVE_TIMELINE_LIMIT) {
    executive = [executive[0]!, ...executive.slice(-11)];
  }
  const used = new Set(executive.map(keyOf));
  return { executive, annex: ordered.filter((row) => !used.has(keyOf(row))) };
}

export function printSourceAuthority(source: string): string {
  if (source === "DATAJUD" || source === "DJEN") return "Oficial CNJ";
  if (source === "TRIBUNAL_PUBLIC") return "Oficial Tribunal";
  if (source === "DOMICILIO") return "Oficial";
  if (source === "ESCAVADOR" || source === "JUSBRASIL") return "Complementar";
  if (source === "WEB_DISCOVERY") return "Localizador";
  return "Outro";
}

export function printSourceKind(source: string): string {
  if (source === "DATAJUD") return "DataJud — Oficial CNJ";
  if (source === "DJEN") return "DJEN — Oficial CNJ";
  if (source === "TRIBUNAL_PUBLIC") return "Portal TRT/TJ — Oficial Tribunal";
  if (source === "ESCAVADOR") return "Escavador — Complementar";
  if (source === "JUSBRASIL") return "Jusbrasil — Complementar";
  return SOURCE_KIND_LABELS[source as LegalExposureSource] ?? source;
}

export function buildPrintSourceRows(input: {
  evidenceSources: string[];
  dashboardSources?: ExposurePrintDashboardSource[];
}): ExposurePrintSourceRow[] {
  const byKey = new Map(input.dashboardSources?.map((row) => [row.source, row]) ?? []);
  const keys = input.evidenceSources.length > 0 ? input.evidenceSources : Array.from(byKey.keys());
  const unique = Array.from(new Set(keys));
  return unique.map((source) => {
    const live = byKey.get(source);
    return {
      source,
      label: printSourceKind(source),
      kind: sourceKindOf(source as LegalExposureSource),
      authority: printSourceAuthority(source),
      lastAttemptAt: live?.lastAttemptAt ?? null,
      lastSuccessfulAt: live?.lastSuccessfulAt ?? null,
      result: live?.statusLabel ?? (isComplementarySource(source as LegalExposureSource) ? "Complementar" : "Consultada"),
    };
  });
}

export function selectPriorityProcesses(processes: ExposureCaseListItem[]): ExposureCaseListItem[] {
  const seen = new Set<string>();
  return processes.filter((row) => {
    if (seen.has(row.processNumber)) return false;
    seen.add(row.processNumber);
    return row.openAlertCount > 0 || Boolean(row.nextHearing) || row.attentionFlags.length > 0;
  });
}

export function uniqueProcesses(processes: ExposureCaseListItem[]): ExposureCaseListItem[] {
  const seen = new Set<string>();
  return processes.filter((row) => {
    if (seen.has(row.processNumber)) return false;
    seen.add(row.processNumber);
    return true;
  });
}

export function formatPrintWhen(value: string | null | undefined, fallback = "não informado"): string {
  if (!value?.trim()) return fallback;
  return formatExposureDateTime(value) ?? formatExposureDate(value) ?? fallback;
}

export function expectedExposurePrintPages(input: {
  kind: "case" | "group";
  timelineCount?: number;
  processCount?: number;
}): { label: string; pages: string } {
  if (input.kind === "group") {
    const extra = Math.max(0, Math.ceil(((input.processCount ?? 0) - 18) / 22));
    const pages = 6 + extra;
    return { label: "relatório grupo", pages: String(pages) };
  }
  const annex = (input.timelineCount ?? 0) > EXPOSURE_EXECUTIVE_TIMELINE_LIMIT;
  return annex
    ? { label: "dossiê completo", pages: "7–8" }
    : { label: "dossiê simples", pages: "6" };
}

export async function waitForExposurePrintAssets(root?: ParentNode | null): Promise<void> {
  if (typeof document === "undefined") return;
  try {
    await document.fonts?.ready;
  } catch {
    /* ignore */
  }
  const scope = root ?? document;
  const images = Array.from(scope.querySelectorAll("img"));
  await Promise.all(
    images.map(async (image) => {
      if (image.complete) return;
      try {
        await image.decode();
      } catch {
        await new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        });
      }
    })
  );
}

export function dossierPrintFacts(dossier: {
  processNumber: string;
  groupEntities: Array<{ legalName: string; pole: string }>;
  claimants: Array<{ name: string }>;
  className: string | null;
  claimValueFormatted: string | null;
  narrative?: string;
}): string[] {
  return [
    dossier.processNumber,
    dossier.className ?? "",
    dossier.claimValueFormatted ?? "",
    ...dossier.groupEntities.map((row) => `${row.legalName} ${casePoleLabel(row.pole)}`),
    ...dossier.claimants.map((row) => row.name),
    dossier.narrative ?? "",
    PDF_DISCLAIMER,
  ];
}

export { PDF_DISCLAIMER };
