import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinalCompositionLine, SimulatedComponent } from "./newProductSandbox.js";
import {
  buildNewProductSimulationInputs,
  displayResultFromSnapshot,
  EMPTY_COMMERCIAL_PREMISES_STATE,
  existingCostKey,
  existingLineBaselineSource,
  marginSignLabel,
  previewNewProductDisplayResult,
} from "./newProductSimulationInputs.js";
import type { NewProductSimulationSnapshot } from "./newProductSimulationSnapshot.js";
import { parseNewProductSaveBody, parseNewProductSimulationInputs } from "./simulationsValidation.js";

const PRODUCT = "11111111-1111-4111-8111-111111111111";
const MATERIAL = "44444444-4444-4444-8444-444444444444";
const TAX_RULE = "33333333-3333-4333-8333-333333333333";

const lines: FinalCompositionLine[] = [
  { id: "l1", type: "EXISTING_COMPONENT", refId: PRODUCT, quantity: 2 },
  { id: "l2", type: "SIMULATED_COMPONENT", refId: "c1", quantity: 1 },
  { id: "l3", type: "DIRECT_MATERIAL", description: "Parafuso", quantity: 4, unitCost: 0.25 },
];

const component: SimulatedComponent = {
  id: "c1",
  name: "Tampa",
  materials: [
    { code: "MP-001", description: "PP", quantity: 0.5, unit: "kg", unitCost: 10, materialId: MATERIAL, source: "CATALOG" },
    { code: "", description: "Pigmento", quantity: 0.01, unit: "kg", unitCost: 80, materialId: null, source: "MANUAL" },
  ],
  hh: 0.3,
  hm: 0.1,
  breakdown: { mp: 5.8, hh: 0.3, hm: 0.1, costBase: 6.2, mpPct: 0, hhPct: 0, hmPct: 0 },
  processInputs: {
    useDefaultHourCosts: true,
    cycleTimeSeconds: 36,
    cavities: 2,
    efficiencyExpectedPercent: 100,
    setupTimeMin: 60,
    lotSize: 1000,
  },
};

const state = {
  simulationName: "  ",
  productName: "Novo corpo",
  productSku: "",
  notes: "",
  mode: "MARGIN" as const,
  desiredMarginPct: "20",
  targetPrice: "0",
  premises: EMPTY_COMMERCIAL_PREMISES_STATE,
  lines,
  simulatedComponents: [component],
};

describe("buildNewProductSimulationInputs — o cliente envia inputs, não resultados", () => {
  it("monta um corpo aceito pela validação do servidor, sem campos de resultado", () => {
    const inputs = buildNewProductSimulationInputs(state);
    const parsed = parseNewProductSimulationInputs(inputs);
    assert.equal(parsed.ok, true);
    assert.equal(inputs.simulationName, "Novo corpo", "nome da simulação cai no nome do produto");
    assert.equal(inputs.commercial.premises, null);
    const json = JSON.stringify(inputs);
    for (const forbidden of ["costBase", "lineTotal", "viability", "price\"", "breakdown", "savedAt", "createdBy"]) {
      assert.ok(!json.includes(forbidden), `inputs não levam ${forbidden}`);
    }
    assert.deepEqual(inputs.lines[0], {
      id: "l1",
      type: "EXISTING_COMPONENT",
      productId: PRODUCT,
      quantity: 2,
      baselineSource: "LIVE",
    });
    assert.equal(inputs.simulatedComponents[0].process.mode, "STANDARD");
    assert.equal(inputs.simulatedComponents[0].materials[1].materialId, null);
  });

  it("componente sem processo padrão vai como HH/HM manual; premissas só com regra fiscal", () => {
    const manual = buildNewProductSimulationInputs({
      ...state,
      simulatedComponents: [{ ...component, processInputs: { useDefaultHourCosts: false, manualHh: 1, manualHm: 2 }, hh: 1, hm: 2 }],
      premises: { enabled: true, taxRuleId: TAX_RULE, commissionRatePct: "3", otherRatePct: "0,5", freight: "1.2" },
    });
    assert.deepEqual(manual.simulatedComponents[0].process, { mode: "MANUAL", manualHh: 1, manualHm: 2 });
    assert.deepEqual(manual.commercial.premises, {
      taxRuleId: TAX_RULE,
      commissionRatePct: 3,
      otherRatePct: 0.5,
      freight: 1.2,
    });
    const noRule = buildNewProductSimulationInputs({
      ...state,
      premises: { ...EMPTY_COMMERCIAL_PREMISES_STATE, enabled: true },
    });
    assert.equal(noRule.commercial.premises, null);
  });

  it("linhas em branco da tela são ignoradas ao enviar; quantidade zero é aceita", () => {
    const inputs = buildNewProductSimulationInputs({
      ...state,
      productName: "",
      lines: [
        { id: "vazia-1", type: "EXISTING_COMPONENT", refId: "", quantity: 1 },
        { id: "vazia-2", type: "SIMULATED_COMPONENT", refId: "", quantity: 1 },
        { id: "vazia-3", type: "DIRECT_MATERIAL", description: "", quantity: 1, unitCost: 0 },
        { id: "sem-descricao", type: "DIRECT_MATERIAL", description: " ", quantity: 0, unitCost: 2 },
        ...lines,
      ],
    });
    assert.deepEqual(
      inputs.lines.map((l) => l.id),
      ["sem-descricao", "l1", "l2", "l3"]
    );
    assert.equal(inputs.productName, "Produto simulado", "nome padrão preservado");
    assert.equal((inputs.lines[0] as { description: string }).description, "Material direto");
    assert.equal(parseNewProductSimulationInputs(inputs).ok, true);
    const empty = buildNewProductSimulationInputs({
      ...state,
      lines: [{ id: "vazia", type: "EXISTING_COMPONENT", refId: "", quantity: 1 }],
    });
    const parsed = parseNewProductSimulationInputs(empty);
    assert.equal(parsed.ok === false && parsed.code, "EMPTY_COMPOSITION");
  });

  it("base por linha: ausente = engenharia atual; PUBLISHED é escolha explícita", () => {
    assert.equal(existingLineBaselineSource(lines[0]), "LIVE");
    assert.equal(
      existingLineBaselineSource({ id: "x", type: "EXISTING_COMPONENT", refId: PRODUCT, quantity: 1, baselineSource: "PUBLISHED" }),
      "PUBLISHED"
    );
    assert.equal(existingCostKey(PRODUCT, "PUBLISHED"), `${PRODUCT}|PUBLISHED`);
  });
});

