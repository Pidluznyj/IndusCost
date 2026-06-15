import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildOtherCostNotes } from "./projectsOtherCostGroups.js";
import {
  buildProjectPricingView,
  computeProjectPricingItem,
  listProjectPricingEligibleTargets,
} from "./projectsPricing.js";
import { buildProjectExecutiveReport } from "./projectsExecutiveReport.js";
import { canManageProjects, canViewProjects } from "./projectsPermissions.js";
import type { ProjectDetail } from "@/src/types/projects.js";

const TAX_RULES = [
  {
    id: "tax-1",
    name: "Mercado Interno",
    description: "Regra padrão",
    taxPercent: 27.25,
  },
];

function buildDetailFixture(): ProjectDetail {
  const itemA = "aaaaaaaa-aaaa-4111-8111-aaaaaaaaaaaa";
  const moldId = "cccccccc-cccc-4111-8111-cccccccccccc";
  return {
    id: "dddddddd-dddd-4111-8111-dddddddddddd",
    code: "PRJ-0008",
    title: "IRIS",
    customerName: "Esmaltec S/A",
    customerDocument: null,
    description: null,
    projectType: "NEW_PRODUCT",
    status: "DRAFT",
    commercialOwner: null,
    technicalOwner: null,
    expectedMonthlyVolume: null,
    targetPrice: null,
    targetMarginPercent: 35,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    currentVersion: null,
    versions: [],
    simulatedProducts: [],
    simulatedItems: [
      {
        id: itemA,
        provisionalCode: "A",
        description: "Haste IRIS",
        itemType: "COMPONENT",
        unit: "UN",
        estimatedUnitCost: 1.30901,
        quotedUnitCost: null,
        supplierName: null,
        leadTimeDays: null,
        estimatedWeight: null,
        lossPercent: 0,
        requiresQuotation: false,
        requiresEngineeringReview: false,
        canBecomeOfficial: false,
        notes: "guided-origin:SIMULATION\nguided-simulation-id:11111111-1111-1111-1111-111111111111",
      },
      {
        id: "bbbbbbbb-bbbb-4111-8111-bbbbbbbbbbbb",
        provisionalCode: "B",
        description: "Torneira IRIS",
        itemType: "COMPONENT",
        unit: "UN",
        estimatedUnitCost: 8.5,
        quotedUnitCost: null,
        supplierName: null,
        leadTimeDays: null,
        estimatedWeight: null,
        lossPercent: 0,
        requiresQuotation: false,
        requiresEngineeringReview: false,
        canBecomeOfficial: false,
        notes: null,
      },
      {
        id: "mp1",
        provisionalCode: "MP-1",
        description: "Polímero",
        itemType: "RAW_MATERIAL",
        unit: "KG",
        estimatedUnitCost: 12,
        quotedUnitCost: null,
        supplierName: null,
        leadTimeDays: null,
        estimatedWeight: null,
        lossPercent: 0,
        requiresQuotation: false,
        requiresEngineeringReview: false,
        canBecomeOfficial: false,
        notes: null,
      },
    ],
    structureLines: [],
    molds: [
      {
        id: moldId,
        name: "Molde da Haste",
        moldType: "Novo",
        cavities: 1,
        estimatedLifeCycles: null,
        supplierName: null,
        constructionCost: 52000,
        maintenanceCost: null,
        changeCost: null,
        leadTimeDays: null,
        chargeMode: "CHARGED_SEPARATELY",
        amortizationQuantity: null,
        amortizedCostPerUnit: null,
        ownership: "UNDEFINED",
        notes: null,
      },
    ],
    snapshotRootProducts: {},
    costBreakdown: {
      rawMaterialCost: 0,
      componentCost: 9.80901,
      serviceCost: 0,
      packagingCost: 0,
      separateMoldCost: 52000,
      amortizedMoldCostPerUnit: 0,
      unitCost: 9.80901,
      targetMarginPercent: 35,
      suggestedPrice: null,
      markupPercent: null,
      targetPrice: null,
      priceGap: null,
    },
    alerts: [],
    conversionAvailable: false,
  };
}

