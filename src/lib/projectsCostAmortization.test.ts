import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  amortizationMetricsAreFinite,
  amortizationStatusLabel,
  buildProjectAmortizationTargets,
  buildProjectCostAmortizationSummary,
  calculateAmortizationAllocation,
  calculatePassThroughAmounts,
  computeAmortizationConfig,
  isAmortizationUuid,
  listAmortizableCostSources,
  resolveAmortizationDistributionStatus,
  validateAmortizationSourceRef,
} from "./projectsCostAmortization.js";
import {
  removeAmortizationAllocationsForTargetItem,
  validateUpsertAmortizationPayload,
} from "./projectsCostAmortizationService.js";
import { canManageProjects, canViewProjects } from "./projectsPermissions.js";
import { buildOtherCostNotes } from "./projectsOtherCostGroups.js";
import type { ProjectDetail } from "@/src/types/projects.js";

const AMORTIZATION_PERCENT_TOLERANCE = 0.0001;
const MOLD_TOTAL = 52_000;
const PASS_THROUGH_80 = 80;
const EXPECTED_PASSTHROUGH = 41_600;
const EXPECTED_ABSORBED = 10_400;

function buildDetailFixture(): ProjectDetail {
  const itemA = "aaaaaaaa-aaaa-4111-8111-aaaaaaaaaaaa";
  const itemB = "bbbbbbbb-bbbb-4111-8111-bbbbbbbbbbbb";
  const moldId = "cccccccc-cccc-4111-8111-cccccccccccc";
  return {
    id: "dddddddd-dddd-4111-8111-dddddddddddd",
    code: "PRJ-0001",
    title: "Projeto teste",
    customerName: "Cliente",
    customerDocument: null,
    description: null,
    projectType: "NEW_PRODUCT",
    status: "DRAFT",
    commercialOwner: null,
    technicalOwner: null,
    expectedMonthlyVolume: null,
    targetPrice: null,
    targetMarginPercent: null,
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentVersion: null,
    versions: [],
    simulatedProducts: [],
    simulatedItems: [
      {
        id: itemA,
        provisionalCode: "A",
        description: "Item A",
        itemType: "COMPONENT",
        unit: "UN",
        estimatedUnitCost: 3,
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
        id: itemB,
        provisionalCode: "B",
        description: "Item B",
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
        constructionCost: MOLD_TOTAL,
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
      componentCost: 0,
      serviceCost: 0,
      packagingCost: 0,
      separateMoldCost: MOLD_TOTAL,
      amortizedMoldCostPerUnit: 0,
      unitCost: 11.5,
      targetMarginPercent: null,
      suggestedPrice: null,
      markupPercent: null,
      targetPrice: null,
      priceGap: null,
    },
    alerts: [],
    conversionAvailable: false,
  };
}

describe("projectsCostAmortization — cálculos puros", () => {
  it("calcula valor repassado e absorvido (80/20)", () => {
    const result = calculatePassThroughAmounts(MOLD_TOTAL, PASS_THROUGH_80);
    assert.equal(result.passThroughAmount, EXPECTED_PASSTHROUGH);
    assert.equal(result.absorbedAmount, EXPECTED_ABSORBED);
  });

  it("percentual 100/0 funciona", () => {
    const result = calculatePassThroughAmounts(MOLD_TOTAL, 100);
    assert.equal(result.passThroughAmount, MOLD_TOTAL);
    assert.equal(result.absorbedAmount, 0);
  });

  it("percentual 0/100 funciona", () => {
    const result = calculatePassThroughAmounts(MOLD_TOTAL, 0);
    assert.equal(result.passThroughAmount, 0);
    assert.equal(result.absorbedAmount, MOLD_TOTAL);
  });

  it("distribuição 60/40 no cenário obrigatório", () => {
    const passThrough = calculatePassThroughAmounts(MOLD_TOTAL, PASS_THROUGH_80).passThroughAmount;
    const itemA = calculateAmortizationAllocation(passThrough, 60, 20_000, 3);
    const itemB = calculateAmortizationAllocation(passThrough, 40, 10_000, 8.5);
    assert.equal(itemA.allocatedAmount, 24_960);
    assert.equal(itemB.allocatedAmount, 16_640);
    assert.equal(itemA.unitAmortizedCost, 1.248);
    assert.equal(itemB.unitAmortizedCost, 1.664);
    assert.equal(itemA.finalUnitCost, 4.248);
    assert.equal(itemB.finalUnitCost, 10.164);
  });

  it("custo final unitário = base + amortização", () => {
    const row = calculateAmortizationAllocation(10_000, 100, 5_000, 2.5);
    assert.equal(row.finalUnitCost, 4.5);
  });

  it("distribuição incompleta gera status correto", () => {
    assert.equal(
      resolveAmortizationDistributionStatus([60], true, true),
      "INCOMPLETE"
    );
  });

  it("distribuição excedente gera status correto", () => {
    assert.equal(resolveAmortizationDistributionStatus([60, 50], true, true), "EXCESS");
  });

  it("distribuído 100% dentro da tolerância", () => {
    const total = 100 - AMORTIZATION_PERCENT_TOLERANCE / 2;
    assert.equal(resolveAmortizationDistributionStatus([total], true, true), "DISTRIBUTED");
  });

  it("quantidade zero gera indicador de pendência", () => {
    const row = calculateAmortizationAllocation(1000, 50, 0, 3);
    assert.equal(row.quantityError, "ZERO");
    assert.equal(row.unitAmortizedCost, 0);
  });

  it("não retorna NaN/Infinity no resumo", () => {
    const detail = buildDetailFixture();
    const summary = buildProjectCostAmortizationSummary(detail);
    assert.equal(amortizationMetricsAreFinite(summary), true);
  });

  it("computeAmortizationConfig fecha soma 100%", () => {
    const detail = buildDetailFixture();
    const mold = detail.molds[0]!;
    const targets = [
      {
        targetItemId: detail.simulatedItems[0]!.id,
        targetItemType: "SIMULATION" as const,
        displayName: "Item A",
        displayCode: "A",
        baseUnitCost: 3,
        suggestedQuantity: 20_000,
        entityKind: "simulation_ref" as const,
      },
      {
        targetItemId: detail.simulatedItems[1]!.id,
        targetItemType: "LEGACY" as const,
        displayName: "Item B",
        displayCode: "B",
        baseUnitCost: 8.5,
        suggestedQuantity: 10_000,
        entityKind: "product" as const,
      },
    ];
    const computed = computeAmortizationConfig(
      {
        sourceType: "MOLD",
        sourceId: mold.id,
        sourceDescriptionSnapshot: mold.name,
        sourceTotalCostSnapshot: MOLD_TOTAL,
        passThroughPercent: PASS_THROUGH_80,
        allocations: [
          {
            targetItemId: targets[0]!.targetItemId,
            targetItemType: "SIMULATION",
            targetDescriptionSnapshot: "Item A",
            targetBaseUnitCostSnapshot: 3,
            allocationPercent: 60,
            amortizationQuantity: 20_000,
          },
          {
            targetItemId: targets[1]!.targetItemId,
            targetItemType: "LEGACY",
            targetDescriptionSnapshot: "Item B",
            targetBaseUnitCostSnapshot: 8.5,
            allocationPercent: 40,
            amortizationQuantity: 10_000,
          },
        ],
      },
      targets
    );
    assert.equal(computed.status, "DISTRIBUTED");
    assert.equal(computed.passThroughAmount, EXPECTED_PASSTHROUGH);
    assert.equal(computed.allocations[0]?.unitAmortizedCost, 1.248);
    assert.equal(computed.allocations[1]?.unitAmortizedCost, 1.664);
  });
});

describe("projectsCostAmortization — validação de payload", () => {
  it("bloqueia distribuição maior que 100%", () => {
    const detail = buildDetailFixture();
    const mold = detail.molds[0]!;
    const result = validateUpsertAmortizationPayload(detail, {
      sourceType: "MOLD",
      sourceId: mold.id,
      passThroughPercent: 80,
      allocations: [
        {
          targetItemType: "SIMULATION",
          targetItemId: detail.simulatedItems[0]!.id,
          allocationPercent: 70,
          amortizationQuantity: 1000,
        },
        {
          targetItemType: "LEGACY",
          targetItemId: detail.simulatedItems[1]!.id,
          allocationPercent: 40,
          amortizationQuantity: 1000,
        },
      ],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /excede 100%/i);
  });

  it("molde pode ter amortização configurada (payload válido)", () => {
    const detail = buildDetailFixture();
    const mold = detail.molds[0]!;
    const result = validateUpsertAmortizationPayload(detail, {
      sourceType: "MOLD",
      sourceId: mold.id,
      passThroughPercent: 80,
      allocations: [
        {
          targetItemType: "SIMULATION",
          targetItemId: detail.simulatedItems[0]!.id,
          allocationPercent: 60,
          amortizationQuantity: 20_000,
        },
        {
          targetItemType: "LEGACY",
          targetItemId: detail.simulatedItems[1]!.id,
          allocationPercent: 40,
          amortizationQuantity: 10_000,
        },
      ],
    });
    assert.equal(result.ok, true);
  });
});

describe("projectsCostAmortization — permissões", () => {
  const checker = (perms: string[]) => {
    const set = new Set(perms);
    return {
      hasPermission: (p: string) => set.has(p),
      hasAnyPermission: (list: string[]) => list.some((p) => set.has(p)),
    };
  };

  it("permissão view não edita (manage false)", () => {
    assert.equal(canViewProjects(checker(["projects.view"])), true);
    assert.equal(canManageProjects(checker(["projects.view"])), false);
  });

  it("permissão manage edita", () => {
    assert.equal(canManageProjects(checker(["projects.manage"])), true);
  });
});

describe("projectsCostAmortization — UI estática", () => {
  it("aba Custos mostra seção de amortização", () => {
    const tab = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectGuidedCostsTab.tsx"),
      "utf8"
    );
    assert.match(tab, /Custos amortizáveis/);
    assert.match(tab, /Distribuição por item/);
    assert.match(tab, /Valor repassado via amortização/);
  });

  it("botão Configurar amortização aparece", () => {
    const tab = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectGuidedCostsTab.tsx"),
      "utf8"
    );
    assert.match(tab, /Configurar amortização/);
  });

  it("modal mostra percentual repassado e distribuição", () => {
    const modal = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectCostAmortizationModal.tsx"),
      "utf8"
    );
    assert.match(modal, /Percentual repassado ao cliente/);
    assert.match(modal, /% da amortização/);
    assert.match(modal, /Salvar amortização/);
  });

  it("rotas de amortização expostas", () => {
    const routes = readFileSync(
      join(process.cwd(), "src", "lib", "projectsRoutes.ts"),
      "utf8"
    );
    assert.match(routes, /cost-amortizations/);
  });

  it("status Distribuído 100% rotulado", () => {
    assert.equal(amortizationStatusLabel("DISTRIBUTED"), "Distribuído 100%");
    assert.equal(amortizationStatusLabel("INCOMPLETE"), "Distribuição incompleta");
  });
});

