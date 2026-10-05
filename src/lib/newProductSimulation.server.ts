/**
 * Simulação de novo produto — o SERVIDOR é a autoridade do cálculo.
 *
 * O cliente envia INPUTS (composição, processo, materiais, premissas); aqui eles são
 * resolvidos contra o cadastro, calculados com as bibliotecas puras e transformados no
 * snapshot de SIMULAÇÃO. Somente leitura sobre o universo oficial: nenhum custo, preço,
 * ProductPricing ou tabela é escrito por este módulo.
 */
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  computeStandardProcessUnitCosts,
  resolveDefaultProcessHourCostsFromAnalysisCache,
  type DefaultProcessHourCosts,
} from "./componentStandardProcessCost.js";
import { computeMaterialEffectiveCost, requiredQuantityWithBomLoss } from "./materialEffectiveCost.js";
import {
  NEW_PRODUCT_SNAPSHOT_SCHEMA_VERSION,
  type NewProductSimulationSnapshot,
  type NewProductSnapshotAnalysis,
  type NewProductSnapshotCommercialPremises,
  type NewProductSnapshotComponent,
  type NewProductSnapshotLine,
} from "./newProductSimulationSnapshot.js";
import {
  marginFromCostAndPrice,
  markupFactor,
  markupPct,
  priceFromCostAndMargin,
  type CommercialPricePremises,
} from "./pricing/commercialPriceFormula.js";
import { NO_PUBLISHED_COST_MESSAGE, type ProductCostBaselineResult } from "./productCostBaseline.js";
import {
  resolveProductCostBaseline,
  type ProductCostBaselineDeps,
  type ProductCostBaselineEngine,
} from "./productCostBaseline.server.js";
import type {
  NewProductMaterialInput,
  NewProductSimulationInputs,
} from "./simulationsValidation.js";

export const NEW_PRODUCT_SIMULATION_ORIGIN = "NEW_PRODUCT_SANDBOX";

export type NewProductSimulationAuthor = { id: string | null; name: string | null };

export type NewProductSimulationComputeError = {
  ok: false;
  httpStatus: 400 | 404 | 422;
  code: string;
  message: string;
  /** Linhas/itens afetados (ex.: produtos sem custo publicado). */
  details?: Array<{ lineId?: string; productId?: string; message: string }>;
};

export type NewProductSimulationComputeResult =
  | { ok: true; snapshot: NewProductSimulationSnapshot; snapshotHash: string }
  | NewProductSimulationComputeError;

export type NewProductSimulationComputeDeps = ProductCostBaselineDeps & {
  /** Injetável em testes; default = resolver central. */
  resolveBaseline?: typeof resolveProductCostBaseline;
};

type MaterialRow = {
  id: string;
  code: string;
  description: string;
  unit: string;
  currentCost: unknown;
  freight: unknown;
  standardLoss: unknown;
};

const COST_OVERRIDE_TOLERANCE = 1e-6;

function pct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

/** Hash estável do snapshot (identidade do registro congelado). */
export function hashNewProductSimulationSnapshot(snapshot: NewProductSimulationSnapshot): string {
  return createHash("sha256").update(stableStringify(snapshot)).digest("hex");
}

function buildMaterialSnapshot(
  input: NewProductMaterialInput,
  catalog: MaterialRow | null
): NewProductSnapshotComponent["materials"][number] {
  const required = requiredQuantityWithBomLoss(input.quantity, input.bomLossPct).requiredQuantity;
  if (!catalog) {
    const unitCost = input.unitCost ?? 0;
    return {
      code: input.code,
      description: input.description,
      quantity: input.quantity,
      unit: input.unit,
      unitCost,
      total: required * unitCost,
      materialId: null,
      source: "MANUAL",
      catalogCurrentCost: null,
      catalogFreight: null,
      catalogStandardLossPct: null,
      catalogEffectiveUnitCost: null,
      costOverridden: false,
      bomLossPct: input.bomLossPct,
      requiredQuantity: required,
    };
  }
  const effective = computeMaterialEffectiveCost({
    currentCost: catalog.currentCost,
    freight: catalog.freight,
    standardLossPct: catalog.standardLoss,
  });
  const costOverridden =
    input.unitCost != null && Math.abs(input.unitCost - effective.effectiveCost) > COST_OVERRIDE_TOLERANCE;
  const unitCost = costOverridden ? (input.unitCost as number) : effective.effectiveCost;
  return {
    code: catalog.code,
    description: catalog.description,
    quantity: input.quantity,
    unit: catalog.unit,
    unitCost,
    total: required * unitCost,
    materialId: catalog.id,
    source: "CATALOG",
    catalogCurrentCost: Number(catalog.currentCost),
    catalogFreight: Number(catalog.freight ?? 0),
    catalogStandardLossPct: effective.standardLossPct,
    catalogEffectiveUnitCost: effective.effectiveCost,
    costOverridden,
    bomLossPct: input.bomLossPct,
    requiredQuantity: required,
  };
}

