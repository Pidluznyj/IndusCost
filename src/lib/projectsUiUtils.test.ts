import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMoldPayloadFromForm,
  parseProjectsNumberInput,
  suggestAmortizedCostPerUnit,
} from "./projectsUiUtils.js";

describe("projectsUiUtils", () => {
  it("parseProjectsNumberInput aceita vírgula e ponto", () => {
    assert.equal(parseProjectsNumberInput("1.234,56"), 1234.56);
    assert.equal(parseProjectsNumberInput("10,5"), 10.5);
    assert.equal(parseProjectsNumberInput(""), null);
  });

  it("cálculo de custo amortizado não gera NaN/Infinity", () => {
    const perUnit = suggestAmortizedCostPerUnit(50000, 10000, "AMORTIZED_IN_PRODUCT", false);
    assert.equal(perUnit, 5);
    assert.equal(suggestAmortizedCostPerUnit(50000, 0, "AMORTIZED_IN_PRODUCT", false), null);
    const payload = buildMoldPayloadFromForm({
      name: "Molde A",
      moldType: "",
      cavities: "",
      estimatedLifeCycles: "",
      supplierName: "",
      constructionCost: "1000",
      maintenanceCost: "",
      changeCost: "",
      leadTimeDays: "",
      chargeMode: "AMORTIZED_IN_PRODUCT",
      amortizationQuantity: "200",
      amortizedCostPerUnit: "",
      amortizedManual: false,
      ownership: "COMPANY",
      notes: "",
    });
    assert.equal(payload.amortizedCostPerUnit, 5);
    assert.equal(Number.isFinite(payload.constructionCost), true);
  });

  it("modal de molde possui campos essenciais no componente", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const mod = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectMoldFormModal.tsx"),
      "utf8"
    );
    assert.match(mod, /Quantidade para amortização/);
    assert.match(mod, /Custo amortizado por unidade/);
    assert.match(mod, /Propriedade e observações/);
    assert.match(mod, /Forma de cobrança|Cobrança e amortização/);
    assert.match(mod, /Salvar molde/);
  });
});