describe("validação do servidor para o novo produto", () => {
  const valid = () => buildNewProductSimulationInputs(state) as any;

  it("rejeita entradas inválidas com código específico", () => {
    const cases: Array<[(i: any) => void, string]> = [
      [(i) => (i.productName = ""), "INVALID_PRODUCT_NAME"],
      [(i) => (i.lines = []), "EMPTY_COMPOSITION"],
      [(i) => (i.lines[0].quantity = -1), "INVALID_QUANTITY"],
      [(i) => (i.lines[0].quantity = "NaN"), "INVALID_QUANTITY"],
      [(i) => (i.lines[0].productId = "abc"), "INVALID_PRODUCT_ID"],
      [(i) => (i.lines[0].baselineSource = "OFICIAL"), "INVALID_BASELINE_SOURCE"],
      [(i) => (i.lines[1].componentId = "inexistente"), "INVALID_COMPONENT_REF"],
      [(i) => (i.lines[2].unitCost = -1), "INVALID_UNIT_COST"],
      [(i) => (i.lines[2].unitCost = 1e12), "INVALID_UNIT_COST"],
      [(i) => (i.lines[2].type = "OUTRO"), "INVALID_LINE_TYPE"],
      [(i) => (i.simulatedComponents[0].process.cycleTimeSeconds = 0), "INVALID_CYCLE"],
      [(i) => (i.simulatedComponents[0].process.cavities = 0), "INVALID_CAVITIES"],
      [(i) => (i.simulatedComponents[0].process.efficiencyExpectedPercent = 0), "INVALID_EFFICIENCY"],
      [(i) => (i.simulatedComponents[0].process.efficiencyExpectedPercent = 500), "INVALID_EFFICIENCY"],
      [(i) => (i.simulatedComponents[0].process.setupTimeMin = -1), "INVALID_SETUP"],
      [(i) => (i.simulatedComponents[0].process.lotSize = 0), "INVALID_LOT_SIZE"],
      [(i) => (i.simulatedComponents[0].process = { mode: "MANUAL", manualHh: -1, manualHm: 0 }), "INVALID_MANUAL_HH_HM"],
      [(i) => (i.simulatedComponents[0].materials[0].materialId = "x"), "INVALID_MATERIAL_ID"],
      [(i) => (i.simulatedComponents[0].materials[1].unitCost = null), "MISSING_UNIT_COST"],
      [(i) => (i.simulatedComponents[0].materials[0].bomLossPct = 100), "INVALID_LOSS"],
      [(i) => (i.commercial.desiredMarginPct = 100), "INVALID_MARGIN"],
      [(i) => (i.commercial.premises = { commissionRatePct: 3 }), "MISSING_TAX"],
      [(i) => (i.commercial.premises = { taxRatePct: 18, commissionRatePct: -1 }), "INVALID_PREMISES"],
    ];
    for (const [mutate, code] of cases) {
      const inputs = valid();
      mutate(inputs);
      const parsed = parseNewProductSimulationInputs(inputs);
      assert.equal(parsed.ok, false, code);
      if (parsed.ok === false) assert.equal(parsed.code, code);
    }
  });

  it("save: recusa snapshot do navegador; freeze é o padrão; draftId precisa ser UUID", () => {
    const refused = parseNewProductSaveBody({ simulationName: "x", snapshot: {} });
    assert.equal(refused.ok === false && refused.code, "SNAPSHOT_NOT_ACCEPTED");
    const ok = parseNewProductSaveBody({ inputs: valid() });
    assert.ok(ok.ok === true);
    if (ok.ok === true) {
      assert.equal(ok.value.freeze, true);
      assert.equal(ok.value.draftId, null);
    }
    const draft = parseNewProductSaveBody({ inputs: valid(), freeze: false, draftId: "x" });
    assert.equal(draft.ok === false && draft.code, "INVALID_DRAFT_ID");
  });
});