function buildAnalysis(
  costBase: number,
  commercial: NewProductSimulationInputs["commercial"],
  premises: NewProductSnapshotCommercialPremises | null
): { price: number | null; marginPct: number | null; analysis: NewProductSnapshotAnalysis } {
  const formulaPremises: CommercialPricePremises = premises
    ? {
        taxRatePct: premises.taxRatePct,
        commissionRatePct: premises.commissionRatePct,
        otherRatePct: premises.otherRatePct,
        freight: premises.freight,
      }
    : { taxRatePct: 0, commissionRatePct: 0, otherRatePct: 0, freight: 0 };
  const kind = premises ? "COMMERCIAL_SIMULATED" : "INDUSTRIAL_PRELIMINARY";
  const priceLabel = premises
    ? "Preço simulado (premissas comerciais da simulação)"
    : "Preço industrial preliminar (sem impostos, comissão e frete)";

  let price: number | null = null;
  let marginPct: number | null = null;
  let error: NewProductSnapshotAnalysis["error"] = null;

  if (commercial.mode === "MARGIN") {
    const calc = priceFromCostAndMargin(costBase, formulaPremises, commercial.desiredMarginPct);
    if (calc.ok === true) {
      price = calc.price;
      marginPct = calc.marginRatePct;
    } else {
      error = { code: calc.code, message: calc.message };
    }
  } else {
    const calc = marginFromCostAndPrice(costBase, formulaPremises, commercial.targetPrice);
    if (calc.ok === true) {
      price = calc.price;
      marginPct = calc.marginRatePct;
    } else {
      error = { code: calc.code, message: calc.message };
    }
  }

  const marginSign: NewProductSnapshotAnalysis["marginSign"] =
    marginPct == null || price == null
      ? "INDETERMINADA"
      : marginPct > 0 && price > costBase
        ? "POSITIVA"
        : "NULA_OU_NEGATIVA";

  return {
    price,
    marginPct,
    analysis: {
      kind,
      priceLabel,
      marginSign,
      markupFactor: price == null ? null : markupFactor(price, costBase),
      markupPct: price == null ? null : markupPct(price, costBase),
      error,
    },
  };
}

