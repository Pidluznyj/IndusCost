import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { dossierPdfLines } from "./legalExposurePdf.js";
import {
  buildPrintSourceRows,
  expectedExposurePrintPages,
  selectExecutiveTimeline,
  uniqueProcesses,
} from "./legalExposurePrint.js";
import type { ExposureTimelineItem } from "./legalExposureContracts.js";

describe("legalExposurePrint", () => {
  it("não usa builder raw %PDF no módulo de PDF", () => {
    const pdfMod = readFileSync(join(process.cwd(), "src/lib/legalExposure/legalExposurePdf.ts"), "utf8");
    const service = readFileSync(join(process.cwd(), "src/lib/legalExposure/legalExposureService.server.ts"), "utf8");
    const page = readFileSync(join(process.cwd(), "src/components/legalExposure/ExposurePage.tsx"), "utf8");
    assert.doesNotMatch(pdfMod, /%PDF-1\.4/);
    assert.doesNotMatch(pdfMod, /Helvetica/);
    assert.doesNotMatch(pdfMod, /buildPagedPdf/);
    assert.doesNotMatch(service, /buildPagedPdf/);
    assert.doesNotMatch(page, /\/api\/legal-exposure\/.*\.pdf/);
    assert.match(page, /EXPOSURE_CASE_PRINT_PATH/);
    assert.match(page, /EXPOSURE_GROUP_PRINT_PATH/);
  });

  it("separa linha do tempo executiva e anexo", () => {
    const items: ExposureTimelineItem[] = Array.from({ length: 20 }, (_, index) => ({
      kind: index === 0 ? "movement" : "movement",
      at: `2026-09-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
      title: index === 0 ? "Distribuído" : index === 5 ? "Intimação expedida" : `Movimento ${index}`,
      description: null,
      source: "DATAJUD",
      sourceCode: null,
      courtUnit: null,
      complements: null,
      communicationType: null,
      subject: null,
      status: null,
    }));
    const selected = selectExecutiveTimeline(items);
    assert.ok(selected.executive.length <= 12);
    assert.ok(selected.annex.length > 0);
    assert.equal(expectedExposurePrintPages({ kind: "case", timelineCount: 20 }).label, "dossiê completo");
    assert.equal(expectedExposurePrintPages({ kind: "case", timelineCount: 4 }).pages, "6");
  });

  it("não duplica CNJ e classifica fontes", () => {
    const rows = uniqueProcesses([
      { processNumber: "0001234-56.2024.5.09.0001" } as never,
      { processNumber: "0001234-56.2024.5.09.0001" } as never,
      { processNumber: "0009999-00.2024.5.09.0002" } as never,
    ]);
    assert.equal(rows.length, 2);
    const sources = buildPrintSourceRows({
      evidenceSources: ["DATAJUD", "DJEN", "ESCAVADOR"],
      dashboardSources: [{ source: "DATAJUD", label: "DataJud", statusLabel: "Saudável", lastSuccessfulAt: "2026-09-30T12:00:00.000Z" }],
    });
    assert.equal(sources.find((row) => row.source === "DATAJUD")?.authority, "Oficial CNJ");
    assert.equal(sources.find((row) => row.source === "ESCAVADOR")?.authority, "Complementar");
  });

  it("fatos do dossiê preservam CNJ e empresa", () => {
    const lines = dossierPdfLines({
      processNumber: "0001234-56.2024.5.09.0001",
      groupEntities: [{ legalName: "Lazarios Exemplo LTDA", pole: "PASSIVE" }],
      claimants: [{ name: "Maria Exemplo" }],
      className: "Ação Trabalhista",
      claimValueFormatted: "R$ 10.000,00",
      narrative: "Processo no polo passivo.",
    });
    assert.ok(lines.some((line) => line.includes("0001234-56.2024.5.09.0001")));
    assert.ok(lines.some((line) => line.includes("Lazarios")));
  });
});
