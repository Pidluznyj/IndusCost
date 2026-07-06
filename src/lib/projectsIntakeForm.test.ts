import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectIntakeQuickFormDocument } from "@/src/components/projects/ProjectIntakeQuickFormDocument";
import { ProjectIntakeFormDocument } from "@/src/components/projects/ProjectIntakeFormDocument";
import {
  buildBlankQuickIntakeForm,
  buildQuickIntakeFormFromDetail,
  countQuickFormSections,
  isQuickFormMoreCompactThanFull,
  PROJECT_INTAKE_QUICK_DELIVERABLES,
  PROJECT_INTAKE_QUICK_ESTIMATE_ITEMS,
  PROJECT_INTAKE_QUICK_FORM_SECTION_COUNT,
  PROJECT_INTAKE_QUICK_FORM_TITLE,
  PROJECT_INTAKE_QUICK_PROJECT_TYPES,
  PROJECT_INTAKE_QUICK_BUTTON_LABEL,
  PROJECT_INTAKE_FULL_BUTTON_LABEL,
  PROJECT_INTAKE_QUICK_STRUCTURE_SECTION_TITLE,
  PROJECT_INTAKE_QUICK_STRUCTURE_INSTRUCTION,
  PROJECT_INTAKE_QUICK_BLANK_STRUCTURE_ROW_COUNT,
  PROJECT_INTAKE_QUICK_STRUCTURE_TYPES,
  deliverableProductsFromDetail,
  structureRowsFromDetail,
} from "./projectsIntakeQuickForm.js";
import {
  buildBlankProjectIntakeForm,
  buildProjectIntakeFormFromDetail,
  getProjectIntakeFormFullPath,
  getProjectIntakeFormPath,
  isFullIntakeFormPath,
  isQuickIntakeFormPath,
  PROJECT_INTAKE_FORM_FULL_TITLE,
} from "./projectsIntakeForm.js";
import type { ProjectDetail, ProjectStructureLineRow } from "@/src/types/projects.js";

function structureLine(
  partial: Partial<ProjectStructureLineRow> & Pick<ProjectStructureLineRow, "id" | "lineType" | "descriptionSnapshot">
): ProjectStructureLineRow {
  return {
    simulatedProductId: null,
    parentLineId: null,
    level: null,
    treePath: null,
    snapshotRootProductId: null,
    sourceType: "MANUAL",
    existingProductId: null,
    existingMaterialId: null,
    simulatedItemId: null,
    sourceOfficialBomId: null,
    sourceOfficialRoutingId: null,
    unitSnapshot: "UN",
    quantity: 1,
    lossPercent: 0,
    officialQuantitySnapshot: null,
    officialLossPercentSnapshot: null,
    officialUnitCostSnapshot: null,
    unitCostSnapshot: 0,
    totalCost: 0,
    costSource: null,
    isChangedFromOfficial: false,
    isMissingCost: false,
    countsInSimulatedProductCost: true,
    supplierNameSnapshot: null,
    notes: null,
    sortOrder: 0,
    ...partial,
  };
}

function minimalDetail(): ProjectDetail {
  return {
    id: "dddddddd-dddd-4111-8111-dddddddddddd",
    code: "PRJ-0001",
    title: "Projeto Teste",
    customerName: "Cliente ABC",
    customerDocument: "12.345.678/0001-90",
    description: "Desenvolver novo filtro.",
    projectType: "NEW_PRODUCT",
    status: "DRAFT",
    commercialOwner: "Comercial 1",
    technicalOwner: "Engenharia 1",
    expectedMonthlyVolume: 1000,
    targetPrice: 25,
    targetMarginPercent: 30,
    notes: null,
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    currentVersion: null,
    versions: [],
    simulatedProducts: [
      {
        id: "prod-1",
        provisionalCode: "SKU-N",
        description: "Filtro Novo",
        unit: "UN",
        estimatedWeight: null,
        expectedVolume: null,
        batchSize: null,
        notes: null,
      },
    ],
    simulatedItems: [],
    structureLines: [],
    molds: [],
    snapshotRootProducts: {},
    costBreakdown: {
      rawMaterialCost: 0,
      componentCost: 0,
      serviceCost: 0,
      packagingCost: 0,
      separateMoldCost: 0,
      amortizedMoldCostPerUnit: 0,
      unitCost: 10,
      targetMarginPercent: 30,
      suggestedPrice: 14.29,
      markupPercent: 42.9,
      targetPrice: 25,
      priceGap: -10.71,
    },
    alerts: [],
    conversionAvailable: false,
  };
}

