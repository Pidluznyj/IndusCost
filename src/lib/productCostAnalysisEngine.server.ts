/**
 * Motor oficial getProductCostAnalysis — compartilhado entre server HTTP e scripts Nomus.
 */
import type { PrismaClient } from "@prisma/client";
import {
  aggregateParentDecomposition,
  scaleChildContribution,
  type ChildScaledContribution,
  type ChildUnitAnalysis,
} from "./costRollup.js";
import {
  buildExcludedBomLineRecord,
  type ExcludedBomLineRecord,
} from "./costAnalysisPartial.js";
import { computeStandardProcessUnitCosts } from "./componentStandardProcessCost.js";

export interface AnalysisCache {
  indirectCosts: any[];
  factoryHoursMonthly: number;
  globalHhCost: number;
  energyCost: number;
  workingHours: number;
  opexRatePerHour: number;
  hhSource?: "AUTO" | "MANUAL";
  autoHhCost?: number;
}

export type ProductCostAnalysisEngine = {
  initAnalysisCache: () => Promise<AnalysisCache>;
  getProductCostAnalysis: (
    productId: string,
    cache?: AnalysisCache,
    includeDetails?: boolean,
    pathStack?: Set<string>
  ) => Promise<unknown>;
  isCostAnalysisFailure: (x: unknown) => x is { error: string; message?: string };
  describeCostAnalysisFailure: (failure: unknown, depth?: number) => string;
};

