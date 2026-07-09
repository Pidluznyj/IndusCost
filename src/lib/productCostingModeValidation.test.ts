import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  shouldSkipOwnProcessInCosting,
  shouldSkipOwnProcessValidation,
  validateStandardProcessFields,
  validateStandardProcessFieldsForForm,
} from "./productCostingModeValidation.js";

const partialProcess = {
  cycleTimeSeconds: 30,
  cavities: null,
  setupTimeMin: null,
  efficiencyExpected: null,
};

const fullProcess = {
  cycleTimeSeconds: 30,
  cavities: 2,
  setupTimeMin: 15,
  efficiencyExpected: 95,
};

describe("productCostingModeValidation", () => {
  it("OWN_PROCESS exige processo completo quando ciclo informado", () => {
    const result = validateStandardProcessFields(partialProcess, {
      itemType: "COMPONENT",
      costingMode: "OWN_PROCESS",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /cavities/);
  });

  it("BOM_ONLY salva sem tempo de ciclo completo", () => {
    assert.equal(
      validateStandardProcessFields(partialProcess, {
        itemType: "COMPONENT",
        costingMode: "BOM_ONLY",
      }).ok,
      true
    );
    assert.equal(
      validateStandardProcessFields(
        { cycleTimeSeconds: null, cavities: null, setupTimeMin: null, efficiencyExpected: null },
        { itemType: "COMPONENT", costingMode: "BOM_ONLY" }
      ).ok,
      true
    );
  });

  it("BOM_ONLY salva com processo antigo parcial ou completo no cadastro", () => {
    assert.equal(
      validateStandardProcessFields(fullProcess, {
        itemType: "COMPONENT",
        costingMode: "BOM_ONLY",
      }).ok,
      true
    );
    assert.equal(
      validateStandardProcessFields(partialProcess, {
        itemType: "COMPONENT",
        costingMode: "BOM_ONLY",
      }).ok,
      true
    );
  });

  it("FINISHING_SERVICE não herda exigência de processo próprio", () => {
    assert.equal(
      validateStandardProcessFields(partialProcess, {
        itemType: "COMPONENT",
        costingMode: "FINISHING_SERVICE",
      }).ok,
      true
    );
  });

  it("formulário OWN_PROCESS bloqueia ciclo inválido", () => {
    assert.ok(
      validateStandardProcessFieldsForForm(
        { cycleTimeSeconds: 30, cavities: "", setupTimeMin: "", efficiencyExpected: "" },
        { itemType: "COMPONENT", costingMode: "OWN_PROCESS" }
      )
    );
  });

  it("formulário BOM_ONLY não bloqueia por processo", () => {
    assert.equal(
      validateStandardProcessFieldsForForm(
        { cycleTimeSeconds: 30, cavities: "", setupTimeMin: "", efficiencyExpected: "" },
        { itemType: "COMPONENT", costingMode: "BOM_ONLY" }
      ),
      null
    );
  });

  it("shouldSkipOwnProcessInCosting ignora HH/HM próprio fora de OWN_PROCESS", () => {
    assert.equal(shouldSkipOwnProcessValidation("OWN_PROCESS"), false);
    assert.equal(shouldSkipOwnProcessInCosting("BOM_ONLY"), true);
    assert.equal(shouldSkipOwnProcessInCosting("FINISHING_SERVICE"), true);
  });
});