function multiProductDetail(): ProjectDetail {
  return {
    ...minimalDetail(),
    title: "Projeto Iris",
    simulatedProducts: [
      {
        id: "prod-1",
        provisionalCode: null,
        description: "Torneira X",
        unit: "UN",
        estimatedWeight: null,
        expectedVolume: null,
        batchSize: null,
        notes: null,
      },
      {
        id: "prod-2",
        provisionalCode: null,
        description: "Torneira Y",
        unit: "UN",
        estimatedWeight: null,
        expectedVolume: null,
        batchSize: null,
        notes: null,
      },
    ],
    structureLines: [
      structureLine({
        id: "l1",
        simulatedProductId: "prod-1",
        parentLineId: null,
        level: 1,
        lineType: "COMPONENT",
        descriptionSnapshot: "Haste",
        sortOrder: 1,
      }),
      structureLine({
        id: "l2",
        simulatedProductId: "prod-1",
        parentLineId: "l1",
        level: 2,
        lineType: "RAW_MATERIAL",
        descriptionSnapshot: "ABS",
        unitSnapshot: "KG",
        quantity: 0.08,
        sortOrder: 2,
      }),
      structureLine({
        id: "l3",
        simulatedProductId: "prod-1",
        parentLineId: "l1",
        level: 2,
        lineType: "SERVICE",
        descriptionSnapshot: "Injeção",
        unitSnapshot: "UN",
        quantity: 1,
        sortOrder: 3,
      }),
      structureLine({
        id: "l4",
        simulatedProductId: "prod-2",
        parentLineId: null,
        level: 1,
        lineType: "COMPONENT",
        descriptionSnapshot: "Haste nova",
        sortOrder: 1,
      }),
      structureLine({
        id: "l5",
        simulatedProductId: "prod-2",
        parentLineId: null,
        level: 1,
        lineType: "PACKAGING",
        descriptionSnapshot: "Embalagem",
        sortOrder: 2,
      }),
    ],
  };
}

