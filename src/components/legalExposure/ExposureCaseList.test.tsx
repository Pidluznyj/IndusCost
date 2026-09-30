import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CASE_AWAITING_DATAJUD_COPY,
  CASE_CLASS_UNKNOWN_COPY,
  CASE_DATAJUD_AVAILABLE_COPY,
  CASE_POLE_PASSIVE_COPY,
  CASE_VERIFIED_OFFICIAL_COPY,
  type ExposureCaseListItem,
  type Page,
} from "@/src/lib/legalExposure/legalExposureContracts";
import { EMPTY_CASE_LIST_FILTERS, ExposureCaseList } from "./ExposureCaseList";
import { ExposureCaseDossier } from "./ExposureCaseDossier";

function item(partial: Partial<ExposureCaseListItem> = {}): ExposureCaseListItem {
  return {
    id: "case-1",
    entityId: "ent-a",
    processNumber: "0001234-56.2024.5.09.0001",
    entity: {
      id: "ent-a",
      legalName: "Industria Exemplo LTDA",
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
        legalName: "Industria Exemplo LTDA",
        tradeName: null,
        cnpj: "11222333000181",
        displayCnpj: "11.222.333/0001-81",
        pole: "PASSIVE",
        confidence: "CONFIRMED",
        firstSeenAt: "2026-09-30T17:50:00.000Z",
        sources: ["DJEN"],
      },
    ],
    claimants: [{ name: "Maria Exemplo", partyType: "RECLAMANTE", pole: "ACTIVE", personType: "PERSON", documentMasked: "***.***.***-12", isGroupEntity: false, entityId: null, sources: ["ESCAVADOR"] }],
    otherDefendants: [],
    attorneys: [],
    subjects: [{ code: null, name: "Verbas rescisórias", fullPath: null, isMain: true, source: "DATAJUD" }],
    stage: "INSTRUCTION",
    stageLabel: "Instrução",
    stageConfidence: "MEDIUM",
    claimValue: "168127.48",
    claimCurrency: "BRL",
    claimValueFormatted: "R$ 168.127,48",
    systemName: null,
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

function pageOf(items: ExposureCaseListItem[], total = items.length, page = 1, pageSize = 20): Page<ExposureCaseListItem> {
  return { items, total, page, pageSize };
}

describe("ExposureCaseList", () => {
  it("mostra empresa, CNPJ, confirmação oficial e Ver processo", () => {
    const html = renderToStaticMarkup(
      <ExposureCaseList
        cases={pageOf([item()])}
        entities={[{ id: "ent-a", legalName: "Industria Exemplo LTDA" }]}
        filters={EMPTY_CASE_LIST_FILTERS}
        onFilterChange={() => {}}
        onClearFilters={() => {}}
        onPageChange={() => {}}
        onOpenCase={() => {}}
      />
    );
    assert.ok(html.includes("Industria Exemplo LTDA"));
    assert.ok(html.includes("11.222.333/0001-81"));
    assert.ok(html.includes(CASE_VERIFIED_OFFICIAL_COPY));
    assert.ok(html.includes(CASE_DATAJUD_AVAILABLE_COPY));
    assert.ok(html.includes("Ação Trabalhista - Rito Ordinário"));
    assert.ok(html.includes("09ª VARA DO TRABALHO DE CURITIBA"));
    assert.ok(html.includes(CASE_POLE_PASSIVE_COPY));
    assert.equal(html.includes("polo UNKNOWN"), false);
    assert.ok(html.includes("Maria Exemplo"));
    assert.ok(html.includes("Ver processo"));
    assert.ok(html.includes("Limpar filtros"));
    assert.ok(html.includes("Empresa"));
    assert.ok(html.includes("Fonte"));
    assert.equal(html.includes("12345678909"), false);
  });

  it("DJEN sem DataJud mostra aguardando enriquecimento sem alerta vermelho", () => {
    const html = renderToStaticMarkup(
      <ExposureCaseList
        cases={pageOf([
          item({
            className: null,
            classCode: null,
            evidenceSources: ["DJEN"],
            enrichmentStatus: "DJEN_ONLY",
            latestMovement: null,
          }),
        ])}
        entities={[{ id: "ent-a", legalName: "Industria Exemplo LTDA" }]}
        filters={EMPTY_CASE_LIST_FILTERS}
        onFilterChange={() => {}}
        onClearFilters={() => {}}
        onPageChange={() => {}}
        onOpenCase={() => {}}
      />
    );
    assert.ok(html.includes(CASE_VERIFIED_OFFICIAL_COPY));
    assert.ok(html.includes(CASE_AWAITING_DATAJUD_COPY));
    assert.ok(html.includes(CASE_CLASS_UNKNOWN_COPY));
    assert.equal(html.includes("inválido"), false);
    assert.equal(html.includes("bg-red-"), false);
  });

  it("paginação aparece quando total é maior que pageSize", () => {
    const html = renderToStaticMarkup(
      <ExposureCaseList
        cases={pageOf([item()], 21, 1, 20)}
        entities={[]}
        filters={{ ...EMPTY_CASE_LIST_FILTERS, page: 1 }}
        onFilterChange={() => {}}
        onClearFilters={() => {}}
        onPageChange={() => {}}
        onOpenCase={() => {}}
      />
    );
    assert.ok(html.includes("21 processos encontrados"));
    assert.ok(html.includes("Anterior"));
    assert.ok(html.includes("Próxima"));
    assert.ok(html.includes("Página 1 de 2"));
  });
});

describe("ExposureCaseList — processo compartilhado", () => {
  it("lista todas as empresas do grupo envolvidas no mesmo processo, com o polo de cada uma", () => {
    const entityB = {
      id: "ent-b",
      legalName: "Comercio Outra LTDA",
      tradeName: null,
      cnpj: "99888777000166",
      displayCnpj: "99.888.777/0001-66",
      pole: "PASSIVE" as const,
      confidence: "CONFIRMED" as const,
      firstSeenAt: "2026-09-30T17:50:00.000Z",
      sources: ["DATAJUD" as const],
    };
    const html = renderToStaticMarkup(
      <ExposureCaseList
        cases={{
          items: [
            item({
              multipleGroupEntities: true,
              groupEntities: [entityB, item().groupEntities[0]!],
              involvedEntities: [
                { caseId: "case-2", entity: { id: entityB.id, legalName: entityB.legalName, tradeName: entityB.tradeName, cnpj: entityB.cnpj, displayCnpj: entityB.displayCnpj }, entityPole: "PASSIVE", verificationStatus: "CONFIRMED_OFFICIAL" },
                { caseId: "case-1", entity: item().entity, entityPole: "UNKNOWN", verificationStatus: "REVIEW_REQUIRED" },
              ],
            }),
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        }}
        entities={[]}
        filters={EMPTY_CASE_LIST_FILTERS}
        onFilterChange={() => undefined}
        onClearFilters={() => undefined}
        onPageChange={() => undefined}
        onOpenCase={() => undefined}
      />
    );
    assert.match(html, /2 empresas do grupo neste processo/);
    assert.match(html, /Comercio Outra LTDA/);
    assert.match(html, /99\.888\.777\/0001-66/);
    assert.match(html, /Industria Exemplo LTDA/);
    assert.match(html, /Ré \/ polo passivo/);
    assert.equal((html.match(/0001234-56\.2024\.5\.09\.0001/g) ?? []).length, 1, "o número do processo aparece uma vez");
  });
});

describe("ExposureCaseDossier", () => {
  it("mostra resumo, partes, linha do tempo, comunicações e fontes sem CPF completo", () => {
    const html = renderToStaticMarkup(
      <ExposureCaseDossier
        dossier={{
          ...item(),
          narrative: "Processo trabalhista em que Industria Exemplo LTDA aparece no polo passivo.",
          parties: {
            active: item().claimants,
            passiveGroup: item().groupEntities,
            passiveOthers: [],
            attorneys: [{ name: "Advogado Teste", oabNumber: "12345", oabState: "PR", representedPartyName: null, documentMasked: null, sources: ["ESCAVADOR"] }],
          },
          timeline: [
            {
              kind: "movement",
              at: "2026-09-30T10:00:00.000Z",
              title: "Conclusos para decisão",
              description: null,
              source: "DATAJUD",
              sourceCode: "123",
              courtUnit: "09ª VARA",
              complements: [],
              communicationType: null,
              subject: null,
              status: null,
            },
          ],
          communications: [],
          discovery: { firstSeenAt: "2026-09-30T17:50:00.000Z", primarySource: "DJEN", evidenceSources: ["DJEN", "DATAJUD"] },
          stageReason: "Movimento de julgamento/decisão.",
        }}
        onClose={() => {}}
        onRefresh={() => {}}
        onPdf={() => {}}
      />
    );
    assert.ok(html.includes("Resumo"));
    assert.ok(html.includes("Partes"));
    assert.ok(html.includes("Linha do Tempo"));
    assert.ok(html.includes("Comunicações"));
    assert.ok(html.includes("Fontes"));
    assert.ok(html.includes("Gerar PDF"));
    assert.ok(html.includes("Maria Exemplo"));
    assert.equal(html.includes("12345678909"), false);
  });
});

describe("ExposurePage cases tab", () => {
  it("não renderiza polo literal e usa a lista executiva", () => {
    const pageSrc = readFileSync(join(process.cwd(), "src/components/legalExposure/ExposurePage.tsx"), "utf8");
    assert.match(pageSrc, /ExposureCaseList/);
    assert.equal(pageSrc.includes("polo {item.entityPole}"), false);
    assert.equal(/legal-exposure\/cases\?page=1&pageSize=20/.test(pageSrc), false);
  });
});
