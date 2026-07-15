import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildOtherCostNotes } from "./projectsOtherCostGroups.js";
import {
  buildProjectAmortizationTargets,
  buildProjectCostAmortizationSummary,
  computeAmortizationConfig,
  type ProjectCostAmortizationRow,
} from "./projectsCostAmortization.js";
import { calculateSalePriceFromCost } from "./pricingCalculations.js";
import {
  buildProjectPricingView,
  buildProjectCommercialPricingSummary,
  computeLiveProjectPricingView,
  computeProjectPricingItem,
  listProjectPricingEligibleTargets,
  resolveProjectCommercialPricingWeights,
  resolveProjectPricingItemCosts,
} from "./projectsPricing.js";
import { resolveProjectCostFinalUnitPrice } from "./projectsCostSnapshot.js";
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

const MANGOTE_BASE = 0.164381;
const MANGOTE_AMORT = 0.46;

function buildMangoteAmortizationRows(detail: ProjectDetail): ProjectCostAmortizationRow[] {
  const itemId = detail.simulatedItems[0]!.id;
  const mold = detail.molds[0]!;
  const targets = buildProjectAmortizationTargets(detail);
  const computed = computeAmortizationConfig(
    {
      sourceType: "MOLD",
      sourceId: mold.id,
      sourceDescriptionSnapshot: mold.name,
      sourceTotalCostSnapshot: 46_000,
      passThroughPercent: 100,
      allocations: [
        {
          targetItemId: itemId,
          targetItemType: "SIMULATION",
          targetDescriptionSnapshot: "Mangote mini Iris",
          targetBaseUnitCostSnapshot: MANGOTE_BASE,
          allocationPercent: 100,
          amortizationQuantity: 100_000,
        },
      ],
    },
    targets
  );
  return [{ id: "amort-mangote", projectId: detail.id, ...computed }];
}