describe("projectsIntakeQuickForm", () => {
  it("ficha rápida possui tipo de projeto com checkboxes", () => {
    const payload = buildBlankQuickIntakeForm();
    assert.equal(payload.projectTypes.length, PROJECT_INTAKE_QUICK_PROJECT_TYPES.length);
    const html = renderToStaticMarkup(React.createElement(ProjectIntakeQuickFormDocument, { payload }));
    assert.match(html, /Tipo de projeto/);
    assert.match(html, /Produto novo/);
    assert.match(html, /project-intake-quick-checkbox-box/);
  });

  it("ficha rápida possui lista de entregáveis", () => {
    const payload = buildBlankQuickIntakeForm();
    assert.equal(payload.deliverables.length, PROJECT_INTAKE_QUICK_DELIVERABLES.length);
    const html = renderToStaticMarkup(React.createElement(ProjectIntakeQuickFormDocument, { payload }));
    assert.match(html, /Entregáveis esperados/);
    assert.match(html, /Estimativa de custo/);
  });

  it('ficha rápida possui seção "O que precisa estimar"', () => {
    const payload = buildQuickIntakeFormFromDetail(minimalDetail());
    assert.equal(payload.estimateItems.length, PROJECT_INTAKE_QUICK_ESTIMATE_ITEMS.length);
    const html = renderToStaticMarkup(React.createElement(ProjectIntakeQuickFormDocument, { payload }));
    assert.match(html, /O que precisa estimar/);
    assert.match(html, /Matéria-prima/);
  });

  it("ficha rápida usa seção Estrutura preliminar / BOM do projeto", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectIntakeQuickFormDocument, { payload: buildBlankQuickIntakeForm() })
    );
    assert.match(html, new RegExp(PROJECT_INTAKE_QUICK_STRUCTURE_SECTION_TITLE));
    assert.match(html, /5\.1 Produtos \/ entregáveis do projeto/);
    assert.match(html, /5\.2 Estrutura \/ composição preliminar/);
    assert.match(html, /Item pai/);
    assert.match(html, /Produto\/Entregável/);
    assert.match(html, /Qtde por un\./);
    assert.match(html, /Hrs\/Qtde serviço/);
    assert.match(html, /Use uma linha por item da estrutura/);
  });

  it("ficha rápida não possui seção separada Processos / HH", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectIntakeQuickFormDocument, { payload: buildBlankQuickIntakeForm() })
    );
    assert.doesNotMatch(html, /7\. Processos \/ HH/);
    assert.doesNotMatch(html, /Valor hora/);
  });

  it("ficha rápida possui 8 seções numeradas de 1 a 8", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectIntakeQuickFormDocument, { payload: buildBlankQuickIntakeForm() })
    );
    assert.match(html, /1\. Tipo de projeto/);
    assert.match(html, /2\. Entregáveis esperados/);
    assert.match(html, /3\. Dados do item\/produto/);
    assert.match(html, /4\. O que precisa estimar/);
    assert.match(html, /5\. Estrutura preliminar \/ BOM do projeto/);
    assert.match(html, /6\. Molde \/ ferramenta/);
    assert.match(html, /7\. Pendências para estimar/);
    assert.match(html, /8\. Decisão inicial/);
    assert.doesNotMatch(html, /9\. Decisão inicial/);
    assert.equal(countQuickFormSections(buildBlankQuickIntakeForm()), PROJECT_INTAKE_QUICK_FORM_SECTION_COUNT);
  });

  it("estrutura preliminar possui tipos incluindo Serviço", () => {
    assert.ok(PROJECT_INTAKE_QUICK_STRUCTURE_TYPES.includes("Serviço"));
  });

  it("ficha em branco traz linhas vazias sem Produto 1/Produto 2 preenchidos", () => {
    const payload = buildBlankQuickIntakeForm();
    assert.equal(payload.structureRows.length, PROJECT_INTAKE_QUICK_BLANK_STRUCTURE_ROW_COUNT);
    assert.ok(payload.structureRows.every((row) => !row.productDeliverable?.trim()));
    assert.ok(payload.structureRows.every((row) => !row.type?.trim()));
    assert.ok(payload.deliverableProducts.every((row) => !row.name?.trim()));
    const html = renderToStaticMarkup(React.createElement(ProjectIntakeQuickFormDocument, { payload }));
    assert.doesNotMatch(html, /Produto 1/);
    assert.doesNotMatch(html, /Produto 2/);
  });

  it("ficha preenchida lista produtos em 5.1 e agrupa estrutura por entregável", () => {
    const detail = multiProductDetail();
    const products = deliverableProductsFromDetail(detail);
    assert.equal(products.length, 2);
    assert.equal(products[0]?.name, "Torneira X");
    assert.equal(products[1]?.name, "Torneira Y");

    const rows = structureRowsFromDetail(detail);
    const groups = [...new Set(rows.map((r) => r.productDeliverable))];
    assert.deepEqual(groups, ["Torneira X", "Torneira Y"]);
    assert.ok(rows.filter((r) => r.productDeliverable === "Torneira X").some((r) => r.level === 0 && r.type === "Produto"));
  });

  it("produto com componente, MP e serviço aparece com item pai e níveis", () => {
    const rows = structureRowsFromDetail(multiProductDetail()).filter((r) => r.productDeliverable === "Torneira X");
    const haste = rows.find((r) => r.description === "Haste");
    const abs = rows.find((r) => r.description === "ABS");
    assert.ok(haste);
    assert.equal(haste.level, 1);
    assert.equal(haste.parentItem, "Torneira X");
    assert.ok(abs);
    assert.equal(abs.level, 2);
    assert.equal(abs.parentItem, "Haste");
    assert.ok(rows.some((r) => r.type === "Serviço" && r.description === "Injeção"));
  });

  it("serviço manual com horas usa Hrs/Qtde serviço sem valor hora obrigatório", () => {
    const detail = {
      ...minimalDetail(),
      structureLines: [
        structureLine({
          id: "svc-1",
          simulatedProductId: "prod-1",
          parentLineId: null,
          level: 1,
          lineType: "PROCESS",
          descriptionSnapshot: "Usinagem",
          unitSnapshot: "HH",
          quantity: 20,
          unitCostSnapshot: 85,
          sortOrder: 1,
        }),
      ],
    };
    const rows = structureRowsFromDetail(detail);
    const service = rows.find((r) => r.description === "Usinagem");
    assert.ok(service);
    assert.equal(service.type, "Serviço");
    assert.equal(service.unit, "H");
    assert.equal(service.serviceHours, "20");
    assert.equal(service.quantityPerUnit, null);
    assert.equal(service.estimatedCost, null);
  });

  it("ficha rápida possui molde/ferramenta simples", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectIntakeQuickFormDocument, { payload: buildBlankQuickIntakeForm() })
    );
    assert.match(html, /Molde \/ ferramenta/);
    assert.match(html, /Amortizar no preço/);
  });

  it("ficha rápida possui pendências", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectIntakeQuickFormDocument, { payload: buildBlankQuickIntakeForm() })
    );
    assert.match(html, /Pendências para estimar/);
    assert.match(html, /Falta desenho técnico/);
  });

  it("ficha rápida possui decisão inicial", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectIntakeQuickFormDocument, { payload: buildBlankQuickIntakeForm() })
    );
    assert.match(html, /Decisão inicial/);
    assert.match(html, /Pode estimar com os dados atuais/);
    assert.match(html, /Comercial:/);
  });

  it("ficha rápida é mais objetiva que a ficha completa", () => {
    const quick = buildBlankQuickIntakeForm();
    const full = buildBlankProjectIntakeForm();
    assert.ok(isQuickFormMoreCompactThanFull(countQuickFormSections(quick), full.sections.length));
    assert.equal(full.sections.length, 16);
    assert.equal(countQuickFormSections(quick), 8);
  });

  it("rotas quick vs full", () => {
    assert.equal(getProjectIntakeFormPath("abc"), "/projects/abc/intake-form");
    assert.equal(getProjectIntakeFormFullPath("abc"), "/projects/abc/intake-form/full");
    assert.equal(isQuickIntakeFormPath("/projects/abc/intake-form"), true);
    assert.equal(isFullIntakeFormPath("/projects/abc/intake-form/full"), true);
    assert.equal(isQuickIntakeFormPath("/projects/abc/intake-form/full"), false);
  });

  it("UI integrada com ficha rápida como principal", () => {
    const app = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
    const actions = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectIntakeActions.tsx"),
      "utf8"
    );
    assert.match(app, /intake-form\/full/);
    assert.match(actions, /PROJECT_INTAKE_QUICK_BUTTON_LABEL/);
    assert.match(actions, /PROJECT_INTAKE_FULL_BUTTON_LABEL/);
    assert.equal(PROJECT_INTAKE_QUICK_BUTTON_LABEL, "Ficha rápida");
    assert.equal(PROJECT_INTAKE_FULL_BUTTON_LABEL, "Ficha completa");
    assert.equal(PROJECT_INTAKE_QUICK_FORM_TITLE, "Ficha Rápida de Estimativa do Projeto");
    assert.equal(PROJECT_INTAKE_FORM_FULL_TITLE, "Ficha Completa de Abertura de Projeto");
  });

  it("ficha completa permanece disponível com 16 seções", () => {
    const full = buildProjectIntakeFormFromDetail(minimalDetail());
    assert.equal(full.sections.length, 16);
    const html = renderToStaticMarkup(React.createElement(ProjectIntakeFormDocument, { payload: full }));
    assert.match(html, /Identificação do projeto/);
    assert.match(html, /Aprovação para seguir com o estudo/);
  });

  it("CSS print e no-print para ficha rápida", () => {
    const css = readFileSync(join(process.cwd(), "src", "project-intake-form-print.css"), "utf8");
    assert.match(css, /project-intake-quick-form-document/);
    assert.match(css, /project-intake-quick-structure-table/);
    assert.match(css, /\.no-print/);
    assert.match(css, /A4 portrait/);
  });

  it("não importa Prisma nem Proposal no frontend", () => {
    const quick = readFileSync(join(process.cwd(), "src", "lib", "projectsIntakeQuickForm.ts"), "utf8");
    const doc = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectIntakeQuickFormDocument.tsx"),
      "utf8"
    );
    for (const source of [quick, doc]) {
      assert.doesNotMatch(source, /@prisma\/client|from ["'].*prisma/i);
      assert.doesNotMatch(source, /from ["'].*Proposal|import.*Proposal/);
    }
  });
});