export function createProductCostAnalysisEngine(prisma: PrismaClient): ProductCostAnalysisEngine {
async function initAnalysisCache() {
  const indirects = await prisma.indirectCost.findMany({ where: { status: "ACTIVE" } });
  const factoryHoursParam = indirects.find(c => c.category === "GLOBAL_PARAM" && c.description === "FACTORY_HOURS_MONTHLY");
  const energyParam = indirects.find(c => c.category === "GLOBAL_PARAM" && c.description === "ENERGY_COST");
  const hoursParam = indirects.find(c => c.category === "GLOBAL_PARAM" && c.description === "WORKING_HOURS");
  const hhOverrideParam = indirects.find(c => c.category === "GLOBAL_PARAM" && c.description === "HH_VALUE_OVERRIDE");
  
  const fhMonthlyRaw = Number(factoryHoursParam?.monthlyValue);
  const energyRaw    = Number(energyParam?.monthlyValue);
  const hoursRaw     = Number(hoursParam?.monthlyValue);

  if (!factoryHoursParam || !Number.isFinite(fhMonthlyRaw) || fhMonthlyRaw <= 0)
    throw new Error("CONFIG_MISSING: FACTORY_HOURS_MONTHLY inválido.");
  if (!energyParam || !Number.isFinite(energyRaw))
    throw new Error("CONFIG_MISSING: ENERGY_COST inválido.");
  if (!hoursParam || !Number.isFinite(hoursRaw) || hoursRaw <= 0)
    throw new Error("CONFIG_MISSING: WORKING_HOURS inválido.");

  const allEmps = await prisma.employee.findMany({ include: { Role: true, EmployeePayrollComponent: { include: { PayrollComponent: true } } } });
  let megaPayroll = 0;
  allEmps.forEach(e => {
      const sal = Number(e.salary || e.Role?.baseSalary || 0);
      let loads = 0;
      e.EmployeePayrollComponent.forEach(r => {
          loads += r.PayrollComponent.calculationType === "PERCENTAGE" ? (sal * Number(r.PayrollComponent.value)) / 100 : Number(r.PayrollComponent.value);
      });
      megaPayroll += sal + loads;
  });
  
  const autoHhCost = megaPayroll / (fhMonthlyRaw || 1);
  
  let globalHhCost = 0;
  let hhSource: "AUTO" | "MANUAL" = "AUTO";

  const overrideVal = Number(hhOverrideParam?.monthlyValue);
  if (hhOverrideParam && Number.isFinite(overrideVal) && overrideVal > 0) {
    globalHhCost = overrideVal;
    hhSource = "MANUAL";
  } else {
    globalHhCost = autoHhCost;
    hhSource = "AUTO";
  }

  const totalOpex = indirects.filter(c => c.category !== "CIF" && c.category !== "GLOBAL_PARAM").reduce((acc, c) => acc + Number(c.monthlyValue), 0);

  return { 
    indirectCosts: indirects, 
    factoryHoursMonthly: fhMonthlyRaw, 
    energyCost: energyRaw, 
    workingHours: hoursRaw, 
    globalHhCost,
    hhSource,
    autoHhCost,
    opexRatePerHour: totalOpex / fhMonthlyRaw 
  };
}

function isCostAnalysisFailure(x: unknown): x is { error: string; message?: string } {
  return typeof x === "object" && x !== null && "error" in x && typeof (x as { error: unknown }).error === "string";
}

function describeCostAnalysisFailure(failure: unknown, depth = 0): string {
  if (depth > 8) return "(cadeia de erros truncada)";
  if (!failure || typeof failure !== "object" || !("error" in failure)) return "erro de custeio desconhecido";
  const f = failure as { error: string; message?: string; cause?: unknown };
  const head =
    typeof f.message === "string" && f.message.trim().length > 0 ? `${f.error}: ${f.message}` : f.error;
  if (
    f.cause !== undefined &&
    f.cause !== null &&
    typeof f.cause === "object" &&
    "error" in (f.cause as object)
  ) {
    return `${head} → ${describeCostAnalysisFailure(f.cause, depth + 1)}`;
  }
  return head;
}

/** Avisos técnicos (cadastro/custeio suspeito). Não substituem erro fatal. */
type CostAnalysisWarning = {
  code: string;
  severity: "warning";
  message: string;
  context: "MATERIAL" | "CHILD_COMPONENT" | "BOM_LINE";
  materialId?: string;
  childProductId?: string;
  bomLineId?: string;
  sku?: string;
  name?: string;
};

function mergeCostWarnings(
  parent: CostAnalysisWarning[],
  nested: unknown
): void {
  if (!nested || typeof nested !== "object" || !("warnings" in nested)) return;
  const w = (nested as { warnings?: unknown }).warnings;
  if (!Array.isArray(w)) return;
  for (const x of w) {
    if (x && typeof x === "object" && "message" in x && "code" in x) {
      parent.push(x as CostAnalysisWarning);
    }
  }
}

/**
 * Rótulo da origem do processo próprio do item, espelhando a precedência do motor (sem recalcular custos).
 * PRODUCT com ciclo: padrão; caso contrário, roteiro se houver; senão processo padrão se houver ciclo.
 */
function inferOwnProcessSourceForMotorDisplay(input: {
  type: string;
  cycleTimeSeconds: unknown | null;
  routingCount: number;
}): "ROUTING" | "STANDARD_PROCESS" {
  const productHasStandardCycle =
    input.cycleTimeSeconds !== null && Number(input.cycleTimeSeconds) > 0;
  const preferStandardOverRouting = input.type === "PRODUCT" && productHasStandardCycle;
  if (preferStandardOverRouting) return "STANDARD_PROCESS";
  if (input.routingCount > 0) return "ROUTING";
  if (productHasStandardCycle) return "STANDARD_PROCESS";
  return "STANDARD_PROCESS";
}

async function getProductCostAnalysis(
  productId: string,
  cache?: AnalysisCache,
  includeDetails = false,
  pathStack?: Set<string>
) {
  if (!cache) {
    try {
      const newCache = await initAnalysisCache();
      return getProductCostAnalysis(productId, newCache, includeDetails, pathStack);
    } catch (e: any) {
      return { error: "CONFIG_MISSING", message: e.message };
    }
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      ProductBOM: { orderBy: { id: "asc" }, include: { Material: true } },
      ProductRouting: { include: { Machine: { include: { MachineCostComponent: true } }, Role: true } },
    },
  });

  if (!product) return null;

  const stack = pathStack ?? new Set<string>();
  if (stack.has(productId)) {
    return {
      error: "BOM_CYCLE",
      message:
        "Ciclo estrutural na BOM: um produto/componente aparece mais de uma vez no caminho recursivo de custeio.",
      cycleProductId: productId,
    };
  }

  stack.add(productId);
  try {
  const lotSize = Number(product.defaultLotSize) || 1;

  const warnings: CostAnalysisWarning[] = [];
  /** Filho custeado com cálculo parcial (exclusões na subárvore). */
  let hasDescendantPartialCost = false;
  /** Evita segunda passagem recursiva no bloco `details` (mesmo resultado da primeira). */
  const bomLineChildAnalysisCache = new Map<string, Record<string, unknown>>();
  /** Linhas da BOM cujo filho não foi custeado — excluídas da soma (cálculo parcial). */
  const bomLineExcludedByLineId = new Map<string, ExcludedBomLineRecord>();
  /** Parcelas de HH/HM de componentes fabricados já agregadas em `childScaledContributions` (só para detalhe UI do PRODUTO). */
  const childBomConversionRollups: Array<{
    bomLineId: string;
    childProductId: string;
    sku: string;
    name: string;
    requiredQty: number;
    hhScaled: number;
    hmScaled: number;
  }> = [];

  // 1. Materiais / Componentes (Recurso) — recursão com pathStack; ciclo detectado; erros de filho propagam (nunca custo zero por falha silenciosa)
  const materialLineCosts: number[] = [];
  let directMaterialBOMTotal = 0;
  const childScaledContributions: ChildScaledContribution[] = [];
  for (const item of product.ProductBOM) {
    if (item.Material) {
      const mat = item.Material;
      const landedCost = Number(mat.currentCost) + Number(mat.freight);
      if (!Number.isFinite(landedCost) || landedCost <= 0) {
        warnings.push({
          code: "MATERIAL_ZERO_OR_INVALID_LANDED_COST",
          severity: "warning",
          message: `Matéria-prima [${mat.code}] (${mat.description}) com custo aterrissado zerado ou inválido — revisar cadastro de custo/frete.`,
          context: "MATERIAL",
          materialId: mat.id,
          sku: mat.code,
          name: mat.description,
          bomLineId: item.id,
        });
      }
      const matEffectiveCost = landedCost / (1 - (Number(mat.standardLoss) / 100));
      const requiredQty = Number(item.quantity) / (1 - (Number(item.lossPercentage) / 100));
      const lineTotal = matEffectiveCost * requiredQty;
      if (lineTotal === 0 && landedCost > 0) {
        warnings.push({
          code: "BOM_LINE_ZERO_TOTAL_DESPITE_MATERIAL_COST",
          severity: "warning",
          message: `Linha BOM [${product.sku}] matéria [${mat.code}]: custo de linha zerado (quantidade/perdas?) — revisar.`,
          context: "MATERIAL",
          materialId: mat.id,
          sku: mat.code,
          bomLineId: item.id,
        });
      }
      materialLineCosts.push(lineTotal);
      directMaterialBOMTotal += lineTotal;
      continue;
    }

    if (item.childProductId) {
      const childAnalysis = await getProductCostAnalysis(item.childProductId, cache, false, stack);
      if (childAnalysis === null) {
        const notFoundFailure = {
          error: "CHILD_NOT_FOUND" as const,
          message: `Componente referenciado na BOM de [${product.sku}] não existe (ID órfão).`,
        };
        const childProd = await prisma.product.findUnique({
          where: { id: item.childProductId },
          select: { sku: true, name: true, type: true },
        });
        const chain = describeCostAnalysisFailure(notFoundFailure);
        const ex = buildExcludedBomLineRecord({
          bomLineId: item.id,
          childProductId: item.childProductId,
          sku: childProd?.sku ?? null,
          name: childProd?.name ?? null,
          itemType: childProd?.type ?? null,
          errorCode: notFoundFailure.error,
          failure: notFoundFailure,
          detailChain: chain,
        });
        bomLineExcludedByLineId.set(item.id, ex);
        warnings.push({
          code: "BOM_CHILD_EXCLUDED_FROM_COST",
          severity: "warning",
          message: `Componente não custeado (excluído do total): ${chain}. Complete o cadastro ou corrija a referência para incluir no cálculo.`,
          context: "CHILD_COMPONENT",
          childProductId: item.childProductId,
          sku: ex.sku ?? undefined,
          name: ex.name ?? undefined,
          bomLineId: item.id,
        });
        continue;
      }
      if (isCostAnalysisFailure(childAnalysis)) {
        const childProd = await prisma.product.findUnique({
          where: { id: item.childProductId },
          select: { sku: true, name: true, type: true },
        });
        const chain = describeCostAnalysisFailure(childAnalysis);
        const errCode = (childAnalysis as { error: string }).error;
        const ex = buildExcludedBomLineRecord({
          bomLineId: item.id,
          childProductId: item.childProductId,
          sku: childProd?.sku ?? null,
          name: childProd?.name ?? null,
          itemType: childProd?.type ?? null,
          errorCode: errCode,
          failure: childAnalysis as { error: string; message?: string },
          detailChain: chain,
        });
        bomLineExcludedByLineId.set(item.id, ex);
        warnings.push({
          code: "BOM_CHILD_EXCLUDED_FROM_COST",
          severity: "warning",
          message: `Componente [${childProd?.sku ?? "?"}] não custeado (excluído do total). Motivo: ${chain}. Complete o cadastro do componente para incluir no cálculo.`,
          context: "CHILD_COMPONENT",
          childProductId: item.childProductId,
          sku: childProd?.sku ?? undefined,
          name: childProd?.name ?? undefined,
          bomLineId: item.id,
        });
        continue;
      }
      bomLineChildAnalysisCache.set(item.id, childAnalysis as Record<string, unknown>);
      mergeCostWarnings(warnings, childAnalysis);
      if ((childAnalysis as { costAnalysisPartial?: boolean }).costAnalysisPartial === true) {
        hasDescendantPartialCost = true;
      }

      const childUnitCost =
        Number(childAnalysis.totalMaterialCost) +
        Number(childAnalysis.totalHH_Unit) +
        Number(childAnalysis.totalHM_Unit);
      if (!Number.isFinite(childUnitCost) || childUnitCost <= 0) {
        warnings.push({
          code: "CHILD_ZERO_OR_INVALID_INDUSTRIAL_COST",
          severity: "warning",
          message: `Componente filho [${childAnalysis.sku ?? "?"}] (${childAnalysis.name ?? "—"}) com custo industrial total zerado ou inválido — revisar processo/BOM/custeio do filho.`,
          context: "CHILD_COMPONENT",
          childProductId: item.childProductId,
          sku: childAnalysis.sku,
          name: childAnalysis.name,
          bomLineId: item.id,
        });
      }
      const requiredQty = Number(item.quantity) / (1 - (Number(item.lossPercentage) / 100));
      const scaled = scaleChildContribution(childAnalysis as ChildUnitAnalysis, requiredQty);
      childScaledContributions.push(scaled);
      materialLineCosts.push(scaled.structuralLine);
      childBomConversionRollups.push({
        bomLineId: item.id,
        childProductId: item.childProductId,
        sku: String((childAnalysis as { sku?: string }).sku ?? "?"),
        name: String((childAnalysis as { name?: string }).name ?? "—"),
        requiredQty,
        hhScaled: scaled.hh,
        hmScaled: scaled.hm,
      });
      continue;
    }

    const incompleteFailure = {
      error: "BOM_LINE_INCOMPLETE" as const,
      message: `Linha da BOM de [${product.sku}] sem material ou componente associado — estrutura inválida para custeio.`,
    };
    const incChain = describeCostAnalysisFailure(incompleteFailure);
    bomLineExcludedByLineId.set(
      item.id,
      buildExcludedBomLineRecord({
        bomLineId: item.id,
        childProductId: null,
        sku: null,
        name: null,
        itemType: null,
        errorCode: incompleteFailure.error,
        failure: incompleteFailure,
        detailChain: incChain,
      })
    );
    warnings.push({
      code: "BOM_LINE_INCOMPLETE",
      severity: "warning",
      message: `${incompleteFailure.message} Linha excluída do total até ser corrigida.`,
      context: "BOM_LINE",
      bomLineId: item.id,
    });
    continue;
  }
  const materialStructuralTotal = materialLineCosts.reduce((acc, u) => acc + u, 0);

  // 2. Operações (prioridade)
  // - PRODUCT com ciclo (molde): processo padrão antes do roteiro (evita custear só BOM quando há molde no PF).
  // - Demais casos: roteiro explícito antes do processo padrão — ao zerar o roteiro, o detalhamento deixa de listar operações do roteiro (cai para processo padrão só se existir).
  type OperationRow = {
    totalHH: number;
    totalHM: number;
    totalTimeH: number;
    breakdown?: any;
  };
  let operationItems: OperationRow[] = [];

  const productHasStandardCycle =
    product.cycleTimeSeconds !== null && Number(product.cycleTimeSeconds) > 0;
  const preferStandardOverRouting = product.type === "PRODUCT" && productHasStandardCycle;

  /**
   * Modo de custeio: define se o motor adiciona HH/HM próprio neste nível.
   * - OWN_PROCESS (default): comportamento atual (BOM + processo/roteiro próprio).
   * - BOM_ONLY: só soma a BOM neste nível; HH/HM próprio = 0.
   * - FINISHING_SERVICE: igual BOM_ONLY; cromagem/beneficiamento entra como linha de BOM.
   * Os custos dos filhos (childProductId) continuam sendo somados normalmente — eles calculam
   * o próprio processo dentro da própria análise recursiva.
   */
  const costingMode = product.costingMode ?? "OWN_PROCESS";
  const skipOwnProcess = costingMode !== "OWN_PROCESS";
  const ownProcessSkipReason: string | null = skipOwnProcess
    ? costingMode === "FINISHING_SERVICE"
      ? "Processo próprio ignorado porque o item está configurado como Acabamento/beneficiamento."
      : "Processo próprio ignorado porque o item está configurado como Somente composição da BOM."
    : null;

  const buildStandardOperationItems = (): OperationRow[] | { error: string; message: string } => {
    if (!productHasStandardCycle) {
      return [];
    }
    const cycle = Number(product.cycleTimeSeconds);
    const cav = Number(product.cavities);
    const eff = Number(product.efficiencyExpected);
    const setup = Number(product.setupTimeMin);

    if (!Number.isFinite(cycle) || cycle <= 0 || !Number.isFinite(cav) || cav < 1 || !Number.isFinite(eff) || eff <= 0 || !Number.isFinite(setup)) {
      return { error: "PROCESS_INVALID", message: `Componente [${product.sku}]: Processo Padrão com dados inválidos.` };
    }

    const machineHourCost = cache.energyCost / cache.workingHours;
    const computed = computeStandardProcessUnitCosts({
      cycleTimeSeconds: cycle,
      cavities: cav,
      efficiencyExpectedPercent: eff,
      setupTimeMin: setup,
      lotSize,
      globalHhCostPerHour: cache.globalHhCost,
      machineHourCostPerHour: machineHourCost,
    });
    if (!computed.ok) {
      return { error: "PROCESS_INVALID", message: `Componente [${product.sku}]: Processo Padrão com dados inválidos.` };
    }

    const { cellHourCost, netPph, unitTransform, setupCost, totalStepCost } = computed;
    const setupH = setup / 60;
    const hhRatio = cellHourCost > 0 ? cache.globalHhCost / cellHourCost : 0;
    const hmRatio = cellHourCost > 0 ? machineHourCost / cellHourCost : 0;

    return [
      {
        totalHH: computed.totalHH_Unit,
        totalHM: computed.totalHM_Unit,
        totalTimeH: (1 / netPph) + (setupH / lotSize),
        breakdown: {
          source: "STANDARD_PROCESS",
          description: "Processo Padrão do Componente",
          timeMin: (1 / netPph) * 60,
          ratePerMin: cellHourCost / 60,
          machineCost: unitTransform * hmRatio + setupCost * hmRatio,
          laborCost: unitTransform * hhRatio + setupCost * hhRatio,
          total: totalStepCost,
          calculationDetails: {
            cycle,
            cavities: cav,
            efficiency: eff,
            setupTimeMin: setup,
            lotSize,
            workingHours: cache.workingHours,
            energyCost: cache.energyCost,
            factoryHoursMonthly: cache.factoryHoursMonthly,
            globalHhCost: cache.globalHhCost,
            machineHourCost,
            cellHourCost,
            netPph,
            unitTransform,
            setupCost,
            totalStepCost,
          },
        },
      },
    ];
  };

  if (skipOwnProcess) {
    operationItems = [];
  } else if (preferStandardOverRouting) {
    const std = buildStandardOperationItems();
    if (!Array.isArray(std)) return std;
    operationItems = std;
  } else if (product.ProductRouting.length > 0) {
    // Roteiro (operações explícitas)
    const rolesWithComponents = await Promise.all(product.ProductRouting.map(async (step) => {
      const emp = await prisma.employee.findFirst({
        where: { roleId: step.roleId },
        include: { EmployeePayrollComponent: { include: { PayrollComponent: true } } }
      });
      return { roleId: step.roleId, components: emp?.EmployeePayrollComponent || [] };
    }));

    operationItems = product.ProductRouting.map((step) => {
      const roleData = rolesWithComponents.find(rc => rc.roleId === step.roleId);
      const machineHourCost = cache.energyCost / cache.workingHours;
      const salary = Number(step.Role?.baseSalary || 0);
      let totalPayrollLoad = 0;
      const payrollComponents = roleData?.components || [];
      
      if (payrollComponents.length > 0) {
        payrollComponents.forEach((rel: any) => {
          const comp = rel.PayrollComponent;
          totalPayrollLoad += comp.calculationType === "PERCENTAGE" ? (salary * Number(comp.value)) / 100 : Number(comp.value);
        });
      } else {
        totalPayrollLoad = salary * 0.8;
      }

      const hhCost = (salary + totalPayrollLoad) / Number(step.Role?.monthlyHours || 220);
      const cellHourCost = machineHourCost + hhCost;

      const cycle = Number(step.cycleTimeSeconds) > 0 ? Number(step.cycleTimeSeconds) : (Number(step.operationTimeMin) > 0 ? Number(step.operationTimeMin) * 60 : 30);
      const cav = Number(step.cavities) >= 1 ? Number(step.cavities) : 1;
      const eff = Number(step.efficiencyExpected) > 0 ? Number(step.efficiencyExpected) : 100;
      const effDecimal = eff / 100;

      const netPph = (3600 / cycle) * cav * effDecimal;
      const unitTransform = cellHourCost / netPph;
      const setupH = Number(step.setupTimeMin) / 60;
      const setupCost = (setupH * cellHourCost) / lotSize;
      const totalStepCost = unitTransform + setupCost;

      return {
        totalHH: totalStepCost * (cellHourCost > 0 ? hhCost / cellHourCost : 0),
        totalHM: totalStepCost * (cellHourCost > 0 ? machineHourCost / cellHourCost : 0),
        totalTimeH: (1 / netPph) + (setupH / lotSize),
        breakdown: {
          source: "ROUTING",
          description: step.description || `Op. ${step.sequence}`,
          timeMin: (1/netPph) * 60,
          ratePerMin: cellHourCost / 60,
          machineCost: totalStepCost * (cellHourCost > 0 ? machineHourCost / cellHourCost : 0),
          laborCost: totalStepCost * (cellHourCost > 0 ? hhCost / cellHourCost : 0),
          total: totalStepCost,
          calculationDetails: {
            cycle, cavities: cav, efficiency: eff, setupTimeMin: Number(step.setupTimeMin), lotSize,
            hhCost, machineHourCost, cellHourCost, netPph, unitTransform, setupCost, totalStepCost
          }
        }
      };
    });

  } else {
    const std = buildStandardOperationItems();
    if (!Array.isArray(std)) return std;
    operationItems = std;
    if (operationItems.length === 0 && product.type === "COMPONENT" && !skipOwnProcess) {
      return { error: "ROUTING_MISSING", message: `Componente [${product.sku}] sem processo (padrão ou roteiro).` };
    }
  }

  const ownHH_Unit = operationItems.reduce((acc, item) => acc + item.totalHH, 0);
  const ownHM_Unit = operationItems.reduce((acc, item) => acc + item.totalHM, 0);
  const totalTimeH_Unit = operationItems.reduce((acc, item) => acc + item.totalTimeH, 0);

  // 3. CIF/OPEX
  if (!cache) return { error: "FATAL_ERROR", message: "Cache de parâmetros não inicializado." };
  if (cache.factoryHoursMonthly <= 0) {
    return { error: "CONFIG_MISSING", message: "Parâmetro global FACTORY_HOURS_MONTHLY não configurado ou inválido." };
  }
  const totalCIF_Monthly = cache.indirectCosts.filter(c => c.category === "CIF").reduce((acc, c) => acc + Number(c.monthlyValue), 0);
  
  const cifRatePerHour = totalCIF_Monthly / cache.factoryHoursMonthly;
  const opexRatePerHour = cache.opexRatePerHour;
  
  const ownCIF_Unit = totalTimeH_Unit * cifRatePerHour;
  const totalOPEX_Unit = totalTimeH_Unit * opexRatePerHour;

  const decomposed = aggregateParentDecomposition(directMaterialBOMTotal, childScaledContributions, {
    hh: ownHH_Unit,
    hm: ownHM_Unit,
    cif: ownCIF_Unit,
  });
  const totalMaterialCost = decomposed.totalMaterialCost;
  const totalHH_Unit = decomposed.totalHH_Unit;
  const totalHM_Unit = decomposed.totalHM_Unit;
  const totalCIF_Unit = decomposed.totalCIF_Unit;

  /** Custo/preço consolidado (regra de negócio): MP + HH + HM — CIF e OPEX apenas informativos. */
  const totalIndustrialCost = totalMaterialCost + totalHH_Unit + totalHM_Unit;

  const costAnalysisPartial = bomLineExcludedByLineId.size > 0 || hasDescendantPartialCost;

  if (skipOwnProcess && productHasStandardCycle) {
    warnings.push({
      code: "OWN_PROCESS_SKIPPED_BY_COSTING_MODE",
      severity: "warning",
      message: `Processo padrão deste item não foi somado: modo de custeio = ${costingMode}. ${
        ownProcessSkipReason ?? ""
      }`.trim(),
      context: "BOM_LINE",
    });
  }

  const result: any = {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    productType: product.type,
    costingMode,
    ownProcessSkipped: skipOwnProcess,
    ownProcessSkipReason,
    /** Tempo produtivo próprio (h/unid. deste item), antes de agregar filhos — usado no detalhe de conversão BOM. */
    ownProductiveTimeH_Unit: totalTimeH_Unit,
    totalMaterialCost,
    totalHH_Unit,
    totalHM_Unit,
    totalCIF_Unit,
    totalOPEX_Unit,
    totalIndustrialCost,
    totalGerencialCost: totalIndustrialCost,
    warnings,
    warningCount: warnings.length,
    costAnalysisPartial,
    excludedBomLines: Array.from(bomLineExcludedByLineId.values()),
  };

  if (includeDetails) {
    const materialsRows: Array<Record<string, unknown>> = [];
    for (const item of product.ProductBOM) {
      const bomLoss = Number(item.lossPercentage) / 100;
      const requiredQty = Number(item.quantity) / (1 - bomLoss);
      const exRow = bomLineExcludedByLineId.get(item.id);
      if (exRow) {
        const label =
          exRow.sku || exRow.name
            ? `[${exRow.sku ?? "—"}] ${exRow.name ?? ""}`.trim()
            : "Linha de BOM sem material nem componente";
        materialsRows.push({
          description: label,
          basePrice: 0,
          requiredQty,
          unitCost: 0,
          excludedFromCost: true,
          errorCode: exRow.errorCode,
          message: exRow.message,
          detailChain: exRow.detailChain,
          sku: exRow.sku,
          name: exRow.name,
          bomLineId: exRow.bomLineId,
        });
        continue;
      }
      if (item.Material) {
        const mat = item.Material;
        const matStandardLoss = Number(mat.standardLoss) / 100;
        const landedCost = Number(mat.currentCost) + Number(mat.freight);
        const matEffectiveCost = landedCost / (1 - matStandardLoss);
        materialsRows.push({
          lineType: "MATERIAL",
          materialId: mat.id,
          childProductId: null,
          description: mat.description,
          sku: mat.code,
          bomLineId: item.id,
          quantity: Number(item.quantity),
          lossPercentage: Number(item.lossPercentage ?? 0),
          unit: mat.unit,
          basePrice: Number(mat.currentCost),
          unitCostUsed: matEffectiveCost,
          requiredQty,
          unitCost: matEffectiveCost * requiredQty,
        });
        continue;
      }
      if (item.childProductId) {
        const childResult = bomLineChildAnalysisCache.get(item.id);
        if (!childResult || isCostAnalysisFailure(childResult)) {
          return {
            error: "INTERNAL_BOM_CACHE_MISS",
            message: `Inconsistência ao montar detalhes da BOM de [${product.sku}] — recálculo de filho ausente (cache).`,
            parentProductId: product.id,
            parentSku: product.sku,
            childProductId: item.childProductId,
            bomLineId: item.id,
          };
        }
        const childUnitNoCif =
          Number(childResult.totalMaterialCost ?? 0) +
          Number(childResult.totalHH_Unit ?? 0) +
          Number(childResult.totalHM_Unit ?? 0);
        materialsRows.push({
          lineType: "COMPONENT",
          materialId: null,
          childProductId: item.childProductId,
          description: String(childResult.name ?? "—"),
          sku: String(childResult.sku ?? ""),
          bomLineId: item.id,
          quantity: Number(item.quantity),
          lossPercentage: Number(item.lossPercentage ?? 0),
          unit: null,
          basePrice: childUnitNoCif,
          unitCostUsed: childUnitNoCif,
          requiredQty,
          unitCost: childUnitNoCif * requiredQty,
        });
        continue;
      }
      materialsRows.push({
        lineType: "INCOMPLETE",
        materialId: null,
        childProductId: null,
        description: "Linha de BOM sem material nem componente",
        basePrice: 0,
        requiredQty,
        unitCost: 0,
        excludedFromCost: true,
        errorCode: "BOM_LINE_INCOMPLETE",
        message: "Linha sem material ou componente.",
        detailChain: "BOM_LINE_INCOMPLETE",
      });
    }
    const ownProcessBreakdown = operationItems.map((oi) => oi.breakdown).filter(Boolean);
    let processBreakdownMerged = ownProcessBreakdown;

    if (product.type === "PRODUCT" && childBomConversionRollups.length > 0) {
      const childIds = [...new Set(childBomConversionRollups.map((r) => r.childProductId))];
      const childCadastro =
        childIds.length > 0
          ? await prisma.product.findMany({
              where: { id: { in: childIds } },
              select: {
                id: true,
                type: true,
                cycleTimeSeconds: true,
                _count: { select: { ProductRouting: true } },
              },
            })
          : [];
      const childCadastroById = new Map(childCadastro.map((c) => [c.id, c]));

      const bomChildRows: unknown[] = [];
      for (const row of childBomConversionRollups) {
        const hh = Number(row.hhScaled);
        const hm = Number(row.hmScaled);
        if (!Number.isFinite(hh) || !Number.isFinite(hm) || (Math.abs(hh) < 1e-12 && Math.abs(hm) < 1e-12)) {
          continue;
        }
        const cad = childCadastroById.get(row.childProductId);
        const source = cad
          ? inferOwnProcessSourceForMotorDisplay({
              type: cad.type,
              cycleTimeSeconds: cad.cycleTimeSeconds,
              routingCount: cad._count?.ProductRouting ?? 0,
            })
          : "STANDARD_PROCESS";
        const childCached = bomLineChildAnalysisCache.get(row.bomLineId) as
          | { ownProductiveTimeH_Unit?: number }
          | undefined;
        const childOwnTimeH = Number(childCached?.ownProductiveTimeH_Unit ?? 0);
        let timeMin: number | undefined;
        if (Number.isFinite(childOwnTimeH) && childOwnTimeH > 0 && row.requiredQty > 0) {
          timeMin = childOwnTimeH * row.requiredQty * 60;
        }
        const total = hh + hm;
        bomChildRows.push({
          source,
          rollupFromBom: true,
          description: `[${row.sku}] ${row.name}`,
          timeMin,
          machineCost: hm,
          laborCost: hh,
          total,
          calculationDetails: {
            rollupFromBom: true,
            bomLineId: row.bomLineId,
            childProductId: row.childProductId,
            childSku: row.sku,
            childName: row.name,
            requiredQty: row.requiredQty,
            childOwnProductiveTimeH_Unit: childOwnTimeH,
            processSource: source,
          },
        });
      }
      processBreakdownMerged = [...ownProcessBreakdown, ...bomChildRows];
    }

    result.details = {
      materials: materialsRows,
      processBreakdown: processBreakdownMerged,
    };

    const detailMaterials = result.details.materials as Array<{
      unitCost: number;
      excludedFromCost?: boolean;
    }>;
    const lineSum = detailMaterials.reduce(
      (acc, row) => acc + (row.excludedFromCost ? 0 : row.unitCost),
      0
    );
    if (
      Number.isFinite(lineSum) &&
      Number.isFinite(materialStructuralTotal) &&
      Math.abs(lineSum - materialStructuralTotal) > 0.0001
    ) {
      warnings.push({
        code: "BOM_DETAIL_TOTAL_DIVERGENCE",
        severity: "warning",
        message: `Soma do detalhamento da BOM (${lineSum.toFixed(6)}) difere do total estrutural das linhas (${materialStructuralTotal.toFixed(6)}) — revisar arredondamento ou consistência das linhas.`,
        context: "BOM_LINE",
      });
      result.warningCount = warnings.length;
    }
  }

  return result;
  } finally {
    stack.delete(productId);
  }
}

  return {
    initAnalysisCache,
    getProductCostAnalysis,
    isCostAnalysisFailure,
    describeCostAnalysisFailure,
  };
}