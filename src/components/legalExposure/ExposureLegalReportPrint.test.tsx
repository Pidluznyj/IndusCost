import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_BRANDING } from "@/src/types/branding";
import { type ExposureCaseListItem } from "@/src/lib/legalExposure/legalExposureContracts";
import { ExposureCaseLegalReportDocument } from "./ExposureCaseLegalReportDocument";
import { ExposureGroupLegalReportDocument } from "./ExposureGroupLegalReportDocument";

function item(partial: Partial<ExposureCaseListItem> = {}): ExposureCaseListItem {
  return {
    id: "case-1",
    entityId: "ent-a",
    processNumber: "0001234-56.2024.5.09.0001",
    entity: {
      id: "ent-a",
      legalName: "Lazarios Exemplo LTDA",
      tradeName: null,
      cnpj: "11222333000181",
      displayCnpj: "11.222.333/0001-81",
    },
    tribunal: "TRT9",
    jurisdiction: "Justiça do Trabalho",
    degree: "G1",
    courtUnit: "09ª VARA DO TRABALHO DE CURITIBA",
    classCode: "985",
    className: "Ação Trabalhista - Rito Ordinário",
    filedAt: "2026-09-23T00:00:00.000Z",
    entityPole: "UNKNOWN",
    currentStatus: null,
    primarySource: "DJEN",
    firstSeenAt: "2026-09-30T17:50:00.000Z",
    lastSeenAt: "2026-09-30T17:50:00.000Z",
    sourceUpdatedAt: "2026-09-30T17:50:00.000Z",
    evidenceSources: ["DJEN", "DATAJUD"],
    verificationStatus: "CONFIRMED_OFFICIAL",
    enrichmentStatus: "DATAJUD_ENRICHED",
    latestMovement: {
      name: "Distribuído",
      occurredAt: "2026-09-30T10:00:00.000Z",
      source: "DATAJUD",
      courtUnit: "09ª VARA DO TRABALHO DE CURITIBA",
    },
    latestPublication: { type: "Intimação", availableAt: "2026-09-30T12:00:00.000Z", courtUnit: "09ª VARA" },
    involvedEntities: [],
    canonicalCaseId: "case-1",
    caseIds: ["case-1"],
    groupEntities: [
      {
        id: "ent-a",
        legalName: "Lazarios Exemplo LTDA",
        tradeName: null,
        cnpj: "11222333000181",
        displayCnpj: "11.222.333/0001-81",
        pole: "PASSIVE",
        confidence: "CONFIRMED",
        firstSeenAt: "2026-09-30T17:50:00.000Z",
        sources: ["DJEN"],
      },
    ],
    claimants: [
      {
        name: "Maria Exemplo",
        partyType: "RECLAMANTE",
        pole: "ACTIVE",
        personType: "PERSON",
        documentMasked: "***.***.***-12",
        isGroupEntity: false,
        entityId: null,
        sources: ["DATAJUD"],
        roles: ["ACTIVE"],
        roleConflict: false,
      },
    ],
    otherDefendants: [],
    attorneys: [],
    subjects: [{ code: null, name: "Verbas rescisórias", fullPath: null, isMain: true, source: "DATAJUD" }],
    stage: "INSTRUCTION",
    stageLabel: "Instrução",
    stageConfidence: "MEDIUM",
    claimValue: "168127.48",
    claimCurrency: "BRL",
    claimValueFormatted: "R$ 168.127,48",
    systemName: "PJe",
    area: null,
    nextHearing: null,
    movementCount: 18,
    publicationCount: 2,
    communicationCount: 1,
    openAlertCount: 1,
    attentionFlags: ["GROUP_ENTITY_PASSIVE"],
    attentionLabels: ["Empresa do grupo no polo passivo"],
    multipleGroupEntities: false,
    secrecy: null,
    ...partial,
  };
}

