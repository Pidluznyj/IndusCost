import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPagedPdf, dossierPdfLines, groupReportPdfLines } from "./legalExposurePdf.js";

describe("legalExposurePdf", () => {
  it("dossiê gera PDF A4 com cabeçalho, data e número de página", () => {
    const lines = dossierPdfLines({
      processNumber: "0001234-56.2024.5.09.0001",
      verificationStatus: "CONFIRMED_OFFICIAL",
      groupEntities: [
        { legalName: "Industria Exemplo LTDA", pole: "PASSIVE" },
        { legalName: "Comercio Outra LTDA", pole: "UNKNOWN" },
      ],
      claimants: [{ name: "Maria Exemplo" }],
      otherDefendants: [],
      attorneys: [],
      tribunal: "TRT9",
      courtUnit: "09ª VARA",
      degree: "G1",
      systemName: "PJe",
      className: "Ação Trabalhista",
      subjects: [{ name: "Verbas rescisórias" }],
      filedAt: "2026-09-23T00:00:00.000Z",
      claimValueFormatted: "R$ 10.000,00",
      currentStatus: "Em andamento",
      stageLabel: "Instrução",
      latestMovement: { occurredAt: "2026-09-30T10:00:00.000Z", name: "Distribuído" },
      nextHearing: { scheduledAt: "2026-10-10T13:00:00.000Z" },
      movementCount: 3,
      evidenceSources: ["DJEN", "DATAJUD"],
      attentionLabels: [],
      timeline: [{ at: "2026-09-30T10:00:00.000Z", kind: "movement", title: "Distribuído", source: "DATAJUD" }],
      narrative: "Processo em que o grupo aparece no polo passivo.",
    });
    const pdf = buildPagedPdf({ title: "IndusCost · Exposure · Dossiê do processo", lines }).toString("latin1");
    assert.match(pdf, /MediaBox \[0 0 595 842\]/);
    assert.match(pdf, /Gerado em /);
    assert.match(pdf, /Pagina 1 de 1/);
    assert.match(pdf, /0001234-56.2024.5.09.0001/);
    assert.doesNotMatch(pdf, /vw|vh|@media/);
    assert.doesNotMatch(lines.join("\n"), /2026-09-23T|2026-09-30T|2026-10-10T/);
    assert.doesNotMatch(lines.join("\n"), /\bUNKNOWN\b|CONFIRMED_OFFICIAL|\bPASSIVE\b/);
    assert.ok(lines.some((line) => line.includes("polo passivo")));
    assert.ok(lines.some((line) => line.includes("Confirmado em fonte oficial")));
  });

  it("relatório geral tem capa, resumo, empresas, processos e totais", () => {
    const lines = groupReportPdfLines({
      generatedAt: "2026-09-30T12:00:00.000Z",
      groupNote: "Um mesmo processo pode envolver mais de uma empresa do grupo.",
      totals: {
        uniqueProcesses: 1,
        filteredProcesses: 1,
        passive: 1,
        active: 0,
        multipleGroup: 1,
        claimTotalFormatted: "R$ 10.000,00",
        requiredActions: 0,
        futureHearings: 0,
      },
      entities: [
        {
          legalName: "Industria Exemplo LTDA",
          monitoredCases: 1,
          processes: [
            {
              processNumber: "0001234-56.2024.5.09.0001",
              className: "Ação Trabalhista",
              claimants: [{ name: "Maria Exemplo" }],
              claimValueFormatted: "R$ 10.000,00",
            },
          ],
        },
      ],
    });
    assert.ok(lines.includes("Capa"));
    assert.ok(lines.includes("RESUMO EXECUTIVO"));
    assert.ok(lines.includes("EMPRESAS MONITORADAS"));
    assert.ok(lines.includes("PROCESSOS"));
    assert.ok(lines.some((line) => line.includes("Processos CNJ unicos: 1")));
    const pdf = buildPagedPdf({ title: "IndusCost · Exposure · Relatório geral", lines }).toString("latin1");
    assert.match(pdf, /Pagina 1 de /);
    assert.match(pdf, /MediaBox \[0 0 595 842\]/);
  });
});
