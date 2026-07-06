import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NomusEffectiveBomLine } from "./nomusBomComparison";
import { buildComponentResolutionMap } from "./nomusEffectivePricingBom";
import {
  buildOptionalSelectionStatus,
  type AggregatedOptionalItem,
  type OptionalPricingGroupView,
} from "./nomusOptionalPricingSelection";
import {
  buildPreferredAlternativeSets,
  parseLinkedPreferredExternalLineId,
  PREFERRED_ALTERNATIVE_LINK_PAYLOAD_KEY,
} from "./nomusPreferredAlternativeLink";

function line(
  overrides: Partial<NomusEffectiveBomLine> & Pick<NomusEffectiveBomLine, "externalLineId" | "componentCode">
): NomusEffectiveBomLine {
  return {
    parentCode: "309.71AA",
    componentDescription: null,
    quantity: 0.0011,
    requiredQuantity: 0.0011,
    lossQuantity: null,
    listaMateriaisId: 17,
    listaMateriaisNome: "04",
    opcional: false,
    alternativo: false,
    preferencial: false,
    ...overrides,
  };
}

function item(
  overrides: Partial<AggregatedOptionalItem> & Pick<AggregatedOptionalItem, "componentCode">
): AggregatedOptionalItem {
  return {
    componentDescription: null,
    plannedQuantity: 0.0011,
    nomusSourceLineIds: [1],
    isOptional: false,
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

describe("parseLinkedPreferredExternalLineId", () => {
  it("lê idComponentePreferencialVinculadoAlternativo do rawPayload", () => {
    assert.equal(
      parseLinkedPreferredExternalLineId({
        [PREFERRED_ALTERNATIVE_LINK_PAYLOAD_KEY]: 42,
      }),
      42
    );
    assert.equal(
      parseLinkedPreferredExternalLineId({
        [PREFERRED_ALTERNATIVE_LINK_PAYLOAD_KEY]: "42",
      }),
      42
    );
  });
});

describe("309.71AA — exclusividade preferencial/alternativo", () => {
  const effectiveLines = [
    line({
      externalLineId: 41,
      componentCode: "114.02--",
      alternativo: true,
      linkedPreferredExternalLineId: 42,
    }),
    line({
      externalLineId: 42,
      componentCode: "114.03--",
      preferencial: true,
    }),
  ];

  const sets = buildPreferredAlternativeSets(effectiveLines);
  const optionalItems: AggregatedOptionalItem[] = [
    item({
      componentCode: "114.02--",
      nomusSourceLineIds: [41],
      isAlternative: true,
      linkedPreferredExternalLineId: 42,
    }),
    item({
      componentCode: "114.03--",
      nomusSourceLineIds: [42],
      isPreferred: true,
    }),
  ];

  it("alternativa 114.02 selecionada → inclui 114.02 e exclui 114.03", () => {
    const groups = [
      groupView({
        id: "g1",
        groupName: "POM",
        status: "RESOLVED",
        choices: [
          {
            id: "c-alt",
            componentCode: "114.02--",
            componentDescription: null,
            plannedQuantity: 0.0011,
            nomusSourceLineIds: [41],
            isSelectedForPricing: true,
            isActive: true,
            isStale: false,
          },
        ],
      }),
    ];

    const map = buildComponentResolutionMap(optionalItems, groups, [], sets);
    const rAlt = map.get("114.02--");
    const rPref = map.get("114.03--");
    assert.equal(rAlt?.kind, "optional_resolved");
    if (rAlt?.kind === "optional_resolved") assert.equal(rAlt.selected, true);
    assert.equal(rPref?.kind, "optional_resolved");
    if (rPref?.kind === "optional_resolved") assert.equal(rPref.selected, false);
  });

  it("sem seleção manual → default preferencial 114.03", () => {
    const map = buildComponentResolutionMap(optionalItems, [], optionalItems, sets);
    const rAlt = map.get("114.02--");
    const rPref = map.get("114.03--");
    assert.equal(rAlt?.kind, "exclusive_set_resolved");
    if (rAlt?.kind === "exclusive_set_resolved") assert.equal(rAlt.selected, false);
    assert.equal(rPref?.kind, "exclusive_set_resolved");
    if (rPref?.kind === "exclusive_set_resolved") assert.equal(rPref.selected, true);
  });

  it("seleção explícita do preferencial no grupo → inclui 114.03 e exclui 114.02", () => {
    const groups = [
      groupView({
        id: "g1",
        groupName: "POM",
        status: "RESOLVED",
        choices: [
          {
            id: "c-pref",
            componentCode: "114.03--",
            componentDescription: null,
            plannedQuantity: 0.0011,
            nomusSourceLineIds: [42],
            isSelectedForPricing: true,
            isActive: true,
            isStale: false,
          },
          {
            id: "c-alt",
            componentCode: "114.02--",
            componentDescription: null,
            plannedQuantity: 0.0011,
            nomusSourceLineIds: [41],
            isSelectedForPricing: false,
            isActive: true,
            isStale: false,
          },
        ],
      }),
    ];

    const map = buildComponentResolutionMap(optionalItems, groups, [], sets);
    const rPref = map.get("114.03--");
    assert.equal(rPref?.kind, "optional_resolved");
    if (rPref?.kind === "optional_resolved") assert.equal(rPref.selected, true);
    const rAlt = map.get("114.02--");
    assert.equal(rAlt?.kind, "optional_resolved");
    if (rAlt?.kind === "optional_resolved") assert.equal(rAlt.selected, false);
  });

  it("vínculo quebrado (preferencial ausente) → alternativa bloqueada", () => {
    const brokenLines = [
      line({
        externalLineId: 41,
        componentCode: "114.02--",
        alternativo: true,
        linkedPreferredExternalLineId: 999,
      }),
    ];
    const brokenSets = buildPreferredAlternativeSets(brokenLines);
    const brokenOptional = [
      item({
        componentCode: "114.02--",
        nomusSourceLineIds: [41],
        isAlternative: true,
        linkedPreferredExternalLineId: 999,
      }),
    ];
    const map = buildComponentResolutionMap(brokenOptional, [], brokenOptional, brokenSets);
    const r = map.get("114.02--");
    assert.equal(r?.kind, "exclusive_set_resolved");
    if (r?.kind === "exclusive_set_resolved") {
      assert.equal(r.brokenLink, true);
      assert.equal(r.selected, false);
    }
  });

  it("status RESOLVED com default preferencial sem grupo", () => {
    const status = buildOptionalSelectionStatus({
      optionalItems,
      unassignedOptionalItems: optionalItems,
      groups: [],
      preferredAlternativeSets: sets,
    });
    assert.equal(status, "RESOLVED");
  });
});

describe("regressão — opcionais reais", () => {
  it("selectedNone em opcional real sem vínculo preferencial", () => {
    const optionalItems = [
      item({
        componentCode: "118.02",
        isOptional: true,
        nomusSourceLineIds: [10],
      }),
    ];
    const groups = [
      groupView({
        id: "g1",
        groupName: "Opc",
        selectedNone: true,
        status: "RESOLVED",
        choices: [
          {
            id: "c1",
            componentCode: "118.02",
            componentDescription: null,
            plannedQuantity: 1,
            nomusSourceLineIds: [10],
            isSelectedForPricing: false,
            isActive: true,
            isStale: false,
          },
        ],
      }),
    ];
    const map = buildComponentResolutionMap(optionalItems, groups, [], []);
    const r = map.get("118.02");
    assert.equal(r?.kind, "optional_resolved");
    if (r?.kind === "optional_resolved") assert.equal(r.selectedNone, true);
  });
});