describe("projectsPricing — integração", () => {
  it("aba Custos do Projeto exibe seção Precificação comercial", () => {
    const tab = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectGuidedCostsTab.tsx"),
      "utf8"
    );
    const section = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectPricingSection.tsx"),
      "utf8"
    );
    assert.match(tab, /ProjectPricingSection/);
    assert.match(section, /Precifica/);
  });

  it("lista apenas produtos/itens simulados raiz", () => {
    const targets = listProjectPricingEligibleTargets(buildDetailFixture());
    assert.equal(targets.length, 1);
    assert.equal(targets[0]?.displayName, "Haste IRIS");
  });

  it("não lista matérias-primas", () => {
    const view = buildProjectPricingView({
      detail: buildDetailFixture(),
      taxRules: TAX_RULES,
      config: { fiscalRuleId: "tax-1", defaultMarginPercent: 35 },
    });
    assert.equal(view.items.some((item) => item.displayName === "Polímero"), false);
  });

  it("não lista moldes", () => {
    const view = buildProjectPricingView({
      detail: buildDetailFixture(),
      taxRules: TAX_RULES,
      config: { fiscalRuleId: "tax-1", defaultMarginPercent: 35 },
    });
    assert.equal(view.items.some((item) => item.displayName.includes("Molde")), false);
  });

  it("não lista outros custos como itens precificáveis", () => {
    const detail = buildDetailFixture();
    detail.simulatedItems.push({
      id: "oc1",
      provisionalCode: null,
      description: "Try-out",
      itemType: "OTHER",
      unit: "UN",
      estimatedUnitCost: 2500,
      quotedUnitCost: 2500,
      supplierName: null,
      leadTimeDays: null,
      estimatedWeight: null,
      lossPercent: 0,
      requiresQuotation: false,
      requiresEngineeringReview: false,
      canBecomeOfficial: false,
      notes: buildOtherCostNotes("TEST", "batch-1"),
    });
    const view = buildProjectPricingView({
      detail,
      taxRules: TAX_RULES,
      config: { fiscalRuleId: "tax-1", defaultMarginPercent: 35 },
    });
    assert.equal(view.items.some((item) => item.displayName === "Try-out"), false);
  });

  it("usa custo final unitário com amortização", () => {
    const detail = buildDetailFixture();
    const view = buildProjectPricingView({
      detail,
      taxRules: TAX_RULES,
      config: { fiscalRuleId: "tax-1", defaultMarginPercent: 35 },
    });
    const item = view.items[0];
    assert.ok(item);
    const computed = computeProjectPricingItem(
      {
        targetItemId: item.targetItemId,
        targetItemType: item.targetItemType,
        displayName: item.displayName,
        baseUnitCost: 1.30901,
        unitAmortizedCost: 1.248,
        finalUnitCost: 2.55701,
      },
      {
        fiscalRuleId: "tax-1",
        fiscalRuleName: "Mercado Interno",
        taxPercent: 27.25,
        targetMarginPercent: 35,
      }
    );
    assert.equal(computed.finalUnitCost, 2.55701);
    assert.ok(computed.suggestedPrice != null && computed.suggestedPrice > computed.finalUnitCost);
  });

  it("usa margem padrão cadastrada no projeto", () => {
    const view = buildProjectPricingView({
      detail: buildDetailFixture(),
      taxRules: TAX_RULES,
      config: { fiscalRuleId: "tax-1", defaultMarginPercent: null },
    });
    assert.equal(view.config.defaultMarginPercent, 35);
    assert.equal(view.items[0]?.targetMarginPercent, 35);
  });

  it("carrega regras fiscais existentes", () => {
    const routes = readFileSync(join(process.cwd(), "src", "lib", "projectsRoutes.ts"), "utf8");
    assert.match(routes, /\/api\/projects\/:id\/pricing/);
    const service = readFileSync(
      join(process.cwd(), "src", "lib", "projectsPricingService.ts"),
      "utf8"
    );
    assert.match(service, /taxRule\.findMany/);
  });

  it("salva precificação dentro do projeto", () => {
    const service = readFileSync(
      join(process.cwd(), "src", "lib", "projectsPricingService.ts"),
      "utf8"
    );
    assert.match(service, /projectPricingConfig\.upsert/);
    assert.match(service, /projectPricingItem\.create/);
  });

  it("alterar margem recalcula preço", () => {
    const low = computeProjectPricingItem(
      {
        targetItemId: "a",
        targetItemType: "SIMULATION",
        displayName: "Item",
        baseUnitCost: 1.30901,
        unitAmortizedCost: 0,
        finalUnitCost: 1.30901,
      },
      { fiscalRuleId: "tax-1", fiscalRuleName: "MI", taxPercent: 27.25, targetMarginPercent: 20 }
    );
    const high = computeProjectPricingItem(
      {
        targetItemId: "a",
        targetItemType: "SIMULATION",
        displayName: "Item",
        baseUnitCost: 1.30901,
        unitAmortizedCost: 0,
        finalUnitCost: 1.30901,
      },
      { fiscalRuleId: "tax-1", fiscalRuleName: "MI", taxPercent: 27.25, targetMarginPercent: 35 }
    );
    assert.ok(low.suggestedPrice != null && high.suggestedPrice != null);
    assert.ok(high.suggestedPrice > low.suggestedPrice);
  });

  it("relatório gerencial exibe precificação quando salva", () => {
    const detail = buildDetailFixture();
    detail.projectPricing = {
      config: { fiscalRuleId: "tax-1", defaultMarginPercent: 35 },
      taxRules: TAX_RULES,
      hasSavedPricing: true,
      items: [
        {
          targetItemId: "aaaaaaaa-aaaa-4111-8111-aaaaaaaaaaaa",
          targetItemType: "SIMULATION",
          displayName: "Haste IRIS",
          costBaseUnit: 1.30901,
          amortizationUnitCost: 0,
          finalUnitCost: 1.30901,
          fiscalRuleId: "tax-1",
          fiscalRuleName: "Mercado Interno",
          taxPercent: 27.25,
          targetMarginPercent: 35,
          suggestedPrice: 3.468348,
          taxAmount: 0.944,
          marginAmount: 1.214,
          status: "CALCULATED",
          statusLabel: "Calculado",
          errorMessage: null,
        },
      ],
    };
    const report = buildProjectExecutiveReport(detail);
    assert.equal(report.economicAnalysis.pending, false);
    assert.ok(report.economicAnalysis.suggestedPrice != null);
    assert.equal(report.economicAnalysis.pricingItems.length, 1);
  });

  it("relatório gerencial mostra pendente quando não há precificação", () => {
    const report = buildProjectExecutiveReport(buildDetailFixture());
    assert.equal(report.economicAnalysis.pending, true);
    assert.match(report.economicAnalysis.message, /pendente/i);
  });

  it("usuário view não edita", () => {
    const section = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectPricingSection.tsx"),
      "utf8"
    );
    assert.match(section, /canManage/);
    assert.match(section, /disabled=\{!canManage\}/);
  });

  it("usuário manage edita", () => {
    const checker = (perms: string[]) => ({
      hasPermission: (p: string) => perms.includes(p),
      hasAnyPermission: (list: string[]) => list.some((p) => perms.includes(p)),
    });
    assert.equal(canViewProjects(checker(["projects.view"])), true);
    assert.equal(canManageProjects(checker(["projects.manage"])), true);
    assert.equal(canManageProjects(checker(["projects.view"])), false);
  });
});