describe("projectsCostAmortization — remoção de item", () => {
  it("removeAmortizationAllocationsForTargetItem é exportado no service", () => {
    assert.equal(typeof removeAmortizationAllocationsForTargetItem, "function");
  });

  it("delete de item marca distribuição incompleta no resumo sem allocation órfã", () => {
    const detail = buildDetailFixture();
    const itemA = detail.simulatedItems[0]!.id;
    const saved = [
      {
        id: "e1",
        projectId: detail.id,
        sourceType: "MOLD" as const,
        sourceId: detail.molds[0]!.id,
        sourceDescriptionSnapshot: "Molde da Haste",
        sourceTotalCostSnapshot: MOLD_TOTAL,
        passThroughPercent: 80,
        passThroughAmount: EXPECTED_PASSTHROUGH,
        absorbedAmount: EXPECTED_ABSORBED,
        status: "DISTRIBUTED" as const,
        allocations: [
          {
            targetItemId: itemA,
            targetItemType: "SIMULATION" as const,
            targetDescriptionSnapshot: "Item A",
            targetBaseUnitCostSnapshot: 3,
            allocationPercent: 60,
            amortizationQuantity: 20_000,
            allocatedAmount: 24_960,
            unitAmortizedCost: 1.248,
            finalUnitCost: 4.248,
          },
          {
            targetItemId: detail.simulatedItems[1]!.id,
            targetItemType: "LEGACY" as const,
            targetDescriptionSnapshot: "Item B",
            targetBaseUnitCostSnapshot: 8.5,
            allocationPercent: 40,
            amortizationQuantity: 10_000,
            allocatedAmount: 16_640,
            unitAmortizedCost: 1.664,
            finalUnitCost: 10.164,
          },
        ],
        distributionPercentTotal: 100,
        distributionBalancePercent: 0,
        allocatedAmountTotal: EXPECTED_PASSTHROUGH,
        unallocatedAmount: 0,
      },
    ];

    const withoutItemA = {
      ...detail,
      simulatedItems: detail.simulatedItems.filter((i) => i.id !== itemA),
    };
    const summary = buildProjectCostAmortizationSummary(withoutItemA, saved);
    const amort = summary.amortizations[0];
    assert.ok(amort);
    assert.equal(amort.allocations.some((a) => a.targetItemId === itemA), false);
    assert.equal(amort.status, "INCOMPLETE");
  });
});

