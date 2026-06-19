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
  PROJECT_INTAKE_QUICK_FORM_TITLE,
  PROJECT_INTAKE_QUICK_PROJECT_TYPES,
  PROJECT_INTAKE_QUICK_BUTTON_LABEL,
  PROJECT_INTAKE_FULL_BUTTON_LABEL,
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
import type { ProjectDetail } from "@/src/types/projects.js";

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

  it("ficha rápida possui composição preliminar simples", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectIntakeQuickFormDocument, { payload: buildBlankQuickIntakeForm() })
    );
    assert.match(html, /Composição preliminar/);
    assert.match(html, /Tipo/);
  });

  it("ficha rápida possui molde/ferramenta simples", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectIntakeQuickFormDocument, { payload: buildBlankQuickIntakeForm() })
    );
    assert.match(html, /Molde \/ ferramenta/);
    assert.match(html, /Amortizar no preço/);
  });

  it("ficha rápida possui processos/HH simples", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectIntakeQuickFormDocument, { payload: buildBlankQuickIntakeForm() })
    );
    assert.match(html, /Processos \/ HH/);
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
    assert.equal(countQuickFormSections(quick), 10);
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