export async function computeNewProductSimulationSnapshot(
  db: PrismaClient,
  engine: ProductCostBaselineEngine,
  inputs: NewProductSimulationInputs,
  ctx: { now: Date; author: NewProductSimulationAuthor; createdAt?: Date | null },
  deps: NewProductSimulationComputeDeps = {}
): Promise<NewProductSimulationComputeResult> {
  const resolveBaseline = deps.resolveBaseline ?? resolveProductCostBaseline;
  const nowIso = ctx.now.toISOString();

  // 1. Taxas-hora da engenharia (mesma fonte do motor oficial) — só se houver processo padrão.
  let hourCosts: DefaultProcessHourCosts | null = null;
  const needsHourCosts = inputs.simulatedComponents.some((c) => c.process.mode === "STANDARD");
  if (needsHourCosts) {
    const cache = await engine.initAnalysisCache();
    const resolved = resolveDefaultProcessHourCostsFromAnalysisCache(cache);
    if (!resolved.available) {
      return {
        ok: false,
        httpStatus: 422,
        code: "HOUR_COSTS_UNAVAILABLE",
        message: "Não foi possível carregar o custo default de HH/HM. Verifique Configurações Gerais.",
      };
    }
    hourCosts = resolved;
  }

  // 2. Materiais do cadastro (custo vivo de Suprimentos, registrado no snapshot).
  const materialIds = [
    ...new Set(
      inputs.simulatedComponents.flatMap((c) => c.materials.map((m) => m.materialId)).filter(Boolean)
    ),
  ] as string[];
  const materialRows: MaterialRow[] =
    materialIds.length > 0
      ? await db.material.findMany({
          where: { id: { in: materialIds } },
          select: {
            id: true,
            code: true,
            description: true,
            unit: true,
            currentCost: true,
            freight: true,
            standardLoss: true,
          },
        })
      : [];
  const materialById = new Map(materialRows.map((m) => [m.id, m]));
  const missingMaterial = materialIds.find((id) => !materialById.has(id));
  if (missingMaterial) {
    return {
      ok: false,
      httpStatus: 422,
      code: "MATERIAL_NOT_FOUND",
      message: "Um material selecionado não existe mais no cadastro de Suprimentos.",
    };
  }

  // 3. Componentes simulados.
  const components: NewProductSnapshotComponent[] = [];
  for (const component of inputs.simulatedComponents) {
    const materials = component.materials.map((m) =>
      buildMaterialSnapshot(m, m.materialId ? (materialById.get(m.materialId) ?? null) : null)
    );
    const mp = materials.reduce((acc, m) => acc + m.total, 0);

    let hh = 0;
    let hm = 0;
    let processInputs: NewProductSnapshotComponent["processInputs"];
    let processResult: NewProductSnapshotComponent["processResult"];
    if (component.process.mode === "STANDARD") {
      const computed = computeStandardProcessUnitCosts({
        cycleTimeSeconds: component.process.cycleTimeSeconds,
        cavities: component.process.cavities,
        efficiencyExpectedPercent: component.process.efficiencyExpectedPercent,
        setupTimeMin: component.process.setupTimeMin,
        lotSize: component.process.lotSize,
        globalHhCostPerHour: (hourCosts as DefaultProcessHourCosts).globalHhCostPerHour,
        machineHourCostPerHour: (hourCosts as DefaultProcessHourCosts).machineHourCostPerHour,
      });
      if (computed.ok === false) {
        return {
          ok: false,
          httpStatus: 422,
          code: computed.errorCode,
          message: `Componente simulado «${component.name}»: ${computed.message}`,
        };
      }
      hh = computed.totalHH_Unit;
      hm = computed.totalHM_Unit;
      processInputs = {
        useDefaultHourCosts: true,
        cycleTimeSeconds: component.process.cycleTimeSeconds,
        cavities: component.process.cavities,
        efficiencyExpectedPercent: component.process.efficiencyExpectedPercent,
        setupTimeMin: component.process.setupTimeMin,
        lotSize: component.process.lotSize,
      };
      processResult = {
        source: "DEFAULT",
        hhRatePerHour: computed.globalHhCostPerHour,
        hmRatePerHour: computed.machineHourCostPerHour,
        hhSource: (hourCosts as DefaultProcessHourCosts).hhSource,
        netPph: computed.netPph,
        unitTransform: computed.unitTransform,
        setupCost: computed.setupCost,
        totalStepCost: computed.totalStepCost,
      };
    } else {
      hh = component.process.manualHh;
      hm = component.process.manualHm;
      processInputs = {
        useDefaultHourCosts: false,
        manualHh: component.process.manualHh,
        manualHm: component.process.manualHm,
      };
      processResult = {
        source: "MANUAL",
        hhRatePerHour: null,
        hmRatePerHour: null,
        hhSource: null,
        netPph: null,
        unitTransform: null,
        setupCost: null,
        totalStepCost: hh + hm,
      };
    }

    const costBase = mp + hh + hm;
    components.push({
      id: component.id,
      name: component.name,
      sku: component.sku ?? undefined,
      hh,
      hm,
      costBase,
      mp,
      mpPct: pct(mp, costBase),
      hhPct: pct(hh, costBase),
      hmPct: pct(hm, costBase),
      processInputs,
      processResult,
      materials,
    });
  }
  const componentById = new Map(components.map((c) => [c.id, c]));

  // 4. Componentes existentes — base explícita por linha, sem fallback entre fontes.
  const baselineCache = new Map<string, ProductCostBaselineResult>();
  const unavailable: NonNullable<NewProductSimulationComputeError["details"]> = [];
  for (const line of inputs.lines) {
    if (line.type !== "EXISTING_COMPONENT") continue;
    const key = `${line.productId}|${line.baselineSource}`;
    if (!baselineCache.has(key)) {
      baselineCache.set(
        key,
        await resolveBaseline(
          db,
          engine,
          { productId: line.productId, source: line.baselineSource, context: "NEW_PRODUCT_SIMULATION" },
          { ...deps, now: () => ctx.now }
        )
      );
    }
    const resolved = baselineCache.get(key) as ProductCostBaselineResult;
    if (resolved.status !== "OK") {
      unavailable.push({
        lineId: line.id,
        productId: line.productId,
        message: resolved.status === "NO_PUBLISHED_COST" ? NO_PUBLISHED_COST_MESSAGE : resolved.message,
      });
    }
  }
  if (unavailable.length > 0) {
    const onlyUnpublished = [...baselineCache.values()].every(
      (r) => r.status === "OK" || r.status === "NO_PUBLISHED_COST"
    );
    return {
      ok: false,
      httpStatus: 422,
      code: onlyUnpublished ? "NO_PUBLISHED_COST" : "BASELINE_UNAVAILABLE",
      message: onlyUnpublished
        ? "Há componentes existentes sem custo oficial publicado. Publique o custo ou escolha explicitamente a engenharia atual (não publicada) para essas linhas."
        : "Não foi possível obter o custo base de um ou mais componentes existentes.",
      details: unavailable,
    };
  }

  // 5. Linhas e totais.
  const lines: NewProductSnapshotLine[] = [];
  const totals = { mp: 0, hh: 0, hm: 0 };
  for (const line of inputs.lines) {
    if (line.type === "DIRECT_MATERIAL") {
      const lineTotal = line.quantity * line.unitCost;
      lines.push({
        id: line.id,
        type: "DIRECT_MATERIAL",
        description: line.description,
        unit: line.unit,
        quantity: line.quantity,
        unitCost: line.unitCost,
        lineTotal,
        breakdown: { mp: lineTotal, hh: 0, hm: 0 },
        costOrigin: "MANUAL_DIRECT",
      });
      totals.mp += lineTotal;
      continue;
    }
    if (line.type === "SIMULATED_COMPONENT") {
      const component = componentById.get(line.componentId) as NewProductSnapshotComponent;
      const breakdown = {
        mp: component.mp * line.quantity,
        hh: component.hh * line.quantity,
        hm: component.hm * line.quantity,
      };
      lines.push({
        id: line.id,
        type: "SIMULATED_COMPONENT",
        referenceId: component.id,
        referenceSku: component.sku ?? null,
        referenceLabel: `${component.sku ? `${component.sku} — ` : ""}${component.name}`,
        quantity: line.quantity,
        unitCost: component.costBase,
        lineTotal: component.costBase * line.quantity,
        breakdown,
        costOrigin: "SIMULATED_COMPONENT",
      });
      totals.mp += breakdown.mp;
      totals.hh += breakdown.hh;
      totals.hm += breakdown.hm;
      continue;
    }
    const resolved = baselineCache.get(`${line.productId}|${line.baselineSource}`);
    if (!resolved || resolved.status !== "OK") {
      return { ok: false, httpStatus: 422, code: "BASELINE_UNAVAILABLE", message: "Custo base indisponível." };
    }
    const unitCost = resolved.totalMaterialCost + resolved.totalHHUnit + resolved.totalHMUnit;
    const breakdown = {
      mp: resolved.totalMaterialCost * line.quantity,
      hh: resolved.totalHHUnit * line.quantity,
      hm: resolved.totalHMUnit * line.quantity,
    };
    lines.push({
      id: line.id,
      type: "EXISTING_COMPONENT",
      referenceId: resolved.productId,
      referenceSku: resolved.sku,
      referenceLabel: `${resolved.sku ? `${resolved.sku} — ` : ""}${resolved.name ?? "Componente existente"}`,
      quantity: line.quantity,
      unitCost,
      lineTotal: unitCost * line.quantity,
      breakdown,
      costOrigin: "EXISTING_PRODUCT",
      baseline: {
        source: resolved.source,
        productionCostVersionId: resolved.productionCostVersionId,
        productionCostVersionCode: resolved.productionCostVersionCode,
        productionCostRevision: resolved.productionCostRevision,
        effectiveDate: resolved.effectiveDate,
        calculatedAt: resolved.calculatedAt,
        unitMp: resolved.totalMaterialCost,
        unitHh: resolved.totalHHUnit,
        unitHm: resolved.totalHMUnit,
        warnings: resolved.warnings.map((w) => w.message),
      },
    });
    totals.mp += breakdown.mp;
    totals.hh += breakdown.hh;
    totals.hm += breakdown.hm;
  }
  const costBase = totals.mp + totals.hh + totals.hm;

  // 6. Premissas comerciais DA SIMULAÇÃO (leitura da regra fiscal; nada é gravado em ProductPricing).
  let premises: NewProductSnapshotCommercialPremises | null = null;
  const rawPremises = inputs.commercial.premises;
  if (rawPremises) {
    let taxRatePct = rawPremises.taxRatePct;
    let taxRuleName: string | null = null;
    if (rawPremises.taxRuleId) {
      const rule = await db.taxRule.findUnique({
        where: { id: rawPremises.taxRuleId },
        select: { name: true, TaxComponent: { select: { percentage: true } } },
      });
      if (!rule) {
        return { ok: false, httpStatus: 422, code: "TAX_RULE_NOT_FOUND", message: "Regra fiscal não encontrada." };
      }
      taxRuleName = rule.name;
      taxRatePct = rule.TaxComponent.reduce((acc, c) => acc + Number(c.percentage), 0);
    }
    premises = {
      taxRuleId: rawPremises.taxRuleId,
      taxRuleName,
      taxRatePct: taxRatePct ?? 0,
      commissionRatePct: rawPremises.commissionRatePct,
      otherRatePct: rawPremises.otherRatePct,
      freight: rawPremises.freight,
    };
  }
  const analysis = buildAnalysis(costBase, inputs.commercial, premises);

  const snapshot: NewProductSimulationSnapshot = {
    schemaVersion: NEW_PRODUCT_SNAPSHOT_SCHEMA_VERSION,
    kind: "SIMULATION_SNAPSHOT",
    inputs,
    hourCosts: hourCosts
      ? {
          globalHhCostPerHour: hourCosts.globalHhCostPerHour,
          machineHourCostPerHour: hourCosts.machineHourCostPerHour,
          hhSource: hourCosts.hhSource,
        }
      : null,
    header: {
      simulationName: inputs.simulationName,
      productName: inputs.productName,
      productSku: inputs.productSku ?? undefined,
      notes: inputs.notes ?? undefined,
      createdAt: (ctx.createdAt ?? ctx.now).toISOString(),
      savedAt: nowIso,
      createdBy: ctx.author.name ?? undefined,
      createdByUserId: ctx.author.id,
      origin: NEW_PRODUCT_SIMULATION_ORIGIN,
    },
    commercial: {
      mode: inputs.commercial.mode,
      desiredMarginPct: inputs.commercial.desiredMarginPct,
      targetPrice: inputs.commercial.targetPrice,
      premises,
    },
    composition: { lines, simulatedComponents: components },
    result: {
      mp: totals.mp,
      hh: totals.hh,
      hm: totals.hm,
      costBase,
      mpPct: pct(totals.mp, costBase),
      hhPct: pct(totals.hh, costBase),
      hmPct: pct(totals.hm, costBase),
      price: analysis.price,
      marginPct: analysis.marginPct,
      analysis: analysis.analysis,
    },
  };

  return { ok: true, snapshot, snapshotHash: hashNewProductSimulationSnapshot(snapshot) };
}