describe("resultado exibido — congelada = snapshot; edição = prévia rotulada", () => {
  const legacy: NewProductSimulationSnapshot = {
    header: { simulationName: "Antiga", productName: "P", createdAt: "", savedAt: "" },
    commercial: { mode: "MARGIN", desiredMarginPct: 20, targetPrice: 0 },
    composition: { lines: [], simulatedComponents: [] },
    result: { mp: 8, hh: 1, hm: 1, costBase: 10, mpPct: 80, hhPct: 10, hmPct: 10, price: 12.5, marginPct: 20, viability: "VIAVEL" },
  };

  it("snapshot legado: números gravados, classificação antiga preservada só como registro", () => {
    const d = displayResultFromSnapshot(legacy);
    assert.equal(d.legacy, true);
    assert.equal(d.costBase, 10);
    assert.equal(d.price, 12.5);
    assert.equal(d.legacyViability, "VIAVEL");
    assert.equal(d.analysisKind, "INDUSTRIAL_PRELIMINARY");
    assert.match(d.priceLabel, /industrial preliminar/i);
  });

  it("snapshot do servidor: usa a análise gravada, sem 'viável'", () => {
    const d = displayResultFromSnapshot({
      ...legacy,
      schemaVersion: 2,
      result: {
        ...legacy.result,
        viability: undefined,
        price: null,
        marginPct: null,
        analysis: {
          kind: "COMMERCIAL_SIMULATED",
          priceLabel: "Preço simulado (premissas comerciais da simulação)",
          marginSign: "INDETERMINADA",
          markupFactor: null,
          markupPct: null,
          error: { code: "IMPOSSIBLE_PREMISES", message: "Soma maior que 100%." },
        },
      },
    });
    assert.equal(d.legacy, false);
    assert.equal(d.legacyViability, null);
    assert.equal(d.price, null);
    assert.equal(d.error, "Soma maior que 100%.");
    assert.equal(marginSignLabel(d.marginSign), "Margem indeterminada");
  });

  it("prévia local usa a mesma fórmula do servidor e nunca devolve preço 0 silencioso", () => {
    const industrial = previewNewProductDisplayResult({ mp: 8, hh: 1, hm: 1, mode: "MARGIN", desiredMarginPct: 20, targetPrice: 0, premises: null });
    assert.ok(Math.abs((industrial.price as number) - 12.5) < 1e-9);
    assert.equal(industrial.analysisKind, "INDUSTRIAL_PRELIMINARY");
    assert.equal(industrial.marginSign, "POSITIVA");
    const commercial = previewNewProductDisplayResult({
      mp: 10, hh: 0, hm: 0, mode: "MARGIN", desiredMarginPct: 20, targetPrice: 0,
      premises: { taxRatePct: 18, commissionRatePct: 3, otherRatePct: 0, freight: 0 },
    });
    assert.ok(Math.abs((commercial.price as number) - 10 / 0.59) < 1e-9);
    assert.match(commercial.priceLabel, /simulado/i);
    const impossible = previewNewProductDisplayResult({
      mp: 10, hh: 0, hm: 0, mode: "MARGIN", desiredMarginPct: 90, targetPrice: 0,
      premises: { taxRatePct: 18, commissionRatePct: 3, otherRatePct: 0, freight: 0 },
    });
    assert.equal(impossible.price, null);
    assert.ok(impossible.error);
    const target = previewNewProductDisplayResult({ mp: 10, hh: 0, hm: 0, mode: "TARGET_PRICE", desiredMarginPct: 0, targetPrice: 8, premises: null });
    assert.equal(target.marginSign, "NULA_OU_NEGATIVA");
  });
});
