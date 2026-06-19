import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectIntakeFormDocument } from "@/src/components/projects/ProjectIntakeFormDocument";
import {
  buildBlankProjectIntakeForm,
  buildProjectIntakeFormFromDetail,
  getBlankIntakeFormPrintPath,
  getProjectIntakeFormPath,
  getProjectIntakeFormPrintPath,
  intakeFormPathRequestsPrint,
  isBlankProjectIntakeFormPath,
  isProjectIntakeFormPath,
  listIntakeFormPendingMinimumFields,
  parseProjectIntakeFormProjectId,
  PROJECT_INTAKE_FORM_BUTTON_LABEL,
  PROJECT_INTAKE_FORM_TITLE,
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

describe("projectsIntakeForm", () => {
  it("rotas da ficha de abertura", () => {
    assert.equal(getProjectIntakeFormPath("abc"), "/projects/abc/intake-form");
    assert.equal(getProjectIntakeFormPrintPath("abc"), "/projects/abc/intake-form/print");
    assert.equal(getBlankIntakeFormPrintPath(), "/projects/intake-form/print");
    assert.equal(isProjectIntakeFormPath("/projects/abc/intake-form"), true);
    assert.equal(isBlankProjectIntakeFormPath("/projects/intake-form"), true);
    assert.equal(parseProjectIntakeFormProjectId("/projects/abc/intake-form"), "abc");
    assert.equal(intakeFormPathRequestsPrint("/projects/abc/intake-form/print"), true);
  });

  it("formulário em branco contém 16 seções", () => {
    const payload = buildBlankProjectIntakeForm();
    assert.equal(payload.mode, "blank");
    assert.equal(payload.sections.length, 16);
    assert.ok(payload.pendingMinimumFields.length > 0);
    assert.equal(payload.canAdvanceBeyondDraft, false);
  });

  it("formulário preenchido usa dados do projeto", () => {
    const payload = buildProjectIntakeFormFromDetail(minimalDetail());
    assert.equal(payload.mode, "prefilled");
    assert.equal(payload.header.projectCode, "PRJ-0001");
    assert.equal(payload.header.projectName, "Projeto Teste");
    assert.equal(payload.header.customerName, "Cliente ABC");
    const identification = payload.sections.find((s) => s.id === "identification");
    assert.ok(identification?.fields.some((f) => f.key === "projectName" && f.value === "Projeto Teste"));
    const productSection = payload.sections.find((s) => s.id === "product");
    assert.ok(productSection?.fields.some((f) => f.key === "productName" && f.value === "Filtro Novo"));
  });

  it("lista campos mínimos pendentes", () => {
    const pendingBlank = listIntakeFormPendingMinimumFields(null);
    assert.ok(pendingBlank.includes("Nome do projeto"));
    const pendingPartial = listIntakeFormPendingMinimumFields(minimalDetail());
    assert.ok(!pendingPartial.includes("Nome do projeto"));
    assert.ok(pendingPartial.includes("Prazo esperado para orçamento"));
  });

  it("documento renderiza título e seções", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectIntakeFormDocument, {
        payload: buildBlankProjectIntakeForm(),
      })
    );
    assert.match(html, new RegExp(PROJECT_INTAKE_FORM_TITLE));
    assert.match(html, /Identificação do projeto/);
    assert.match(html, /Aprovação para seguir com o estudo/);
    assert.match(html, /Dados mínimos pendentes/);
  });

  it("UI integrada referencia botão da ficha", () => {
    const app = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
    const module = readFileSync(join(process.cwd(), "src", "components", "ProjectsModule.tsx"), "utf8");
    const button = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectIntakeFormButton.tsx"),
      "utf8"
    );
    assert.match(app, /ProjectIntakeFormPage/);
    assert.match(app, /\/projects\/intake-form/);
    assert.match(module, /ProjectIntakeFormButton/);
    assert.match(button, /PROJECT_INTAKE_FORM_BUTTON_LABEL/);
  });

  it("CSS de impressão da ficha existe", () => {
    const css = readFileSync(join(process.cwd(), "src", "project-intake-form-print.css"), "utf8");
    assert.match(css, /project-intake-form-route/);
    assert.match(css, /A4 portrait/);
  });
});
