import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildComponentResolutionMap } from "./nomusEffectivePricingBom";
import {
  buildOptionalSelectionStatus,
  resolveGroupStatus,
  resolveGroupStatusForCurrentOptionalPool,
  type AggregatedOptionalItem,
  type OptionalPricingGroupView,
} from "./nomusOptionalPricingSelection";

function optionalItem(
  componentCode: string,
  lineIds: number[] = [1],
  overrides: Partial<AggregatedOptionalItem> = {}
): AggregatedOptionalItem {
  return {
    componentCode,
    componentDescription: null,
    plannedQuantity: 0.0011,
    nomusSourceLineIds: lineIds,
    isOptional: true,
    isAlternative: false,
    isPreferred: false,
    ...overrides,
  };
}

function groupView(
  overrides: Partial<OptionalPricingGroupView> & { id: string; groupName: string }
): OptionalPricingGroupView {
  return {
    selectionMode: "OPTIONAL_ONE",
    notes: null,
    isActive: true,
    selectedNone: false,
    status: "RESOLVED",
    choices: [],
    ...overrides,
  };
}

describe("309.71AA — re-seleção com sibling stale", () => {
  const optionalItems = [
    optionalItem("114.03", [101], { isOptional: true, isAlternative: false, isPreferred: false }),
    optionalItem("114.02", [102], { isOptional: true, isAlternative: true, isPreferred: false }),
  ];

  const group = groupView({
    id: "g-pom",
    groupName: "POM Pino",
    selectionMode: "OPTIONAL_ONE",
    selectedNone: false,
    status: "RESOLVED",
    choices: [
      {
        id: "c-114-03",
        componentCode: "114.03",
        componentDescription: "KP30",
        plannedQuantity: 0.0011,
        nomusSourceLineIds: [101],
        isSelectedForPricing: false,
        isActive: true,
        isStale: true,
      },
      {
        id: "c-114-02",
        componentCode: "114.02",
        componentDescription: "KP20",
        plannedQuantity: 0.0011,
        nomusSourceLineIds: [102],
        isSelectedForPricing: true,
        isActive: true,
        isStale: false,
      },
    ],
  });

  it("resolveGroupStatus → RESOLVED (não contamina grupo inteiro)", () => {
    assert.equal(
      resolveGroupStatus({
        selectionMode: "OPTIONAL_ONE",
        selectedNone: false,
        choices: group.choices,
      }),
      "RESOLVED"
    );
  });

  it("buildComponentResolutionMap inclui 114.02 selecionado", () => {
    const map = buildComponentResolutionMap(optionalItems, [group], []);
    const r11402 = map.get("114.02");
    const r11403 = map.get("114.03");
    assert.equal(r11402?.kind, "optional_resolved");
    if (r11402?.kind === "optional_resolved") {
      assert.equal(r11402.selected, true);
      assert.equal(r11402.selectedNone, false);
    }
    assert.equal(r11403?.kind, "optional_resolved");
    if (r11403?.kind === "optional_resolved") {
      assert.equal(r11403.selected, false);
    }
  });

  it("buildOptionalSelectionStatus → RESOLVED", () => {
    const status = buildOptionalSelectionStatus({
      optionalItems,
      unassignedOptionalItems: [],
      groups: [group],
    });
    assert.equal(status, "RESOLVED");
  });
});

describe("selectedNone — nenhuma choice na BOM", () => {
  it("resolveGroupStatus e resolution map excluem todas", () => {
    const optionalItems = [optionalItem("114.02", [99])];
    const group = groupView({
      id: "g1",
      groupName: "POM",
      selectedNone: true,
      status: "RESOLVED",
      choices: [
        {
          id: "c1",
          componentCode: "114.02",
          componentDescription: null,
          plannedQuantity: 0.0011,
          nomusSourceLineIds: [99],
          isSelectedForPricing: false,
          isActive: true,
          isStale: false,
        },
      ],
    });

    assert.equal(
      resolveGroupStatus({
        selectionMode: "OPTIONAL_ONE",
        selectedNone: true,
        choices: group.choices,
      }),
      "RESOLVED"
    );

    const map = buildComponentResolutionMap(optionalItems, [group], []);
    const r = map.get("114.02");
    assert.equal(r?.kind, "optional_resolved");
    if (r?.kind === "optional_resolved") {
      assert.equal(r.selected, false);
      assert.equal(r.selectedNone, true);
    }
  });
});

describe("choice selecionada stale no pool — exige nova decisão", () => {
  it("resolveGroupStatus → STALE quando seleção aponta para linha desatualizada", () => {
    assert.equal(
      resolveGroupStatus({
        selectionMode: "OPTIONAL_ONE",
        selectedNone: false,
        choices: [
          {
            isActive: true,
            isSelectedForPricing: true,
            isStale: true,
          },
        ],
      }),
      "STALE"
    );
  });

  it("buildComponentResolutionMap bloqueia apenas a choice selecionada stale", () => {
    const optionalItems = [optionalItem("114.02", [99])];
    const group = groupView({
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
    });

    const map = buildComponentResolutionMap(optionalItems, [group], []);
    const r = map.get("114.02");
    assert.equal(r?.kind, "group_stale");
  });

  it("grupo só com choice obsoleta fora do pool → RESOLVED via pool helper", () => {
    const optionalByCode = new Map<string, AggregatedOptionalItem>();
    assert.equal(
      resolveGroupStatusForCurrentOptionalPool(
        {
          selectionMode: "OPTIONAL_ONE",
          selectedNone: false,
          choices: [
            {
              componentCode: "114.02",
              isActive: true,
              isSelectedForPricing: true,
              isStale: true,
            },
          ],
        },
        optionalByCode
      ),
      "RESOLVED"
    );
  });
});
