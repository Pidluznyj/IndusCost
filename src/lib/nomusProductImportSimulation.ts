import { createHash } from "node:crypto";
import type { ItemType } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import { normalizeComponentCode, normalizeSku, toNumberSafe } from "@/src/lib/nomusBomComparison";
import { buildEffectivePricingBomForParentCode } from "@/src/lib/nomusEffectivePricingBom";
import type { EffectivePricingBomLine } from "@/src/lib/nomusEffectivePricingBomTypes";
import { resolveNomusComponentCodes } from "@/src/lib/nomusBomComparisonLoad";
import type {
  NomusProductImportAmbiguousItem,
  NomusProductImportBomLinePlan,
  NomusProductImportComponentAction,
  NomusProductImportMissingCostItem,
  NomusProductImportMissingRoutingItem,
  NomusProductImportOptionalPending,
  NomusProductImportProductAction,
  NomusProductImportSimulationPreview,
  NomusProductImportSimulationResult,
  NomusProductImportActionType,
  NomusProductImportBomActionType,
} from "@/src/lib/nomusProductImportSimulationTypes";

const DEFAULT_MAX_DEPTH = 10;

export type BuildNomusProductImportPreviewInput = {
  parentCode: string;
  recursive?: boolean;
  maxDepth?: number;
};

export function confirmationTextForProductImport(parentCode: string): string {
  const sku = normalizeSku(parentCode.trim());
  return `IMPORTAR PRODUTO ${sku}`;
}

function buildPlanHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function parentCodesWithSubBom(codes: string[]): Promise<Set<string>> {
  const unique = [...new Set(codes.map((c) => normalizeSku(c.trim())).filter(Boolean))];
  if (unique.length === 0) return new Set();
  const rows = await prisma.nomusBomComponentStage.groupBy({
    by: ["parentCode"],
    where: { parentCode: { in: unique } },
  });
  return new Set(rows.map((r) => normalizeSku(r.parentCode)));
}

async function loadParentDescription(parentCode: string): Promise<string | null> {
  const trimmed = parentCode.trim();
  const sku = normalizeSku(trimmed);
  const row = await prisma.nomusBomComponentStage.findFirst({
    where: { OR: [{ parentCode: trimmed }, { parentCode: sku }] },
    select: { parentDescription: true },
  });
  return row?.parentDescription ?? null;
}

function nomusFlagsFromLine(line: EffectivePricingBomLine) {
  const f = line.flags;
  return {
    opcional: Boolean(f?.hasOptionalNomusLines),
    alternativo: Boolean(f?.hasAlternativeNomusLines),
    preferencial: Boolean(f?.hasPreferredNomusLines),
    itemDeEmbarque: Boolean(f?.hasShipmentItemNomusLines),
  };
}

function proposeComponentAction(params: {
  componentCode: string;
  resolvedKind: "PRODUCT" | "MATERIAL" | "BOTH" | "NONE";
  productId: string | null;
  materialId: string | null;
  hasNomusSubBom: boolean;
  line: EffectivePricingBomLine;
}): {
  action: NomusProductImportActionType;
  reason: string;
  ambiguous?: NomusProductImportAmbiguousItem;
} {
  const { resolvedKind, productId, materialId, hasNomusSubBom, line } = params;

  if (line.decision === "BLOCKED" || !line.includedForPricing) {
    if (line.source?.includes("OPTIONAL") || line.decision === "BLOCKED") {
      return {
        action: "OPTIONAL_SELECTION_REQUIRED",
        reason: "Opcional/alternativo sem seleção explícita para precificação.",
      };
    }
    return { action: "BLOCKED", reason: "Linha excluída da BOM efetiva de precificação." };
  }

  if (resolvedKind === "PRODUCT" && productId) {
    return {
      action: "USE_EXISTING_PRODUCT",
      reason: "Componente já cadastrado como Product no IndusCost.",
    };
  }

  if (resolvedKind === "MATERIAL" && materialId) {
    return {
      action: "USE_EXISTING_MATERIAL",
      reason: "Componente já cadastrado como Material no IndusCost.",
    };
  }

  if (resolvedKind === "BOTH" && productId && materialId) {
    const suggestedResolution: NomusProductImportAmbiguousItem["suggestedResolution"] =
      hasNomusSubBom ? "PREFER_PRODUCT" : "PREFER_MATERIAL";
    return {
      action: "AMBIGUOUS_PRODUCT_AND_MATERIAL",
      reason: "Mesmo código em Product.sku e Material.code — resolução manual ou regra Nomus apply.",
      ambiguous: {
        componentCode: params.componentCode,
        productId,
        materialId,
        reason: "Mesmo código em Product.sku e Material.code.",
        suggestedResolution,
      },
    };
  }

  if (hasNomusSubBom) {
    return {
      action: "CREATE_COMPONENT_PRODUCT_FROM_NOMUS",
      reason: "Componente com subestrutura no Nomus — criar Product tipo COMPONENT.",
    };
  }

  return {
    action: "CREATE_PLACEHOLDER_COMPONENT_WITHOUT_COST",
    reason:
      "Componente importado sem custo. Precificação deve ficar bloqueada ou marcada como incompleta.",
  };
}