const OTHER_COST_BATCH_ID = "other-cost-batch-11111111-1111-1111-1111-111111111111";
const OTHER_COST_TOTAL = 5075;

function buildOtherCostDetailFixture(): ProjectDetail {
  const detail = buildDetailFixture();
  return {
    ...detail,
    simulatedItems: [
      ...detail.simulatedItems,
      {
        id: "eeeeeeee-eeee-4111-8111-eeeeeeeeeeee",
        provisionalCode: null,
        description: "Projeto 3d",
        itemType: "COMPONENT",
        unit: "UN",
        estimatedUnitCost: OTHER_COST_TOTAL,
        quotedUnitCost: null,
        supplierName: null,
        leadTimeDays: null,
        estimatedWeight: null,
        lossPercent: 0,
        requiresQuotation: false,
        requiresEngineeringReview: false,
        canBecomeOfficial: false,
        notes: buildOtherCostNotes("OTHER", OTHER_COST_BATCH_ID),
      },
    ],
  };
}

describe("projectsCostAmortization — OTHER_COST sourceId", () => {
  it("outro custo usa batchId real como sourceId na listagem", () => {
    const detail = buildOtherCostDetailFixture();
    const source = listAmortizableCostSources(detail).find((s) => s.sourceType === "OTHER_COST");
    assert.ok(source);
    assert.equal(source.sourceId, OTHER_COST_BATCH_ID);
    assert.equal(source.sourceBatchId, OTHER_COST_BATCH_ID);
    assert.equal(source.description, "Projeto 3d");
    assert.equal(source.totalCost, OTHER_COST_TOTAL);
    assert.equal(isAmortizationUuid(source.sourceId), false);
  });

  it("backend aceita sourceId de OTHER_COST existente no projeto", () => {
    const detail = buildOtherCostDetailFixture();
    const result = validateAmortizationSourceRef(detail, "OTHER_COST", OTHER_COST_BATCH_ID);
    assert.equal(result.ok, true);
  });

  it("backend rejeita sourceId de OTHER_COST inexistente", () => {
    const detail = buildOtherCostDetailFixture();
    const result = validateAmortizationSourceRef(detail, "OTHER_COST", "other-cost-batch-missing");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /não encontrado/i);
  });

  it("outro custo 100% em um item valida payload", () => {
    const detail = buildOtherCostDetailFixture();
    const targetA = detail.simulatedItems[0]!.id;
    const result = validateUpsertAmortizationPayload(detail, {
      sourceType: "OTHER_COST",
      sourceId: OTHER_COST_BATCH_ID,
      passThroughPercent: 100,
      allocations: [
        {
          targetItemType: "SIMULATION",
          targetItemId: targetA,
          allocationPercent: 100,
          amortizationQuantity: 1000,
        },
      ],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      const computed = computeAmortizationConfig(
        result.config,
        buildProjectAmortizationTargets(detail)
      );
      assert.equal(computed.passThroughAmount, OTHER_COST_TOTAL);
      assert.equal(computed.allocations[0]?.allocatedAmount, OTHER_COST_TOTAL);
      assert.equal(computed.status, "DISTRIBUTED");
    }
  });

  it("outro custo 50/50 em dois itens valida payload", () => {
    const detail = buildOtherCostDetailFixture();
    const targetA = detail.simulatedItems[0]!.id;
    const targetB = detail.simulatedItems[1]!.id;
    const result = validateUpsertAmortizationPayload(detail, {
      sourceType: "OTHER_COST",
      sourceId: OTHER_COST_BATCH_ID,
      passThroughPercent: 100,
      allocations: [
        {
          targetItemType: "SIMULATION",
          targetItemId: targetA,
          allocationPercent: 50,
          amortizationQuantity: 1000,
        },
        {
          targetItemType: "LEGACY",
          targetItemId: targetB,
          allocationPercent: 50,
          amortizationQuantity: 1000,
        },
      ],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      const computed = computeAmortizationConfig(
        result.config,
        buildProjectAmortizationTargets(detail)
      );
      assert.equal(computed.allocations[0]?.allocatedAmount, 2537.5);
      assert.equal(computed.allocations[1]?.allocatedAmount, 2537.5);
      assert.equal(computed.status, "DISTRIBUTED");
    }
  });

  it("molde continua exigindo UUID como sourceId", () => {
    const detail = buildDetailFixture();
    const moldId = detail.molds[0]!.id;
    assert.equal(validateAmortizationSourceRef(detail, "MOLD", moldId).ok, true);
    assert.equal(validateAmortizationSourceRef(detail, "MOLD", OTHER_COST_BATCH_ID).ok, false);
  });

  it("rotas não rejeitam OTHER_COST apenas por não ser UUID", () => {
    const routes = readFileSync(
      join(process.cwd(), "src", "lib", "projectsRoutes.ts"),
      "utf8"
    );
    assert.match(routes, /validateAmortizationSourceRef/);
    assert.doesNotMatch(
      routes.slice(routes.indexOf('app.put("/api/projects/:id/cost-amortizations"')),
      /if \(!isUuid\(sourceId\)\) return res\.status\(400\)\.json\(\{ error: "sourceId inválido\." \}\);/
    );
  });

  it("valores de outro custo não retornam NaN/Infinity", () => {
    const detail = buildOtherCostDetailFixture();
    const summary = buildProjectCostAmortizationSummary(detail);
    assert.equal(amortizationMetricsAreFinite(summary), true);
  });
});
