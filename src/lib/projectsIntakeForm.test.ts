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
  PROJECT_INTAKE_FORM_BLANK_PATH,
  PROJECT_INTAKE_FORM_BUTTON_LABEL,
  PROJECT_INTAKE_MINIMUM_FIELD_LABELS,
  PROJECT_INTAKE_FORM_PENDING_LABEL,
  PROJECT_INTAKE_FORM_TITLE,
} from "./projectsIntakeForm.js";
import type { ProjectDetail } from "@/src/types/projects.js";

const EXPECTED_SECTION_TITLES = [
  "1. Identificação do projeto",
  "2. Dados do cliente",
  "3. Classificação do projeto",
  "4. Objetivo técnico do projeto",
  "5. Produto ou componente a desenvolver",
  "6. Materiais e componentes",
  "7. Estrutura / BOM prevista",
  "8. Processo produtivo / HH",
  "9. Molde, ferramenta ou dispositivo",
  "10. Custos adicionais",
  "11. Volume, preço e condições comerciais",
  "12. Prazos e marcos do projeto",
  "13. Qualidade, testes e validações",
  "14. Documentos e anexos necessários",
  "15. Riscos e pendências",
  "16. Aprovação para seguir com o estudo",
];

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

function emptyDetail(): ProjectDetail {
  return {
    id: "eeeeeeee-eeee-4111-8111-eeeeeeeeeeee",
    code: "PRJ-EMPTY",
    title: "",
    customerName: null,
    customerDocument: null,
    description: null,
    projectType: "QUICK_ESTIMATE",
    status: "DRAFT",
    commercialOwner: null,
    technicalOwner: null,
    expectedMonthlyVolume: null,
    targetPrice: null,
    targetMarginPercent: null,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    currentVersion: null,
    versions: [],
    simulatedProducts: [],
    simulatedItems: [],
    structureLines: [],
    molds: [],
    snapshotRootProducts: {},
    costBreakdown: null,
    alerts: [],
    conversionAvailable: false,
  };
}

function assertNoInvalidNumbers(value: unknown, path = "root"): void {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `NaN/Infinity em ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoInvalidNumbers(item, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      assertNoInvalidNumbers(nested, `${path}.${key}`);
    }
  }
}

describe("projectsIntakeForm", () => {
  it("rotas da ficha de abertura", () => {
    assert.equal(getProjectIntakeFormPath("abc"), "/projects/abc/intake-form");
    assert.equal(getProjectIntakeFormPrintPath("abc"), "/projects/abc/intake-form/print");
    assert.equal(PROJECT_INTAKE_FORM_BLANK_PATH, "/projects/intake-form/blank");
    assert.equal(getBlankIntakeFormPrintPath(), "/projects/intake-form/blank/print");
    assert.equal(isProjectIntakeFormPath("/projects/abc/intake-form"), true);
    assert.equal(isBlankProjectIntakeFormPath("/projects/intake-form"), true);
    assert.equal(isBlankProjectIntakeFormPath("/projects/intake-form/blank"), true);
    assert.equal(isBlankProjectIntakeFormPath("/projects/intake-form/blank/print"), true);
    assert.equal(isBlankProjectIntakeFormPath("/projects/intake-form/print"), true);
    assert.equal(isBlankProjectIntakeFormPath("/projects/abc/intake-form"), false);
    assert.equal(parseProjectIntakeFormProjectId("/projects/abc/intake-form"), "abc");
    assert.equal(intakeFormPathRequestsPrint("/projects/abc/intake-form/print"), true);
  });

  it("formulário em branco contém 16 seções obrigatórias", () => {
    const payload = buildBlankProjectIntakeForm();
    assert.equal(payload.mode, "blank");
    assert.equal(payload.sections.length, 16);
    assert.deepEqual(
      payload.sections.map((s) => s.title),
      EXPECTED_SECTION_TITLES
    );
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
    for (const label of Object.values(PROJECT_INTAKE_MINIMUM_FIELD_LABELS)) {
      assert.ok(typeof label === "string" && label.length > 0);
    }
  });

  it("documento renderiza título e seções", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectIntakeFormDocument, {
        payload: buildBlankProjectIntakeForm(),
      })
    );
    assert.match(html, new RegExp(PROJECT_INTAKE_FORM_TITLE));
    for (const title of EXPECTED_SECTION_TITLES) {
      assert.match(html, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(html, /Dados mínimos pendentes/);
  });

  it("UI integrada referencia botão e rotas da ficha", () => {
    const app = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
    const module = readFileSync(join(process.cwd(), "src", "components", "ProjectsModule.tsx"), "utf8");
    const button = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectIntakeFormButton.tsx"),
      "utf8"
    );
    const controls = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectExecutiveReportPrintControls.tsx"),
      "utf8"
    );
    assert.match(app, /ProjectIntakeFormPage/);
    assert.match(app, /\/projects\/intake-form\/blank/);
    assert.match(app, /\/projects\/:projectId\/intake-form/);
    assert.match(module, /ProjectIntakeFormButton/);
    assert.match(button, /PROJECT_INTAKE_FORM_BUTTON_LABEL/);
    assert.equal(PROJECT_INTAKE_FORM_BUTTON_LABEL, "Imprimir Ficha de Abertura");
    assert.match(controls, /no-print/);
  });

  it("CSS de impressão oculta app shell e botões", () => {
    const css = readFileSync(join(process.cwd(), "src", "project-intake-form-print.css"), "utf8");
    assert.match(css, /project-intake-form-route/);
    assert.match(css, /A4 portrait/);
    assert.match(css, /@media print/);
    assert.match(css, /\.no-print/);
    assert.match(css, /aside/);
    assert.match(css, /header/);
  });

  it("renderiza projeto com dados incompletos sem NaN/Infinity", () => {
    const payload = buildProjectIntakeFormFromDetail(emptyDetail());
    const html = renderToStaticMarkup(
      React.createElement(ProjectIntakeFormDocument, { payload })
    );
    assert.match(html, /PRJ-EMPTY/);
    assert.match(html, new RegExp(PROJECT_INTAKE_FORM_PENDING_LABEL));
    assertNoInvalidNumbers(payload);
    assert.doesNotMatch(JSON.stringify(payload), /NaN|Infinity/);
  });

  it("não importa Prisma nem Proposal no frontend da ficha", () => {
    const lib = readFileSync(join(process.cwd(), "src", "lib", "projectsIntakeForm.ts"), "utf8");
    const page = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectIntakeFormPage.tsx"),
      "utf8"
    );
    const doc = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectIntakeFormDocument.tsx"),
      "utf8"
    );
    for (const source of [lib, page, doc]) {
      assert.doesNotMatch(source, /@prisma\/client|from ["'].*prisma/i);
      assert.doesNotMatch(source, /from ["'].*Proposal|import.*Proposal/);
    }
  });

  it("não altera produto oficial — apenas lê snapshot existente", () => {
    const lib = readFileSync(join(process.cwd(), "src", "lib", "projectsIntakeForm.ts"), "utf8");
    assert.doesNotMatch(lib, /updateProduct|createProduct|officialProduct.*=/i);
    assert.match(lib, /snapshotRootProducts/);
  });
});