async function collectComponentActionsRecursive(params: {
  parentCode: string;
  recursive: boolean;
  maxDepth: number;
  depth: number;
  visited: Set<string>;
  cache: Map<string, Awaited<ReturnType<typeof buildEffectivePricingBomForParentCode>>>;
  subBomParents: Set<string>;
  out: NomusProductImportComponentAction[];
  ambiguous: NomusProductImportAmbiguousItem[];
  optionalPending: NomusProductImportOptionalPending[];
}): Promise<void> {
  const { parentCode, recursive, maxDepth, depth, visited, cache, subBomParents, out, ambiguous, optionalPending } =
    params;
  const key = normalizeSku(parentCode);
  if (visited.has(key)) {
    return;
  }
  visited.add(key);

  let bom = cache.get(key);
  if (!bom) {
    bom = await buildEffectivePricingBomForParentCode(parentCode, {
      recursive: false,
      maxDepth,
      _cache: cache,
    });
    cache.set(key, bom);
  }

  const lines = [...bom.directLines, ...bom.reviewLines.filter((l) => l.includedForPricing)];
  const codes = lines.map((l) => l.componentCode);
  const resolved = await resolveNomusComponentCodes(codes);
  const resolvedByCode = new Map(resolved.map((r) => [normalizeComponentCode(r.componentCode), r]));

  for (const line of lines) {
    const codeKey = normalizeComponentCode(line.componentCode);
    const res = resolvedByCode.get(codeKey);
    const hasNomusSubBom = subBomParents.has(normalizeSku(line.componentCode));
    const proposal = proposeComponentAction({
      componentCode: line.componentCode,
      resolvedKind: res?.resolvedKind ?? "NONE",
      productId: res?.productId ?? null,
      materialId: res?.materialId ?? null,
      hasNomusSubBom,
      line,
    });

    if (proposal.ambiguous) ambiguous.push(proposal.ambiguous);

    if (proposal.action === "OPTIONAL_SELECTION_REQUIRED") {
      optionalPending.push({
        componentCode: line.componentCode,
        componentDescription: line.componentDescription,
        reason: proposal.reason,
      });
    }

    out.push({
      componentCode: line.componentCode,
      componentDescription: line.componentDescription,
      quantity: line.quantity,
      nomusFlags: nomusFlagsFromLine(line),
      existsAsProduct: Boolean(res?.productId),
      existsAsMaterial: Boolean(res?.materialId),
      existsInBoth: res?.resolvedKind === "BOTH",
      existsInNeither: res?.resolvedKind === "NONE",
      hasNomusSubBom,
      parentCodeContext: parentCode,
      level: depth,
      proposedAction: proposal.action,
      productId: res?.productId ?? null,
      materialId: res?.materialId ?? null,
      reason: proposal.reason,
      includedInPricingBom: line.includedForPricing,
    });

    if (
      recursive &&
      depth < maxDepth &&
      hasNomusSubBom &&
      line.includedForPricing &&
      proposal.action !== "OPTIONAL_SELECTION_REQUIRED"
    ) {
      await collectComponentActionsRecursive({
        parentCode: line.componentCode,
        recursive,
        maxDepth,
        depth: depth + 1,
        visited,
        cache,
        subBomParents,
        out,
        ambiguous,
        optionalPending,
      });
    }
  }

  visited.delete(key);
}

