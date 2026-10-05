/**
 * Validação (pura) dos payloads das rotas de Simulações.
 * Lista branca de campos — nada do corpo da requisição vai direto para o Prisma.
 */
import {
  isProductCostBaselineSource,
  type ProductCostBaselineSource,
} from "./productCostBaseline.js";

export const SIMULATION_ADJ_MIN_PCT = -90;
export const SIMULATION_ADJ_MAX_PCT = 500;
export const SIMULATION_NAME_MAX_LEN = 160;
export const SIMULATION_TEXT_MAX_LEN = 2000;
export const NEW_PRODUCT_MAX_LINES = 200;
export const NEW_PRODUCT_MAX_COMPONENTS = 100;
export const NEW_PRODUCT_MAX_MATERIALS = 100;
const MAX_MONEY = 1_000_000_000;
const MAX_QUANTITY = 1_000_000_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidString(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export type ParseFailure = { ok: false; code: string; message: string };
export type ParseResult<T> = { ok: true; value: T } | ParseFailure;

function fail(code: string, message: string): ParseFailure {
  return { ok: false, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** Aceita number ou string numérica; rejeita NaN/Infinity/booleans/objetos. */
function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function readText(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > maxLen) return null;
  return trimmed;
}

function readOptionalText(value: unknown, maxLen: number): string | null | undefined {
  if (value == null || value === "") return null;
  const text = readText(value, maxLen);
  return text === null ? undefined : text || null;
}

// ---------------------------------------------------------------------------
// Cenário de produto existente
// ---------------------------------------------------------------------------

export type ScenarioCreateInput = {
  name: string;
  description: string | null;
  productId: string;
  taxRuleId: string;
  materialAdj: number;
  laborAdj: number;
  indirectAdj: number;
  efficiencyAdj: number;
  marginAdj: number;
  baselineSource: ProductCostBaselineSource;
};

const SCENARIO_ADJ_FIELDS = [
  ["materialAdj", "Matéria-prima"],
  ["laborAdj", "Mão de obra (HH)"],
  ["indirectAdj", "Máquina (HM)"],
  ["efficiencyAdj", "Eficiência"],
  ["marginAdj", "Margem"],
] as const;

export function parseScenarioCreateBody(body: unknown): ParseResult<ScenarioCreateInput> {
  if (!isRecord(body)) return fail("INVALID_BODY", "Corpo da requisição inválido.");

  const name = readText(body.name, SIMULATION_NAME_MAX_LEN);
  if (!name) return fail("INVALID_NAME", "Nome do cenário é obrigatório (até 160 caracteres).");

  const description = readOptionalText(body.description, SIMULATION_TEXT_MAX_LEN);
  if (description === undefined) return fail("INVALID_DESCRIPTION", "Descrição inválida.");

  if (!isUuidString(body.productId)) return fail("INVALID_PRODUCT_ID", "Produto base inválido.");
  if (!isUuidString(body.taxRuleId)) return fail("INVALID_TAX_RULE_ID", "Regra fiscal inválida.");

  const adjustments: Record<string, number> = {};
  for (const [field, label] of SCENARIO_ADJ_FIELDS) {
    const raw = body[field];
    const n = raw == null || raw === "" ? 0 : readFiniteNumber(raw);
    if (n == null) return fail("INVALID_ADJUSTMENT", `Ajuste de ${label} inválido.`);
    if (n < SIMULATION_ADJ_MIN_PCT || n > SIMULATION_ADJ_MAX_PCT) {
      return fail(
        "ADJUSTMENT_OUT_OF_RANGE",
        `Ajuste de ${label} fora da faixa permitida (${SIMULATION_ADJ_MIN_PCT}% a ${SIMULATION_ADJ_MAX_PCT}%).`
      );
    }
    adjustments[field] = n;
  }

  const rawSource = body.baselineSource;
  let baselineSource: ProductCostBaselineSource = "PUBLISHED";
  if (rawSource != null && rawSource !== "") {
    if (!isProductCostBaselineSource(rawSource)) {
      return fail("INVALID_BASELINE_SOURCE", "Base da simulação deve ser PUBLISHED ou LIVE.");
    }
    baselineSource = rawSource;
  }

  return {
    ok: true,
    value: {
      name,
      description,
      productId: (body.productId as string).trim(),
      taxRuleId: (body.taxRuleId as string).trim(),
      materialAdj: adjustments.materialAdj,
      laborAdj: adjustments.laborAdj,
      indirectAdj: adjustments.indirectAdj,
      efficiencyAdj: adjustments.efficiencyAdj,
      marginAdj: adjustments.marginAdj,
      baselineSource,
    },
  };
}

// ---------------------------------------------------------------------------
// Novo produto — o cliente envia INPUTS; o servidor calcula e monta o snapshot.
// ---------------------------------------------------------------------------

export type NewProductMaterialInput = {
  /** Material do cadastro (Suprimentos). Sem id = linha manual. */
  materialId: string | null;
  code: string;
  description: string;
  unit: string;
  quantity: number;
  /** Perda da linha (BOM), em %. */
  bomLossPct: number;
  /**
   * Custo unitário informado pelo usuário. Em linha de cadastro, só é usado se diferir do
   * custo efetivo do cadastro (registrado como override). Em linha manual é obrigatório.
   */
  unitCost: number | null;
};

export type NewProductProcessInput =
  | {
      mode: "STANDARD";
      cycleTimeSeconds: number;
      cavities: number;
      efficiencyExpectedPercent: number;
      setupTimeMin: number;
      lotSize: number;
    }
  | { mode: "MANUAL"; manualHh: number; manualHm: number };

export type NewProductSimulatedComponentInput = {
  id: string;
  name: string;
  sku: string | null;
  materials: NewProductMaterialInput[];
  process: NewProductProcessInput;
};

export type NewProductLineInput =
  | {
      id: string;
      type: "EXISTING_COMPONENT";
      productId: string;
      quantity: number;
      baselineSource: ProductCostBaselineSource;
    }
  | { id: string; type: "SIMULATED_COMPONENT"; componentId: string; quantity: number }
  | {
      id: string;
      type: "DIRECT_MATERIAL";
      description: string;
      unit: string;
      quantity: number;
      unitCost: number;
    };

export type NewProductCommercialInput = {
  mode: "MARGIN" | "TARGET_PRICE";
  desiredMarginPct: number;
  targetPrice: number;
  /**
   * Premissas comerciais DA SIMULAÇÃO (não são ProductPricing oficial). null = sem análise
   * comercial: o servidor entrega apenas a análise industrial preliminar.
   */
  premises: {
    taxRuleId: string | null;
    taxRatePct: number | null;
    commissionRatePct: number;
    otherRatePct: number;
    freight: number;
  } | null;
};

export type NewProductSimulationInputs = {
  simulationName: string;
  productName: string;
  productSku: string | null;
  notes: string | null;
  commercial: NewProductCommercialInput;
  lines: NewProductLineInput[];
  simulatedComponents: NewProductSimulatedComponentInput[];
};

export type NewProductSaveRequest = {
  inputs: NewProductSimulationInputs;
  /** true = congela (SAVED); false = grava rascunho editável. */
  freeze: boolean;
  /** Rascunho existente a atualizar/congelar. */
  draftId: string | null;
};

function readId(value: unknown): string | null {
  const text = readText(value, 80);
  return text ? text : null;
}

function readBounded(value: unknown, min: number, max: number): number | null {
  const n = readFiniteNumber(value);
  if (n == null || n < min || n > max) return null;
  return n;
}

function parseMaterial(raw: unknown, where: string): ParseResult<NewProductMaterialInput> {
  if (!isRecord(raw)) return fail("INVALID_MATERIAL", `${where}: linha de material inválida.`);
  let materialId: string | null = null;
  if (raw.materialId != null && raw.materialId !== "") {
    if (!isUuidString(raw.materialId)) return fail("INVALID_MATERIAL_ID", `${where}: material inválido.`);
    materialId = raw.materialId.trim();
  }
  const quantity = readBounded(raw.quantity, 0, MAX_QUANTITY);
  if (quantity == null) return fail("INVALID_QUANTITY", `${where}: quantidade deve ser um número ≥ 0.`);
  const bomLossPct = raw.bomLossPct == null || raw.bomLossPct === "" ? 0 : readBounded(raw.bomLossPct, 0, 99.99);
  if (bomLossPct == null) return fail("INVALID_LOSS", `${where}: perda deve estar entre 0% e 99,99%.`);
  let unitCost: number | null = null;
  if (raw.unitCost != null && raw.unitCost !== "") {
    unitCost = readBounded(raw.unitCost, 0, MAX_MONEY);
    if (unitCost == null) return fail("INVALID_UNIT_COST", `${where}: custo unitário deve ser um número ≥ 0.`);
  }
  if (!materialId && unitCost == null) {
    return fail("MISSING_UNIT_COST", `${where}: linha manual exige custo unitário.`);
  }
  return {
    ok: true,
    value: {
      materialId,
      code: readText(raw.code, 80) ?? "",
      description: readText(raw.description, 300) ?? "",
      unit: readText(raw.unit, 20) || "UN",
      quantity,
      bomLossPct,
      unitCost,
    },
  };
}

function parseProcess(raw: unknown, where: string): ParseResult<NewProductProcessInput> {
  if (!isRecord(raw)) return fail("INVALID_PROCESS", `${where}: processo inválido.`);
  if (raw.mode === "MANUAL") {
    const manualHh = readBounded(raw.manualHh, 0, MAX_MONEY);
    const manualHm = readBounded(raw.manualHm, 0, MAX_MONEY);
    if (manualHh == null || manualHm == null) {
      return fail("INVALID_MANUAL_HH_HM", `${where}: HH/HM manuais devem ser números ≥ 0.`);
    }
    return { ok: true, value: { mode: "MANUAL", manualHh, manualHm } };
  }
  if (raw.mode !== "STANDARD") return fail("INVALID_PROCESS_MODE", `${where}: modo de processo inválido.`);
  const cycleTimeSeconds = readFiniteNumber(raw.cycleTimeSeconds);
  const cavities = readFiniteNumber(raw.cavities);
  const efficiencyExpectedPercent = readFiniteNumber(raw.efficiencyExpectedPercent);
  const setupTimeMin = readFiniteNumber(raw.setupTimeMin);
  const lotSize = readFiniteNumber(raw.lotSize);
  if (cycleTimeSeconds == null || cycleTimeSeconds <= 0 || cycleTimeSeconds > 86_400) {
    return fail("INVALID_CYCLE", `${where}: informe ciclo em segundos maior que zero.`);
  }
  if (cavities == null || cavities < 1 || cavities > 10_000) {
    return fail("INVALID_CAVITIES", `${where}: informe cavidades boas maiores ou iguais a 1.`);
  }
  if (efficiencyExpectedPercent == null || efficiencyExpectedPercent <= 0 || efficiencyExpectedPercent > 200) {
    return fail("INVALID_EFFICIENCY", `${where}: eficiência deve ser maior que 0% e até 200%.`);
  }
  if (setupTimeMin == null || setupTimeMin < 0 || setupTimeMin > 1_000_000) {
    return fail("INVALID_SETUP", `${where}: setup inválido.`);
  }
  if (lotSize == null || lotSize <= 0 || lotSize > MAX_QUANTITY) {
    return fail("INVALID_LOT_SIZE", `${where}: lote padrão deve ser maior que zero.`);
  }
  return {
    ok: true,
    value: { mode: "STANDARD", cycleTimeSeconds, cavities, efficiencyExpectedPercent, setupTimeMin, lotSize },
  };
}

export function parseNewProductSimulationInputs(raw: unknown): ParseResult<NewProductSimulationInputs> {
  if (!isRecord(raw)) return fail("INVALID_INPUTS", "Dados da simulação inválidos.");

  const productName = readText(raw.productName, SIMULATION_NAME_MAX_LEN);
  if (!productName) return fail("INVALID_PRODUCT_NAME", "Nome do produto simulado é obrigatório.");
  const simulationName = readText(raw.simulationName, SIMULATION_NAME_MAX_LEN) || productName;
  const productSku = readOptionalText(raw.productSku, 80);
  if (productSku === undefined) return fail("INVALID_SKU", "SKU provisório inválido.");
  const notes = readOptionalText(raw.notes, SIMULATION_TEXT_MAX_LEN);
  if (notes === undefined) return fail("INVALID_NOTES", "Observações inválidas.");

  // Componentes simulados
  if (!Array.isArray(raw.simulatedComponents)) {
    return fail("INVALID_COMPONENTS", "Lista de componentes simulados inválida.");
  }
  if (raw.simulatedComponents.length > NEW_PRODUCT_MAX_COMPONENTS) {
    return fail("TOO_MANY_COMPONENTS", "Quantidade de componentes simulados acima do limite.");
  }
  const simulatedComponents: NewProductSimulatedComponentInput[] = [];
  const componentIds = new Set<string>();
  for (const [index, item] of raw.simulatedComponents.entries()) {
    const where = `Componente simulado ${index + 1}`;
    if (!isRecord(item)) return fail("INVALID_COMPONENT", `${where}: inválido.`);
    const id = readId(item.id);
    if (!id || componentIds.has(id)) return fail("INVALID_COMPONENT_ID", `${where}: identificador inválido ou repetido.`);
    const name = readText(item.name, SIMULATION_NAME_MAX_LEN);
    if (!name) return fail("INVALID_COMPONENT_NAME", `${where}: nome é obrigatório.`);
    const sku = readOptionalText(item.sku, 80);
    if (sku === undefined) return fail("INVALID_SKU", `${where}: SKU inválido.`);
    if (!Array.isArray(item.materials) || item.materials.length > NEW_PRODUCT_MAX_MATERIALS) {
      return fail("INVALID_MATERIALS", `${where}: lista de materiais inválida.`);
    }
    const materials: NewProductMaterialInput[] = [];
    for (const [mIndex, m] of item.materials.entries()) {
      const parsed = parseMaterial(m, `${where}, material ${mIndex + 1}`);
      if (parsed.ok === false) return fail(parsed.code, parsed.message);
      materials.push(parsed.value);
    }
    const process = parseProcess(item.process, where);
    if (process.ok === false) return fail(process.code, process.message);
    componentIds.add(id);
    simulatedComponents.push({ id, name, sku, materials, process: process.value });
  }

  // Linhas da composição
  if (!Array.isArray(raw.lines) || raw.lines.length === 0) {
    return fail("EMPTY_COMPOSITION", "Informe ao menos uma linha na composição do produto.");
  }
  if (raw.lines.length > NEW_PRODUCT_MAX_LINES) {
    return fail("TOO_MANY_LINES", "Quantidade de linhas da composição acima do limite.");
  }
  const lines: NewProductLineInput[] = [];
  const lineIds = new Set<string>();
  for (const [index, item] of raw.lines.entries()) {
    const where = `Linha ${index + 1}`;
    if (!isRecord(item)) return fail("INVALID_LINE", `${where}: inválida.`);
    const id = readId(item.id);
    if (!id || lineIds.has(id)) return fail("INVALID_LINE_ID", `${where}: identificador inválido ou repetido.`);
    lineIds.add(id);
    const quantity = readBounded(item.quantity, 0, MAX_QUANTITY);
    if (quantity == null) return fail("INVALID_QUANTITY", `${where}: quantidade deve ser um número ≥ 0.`);
    if (item.type === "EXISTING_COMPONENT") {
      if (!isUuidString(item.productId)) return fail("INVALID_PRODUCT_ID", `${where}: selecione um item existente.`);
      // Novo produto: a referência padrão continua sendo a engenharia atual (comportamento
      // existente), agora registrada explicitamente; PUBLISHED é opcional por linha.
      let baselineSource: ProductCostBaselineSource = "LIVE";
      if (item.baselineSource != null && item.baselineSource !== "") {
        if (!isProductCostBaselineSource(item.baselineSource)) {
          return fail("INVALID_BASELINE_SOURCE", `${where}: base deve ser PUBLISHED ou LIVE.`);
        }
        baselineSource = item.baselineSource;
      }
      lines.push({ id, type: "EXISTING_COMPONENT", productId: item.productId.trim(), quantity, baselineSource });
    } else if (item.type === "SIMULATED_COMPONENT") {
      const componentId = readId(item.componentId);
      if (!componentId || !componentIds.has(componentId)) {
        return fail("INVALID_COMPONENT_REF", `${where}: componente simulado não encontrado na simulação.`);
      }
      lines.push({ id, type: "SIMULATED_COMPONENT", componentId, quantity });
    } else if (item.type === "DIRECT_MATERIAL") {
      const description = readText(item.description, 300);
      if (!description) return fail("INVALID_DESCRIPTION", `${where}: descrição do material direto é obrigatória.`);
      const unitCost = readBounded(item.unitCost, 0, MAX_MONEY);
      if (unitCost == null) return fail("INVALID_UNIT_COST", `${where}: custo unitário deve ser um número ≥ 0.`);
      lines.push({
        id,
        type: "DIRECT_MATERIAL",
        description,
        unit: readText(item.unit, 20) || "UN",
        quantity,
        unitCost,
      });
    } else {
      return fail("INVALID_LINE_TYPE", `${where}: tipo de linha inválido.`);
    }
  }

  // Análise comercial da simulação
  const rawCommercial = isRecord(raw.commercial) ? raw.commercial : {};
  const mode = rawCommercial.mode === "TARGET_PRICE" ? "TARGET_PRICE" : "MARGIN";
  const desiredMarginPct =
    rawCommercial.desiredMarginPct == null || rawCommercial.desiredMarginPct === ""
      ? 0
      : readBounded(rawCommercial.desiredMarginPct, -100, 99.99);
  if (desiredMarginPct == null) return fail("INVALID_MARGIN", "Margem desejada deve estar entre −100% e 99,99%.");
  const targetPrice =
    rawCommercial.targetPrice == null || rawCommercial.targetPrice === ""
      ? 0
      : readBounded(rawCommercial.targetPrice, 0, MAX_MONEY);
  if (targetPrice == null) return fail("INVALID_TARGET_PRICE", "Preço alvo deve ser um número ≥ 0.");

  let premises: NewProductCommercialInput["premises"] = null;
  if (isRecord(rawCommercial.premises)) {
    const p = rawCommercial.premises;
    let taxRuleId: string | null = null;
    if (p.taxRuleId != null && p.taxRuleId !== "") {
      if (!isUuidString(p.taxRuleId)) return fail("INVALID_TAX_RULE_ID", "Regra fiscal inválida.");
      taxRuleId = p.taxRuleId.trim();
    }
    const taxRatePct = p.taxRatePct == null || p.taxRatePct === "" ? null : readBounded(p.taxRatePct, 0, 99.99);
    if (p.taxRatePct != null && p.taxRatePct !== "" && taxRatePct == null) {
      return fail("INVALID_TAX_RATE", "Impostos devem estar entre 0% e 99,99%.");
    }
    if (!taxRuleId && taxRatePct == null) {
      return fail("MISSING_TAX", "Informe a regra fiscal ou o percentual de impostos da análise comercial.");
    }
    const commissionRatePct = p.commissionRatePct == null || p.commissionRatePct === "" ? 0 : readBounded(p.commissionRatePct, 0, 99.99);
    const otherRatePct = p.otherRatePct == null || p.otherRatePct === "" ? 0 : readBounded(p.otherRatePct, 0, 99.99);
    const freight = p.freight == null || p.freight === "" ? 0 : readBounded(p.freight, 0, MAX_MONEY);
    if (commissionRatePct == null || otherRatePct == null || freight == null) {
      return fail("INVALID_PREMISES", "Comissão, outras variáveis e frete devem ser números ≥ 0.");
    }
    premises = { taxRuleId, taxRatePct, commissionRatePct, otherRatePct, freight };
  }

  return {
    ok: true,
    value: {
      simulationName,
      productName,
      productSku,
      notes,
      commercial: { mode, desiredMarginPct, targetPrice, premises },
      lines,
      simulatedComponents,
    },
  };
}

export function parseNewProductSaveBody(body: unknown): ParseResult<NewProductSaveRequest> {
  if (!isRecord(body)) return fail("INVALID_BODY", "Corpo da requisição inválido.");
  if ("snapshot" in body && !("inputs" in body)) {
    return fail(
      "SNAPSHOT_NOT_ACCEPTED",
      "O servidor não aceita mais snapshot calculado no navegador. Atualize a página e salve novamente."
    );
  }
  const inputs = parseNewProductSimulationInputs(body.inputs);
  if (inputs.ok === false) return fail(inputs.code, inputs.message);
  let draftId: string | null = null;
  if (body.draftId != null && body.draftId !== "") {
    if (!isUuidString(body.draftId)) return fail("INVALID_DRAFT_ID", "Rascunho inválido.");
    draftId = body.draftId.trim();
  }
  return { ok: true, value: { inputs: inputs.value, freeze: body.freeze !== false, draftId } };
}
