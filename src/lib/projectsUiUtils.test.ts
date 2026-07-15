import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLaborLinePayload,
  buildMoldPayloadFromForm,
  calculateLaborLineTotal,
  formatProjectsNumberInput,
  parseProjectsNumberInput,
  suggestAmortizedCostPerUnit,
} from "./projectsUiUtils.js";

describe("projectsUiUtils", () => {
  it("parseProjectsNumberInput aceita vírgula e ponto", () => {
    assert.equal(parseProjectsNumberInput("1.234,56"), 1234.56);
    assert.equal(parseProjectsNumberInput("10,5"), 10.5);
    assert.equal(parseProjectsNumberInput(""), null);
  });

  it("parseProjectsNumberInput não transforma 37.5 em 375 (ponto decimal)", () => {
    assert.equal(parseProjectsNumberInput("37.5"), 37.5);
    assert.equal(parseProjectsNumberInput("37,5"), 37.5);
    assert.equal(parseProjectsNumberInput("25"), 25);
    assert.equal(parseProjectsNumberInput("0"), 0);
    assert.equal(parseProjectsNumberInput("1.234.567"), 1234567);
    assert.equal(parseProjectsNumberInput("1,234.56"), 1234.56);
  });

  it("parseProjectsNumberInput trata milhar BR em quantidade (10.000 ≠ 10)", () => {
    assert.equal(parseProjectsNumberInput("10.000"), 10_000);
    assert.equal(parseProjectsNumberInput("1.250"), 1_250);
    assert.equal(parseProjectsNumberInput("1.250.000"), 1_250_000);
    assert.equal(parseProjectsNumberInput("10.25"), 10.25);
    assert.equal(parseProjectsNumberInput("10,25"), 10.25);
  });

  it("formatProjectsNumberInput + parse mantém percentuais e quantidades", () => {
    assert.equal(formatProjectsNumberInput(37.5), "37,5");
    assert.equal(parseProjectsNumberInput(formatProjectsNumberInput(37.5)!), 37.5);
    assert.equal(formatProjectsNumberInput(10_000), "10.000");
    assert.equal(parseProjectsNumberInput(formatProjectsNumberInput(10_000)!), 10_000);
    assert.equal(formatProjectsNumberInput(1_250_000), "1.250.000");
    assert.equal(parseProjectsNumberInput(formatProjectsNumberInput(1_250_000)!), 1_250_000);
    assert.equal(parseProjectsNumberInput(formatProjectsNumberInput(100)!), 100);
    // Regressão do modal: String(37.5) era "37.5" e o parse antigo virava 375 → soma 775%.
    assert.equal(parseProjectsNumberInput(String(37.5)), 37.5);
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

  it("linha HH calcula custo total corretamente", () => {
    const payload = buildLaborLinePayload({
      description: "Hora-homem",
      hours: "4",
      hourlyRate: "100",
      lossPercent: "0",
      notes: "",
    });
    const total = calculateLaborLineTotal(payload.quantity, payload.unitCost, payload.lossPercent);
    assert.equal(total, 400);
    assert.equal(Number.isFinite(total), true);
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