async function assessMissingCosts(
  componentActions: NomusProductImportComponentAction[]
): Promise<NomusProductImportMissingCostItem[]> {
  const missing: NomusProductImportMissingCostItem[] = [];
  const materialIds = [
    ...new Set(
      componentActions
        .filter((a) => a.proposedAction === "USE_EXISTING_MATERIAL" && a.materialId)
        .map((a) => a.materialId!)
    ),
  ];
  const productIds = [
    ...new Set(
      componentActions
        .filter(
          (a) =>
            (a.proposedAction === "USE_EXISTING_PRODUCT" ||
              a.proposedAction === "CREATE_COMPONENT_PRODUCT_FROM_NOMUS") &&
            a.productId
        )
        .map((a) => a.productId!)
    ),
  ];

  if (materialIds.length > 0) {
    const materials = await prisma.material.findMany({
      where: { id: { in: materialIds } },
      select: { id: true, code: true, currentCost: true, freight: true },
    });
    for (const mat of materials) {
      const landed = Number(mat.currentCost) + Number(mat.freight ?? 0);
      if (!Number.isFinite(landed) || landed <= 0) {
        missing.push({
          componentCode: mat.code,
          kind: "MATERIAL",
          reason: "Matéria-prima sem custo aterrissado válido.",
        });
      }
    }
  }

  if (productIds.length > 0) {
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        sku: true,
        type: true,
        cycleTimeSeconds: true,
        cavities: true,
        setupTimeMin: true,
        efficiencyExpected: true,
        ProductRouting: { select: { id: true }, take: 1 },
      },
    });
    for (const p of products) {
      const hasRouting = p.ProductRouting.length > 0;
      const hasStandard =
        p.type === "COMPONENT" &&
        p.cycleTimeSeconds != null &&
        Number(p.cycleTimeSeconds) > 0 &&
        p.cavities != null &&
        p.cavities >= 1;
      if (p.type === "COMPONENT" && !hasRouting && !hasStandard) {
        missing.push({
          componentCode: p.sku,
          kind: "PRODUCT",
          reason: "Componente sem processo padrão ou roteiro — custo de conversão indisponível.",
        });
      }
    }
  }

  for (const action of componentActions) {
    if (
      action.proposedAction === "CREATE_PLACEHOLDER_COMPONENT_WITHOUT_COST" ||
      action.proposedAction === "CREATE_COMPONENT_PRODUCT_FROM_NOMUS"
    ) {
      if (!action.productId) {
        missing.push({
          componentCode: action.componentCode,
          kind: "PLACEHOLDER",
          reason:
            "Componente importado sem custo. Precificação deve ficar bloqueada ou marcada como incompleta.",
        });
      }
    }
  }

  return missing;
}

function buildBomActions(
  effectiveLines: EffectivePricingBomLine[],
  componentActions: NomusProductImportComponentAction[],
  ambiguousItems: NomusProductImportAmbiguousItem[]
): NomusProductImportBomLinePlan[] {
  const actionByCode = new Map(
    componentActions.map((a) => [normalizeComponentCode(a.componentCode), a])
  );
  const ambiguousByCode = new Map(
    ambiguousItems.map((a) => [normalizeComponentCode(a.componentCode), a])
  );
  const plans: NomusProductImportBomLinePlan[] = [];

  for (const line of effectiveLines) {
    const codeKey = normalizeComponentCode(line.componentCode);
    const action = actionByCode.get(codeKey);

    if (!line.includedForPricing) {
      if (
        action?.proposedAction === "OPTIONAL_SELECTION_REQUIRED" ||
        line.decision === "BLOCKED" ||
        line.source?.includes("OPTIONAL")
      ) {
        plans.push({
          bomActionType: "SKIP_OPTIONAL_NOT_SELECTED",
          componentCode: line.componentCode,
          componentDescription: line.componentDescription,
          quantity: line.quantity,
          lossPercentage: 0,
          materialId: null,
          childProductId: null,
          source: line.source,
          willCreate: false,
          reason: "Opcional/alternativo sem seleção — não entra na ProductBOM.",
        });
      }
      continue;
    }

    if (!action) continue;

    if (action.proposedAction === "OPTIONAL_SELECTION_REQUIRED") {
      plans.push({
        bomActionType: "SKIP_OPTIONAL_NOT_SELECTED",
        componentCode: line.componentCode,
        componentDescription: line.componentDescription,
        quantity: line.quantity,
        lossPercentage: 0,
        materialId: null,
        childProductId: null,
        source: line.source,
        willCreate: false,
        reason: action.reason,
      });
      continue;
    }

    if (
      action.proposedAction === "AMBIGUOUS_PRODUCT_AND_MATERIAL" ||
      ambiguousByCode.has(codeKey)
    ) {
      plans.push({
        bomActionType: "BLOCKED_AMBIGUOUS_COMPONENT",
        componentCode: line.componentCode,
        componentDescription: line.componentDescription,
        quantity: line.quantity,
        lossPercentage: 0,
        materialId: action.materialId,
        childProductId: action.productId,
        source: line.source,
        willCreate: false,
        reason: "Product e Material com o mesmo código — bloqueado até resolução.",
      });
      continue;
    }

    if (
      action.proposedAction === "BLOCKED" ||
      action.proposedAction === "BLOCKED_UNRESOLVED"
    ) {
      plans.push({
        bomActionType: "BLOCKED_MISSING_COMPONENT",
        componentCode: line.componentCode,
        componentDescription: line.componentDescription,
        quantity: line.quantity,
        lossPercentage: 0,
        materialId: null,
        childProductId: null,
        source: line.source,
        willCreate: false,
        reason: action.reason,
      });
      continue;
    }

    let materialId: string | null = null;
    let childProductId: string | null = null;
    let willCreate = false;
    let reason = action.reason;

    switch (action.proposedAction) {
      case "USE_EXISTING_MATERIAL":
        materialId = action.materialId;
        break;
      case "USE_EXISTING_PRODUCT":
        childProductId = action.productId;
        break;
      case "CREATE_COMPONENT_PRODUCT_FROM_NOMUS":
      case "CREATE_PLACEHOLDER_COMPONENT_WITHOUT_COST":
        willCreate = true;
        childProductId = null;
        reason = "Será vinculado após criação do Product.";
        break;
      default:
        plans.push({
          bomActionType: "BLOCKED_MISSING_COMPONENT",
          componentCode: line.componentCode,
          componentDescription: line.componentDescription,
          quantity: line.quantity,
          lossPercentage: 0,
          materialId: null,
          childProductId: null,
          source: line.source,
          willCreate: false,
          reason: action.reason,
        });
        continue;
    }

    const qty = line.quantity ?? 0;
    plans.push({
      bomActionType: "CREATE_PRODUCT_BOM_LINE",
      componentCode: line.componentCode,
      componentDescription: line.componentDescription,
      quantity: qty > 0 ? qty : 1,
      lossPercentage: 0,
      materialId,
      childProductId,
      source: line.source,
      willCreate,
      reason,
    });
  }

  return plans;
}