function buildMangoteDetailFixture(): ProjectDetail {
  const itemId = "aaaaaaaa-aaaa-4111-8111-aaaaaaaaaaaa";
  const moldId = "cccccccc-cccc-4111-8111-cccccccccccc";
  const detail: ProjectDetail = {
    ...buildDetailFixture(),
    simulatedItems: [
      {
        id: itemId,
        provisionalCode: "MNG",
        description: "Mangote mini Iris",
        itemType: "COMPONENT",
        unit: "UN",
        estimatedUnitCost: MANGOTE_BASE,
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
    ],
    molds: [
      {
        id: moldId,
        name: "24 Machos para o molde",
        moldType: "Novo",
        cavities: 1,
        estimatedLifeCycles: null,
        supplierName: null,
        constructionCost: 46_000,
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
  };
  const amortizations = buildMangoteAmortizationRows(detail);
  return {
    ...detail,
    costAmortizations: amortizations,
    costAmortizationSummary: buildProjectCostAmortizationSummary(detail, amortizations),
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
    const detail = buildMangoteDetailFixture();
    const rollup = detail.costAmortizationSummary!.itemRollups[0]!;
    const view = buildProjectPricingView({
      detail,
      taxRules: TAX_RULES,
      config: { fiscalRuleId: "tax-1", defaultMarginPercent: 35 },
    });
    const item = view.items[0];
    assert.ok(item);
    assert.equal(item.displayName, "Mangote mini Iris");
    assert.equal(item.costBaseUnit, rollup.baseUnitCost);
    assert.equal(item.amortizationUnitCost, rollup.unitAmortizedCost);
    assert.equal(item.finalUnitCost, rollup.finalUnitCost);
    assert.ok(item.suggestedPrice != null && item.suggestedPrice > item.finalUnitCost);
  });

  it("não usa apenas custo base quando existe amortização", () => {
    const detail = buildMangoteDetailFixture();
    const view = buildProjectPricingView({
      detail,
      taxRules: TAX_RULES,
      config: { fiscalRuleId: "tax-1", defaultMarginPercent: 35 },
    });
    const item = view.items[0]!;
    assert.notEqual(item.finalUnitCost, item.costBaseUnit);
    assert.ok(item.amortizationUnitCost > 0);
  });

  it("Mangote mini Iris — preço calculado sobre custo final com amortização", () => {
    const detail = buildMangoteDetailFixture();
    const rollup = detail.costAmortizationSummary!.itemRollups[0]!;
    const view = buildProjectPricingView({
      detail,
      taxRules: TAX_RULES,
      config: { fiscalRuleId: "tax-1", defaultMarginPercent: 35 },
    });
    const item = view.items[0]!;
    const expected = calculateSalePriceFromCost({
      cost: rollup.finalUnitCost,
      taxPercent: 27.25,
      targetMarginPercent: 35,
    });
    assert.equal(expected.ok, true);
    if (!expected.ok) return;
    assert.equal(item.suggestedPrice, expected.suggestedPrice);
    assert.ok(item.suggestedPrice! > rollup.finalUnitCost);
  });

  it("composição usa amortização unitária e custo final = base + amortização", () => {
    const detail = buildMangoteDetailFixture();
    const rollup = detail.costAmortizationSummary!.itemRollups[0]!;
    const costs = resolveProjectPricingItemCosts(
      { targetItemId: "a", baseUnitCost: rollup.baseUnitCost },
      rollup
    );
    const item = computeProjectPricingItem(
      {
        targetItemId: "a",
        targetItemType: "SIMULATION",
        displayName: "Mangote mini Iris",
        baseUnitCost: costs.costBaseUnit,
        unitAmortizedCost: costs.amortizationUnitCost,
        finalUnitCost: costs.pricingCost,
      },
      {
        fiscalRuleId: "tax-1",
        fiscalRuleName: "Mercado Interno",
        taxPercent: 27.25,
        targetMarginPercent: 35,
      }
    );
    assert.equal(item.amortizationUnitCost, rollup.unitAmortizedCost);
    assert.equal(item.finalUnitCost, rollup.finalUnitCost);
    assert.ok(item.amortizationUnitCost > 0);
    assert.ok(item.finalUnitCost > item.costBaseUnit);
  });

  it("preço sugerido é calculado sobre custo final com amortização", () => {
    const detail = buildMangoteDetailFixture();
    const rollup = detail.costAmortizationSummary!.itemRollups[0]!;
    const item = computeProjectPricingItem(
      {
        targetItemId: "a",
        targetItemType: "SIMULATION",
        displayName: "Mangote mini Iris",
        baseUnitCost: rollup.baseUnitCost,
        unitAmortizedCost: rollup.unitAmortizedCost,
        finalUnitCost: rollup.finalUnitCost,
      },
      {
        fiscalRuleId: "tax-1",
        fiscalRuleName: "MI",
        taxPercent: 27.25,
        targetMarginPercent: 35,
      }
    );
    const withoutExpected = calculateSalePriceFromCost({
      cost: rollup.baseUnitCost,
      taxPercent: 27.25,
      targetMarginPercent: 35,
    });
    const withExpected = calculateSalePriceFromCost({
      cost: rollup.finalUnitCost,
      taxPercent: 27.25,
      targetMarginPercent: 35,
    });
    assert.equal(withoutExpected.ok, true);
    assert.equal(withExpected.ok, true);
    if (!withoutExpected.ok || !withExpected.ok) return;
    assert.equal(item.suggestedPriceWithoutAmortization, withoutExpected.suggestedPrice);
    assert.equal(item.suggestedPriceWithAmortization, withExpected.suggestedPrice);
    assert.equal(item.suggestedPrice, withExpected.suggestedPrice);
    assert.ok(item.suggestedPriceWithAmortization! > item.suggestedPriceWithoutAmortization!);
  });

  it("amortização zero deixa os dois preços iguais", () => {
    const item = computeProjectPricingItem(
      {
        targetItemId: "a",
        targetItemType: "SIMULATION",
        displayName: "Item",
        baseUnitCost: 1.30901,
        unitAmortizedCost: 0,
        finalUnitCost: 1.30901,
      },
      {
        fiscalRuleId: "tax-1",
        fiscalRuleName: "MI",
        taxPercent: 27.25,
        targetMarginPercent: 35,
      }
    );
    assert.equal(item.suggestedPriceWithoutAmortization, item.suggestedPriceWithAmortization);
  });

  it("ProjectPricingSection exibe preço s/ e c/ amortização", () => {
    const section = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectPricingSection.tsx"),
      "utf8"
    );
    assert.match(section, /Preço s\/ amortização/);
    assert.match(section, /Preço c\/ amortização/);
    assert.match(section, /suggestedPriceWithoutAmortization/);
    assert.match(section, /suggestedPriceWithAmortization/);
    assert.match(section, /Cenário sem amortização/);
    assert.match(section, /Cenário com amortização/);
    assert.match(section, /amortizationPriceAddOnUnit|Repasse no preço/);
  });

  it("snapshot salvo persiste preço sem e com amortização", () => {
    const service = readFileSync(
      join(process.cwd(), "src", "lib", "projectsPricingService.ts"),
      "utf8"
    );
    assert.match(service, /suggestedPriceWithoutAmortization/);
    assert.match(service, /taxAmountWithoutAmortization/);
    assert.match(service, /marginAmountWithoutAmortization/);
  });

  it("consome detail.costAmortizations quando savedAmortizations não é passado", () => {
    const detail = buildMangoteDetailFixture();
    const view = buildProjectPricingView({
      detail,
      taxRules: TAX_RULES,
      config: { fiscalRuleId: "tax-1", defaultMarginPercent: 35 },
    });
    assert.equal(view.items[0]?.amortizationUnitCost, MANGOTE_AMORT);
  });

  it("ProjectPricingSection usa motor vivo com amortizações do projeto", () => {
    const section = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectPricingSection.tsx"),
      "utf8"
    );
    assert.match(section, /computeLiveProjectPricingView/);
  });

  it("item sem amortização continua usando custo base", () => {
    const detail = buildDetailFixture();
    const view = buildProjectPricingView({
      detail,
      taxRules: TAX_RULES,
      config: { fiscalRuleId: "tax-1", defaultMarginPercent: 35 },
    });
    const item = view.items[0]!;
    assert.equal(item.amortizationUnitCost, 0);
    assert.equal(item.finalUnitCost, item.costBaseUnit);
  });

  it("computeProjectPricingItem usa finalUnitCost no cálculo do preço", () => {
    const computed = computeProjectPricingItem(
      {
        targetItemId: "a",
        targetItemType: "SIMULATION",
        displayName: "Haste IRIS",
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

  it("snapshot salvo preserva base, amortização e custo final separadamente", () => {
    const service = readFileSync(
      join(process.cwd(), "src", "lib", "projectsPricingService.ts"),
      "utf8"
    );
    assert.match(service, /costBaseUnitSnapshot: item\.costBaseUnit/);
    assert.match(service, /amortizationUnitCostSnapshot: item\.amortizationUnitCost/);
    assert.match(service, /finalUnitCostSnapshot: item\.finalUnitCost/);
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
    assert.match(service, /agreedCustomerPrice/);
  });

  it("UI tem coluna Preço acordado cliente no lugar de Status", () => {
    const section = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectPricingSection.tsx"),
      "utf8"
    );
    assert.match(section, /Preço acordado cliente/);
    assert.match(section, /agreedCustomerPrice/);
    assert.doesNotMatch(section, />Status</);
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
    const detail = buildMangoteDetailFixture();
    const priced = buildProjectPricingView({
      detail,
      taxRules: TAX_RULES,
      config: { fiscalRuleId: "tax-1", defaultMarginPercent: 35 },
    });
    const pricedItem = priced.items[0]!;
    const rollup = detail.costAmortizationSummary!.itemRollups[0]!;
    detail.projectPricing = {
      config: { fiscalRuleId: "tax-1", defaultMarginPercent: 35 },
      taxRules: TAX_RULES,
      hasSavedPricing: true,
      items: priced.items,
    };
    const report = buildProjectExecutiveReport(detail);
    const liveItem = computeLiveProjectPricingView(detail).items[0]!;
    assert.equal(report.economicAnalysis.pending, false);
    assert.ok(report.economicAnalysis.suggestedPrice != null);
    assert.equal(report.economicAnalysis.pricingItems.length, 1);
    assert.equal(report.economicAnalysis.pricingItems[0]?.finalUnitCost, rollup.finalUnitCost);
    assert.ok(liveItem.suggestedPriceWithAmortization != null);
    assert.ok(
      Math.abs(
        (report.economicAnalysis.pricingItems[0]?.suggestedPriceWithAmortization ?? 0) -
          liveItem.suggestedPriceWithAmortization!
      ) < 0.01
    );
    assert.equal(
      report.economicAnalysis.suggestedPrice,
      report.economicAnalysis.portfolio.totalRevenueWithAmortization
    );
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

  it("buildProjectCommercialPricingSummary agrega itens calculados sem zerar", () => {
    const detail = buildMangoteDetailFixture();
    const view = buildProjectPricingView({
      detail,
      taxRules: TAX_RULES,
      config: { fiscalRuleId: "tax-1", defaultMarginPercent: 35 },
    });
    const summary = buildProjectCommercialPricingSummary({
      items: view.items,
      weightsByTargetId: resolveProjectCommercialPricingWeights(detail),
      defaultMarginPercent: 35,
    });
    assert.equal(summary.isEmpty, false);
    assert.ok(summary.averageFinalUnitCost != null && summary.averageFinalUnitCost > 0);
    assert.ok(
      summary.averageSuggestedPriceWithAmortization != null &&
        summary.averageSuggestedPriceWithAmortization > 0
    );
    assert.ok(
      summary.averageSuggestedPriceWithoutAmortization != null &&
        summary.averageSuggestedPriceWithoutAmortization > 0
    );
    assert.equal(summary.pendingItems, 0);
    assert.equal(summary.calculatedItems, view.items.length);
  });

  it("amortização zero deixa preços médios iguais", () => {
    const view = buildProjectPricingView({
      detail: buildDetailFixture(),
      taxRules: TAX_RULES,
      config: { fiscalRuleId: "tax-1", defaultMarginPercent: 35 },
    });
    const summary = buildProjectCommercialPricingSummary({
      items: view.items,
      defaultMarginPercent: 35,
    });
    assert.equal(
      summary.averageSuggestedPriceWithoutAmortization,
      summary.averageSuggestedPriceWithAmortization
    );
  });

  it("média ponderada usa quantidade sugerida quando volumes diferem", () => {
    const detail = buildMangoteDetailFixture();
    detail.simulatedProducts = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        provisionalCode: "P1",
        description: "Produto",
        expectedVolume: 1000,
        batchSize: null,
        notes: null,
      },
    ];
    const item = computeProjectPricingItem(
      {
        targetItemId: detail.simulatedItems[0]!.id,
        targetItemType: "SIMULATION",
        displayName: "Mangote mini Iris",
        baseUnitCost: 1,
        unitAmortizedCost: 0.5,
        finalUnitCost: 1.5,
      },
      {
        fiscalRuleId: "tax-1",
        fiscalRuleName: "MI",
        taxPercent: 10,
        targetMarginPercent: 20,
      }
    );
    const itemB = computeProjectPricingItem(
      {
        targetItemId: "other-item",
        targetItemType: "SIMULATION",
        displayName: "Outro",
        baseUnitCost: 2,
        unitAmortizedCost: 0,
        finalUnitCost: 2,
      },
      {
        fiscalRuleId: "tax-1",
        fiscalRuleName: "MI",
        taxPercent: 10,
        targetMarginPercent: 20,
      }
    );
    const weighted = buildProjectCommercialPricingSummary({
      items: [item, itemB],
      weightsByTargetId: new Map([
        [item.targetItemId, 1000],
        [itemB.targetItemId, 1],
      ]),
    });
    const simple = buildProjectCommercialPricingSummary({
      items: [item, itemB],
    });
    assert.equal(weighted.aggregationMode, "weighted");
    assert.equal(simple.aggregationMode, "simple");
    assert.notEqual(weighted.averageFinalUnitCost, simple.averageFinalUnitCost);
  });

  it("ProjectGuidedCostsTab não usa costBreakdown legado nos cards finais", () => {
    const tab = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectGuidedCostsTab.tsx"),
      "utf8"
    );
    assert.doesNotMatch(tab, /Custo MP \(unitário\)/);
    assert.match(tab, /ProjectPricingSection/);
    const section = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectPricingSection.tsx"),
      "utf8"
    );
    assert.match(section, /ProjectCommercialPricingSummaryCards/);
    assert.match(section, /buildProjectCommercialPricingSummary/);
  });
});
