/**
 * PDF A4 do Exposure. Reusa o mesmo DTO do dossiê/relatório.
 * Sem Puppeteer e sem rawMetadata. Layout independente de viewport.
 */

import { PDF_DISCLAIMER, SOURCE_KIND_LABELS } from "./legalExposureContracts.js";
import { caseVerificationLabel, formatExposureDate, formatExposureDateTime } from "./legalExposureCaseListUi.js";
import { exposureTimelineKindLabel } from "./legalExposureFeedUi.js";

function looksLikeIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(value) || value.includes("T");
}

function pdfWhen(value: string | null | undefined, fallback = "nao informado"): string {
  if (!value?.trim()) return fallback;
  const formatted = formatExposureDateTime(value) ?? formatExposureDate(value);
  if (formatted) return formatted;
  if (looksLikeIsoDate(value)) return fallback;
  return value;
}

function pdfPole(pole: string): string {
  if (pole === "PASSIVE") return "reu / polo passivo";
  if (pole === "ACTIVE") return "autora / polo ativo";
  if (pole === "THIRD_PARTY") return "terceira interessada";
  if (pole === "OTHER") return "outro polo";
  return "polo ainda nao confirmado";
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapLine(text: string, width = 88): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  const pushChunks = (word: string) => {
    for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
  };
  for (const word of words) {
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      pushChunks(word);
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > width) {
      if (current) lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

export function buildPagedPdf(input: { title: string; lines: string[]; generatedAt?: string }): Buffer {
  const generatedAt = pdfWhen(input.generatedAt ?? new Date().toISOString());
  const pages: string[][] = [];
  let current: string[] = [];
  const maxLines = 42;
  for (const line of input.lines) {
    if (line === "\f") {
      pages.push(current.length > 0 ? current : [""]);
      current = [];
      continue;
    }
    const wrapped = wrapLine(line);
    for (const row of wrapped) {
      if (current.length >= maxLines) {
        pages.push(current);
        current = [];
      }
      current.push(row);
    }
  }
  if (current.length > 0) pages.push(current);
  if (pages.length === 0) pages.push([""]);

  const objects: string[] = [];
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  const pageIds = pages.map((_, index) => 3 + index * 2);
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`
  );
  const fontId = 3 + pages.length * 2;
  pages.forEach((lines, index) => {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    const pageLabel = `Pagina ${index + 1} de ${pages.length}`;
    const contentLines = [
      "BT",
      "/F1 11 Tf",
      "50 800 Td",
      `(${escapePdfText(input.title)}) Tj`,
      "/F1 8 Tf",
      "0 -12 Td",
      `(Gerado em ${escapePdfText(generatedAt)}) Tj`,
      "/F1 9 Tf",
      "0 -18 Td",
    ];
    for (const line of lines) {
      contentLines.push(`0 -14 Td (${escapePdfText(line)}) Tj`);
    }
    contentLines.push("ET");
    contentLines.push("BT");
    contentLines.push("/F1 8 Tf");
    contentLines.push("50 36 Td");
    contentLines.push(`(${escapePdfText(pageLabel)}) Tj`);
    contentLines.push("ET");
    const stream = contentLines.join("\n");
    objects.push(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>\nendobj\n`
    );
    objects.push(
      `${contentId} 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream\nendobj\n`
    );
  });
  objects.push(`${fontId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += object;
  }
  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

export function dossierPdfLines(dossier: {
  processNumber: string;
  verificationStatus: string;
  groupEntities: Array<{ legalName: string; pole: string }>;
  claimants: Array<{ name: string }>;
  otherDefendants: Array<{ name: string }>;
  attorneys: Array<{ name: string; oabNumber: string | null; oabState: string | null }>;
  tribunal: string | null;
  courtUnit: string | null;
  degree: string | null;
  systemName: string | null;
  className: string | null;
  subjects: Array<{ name: string }>;
  filedAt: string | null;
  claimValueFormatted: string | null;
  currentStatus: string | null;
  stageLabel: string;
  latestMovement: { occurredAt: string | null; name: string } | null;
  nextHearing: { scheduledAt: string | null } | null;
  movementCount: number;
  evidenceSources: string[];
  attentionLabels: string[];
  timeline: Array<{ at: string; kind: string; title: string; source: string }>;
  narrative?: string;
}): string[] {
  const lines = [
    `CNJ ${dossier.processNumber}`,
    `Classe: ${dossier.className ?? "nao informada"}`,
    `Confirmacao: ${caseVerificationLabel(dossier.verificationStatus as "CONFIRMED_OFFICIAL" | "REVIEW_REQUIRED")}`,
    `Empresas do grupo: ${dossier.groupEntities.map((row) => `${row.legalName} (${pdfPole(row.pole)})`).join(" | ") || "nao identificadas"}`,
    `Autor/reclamante: ${dossier.claimants.map((row) => row.name).join("; ") || "nao identificado nas fontes disponiveis"}`,
    `Outros reus: ${dossier.otherDefendants.map((row) => row.name).join("; ") || "nao identificados"}`,
    `Advogados: ${dossier.attorneys.map((row) => `${row.name}${row.oabNumber ? ` OAB ${row.oabNumber}/${row.oabState ?? ""}` : ""}`).join("; ") || "nao identificados"}`,
    `Tribunal: ${dossier.tribunal ?? "nao informado"}`,
    `Vara: ${dossier.courtUnit ?? "nao informada"}`,
    `Grau: ${dossier.degree ?? "nao informado"}`,
    `Sistema: ${dossier.systemName ?? "nao informado"}`,
    `Assuntos: ${dossier.subjects.map((row) => row.name).join("; ") || "nao informados"}`,
    `Ajuizamento: ${pdfWhen(dossier.filedAt)}`,
    `Valor da causa: ${dossier.claimValueFormatted ?? "nao informado"}`,
    `Situacao: ${dossier.currentStatus?.trim() || "nao informada"}`,
    `Fase: ${dossier.stageLabel}`,
    `Ultima movimentacao: ${dossier.latestMovement ? `${pdfWhen(dossier.latestMovement.occurredAt, "")} ${dossier.latestMovement.name}`.trim() : "nao identificada"}`,
    `Proxima audiencia: ${pdfWhen(dossier.nextHearing?.scheduledAt, "nao identificada")}`,
    `Movimentacoes: ${dossier.movementCount}`,
    `Fontes: ${dossier.evidenceSources.map((source) => SOURCE_KIND_LABELS[source as keyof typeof SOURCE_KIND_LABELS] ?? source).join(", ")}`,
    `Pontos de atencao: ${dossier.attentionLabels.join("; ") || "nenhum"}`,
    "",
    dossier.narrative ?? "",
    "",
    "Linha do tempo resumida:",
    ...dossier.timeline
      .slice(0, 20)
      .map(
        (row) =>
          `${pdfWhen(row.at)} · ${exposureTimelineKindLabel(row.kind, row.title)} · ${row.title} · ${SOURCE_KIND_LABELS[row.source as keyof typeof SOURCE_KIND_LABELS] ?? row.source}`
      ),
    "",
    PDF_DISCLAIMER,
  ];
  return lines;
}

export function groupReportPdfLines(report: {
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
    legalName: string;
    monitoredCases: number;
    processes: Array<{
      processNumber: string;
      className: string | null;
      claimants: Array<{ name: string }>;
      claimValueFormatted: string | null;
    }>;
  }>;
}): string[] {
  return [
    "EXPOSURE - RELATORIO GERENCIAL",
    "Capa",
    `Gerado em ${pdfWhen(report.generatedAt)}`,
    report.groupNote,
    "\f",
    "RESUMO EXECUTIVO",
    `Processos CNJ unicos: ${report.totals.uniqueProcesses}`,
    `Processos no filtro: ${report.totals.filteredProcesses}`,
    `Polo passivo: ${report.totals.passive}`,
    `Polo ativo: ${report.totals.active}`,
    `Multiplas empresas do grupo: ${report.totals.multipleGroup}`,
    `Valor total de causas conhecido: ${report.totals.claimTotalFormatted ?? "nao informado"}`,
    `Acoes requeridas: ${report.totals.requiredActions}`,
    `Audiencias futuras: ${report.totals.futureHearings}`,
    "\f",
    "EMPRESAS MONITORADAS",
    ...report.entities.flatMap((entity) => [`${entity.legalName}: ${entity.monitoredCases} processo(s) unicos`]),
    "\f",
    "PROCESSOS",
    ...report.entities.flatMap((entity) => [
      entity.legalName,
      ...entity.processes.map(
        (row) =>
          `  ${row.processNumber} · ${row.className ?? "classe nao informada"} · ${row.claimants[0]?.name ?? "reclamante nao identificado"} · ${row.claimValueFormatted ?? "valor nao informado"}`
      ),
    ]),
    "",
    PDF_DISCLAIMER,
  ];
}
