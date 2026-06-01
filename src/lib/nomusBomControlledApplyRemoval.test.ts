import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONTROLLED_APPLY_REMOVAL_SOURCES,
  excludedOptionalResolutionForSource,
  isEffectiveLineRemovableByControlledApply,
  isProductBomRowEligibleForExcludedComponentRemoval,
} from "./nomusBomControlledApplyRemoval";
import { resolveGroupStatus } from "./nomusOptionalPricingSelection";

describe("nomusBomControlledApplyRemoval — fontes removíveis", () => {
  it("NOMUS_OPTIONAL_SELECTED_NONE é fonte de remoção (301.02AB / 118.02)", () => {
    assert.equal(isEffectiveLineRemovableByControlledApply("NOMUS_OPTIONAL_SELECTED_NONE"), true);
    assert.ok(CONTROLLED_APPLY_REMOVAL_SOURCES.has("NOMUS_OPTIONAL_SELECTED_NONE"));
  });

  it("NOMUS_OPTIONAL_NOT_SELECTED e alternativa não selecionada são removíveis", () => {
    assert.equal(isEffectiveLineRemovableByControlledApply("NOMUS_OPTIONAL_NOT_SELECTED"), true);
    assert.equal(isEffectiveLineRemovableByControlledApply("NOMUS_ALTERNATIVE_NOT_SELECTED"), true);
  });

  it("NOMUS_REQUIRED e opcional selecionado não são fontes de remoção", () => {
    assert.equal(isEffectiveLineRemovableByControlledApply("NOMUS_REQUIRED"), false);
    assert.equal(isEffectiveLineRemovableByControlledApply("NOMUS_OPTIONAL_SELECTED"), false);
  });

  it("classificação explícita de exclusão por opcional", () => {
    assert.equal(
      excludedOptionalResolutionForSource("NOMUS_OPTIONAL_SELECTED_NONE"),
      "EXCLUDED_BY_OPTIONAL_SELECTION_NONE"
    );
    assert.equal(
      excludedOptionalResolutionForSource("NOMUS_OPTIONAL_NOT_SELECTED", "EXCLUDED_OPTIONAL_NOT_SELECTED"),
      "EXCLUDED_OPTIONAL_NOT_SELECTED"
    );
  });
});

describe("nomusBomControlledApplyRemoval — proteções de linha ProductBOM", () => {
  const base = { componentCode: "118.02--", componentDescription: "SAN 358N TR77741" };

  it("linha Nomus padrão → elegível para remoção por opcional excluído", () => {
    assert.equal(isProductBomRowEligibleForExcludedComponentRemoval(base), true);
  });

  it("localException=true → não remove", () => {
    assert.equal(
      isProductBomRowEligibleForExcludedComponentRemoval({ ...base, localException: true }),
      false
    );
  });

  it("INCLUDE_AS_LOCAL_EXCEPTION → não remove", () => {
    assert.equal(
      isProductBomRowEligibleForExcludedComponentRemoval({
        ...base,
        reviewDecisionType: "INCLUDE_AS_LOCAL_EXCEPTION",
      }),
      false
    );
  });

  it("800.xx → não remove", () => {
    assert.equal(
      isProductBomRowEligibleForExcludedComponentRemoval({
        componentCode: "800.01--",
        componentDescription: "Montagem",
      }),
      false
    );
  });

  it("item operacional por descrição → não remove", () => {
    assert.equal(
      isProductBomRowEligibleForExcludedComponentRemoval({
        componentCode: "999.01--",
        componentDescription: "Montagem principal",
      }),
      false
    );
  });
});

describe("resolveGroupStatus — selectedNone", () => {
  const choice = { isActive: true, isSelectedForPricing: false, isStale: false };

  it("EXACTLY_ONE com selectedNone → RESOLVED (não bloqueia apply)", () => {
    assert.equal(
      resolveGroupStatus({
        selectionMode: "EXACTLY_ONE",
        selectedNone: true,
        choices: [choice],
      }),
      "RESOLVED"
    );
  });

  it("OPTIONAL_ONE com selectedNone → RESOLVED", () => {
    assert.equal(
      resolveGroupStatus({
        selectionMode: "OPTIONAL_ONE",
        selectedNone: true,
        choices: [choice],
      }),
      "RESOLVED"
    );
  });

  it("grupo sem seleção → PENDING", () => {
    assert.equal(
      resolveGroupStatus({
        selectionMode: "EXACTLY_ONE",
        selectedNone: false,
        choices: [choice],
      }),
      "PENDING"
    );
  });
});
