import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOptionalSelectionStatus,
  computeUnassignedOptionalItems,
  resolveGroupStatus,
  resolveGroupStatusForCurrentOptionalPool,
  type AggregatedOptionalItem,
  type OptionalPricingGroupView,
} from "./nomusOptionalPricingSelection";

function optionalItem(
  componentCode: string,
  lineIds: number[] = [1]
): AggregatedOptionalItem {
  return {
    componentCode,
    componentDescription: null,
    plannedQuantity: 0.001,
    nomusSourceLineIds: lineIds,
    isOptional: true,
    isAlternative: false,
  };
}

function groupView(
  overrides: Partial<OptionalPricingGroupView> & { id: string; groupName: string }
): OptionalPricingGroupView {
  return {
    selectionMode: "EXACTLY_ONE",
    notes: null,
    isActive: true,
    selectedNone: false,
    status: "PENDING",
    choices: [],
    ...overrides,
  };
}

describe("309.71AA / 114.02 — opcional stale não bloqueia", () => {
  it("114.02 removido do pool — sem opcionais ativos → NO_OPTIONALS", () => {
    const optionalItems: AggregatedOptionalItem[] = [];
    const status = buildOptionalSelectionStatus({
      optionalItems,
      unassignedOptionalItems: [],
      groups: [],
    });
    assert.equal(status, "NO_OPTIONALS");
  });

  it("114.02 só existia no stage stale — após filtro não restam opcionais ativos", () => {
    const allStageOptional = [
      optionalItem("115.01--", [10]),
      optionalItem("114.02", [99]),
    ];
    const currentOptional = allStageOptional.filter((i) => i.componentCode !== "114.02");
    // Simula 115.01-- como obrigatório (não entra em optionalItems após classificação)
    const optionalItems = currentOptional.filter((i) => i.componentCode === "114.02");
    const unassigned = computeUnassignedOptionalItems(optionalItems, []);
    const status = buildOptionalSelectionStatus({
      optionalItems,
      unassignedOptionalItems: unassigned,
      groups: [],
    });
    assert.equal(status, "NO_OPTIONALS");
    assert.equal(unassigned.length, 0);
  });
});

describe("opcionais reais continuam bloqueando", () => {
  it("opcional atual sem grupo → PENDING", () => {
    const optionalItems = [optionalItem("114.02", [99])];
    const unassigned = computeUnassignedOptionalItems(optionalItems, []);
    const status = buildOptionalSelectionStatus({
      optionalItems,
      unassignedOptionalItems: unassigned,
      groups: [],
    });
    assert.equal(status, "PENDING");
    assert.equal(unassigned.length, 1);
  });

  it("opcional com grupo RESOLVED → RESOLVED", () => {
    const optionalItems = [optionalItem("114.02", [99])];
    const groups: OptionalPricingGroupView[] = [
      groupView({
        id: "g1",
        groupName: "Anel",
        status: "RESOLVED",
        choices: [
          {
            id: "c1",
            componentCode: "114.02",
            componentDescription: null,
            plannedQuantity: 0.001,
            nomusSourceLineIds: [99],
            isSelectedForPricing: true,
            isActive: true,
            isStale: false,
          },
        ],
      }),
    ];
    const unassigned = computeUnassignedOptionalItems(optionalItems, groups);
    const status = buildOptionalSelectionStatus({
      optionalItems,
      unassignedOptionalItems: unassigned,
      groups,
    });
    assert.equal(status, "RESOLVED");
  });

  it("selectedNone=true → RESOLVED", () => {
    const optionalItems = [optionalItem("114.02", [99])];
    const groups: OptionalPricingGroupView[] = [
      groupView({
        id: "g1",
        groupName: "POM",
        status: "RESOLVED",
        selectedNone: true,
        choices: [
          {
            id: "c1",
            componentCode: "114.02",
            componentDescription: null,
            plannedQuantity: 0.001,
            nomusSourceLineIds: [99],
            isSelectedForPricing: false,
            isActive: true,
            isStale: false,
          },
        ],
      }),
    ];
    const status = buildOptionalSelectionStatus({
      optionalItems,
      unassignedOptionalItems: [],
      groups,
    });
    assert.equal(status, "RESOLVED");
  });
});

describe("grupos/choices obsoletos", () => {
  it("grupo só com choice fora do pool atual → RESOLVED (não bloqueia)", () => {
    const optionalByCode = new Map<string, AggregatedOptionalItem>();
    const status = resolveGroupStatusForCurrentOptionalPool(
      {
        selectionMode: "EXACTLY_ONE",
        selectedNone: false,
        choices: [
          {
            componentCode: "114.02",
            isActive: true,
            isSelectedForPricing: false,
            isStale: true,
          },
        ],
      },
      optionalByCode
    );
    assert.equal(status, "RESOLVED");
  });

  it("309.71AA — sibling stale + seleção válida → RESOLVED (não bloqueia grupo)", () => {
    const optionalItems = [
      optionalItem("114.03", [101]),
      optionalItem("114.02", [102]),
    ];
    const optionalByCode = new Map(
      optionalItems.map((i) => [i.componentCode.toUpperCase().replace(/\s+/g, " ").trim(), i])
    );
    const status = resolveGroupStatusForCurrentOptionalPool(
      {
        selectionMode: "OPTIONAL_ONE",
        selectedNone: false,
        choices: [
          {
            componentCode: "114.03",
            isActive: true,
            isSelectedForPricing: false,
            isStale: true,
          },
          {
            componentCode: "114.02",
            isActive: true,
            isSelectedForPricing: true,
            isStale: false,
          },
        ],
      },
      optionalByCode
    );
    assert.equal(status, "RESOLVED");
    assert.equal(
      resolveGroupStatus({
        selectionMode: "OPTIONAL_ONE",
        selectedNone: false,
        choices: [
          { isActive: true, isSelectedForPricing: false, isStale: true },
          { isActive: true, isSelectedForPricing: true, isStale: false },
        ],
      }),
      "RESOLVED"
    );
  });

  it("grupo STALE com componente ainda no pool → STALE bloqueante", () => {
    const optionalItems = [optionalItem("114.02", [99])];
    const optionalByCode = new Map(
      optionalItems.map((i) => [i.componentCode.toUpperCase().replace(/\s+/g, " ").trim(), i])
    );
    const groups: OptionalPricingGroupView[] = [
      groupView({
        id: "g1",
        groupName: "Antigo",
        status: "STALE",
        choices: [
          {
            id: "c1",
            componentCode: "114.02",
            componentDescription: null,
            plannedQuantity: 0.002,
            nomusSourceLineIds: [88],
            isSelectedForPricing: true,
            isActive: true,
            isStale: true,
          },
        ],
      }),
    ];
    const status = buildOptionalSelectionStatus({
      optionalItems,
      unassignedOptionalItems: [],
      groups,
    });
    assert.equal(status, "STALE");
  });
});