describe("Exposure legal report print", () => {
  it("dossiê tem capa, CNJ, partes, valor, fontes, rodapé e branding", () => {
    const html = renderToStaticMarkup(
      <ExposureCaseLegalReportDocument
        dossier={{
          ...item(),
          narrative: "Processo trabalhista em que Lazarios Exemplo LTDA consta no polo passivo.",
          timeline: [
            {
              kind: "movement",
              at: "2026-09-23T00:00:00.000Z",
              title: "Distribuído",
              description: null,
              source: "DATAJUD",
              sourceCode: "26",
              courtUnit: "09ª VARA",
              complements: [],
              communicationType: null,
              subject: null,
              status: null,
            },
          ],
        }}
        branding={DEFAULT_BRANDING}
        generatedAt="2026-09-30T18:00:00.000Z"
        sources={[{ source: "DATAJUD", label: "DataJud", statusLabel: "Saudável", lastSuccessfulAt: "2026-09-30T12:00:00.000Z" }]}
      />
    );
    assert.ok(html.includes("Dossiê jurídico executivo"));
    assert.ok(html.includes("0001234-56.2024.5.09.0001"));
    assert.ok(html.includes("Maria Exemplo"));
    assert.ok(html.includes("Lazarios Exemplo LTDA"));
    assert.ok(html.includes("R$ 168.127,48"));
    assert.ok(html.includes("DataJud"));
    assert.ok(html.includes("IndusCost · Exposure Jurídico"));
    assert.ok(html.includes("Página"));
    assert.ok(html.includes("resolvePrintCoverLogoSrc") === false);
    assert.ok(html.includes("exposure-legal-report-cover"));
    assert.equal(html.includes("12345678909"), false);
    assert.equal(html.includes("%PDF"), false);
  });

  it("relatório de grupo não duplica CNJ e mostra panorama", () => {
    const process = item();
    const html = renderToStaticMarkup(
      <ExposureGroupLegalReportDocument
        report={{
          generatedAt: "2026-09-30T18:00:00.000Z",
          groupNote: "Um mesmo processo pode envolver mais de uma empresa do grupo.",
          totals: {
            uniqueProcesses: 1,
            filteredProcesses: 1,
            passive: 1,
            active: 0,
            multipleGroup: 0,
            claimTotalFormatted: "R$ 168.127,48",
            requiredActions: 1,
            futureHearings: 0,
          },
          entities: [{ entityId: "ent-a", legalName: "Lazarios Exemplo LTDA", monitoredCases: 1, processes: [process] }],
          processes: [process, process],
        }}
        branding={DEFAULT_BRANDING}
        sources={[{ source: "DJEN", label: "DJEN", statusLabel: "Saudável", lastSuccessfulAt: null }]}
      />
    );
    assert.ok(html.includes("Relatório executivo de exposição jurídica"));
    assert.equal((html.match(/0001234-56.2024.5.09.0001/g) ?? []).length >= 1, true);
    assert.ok(html.includes("Lazarios Exemplo LTDA"));
    assert.ok(html.includes("Processos únicos"));
    assert.ok(html.includes("DJEN"));
  });

  it("CSS A4, print, no-print e fontes de branding estão no fluxo", () => {
    const css = readFileSync(join(process.cwd(), "src/components/legalExposure/exposure-legal-report-print.css"), "utf8");
    const cover = readFileSync(join(process.cwd(), "src/components/legalExposure/ExposureLegalReportDocument.tsx"), "utf8");
    const view = readFileSync(join(process.cwd(), "src/components/legalExposure/ExposureLegalReportPrintView.tsx"), "utf8");
    const app = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    assert.match(css, /A4 portrait/);
    assert.match(css, /@media print/);
    assert.match(css, /exposure-legal-report-no-print/);
    assert.match(css, /:last-child/);
    assert.match(cover, /resolvePrintCoverLogoSrc/);
    assert.match(cover, /resolvePrintLogoSrc/);
    assert.match(view, /waitForExposurePrintAssets/);
    assert.match(view, /Imprimir \/ Salvar PDF/);
    assert.match(app, /\/exposure\/cases\/:id\/print/);
    assert.match(app, /\/exposure\/reports\/group\/print/);
    assert.doesNotMatch(view, /%PDF-1\.4/);
  });
});