async function assessMissingRouting(
  parentCode: string,
  parentExists: boolean,
  parentProductId: string | null,
  componentActions: NomusProductImportComponentAction[]
): Promise<NomusProductImportMissingRoutingItem[]> {
  const missing: NomusProductImportMissingRoutingItem[] = [];

  if (parentExists && parentProductId) {
    const parent = await prisma.product.findUnique({
      where: { id: parentProductId },
      select: {
        sku: true,
        type: true,
        ProductRouting: { select: { id: true }, take: 1 },
      },
    });
    if (parent?.type === "PRODUCT" && parent.ProductRouting.length === 0) {
      missing.push({
        componentCode: parent.sku,
        kind: "PARENT",
        reason: "Produto principal sem roteiro/montagem cadastrada (ex.: 800.01 não importado automaticamente).",
      });
    }
  } else if (!parentExists) {
    missing.push({
      componentCode: parentCode,
      kind: "PARENT",
      reason: "Produto principal será criado sem roteiro — definir processo após importação.",
    });
  }

  const componentIds = [
    ...new Set(
      componentActions
        .filter((a) => a.productId && a.proposedAction === "USE_EXISTING_PRODUCT")
        .map((a) => a.productId!)
    ),
  ];
  if (componentIds.length > 0) {
    const products = await prisma.product.findMany({
      where: { id: { in: componentIds }, type: "COMPONENT" },
      select: {
        id: true,
        sku: true,
        cycleTimeSeconds: true,
        cavities: true,
        ProductRouting: { select: { id: true }, take: 1 },
      },
    });
    for (const p of products) {
      const hasStandard =
        p.cycleTimeSeconds != null && Number(p.cycleTimeSeconds) > 0 && p.cavities != null && p.cavities >= 1;
      if (p.ProductRouting.length === 0 && !hasStandard) {
        missing.push({
          componentCode: p.sku,
          kind: "COMPONENT",
          reason: "Componente sem processo padrão ou roteiro.",
        });
      }
    }
  }

  return missing;
}

