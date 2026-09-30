/**
 * PDF A4 do Exposure. Reusa o mesmo DTO do dossiê/relatório.
 * Sem Puppeteer e sem rawMetadata.
 */

import { PDF_DISCLAIMER } from "./legalExposureContracts.js";
import { formatExposureDateTime } from "./legalExposureCaseListUi.js";

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapLine(text: string, width = 92): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width) {
      if (current) lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

export function buildPagedPdf(input: { title: string; lines: string[] }): Buffer {
  const pages: string[][] = [];
  let current: string[] = [];
  const maxLines = 48;
  for (const line of input.lines) {
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
    const contentLines = ["BT", "/F1 12 Tf", "50 800 Td", `(${escapePdfText(input.title)}) Tj`, "/F1 9 Tf"];
    for (const line of lines) {
      contentLines.push(`0 -14 Td (${escapePdfText(line)}) Tj`);
    }
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
    `Gerado em ${formatExposureDateTime(new Date().toISOString()) ?? ""}`,
    `CNJ ${dossier.processNumber}`,
    `Confirmação: ${dossier.verificationStatus}`,
    `Empresas do grupo: ${dossier.groupEntities.map((row) => `${row.legalName} (${row.pole})`).join(" | ") || "não identificadas"}`,
    `Autor/reclamante: ${dossier.claimants.map((row) => row.name).join("; ") || "não identificado nas fontes disponíveis"}`,
    `Outros réus: ${dossier.otherDefendants.map((row) => row.name).join("; ") || "não identificados"}`,
    `Advogados: ${dossier.attorneys.map((row) => `${row.name}${row.oabNumber ? ` OAB ${row.oabNumber}/${row.oabState ?? ""}` : ""}`).join("; ") || "não identificados"}`,
    `Tribunal: ${dossier.tribunal ?? "não informado"}`,
    `Vara: ${dossier.courtUnit ?? "não informada"}`,
    `Grau: ${dossier.degree ?? "não informado"}`,
    `Sistema: ${dossier.systemName ?? "não informado"}`,
    `Classe: ${dossier.className ?? "não informada"}`,
    `Assuntos: ${dossier.subjects.map((row) => row.name).join("; ") || "não informados"}`,
    `Ajuizamento: ${dossier.filedAt ?? "não informado"}`,
    `Valor da causa: ${dossier.claimValueFormatted ?? "não informado"}`,
    `Situação: ${dossier.currentStatus ?? "não informada"}`,
    `Fase: ${dossier.stageLabel}`,
    `Última movimentação: ${dossier.latestMovement ? `${dossier.latestMovement.occurredAt ?? ""} ${dossier.latestMovement.name}` : "não identificada"}`,
    `Próxima audiência: ${dossier.nextHearing?.scheduledAt ?? "não identificada"}`,
    `Movimentações: ${dossier.movementCount}`,
    `Fontes: ${dossier.evidenceSources.join(", ")}`,
    `Pontos de atenção: ${dossier.attentionLabels.join("; ") || "nenhum"}`,
    "",
    dossier.narrative ?? "",
    "",
    "Linha do tempo resumida:",
    ...dossier.timeline.slice(0, 20).map((row) => `${row.at} · ${row.kind} · ${row.title} · ${row.source}`),
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
    `Gerado em ${formatExposureDateTime(report.generatedAt) ?? report.generatedAt}`,
    "RESUMO EXECUTIVO",
    `Processos CNJ únicos: ${report.totals.uniqueProcesses}`,
    `Processos no filtro: ${report.totals.filteredProcesses}`,
    `Polo passivo: ${report.totals.passive}`,
    `Polo ativo: ${report.totals.active}`,
    `Múltiplas empresas do grupo: ${report.totals.multipleGroup}`,
    `Valor total de causas conhecido: ${report.totals.claimTotalFormatted ?? "não informado"}`,
    `Ações requeridas: ${report.totals.requiredActions}`,
    `Audiências futuras: ${report.totals.futureHearings}`,
    report.groupNote,
    "",
    "Por empresa:",
    ...report.entities.flatMap((entity) => [
      `${entity.legalName}: ${entity.monitoredCases} processo(s)`,
      ...entity.processes.map(
        (row) =>
          `  ${row.processNumber} · ${row.className ?? "classe não informada"} · ${row.claimants[0]?.name ?? "reclamante não identificado"} · ${row.claimValueFormatted ?? "valor não informado"}`
      ),
    ]),
    "",
    PDF_DISCLAIMER,
  ];
}