export async function buildNomusProductImportSimulationPreview(
  input: BuildNomusProductImportPreviewInput
): Promise<NomusProductImportSimulationPreview> {
  const trimmed = input.parentCode.trim();
  const parentCode = normalizeSku(trimmed);
  const recursive = input.recursive ?? true;
  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
  const warnings: string[] = [];
  const blockingReasons: string[] = [];
  const engineeringPending: string[] = [];

  const stageCount = await prisma.nomusBomComponentStage.count({
    where: { OR: [{ parentCode: trimmed }, { parentCode }] },
  });
  const existsInNomus = stageCount > 0;

  const parentDescription = await loadParentDescription(trimmed);
  const existingProduct = await prisma.product.findFirst({
    where: { OR: [{ sku: parentCode }, { sku: trimmed }] },
    select: {
      id: true,
      sku: true,
      name: true,
      ProductBOM: { select: { id: true }, take: 1 },
      ProductRouting: { select: { id: true }, take: 1 },
    },
  });

  const existsInIndusCost = Boolean(existingProduct);
  const indusProductId = existingProduct?.id ?? null;

  let productProposedAction: NomusProductImportActionType;
  let productReason: string;
  if (!existsInNomus) {
    productProposedAction = "BLOCKED";
    productReason = "parentCode não encontrado no NomusBomComponentStage.";
    blockingReasons.push(productReason);
  } else if (existsInIndusCost) {
    productProposedAction = "USE_EXISTING_PRODUCT";
    productReason = "Produto já cadastrado no IndusCost — não será recriado.";
    if ((existingProduct?.ProductBOM.length ?? 0) > 0) {
      warnings.push(
        "Produto já possui ProductBOM. A importação não substitui estrutura existente; revise manualmente se necessário."
      );
      blockingReasons.push("Produto IndusCost já possui BOM cadastrada.");
    }
  } else {
    productProposedAction = "CREATE_PRODUCT_FROM_NOMUS";
    productReason = "Produto oficial Nomus ausente no IndusCost — será criado com dados mínimos.";
  }

  const productAction: NomusProductImportProductAction = {
    parentCode,
    parentDescription,
    existsInNomus,
    existsInIndusCost,
    indusProductId,
    proposedAction: productProposedAction,
    reason: productReason,
  };

  const effectiveBom = await buildEffectivePricingBomForParentCode(trimmed, {
    recursive: false,
    maxDepth,
  });

  if (effectiveBom.status === "NO_NOMUS_BOM") {
    blockingReasons.push("BOM efetiva Nomus indisponível.");
  }
  if (effectiveBom.status === "PENDING_OPTIONAL_SELECTION") {
    blockingReasons.push("Opcionais Nomus pendentes de seleção.");
  }
  if (effectiveBom.status === "STALE_OPTIONAL_SELECTION") {
    warnings.push("Seleção de opcionais desatualizada em relação ao stage Nomus.");
  }

  const componentActions: NomusProductImportComponentAction[] = [];
  const ambiguousItems: NomusProductImportAmbiguousItem[] = [];
  const optionalPendingItems: NomusProductImportOptionalPending[] = [];
  const cache = new Map<string, Awaited<ReturnType<typeof buildEffectivePricingBomForParentCode>>>();

  const allCodes = new Set<string>([parentCode]);
  for (const line of effectiveBom.directLines) {
    allCodes.add(normalizeSku(line.componentCode));
  }
  const subBomParents = await parentCodesWithSubBom([...allCodes]);

  await collectComponentActionsRecursive({
    parentCode: trimmed,
    recursive,
    maxDepth,
    depth: 0,
    visited: new Set(),
    cache,
    subBomParents,
    out: componentActions,
    ambiguous: ambiguousItems,
    optionalPending: optionalPendingItems,
  });

  const bomActions = buildBomActions(
    [...effectiveBom.directLines, ...effectiveBom.excludedLines, ...effectiveBom.reviewLines],
    componentActions,
    ambiguousItems
  );

  if (optionalPendingItems.length > 0) {
    blockingReasons.push(
      `${optionalPendingItems.length} opcional(is) sem seleção — não entram na ProductBOM automaticamente.`
    );
  }

  const unresolvedCreates = componentActions.filter(
    (a) =>
      a.includedInPricingBom &&
      a.proposedAction === "CREATE_PLACEHOLDER_COMPONENT_WITHOUT_COST" &&
      !a.hasNomusSubBom
  );
  if (unresolvedCreates.length > 0) {
    warnings.push(
      `${unresolvedCreates.length} componente(s) folha sem cadastro e sem subestrutura Nomus.`
    );
  }

  engineeringPending.push(
    "Definir montagem/processo/roteiro do novo produto (ex.: 800.01 não é importado automaticamente nesta fase)."
  );
  if (existingProduct && existingProduct.ProductRouting.length === 0) {
    engineeringPending.push("Produto principal sem roteiro de produção cadastrado.");
  }

  const missingCostItems = await assessMissingCosts(componentActions);
  const missingRoutingItems = await assessMissingRouting(
    parentCode,
    existsInIndusCost,
    indusProductId,
    componentActions
  );

  const createBomLineCount = bomActions.filter(
    (b) => b.bomActionType === "CREATE_PRODUCT_BOM_LINE"
  ).length;
  const blockedAmbiguous = bomActions.some(
    (b) => b.bomActionType === "BLOCKED_AMBIGUOUS_COMPONENT"
  );
  if (blockedAmbiguous) {
    blockingReasons.push("Há componentes ambíguos (Product e Material) bloqueando linhas da BOM.");
  }

  const cycleKey = `${parentCode}>${parentCode}`;
  const visitedCycle = new Set<string>();
  function detectCycle(code: string, stack: string[]): boolean {
    const k = normalizeSku(code);
    if (stack.includes(k)) return true;
    if (visitedCycle.has(k)) return false;
    visitedCycle.add(k);
    const children = componentActions.filter(
      (a) => normalizeSku(a.parentCodeContext) === k && a.hasNomusSubBom
    );
    for (const child of children) {
      if (detectCycle(child.componentCode, [...stack, k])) return true;
    }
    return false;
  }
  if (detectCycle(trimmed, [])) {
    blockingReasons.push("Ciclo detectado na árvore Nomus recursiva.");
  }

  const canImport =
    existsInNomus &&
    productProposedAction !== "BLOCKED" &&
    blockingReasons.filter((r) => r.includes("já possui BOM")).length === 0 &&
    optionalPendingItems.length === 0 &&
    !blockedAmbiguous &&
    !blockingReasons.some((r) => r.includes("Ciclo"));

  const canSimulateCost =
    canImport && missingCostItems.length === 0 && createBomLineCount > 0;

  const costSimulationStatus: NomusProductImportSimulationPreview["costSimulationStatus"] =
    !canImport
      ? "BLOCKED"
      : canSimulateCost
        ? "COMPLETE"
        : "INCOMPLETE_COST";

  if (missingCostItems.length > 0) {
    warnings.push(
      `Produto importado, mas simulação de custo incompleta: faltam custos para ${missingCostItems.length} item(ns).`
    );
  }
  if (missingRoutingItems.length > 0) {
    warnings.push(
      `${missingRoutingItems.length} pendência(s) de roteiro/montagem — custo de conversão pode ficar incompleto.`
    );
  }

  const planHash = buildPlanHash({
    parentCode,
    recursive,
    maxDepth,
    productAction: productProposedAction,
    componentActions: componentActions.map((a) => ({
      code: a.componentCode,
      action: a.proposedAction,
      qty: a.quantity,
      parent: a.parentCodeContext,
    })),
    bomActions: bomActions
      .filter((b) => b.bomActionType === "CREATE_PRODUCT_BOM_LINE")
      .map((b) => ({
        type: b.bomActionType,
        code: b.componentCode,
        materialId: b.materialId,
        childProductId: b.childProductId,
        qty: b.quantity,
      })),
  });

  return {
    generatedAt: new Date().toISOString(),
    parentCode,
    parentDescription,
    existsInIndusCost,
    indusProductId,
    existsInNomus,
    canImport,
    canSimulateCost,
    costSimulationStatus,
    blockingReasons: [...new Set(blockingReasons)],
    warnings: [...effectiveBom.warnings, ...warnings],
    planHash,
    confirmationRequiredText: confirmationTextForProductImport(parentCode),
    productAction,
    productActions: [productAction],
    componentActions,
    bomActions,
    missingCostItems,
    missingRoutingItems,
    optionalPendingItems,
    ambiguousItems,
    engineeringPending,
    recursive,
    maxDepth,
    effectiveBomStatus: effectiveBom.status,
    optionalPricingStatus: effectiveBom.optionalPricingStatus,
  };
}

type CreatedProductRef = { sku: string; productId: string; action: string };

async function createProductFromNomus(params: {
  sku: string;
  name: string;
  description: string | null;
  type: ItemType;
}): Promise<CreatedProductRef> {
  const sku = normalizeSku(params.sku);
  const created = await prisma.product.create({
    data: {
      sku,
      name: params.name.trim() || sku,
      description: params.description,
      type: params.type,
      version: "1.0.0",
      defaultLotSize: 1,
      status: "ACTIVE",
    },
    select: { id: true, sku: true },
  });
  return { sku: created.sku, productId: created.id, action: "CREATED" };
}

export async function executeNomusProductImportSimulation(input: {
  parentCode: string;
  recursive?: boolean;
  maxDepth?: number;
  planHash: string;
  confirmationText: string;
  approvedBy?: string;
}): Promise<NomusProductImportSimulationResult> {
  const preview = await buildNomusProductImportSimulationPreview({
    parentCode: input.parentCode,
    recursive: input.recursive ?? true,
    maxDepth: input.maxDepth ?? DEFAULT_MAX_DEPTH,
  });

  if (preview.planHash !== input.planHash.trim()) {
    throw new Error("Plano desatualizado. Gere o preview novamente antes de importar.");
  }

  if (input.confirmationText.trim() !== preview.confirmationRequiredText) {
    throw new Error(
      `Confirmação inválida. Digite exatamente: ${preview.confirmationRequiredText}`
    );
  }

  if (!preview.canImport) {
    throw new Error(
      preview.blockingReasons.join(" ") || "Importação bloqueada pelos gates de segurança."
    );
  }

  const trimmed = input.parentCode.trim();
  const warnings = [...preview.warnings];
  const importedProducts: CreatedProductRef[] = [];
  const beforeJson = {
    preview: {
      parentCode: preview.parentCode,
      existsInIndusCost: preview.existsInIndusCost,
      componentCount: preview.componentActions.length,
    },
  };

  const run = await prisma.nomusProductImportRun.create({
    data: {
      parentCode: preview.parentCode,
      status: "PREVIEWED",
      planHash: preview.planHash,
      confirmationText: input.confirmationText.trim(),
      approvedBy: input.approvedBy?.trim() || null,
      beforeJson,
      summaryJson: { phase: "IMPORT_START" },
      warningsJson: preview.warnings,
    },
  });

  try {
    let mainProductId = preview.indusProductId;

    if (preview.productAction.proposedAction === "CREATE_PRODUCT_FROM_NOMUS") {
      const created = await createProductFromNomus({
        sku: preview.parentCode,
        name: preview.parentDescription ?? preview.parentCode,
        description: preview.parentDescription,
        type: "PRODUCT",
      });
      mainProductId = created.productId;
      importedProducts.push({ ...created, action: "CREATE_PRODUCT_FROM_NOMUS" });
      await prisma.nomusProductImportRunLine.create({
        data: {
          runId: run.id,
          actionType: "CREATE_PRODUCT_FROM_NOMUS",
          componentCode: preview.parentCode,
          componentDescription: preview.parentDescription,
          status: "APPLIED",
          reason: preview.productAction.reason,
        },
      });
    } else if (mainProductId) {
      await prisma.nomusProductImportRunLine.create({
        data: {
          runId: run.id,
          actionType: "USE_EXISTING_PRODUCT",
          componentCode: preview.parentCode,
          componentDescription: preview.parentDescription,
          status: "SKIPPED",
          reason: preview.productAction.reason,
        },
      });
    }

    if (!mainProductId) {
      throw new Error("Produto principal não pôde ser resolvido após importação.");
    }

    const skuToProductId = new Map<string, string>();
    if (mainProductId) skuToProductId.set(normalizeSku(preview.parentCode), mainProductId);

    const createActions = preview.componentActions.filter(
      (a) =>
        a.proposedAction === "CREATE_COMPONENT_PRODUCT_FROM_NOMUS" ||
        a.proposedAction === "CREATE_PLACEHOLDER_COMPONENT_WITHOUT_COST"
    );
    const sortedCreates = [...createActions].sort((a, b) => a.level - b.level);

    for (const action of sortedCreates) {
      const sku = normalizeSku(action.componentCode);
      if (skuToProductId.has(sku)) continue;
      const desc =
        action.componentDescription ??
        (await loadParentDescription(action.componentCode)) ??
        action.componentCode;
      const created = await createProductFromNomus({
        sku: action.componentCode,
        name: desc,
        description: desc,
        type: "COMPONENT",
      });
      skuToProductId.set(normalizeSku(created.sku), created.productId);
      importedProducts.push({ ...created, action: action.proposedAction });
      await prisma.nomusProductImportRunLine.create({
        data: {
          runId: run.id,
          actionType: action.proposedAction,
          componentCode: action.componentCode,
          componentDescription: action.componentDescription,
          status: "APPLIED",
          reason: action.reason,
        },
      });
    }

    for (const action of preview.componentActions) {
      if (
        action.proposedAction === "USE_EXISTING_PRODUCT" ||
        action.proposedAction === "USE_EXISTING_MATERIAL"
      ) {
        await prisma.nomusProductImportRunLine.create({
          data: {
            runId: run.id,
            actionType: action.proposedAction,
            componentCode: action.componentCode,
            componentDescription: action.componentDescription,
            status: "SKIPPED",
            reason: action.reason,
          },
        });
        if (action.productId) {
          skuToProductId.set(normalizeSku(action.componentCode), action.productId);
        }
      }
    }

    const existingBomCount = await prisma.productBOM.count({
      where: { productId: mainProductId },
    });

    const bomLinesToCreate = preview.bomActions.filter(
      (b) => b.bomActionType === "CREATE_PRODUCT_BOM_LINE"
    );

    let createdBomLines = 0;
    if (existingBomCount === 0) {
      for (const line of bomLinesToCreate) {
        let materialId = line.materialId;
        let childProductId = line.childProductId;

        if (line.willCreate || (!materialId && !childProductId)) {
          childProductId = skuToProductId.get(normalizeSku(line.componentCode)) ?? null;
        }

        if (!materialId && !childProductId) {
          warnings.push(`Linha BOM ignorada — sem vínculo: ${line.componentCode}`);
          continue;
        }

        const qty = line.quantity ?? 1;
        await prisma.productBOM.create({
          data: {
            productId: mainProductId,
            materialId,
            childProductId,
            quantity: qty,
            lossPercentage: line.lossPercentage,
            notes: `Importado do Nomus (${line.source ?? "NOMUS"})`,
          },
        });
        createdBomLines += 1;
        await prisma.nomusProductImportRunLine.create({
          data: {
            runId: run.id,
            actionType: "CREATE_BOM_LINE",
            componentCode: line.componentCode,
            componentDescription: line.componentDescription,
            status: "APPLIED",
            reason: line.reason,
          },
        });
      }
    } else {
      warnings.push("ProductBOM existente mantida — nenhuma linha nova criada.");
    }

    let childBomLinesCreated = 0;
    const subBomParents = preview.componentActions.filter((a) => a.hasNomusSubBom);
    for (const action of subBomParents) {
      const childProductId = skuToProductId.get(normalizeSku(action.componentCode));
      if (!childProductId) continue;
      const childBomCount = await prisma.productBOM.count({
        where: { productId: childProductId },
      });
      if (childBomCount > 0) continue;

      const childEffective = await buildEffectivePricingBomForParentCode(action.componentCode, {
        recursive: false,
      });
      const childResolved = await resolveNomusComponentCodes(
        childEffective.directLines.map((l) => l.componentCode)
      );
      const childResolvedByCode = new Map(
        childResolved.map((r) => [normalizeComponentCode(r.componentCode), r])
      );
      const childComponentActions: NomusProductImportComponentAction[] = [];
      for (const line of childEffective.directLines) {
        const res = childResolvedByCode.get(normalizeComponentCode(line.componentCode));
        const hasSub = (await parentCodesWithSubBom([line.componentCode])).has(
          normalizeSku(line.componentCode)
        );
        const proposal = proposeComponentAction({
          componentCode: line.componentCode,
          resolvedKind: res?.resolvedKind ?? "NONE",
          productId: res?.productId ?? null,
          materialId: res?.materialId ?? null,
          hasNomusSubBom: hasSub,
          line,
        });
        childComponentActions.push({
          componentCode: line.componentCode,
          componentDescription: line.componentDescription,
          quantity: line.quantity,
          nomusFlags: nomusFlagsFromLine(line),
          existsAsProduct: Boolean(res?.productId),
          existsAsMaterial: Boolean(res?.materialId),
          existsInBoth: res?.resolvedKind === "BOTH",
          existsInNeither: res?.resolvedKind === "NONE",
          hasNomusSubBom: hasSub,
          parentCodeContext: action.componentCode,
          level: action.level + 1,
          proposedAction: proposal.action,
          productId: res?.productId ?? null,
          materialId: res?.materialId ?? null,
          reason: proposal.reason,
          includedInPricingBom: line.includedForPricing,
        });
      }
      const childPlans = buildBomActions(
        childEffective.directLines,
        childComponentActions,
        []
      ).filter((b) => b.bomActionType === "CREATE_PRODUCT_BOM_LINE");
      for (const line of childPlans) {
        let materialId = line.materialId;
        let childProductIdRef = line.childProductId;
        if (line.willCreate || (!materialId && !childProductIdRef)) {
          childProductIdRef = skuToProductId.get(normalizeSku(line.componentCode)) ?? null;
        }
        if (!materialId && !childProductIdRef) continue;
        await prisma.productBOM.create({
          data: {
            productId: childProductId,
            materialId,
            childProductId: childProductIdRef,
            quantity: line.quantity ?? 1,
            lossPercentage: line.lossPercentage,
            notes: `Importado do Nomus (${line.source ?? "NOMUS"}) — subestrutura`,
          },
        });
        childBomLinesCreated += 1;
      }
    }
    if (childBomLinesCreated > 0) {
      warnings.push(`${childBomLinesCreated} linha(s) de BOM criadas em componentes com subestrutura Nomus.`);
    }

    const missingCostItems = await assessMissingCosts(preview.componentActions);
    const missingRoutingItems = preview.missingRoutingItems;
    const canSimulateCost =
      missingCostItems.length === 0 && createdBomLines > 0 && preview.canSimulateCost;
    const costSimulationStatus = canSimulateCost ? "COMPLETE" : "INCOMPLETE_COST";

    await prisma.nomusProductImportRun.update({
      where: { id: run.id },
      data: {
        productId: mainProductId,
        status: "IMPORTED",
        importedAt: new Date(),
        afterJson: {
          productId: mainProductId,
          importedProducts,
          createdBomLines,
          childBomLinesCreated,
        },
        summaryJson: {
          importedProducts: importedProducts.length,
          createdBomLines,
          childBomLinesCreated,
          canSimulateCost,
          costSimulationStatus,
          missingCostItems,
          missingRoutingItems,
        },
        warningsJson: warnings,
      },
    });

    return {
      imported: true,
      productId: mainProductId,
      parentCode: preview.parentCode,
      importedProducts,
      createdBomLines,
      warnings,
      canSimulateCost,
      costSimulationStatus,
      missingCostItems,
      missingRoutingItems,
      runId: run.id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.nomusProductImportRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        summaryJson: { error: message },
      },
    });
    throw err;
  }
}
