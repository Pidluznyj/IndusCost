import { prisma } from "@/src/lib/prisma";
import { normalizeComponentCode, normalizeSku } from "@/src/lib/nomusBomComparison";
import { buildBomComparisonForParentCode } from "@/src/lib/nomusBomComparisonLoad";
import { resolveNomusComponentCodes } from "@/src/lib/nomusBomComparisonLoad";
import {
  isRegistryActiveStatus,
  prefersMaterialForNomusComponent,
} from "@/src/lib/nomusComponentRegistryResolve";

export type ComponentRegistryConflictPreview = {
  generatedAt: string;
  codeBase: string;
  parentCode: string | null;
  codeVariantsSearched: string[];
  materials: Array<{
    id: string;
    code: string;
    description: string;
    status: string | null;
    active: boolean;
    productBomLineCount: number;
    purchaseRequestItemCount: number;
  }>;
  products: Array<{
    id: string;
    sku: string;
    name: string;
    type: string;
    status: string | null;
    active: boolean;
    sourceSystem: string | null;
    isNomusControlled: boolean;
    productBomAsChildCount: number;
    proposalItemCount: number;
    salesOrderItemCount: number;
  }>;
  nomusCatalog: Array<{
    code: string;
    description: string | null;
    active: boolean | null;
    typeName: string | null;
    syncedAt: string;
  }>;
  nomusStageByParent: Array<{
    parentCode: string;
    componentCode: string;
    componentDescription: string | null;
    quantity: number | null;
    lineCount: number;
  }>;
  productBomLinks: Array<{
    productBomLineId: string;
    parentSku: string;
    parentName: string;
    linkKind: "MATERIAL" | "PRODUCT" | "UNKNOWN";
    linkedCode: string;
    linkedDescription: string | null;
    linkedStatus: string | null;
    linkedActive: boolean;
    quantity: number | null;
    nomusComponentCode: string | null;
    isNomusControlled: boolean;
    localException: boolean;
  }>;
  resolver: Array<{
    componentCode: string;
    resolvedKind: string;
    productId: string | null;
    materialId: string | null;
    prefersMaterialRule: boolean;
  }>;
  parentComparison?: {
    parentCode: string;
    linesForBase: Array<{
      componentCode: string;
      status: string;
      nomusQuantity: number | null;
      indusQuantity: number | null;
    }>;
  };
  risks: string[];
  recommendations: string[];
  wouldNomusRecreateAfterCleanup: boolean;
  cleanupPreview: {
    productBomLinesToUnlink: string[];
    registriesSafeToDeactivateOnly: string[];
    registriesBlockedFromDelete: string[];
  };
};

function expandCodeVariants(base: string): string[] {
  const core = base.trim().replace(/%+$/g, "");
  const variants = new Set<string>([core, normalizeSku(core)]);
  if (!core.endsWith("%")) {
    variants.add(`${core}%`);
    variants.add(`${normalizeSku(core)}%`);
  }
  return [...variants];
}

export async function buildComponentRegistryConflictPreview(input: {
  codeBase: string;
  parentCode?: string | null;
}): Promise<ComponentRegistryConflictPreview> {
  const codeBase = input.codeBase.trim();
  const parentCode = input.parentCode?.trim() || null;
  const likeCore = codeBase.replace(/%+$/g, "");
  const materials = await prisma.material.findMany({
    where: { code: { startsWith: likeCore, mode: "insensitive" } },
    select: {
      id: true,
      code: true,
      description: true,
      status: true,
      _count: { select: { ProductBOM: true, PurchaseRequestItem: true } },
    },
    orderBy: { code: "asc" },
  });

  const products = await prisma.product.findMany({
    where: { sku: { startsWith: likeCore, mode: "insensitive" } },
    select: {
      id: true,
      sku: true,
      name: true,
      type: true,
      status: true,
      sourceSystem: true,
      isNomusControlled: true,
      _count: { select: { UsedInBOM: true, ProposalItem: true, SalesOrderItem: true } },
    },
    orderBy: { sku: "asc" },
  });

  const materialIds = materials.map((m) => m.id);
  const productIds = products.map((p) => p.id);

  const nomusCatalog = await prisma.nomusProductCatalog.findMany({
    where: { code: { startsWith: likeCore, mode: "insensitive" } },
    select: {
      code: true,
      description: true,
      active: true,
      typeName: true,
      syncedAt: true,
    },
    orderBy: { code: "asc" },
  });

  const nomusStageRows = await prisma.nomusBomComponentStage.findMany({
    where: {
      OR: [
        { componentCode: { startsWith: likeCore, mode: "insensitive" } },
        ...(parentCode
          ? [{ parentCode: { in: [parentCode, normalizeSku(parentCode)] } }]
          : []),
      ],
    },
    select: {
      parentCode: true,
      componentCode: true,
      componentDescription: true,
      qtdeNecessaria: true,
    },
  });

  const stageByParentMap = new Map<
    string,
    { componentCode: string; componentDescription: string | null; qty: number; count: number }
  >();
  for (const row of nomusStageRows) {
    if (!normalizeComponentCode(row.componentCode).startsWith(normalizeComponentCode(likeCore))) {
      if (!parentCode) continue;
    }
    const key = `${normalizeSku(row.parentCode)}::${normalizeComponentCode(row.componentCode)}`;
    const qty = row.qtdeNecessaria != null ? Number(row.qtdeNecessaria.toString()) : null;
    const prev = stageByParentMap.get(key);
    if (prev) {
      prev.count += 1;
      if (qty != null) prev.qty = (prev.qty ?? 0) + qty;
    } else {
      stageByParentMap.set(key, {
        componentCode: row.componentCode,
        componentDescription: row.componentDescription,
        qty: qty ?? 0,
        count: 1,
      });
    }
  }

  const bomLinks =
    materialIds.length === 0 && productIds.length === 0
      ? []
      : await prisma.productBOM.findMany({
    where: {
      OR: [
        ...(materialIds.length > 0 ? [{ materialId: { in: materialIds } }] : []),
        ...(productIds.length > 0 ? [{ childProductId: { in: productIds } }] : []),
      ],
    },
    select: {
      id: true,
      quantity: true,
      nomusComponentCode: true,
      isNomusControlled: true,
      localException: true,
      materialId: true,
      childProductId: true,
      Material: { select: { code: true, description: true, status: true } },
      ChildProduct: { select: { sku: true, name: true, status: true } },
      ParentProduct: { select: { sku: true, name: true } },
    },
    orderBy: [{ ParentProduct: { sku: "asc" } }, { id: "asc" }],
  });

  const stageCodesForParent = parentCode
    ? nomusStageRows
        .filter((r) => normalizeSku(r.parentCode) === normalizeSku(parentCode))
        .map((r) => r.componentCode)
    : [...new Set(nomusStageRows.map((r) => r.componentCode))];

  const resolver =
    stageCodesForParent.length > 0
      ? await resolveNomusComponentCodes(stageCodesForParent)
      : await resolveNomusComponentCodes(
          [...new Set([...materials.map((m) => m.code), ...products.map((p) => p.sku)])]
        );

  let parentComparison: ComponentRegistryConflictPreview["parentComparison"];
  if (parentCode) {
    const cmp = await buildBomComparisonForParentCode(parentCode);
    const baseKey = normalizeComponentCode(likeCore);
    const linesForBase = cmp.lines.filter((l) =>
      normalizeComponentCode(l.componentCode).startsWith(baseKey)
    );
    parentComparison = {
      parentCode: cmp.parentCode,
      linesForBase: linesForBase.map((l) => ({
        componentCode: l.componentCode,
        status: l.status,
        nomusQuantity: l.nomusQuantity ?? null,
        indusQuantity: l.indusQuantity ?? null,
      })),
    };
  }

  const risks: string[] = [];
  const recommendations: string[] = [];

  const activeMaterials = materials.filter((m) => isRegistryActiveStatus(m.status));
  const activeProducts = products.filter((p) => isRegistryActiveStatus(p.status));
  const inactiveMaterials = materials.filter((m) => !isRegistryActiveStatus(m.status));
  const inactiveProducts = products.filter((p) => !isRegistryActiveStatus(p.status));

  if (activeMaterials.length > 0 && activeProducts.length > 0) {
    risks.push(
      "Existem Material e Product ativos com códigos similares — resolução automática pode ser ambígua (BOTH)."
    );
  }
  if (inactiveMaterials.length > 0 && activeProducts.length > 0) {
    risks.push(
      "Material inativo coexiste com Product ativo — versões antigas de suprimentos vs componentes."
    );
    recommendations.push(
      "Desvincular ProductBOM do Material inativo; manter Product ativo ou usar Material ativo do Nomus (420.01A-)."
    );
  }
  if (materials.length > 1 || products.length > 1) {
    risks.push("Múltiplos cadastros com prefixo semelhante (sufixo/hífen diferentes).");
  }

  const nomusCodes = new Set(
    nomusStageRows.map((r) => normalizeComponentCode(r.componentCode))
  );
  const indusOnlyCodes = new Set(
    (parentComparison?.linesForBase ?? [])
      .filter((l) => l.status === "ONLY_IN_INDUSCOST")
      .map((l) => normalizeComponentCode(l.componentCode))
  );
  if (indusOnlyCodes.size > 0 && nomusCodes.size > 0) {
    const overlap = [...indusOnlyCodes].some((c) => nomusCodes.has(c));
    if (!overlap) {
      risks.push(
        "Códigos ONLY_IN_INDUSCOST não batem exatamente com componentCode Nomus (ex.: 420.01A vs 420.01A-) — gera revisão local."
      );
      recommendations.push(
        "Alinhar ProductBOM ao código exato da BOM Nomus ou limpar cadastro divergente e reaplicar BOM."
      );
    }
  }

  const productBomLinesToUnlink: string[] = [];
  const registriesBlockedFromDelete: string[] = [];
  const registriesSafeToDeactivateOnly: string[] = [];

  for (const link of bomLinks) {
    const linkedActive = link.Material
      ? isRegistryActiveStatus(link.Material.status)
      : link.ChildProduct
        ? isRegistryActiveStatus(link.ChildProduct.status)
        : false;
    if (!linkedActive) {
      productBomLinesToUnlink.push(link.id);
    }
  }

  for (const m of materials) {
    if (m._count.PurchaseRequestItem > 0) {
      registriesBlockedFromDelete.push(`Material ${m.code} (pedidos de compra)`);
    } else if (!isRegistryActiveStatus(m.status)) {
      registriesSafeToDeactivateOnly.push(`Material ${m.code}`);
    }
  }
  for (const p of products) {
    if (p._count.ProposalItem > 0 || p._count.SalesOrderItem > 0) {
      registriesBlockedFromDelete.push(`Product ${p.sku} (proposta/pedido)`);
    }
  }

  const wouldNomusRecreateAfterCleanup =
    nomusStageRows.length > 0 &&
    activeMaterials.length + activeProducts.length > 0;

  if (prefersMaterialForNomusComponent("420.01A-")) {
    recommendations.push(
      "420.01A- tem regra PREFER_MATERIAL quando Product+Material ativos coexistem com o mesmo código."
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    codeBase,
    parentCode,
    codeVariantsSearched: expandCodeVariants(codeBase),
    materials: materials.map((m) => ({
      id: m.id,
      code: m.code,
      description: m.description,
      status: m.status,
      active: isRegistryActiveStatus(m.status),
      productBomLineCount: m._count.ProductBOM,
      purchaseRequestItemCount: m._count.PurchaseRequestItem,
    })),
    products: products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      type: String(p.type),
      status: p.status,
      active: isRegistryActiveStatus(p.status),
      sourceSystem: p.sourceSystem,
      isNomusControlled: p.isNomusControlled,
      productBomAsChildCount: p._count.UsedInBOM,
      proposalItemCount: p._count.ProposalItem,
      salesOrderItemCount: p._count.SalesOrderItem,
    })),
    nomusCatalog: nomusCatalog.map((c) => ({
      code: c.code,
      description: c.description,
      active: c.active,
      typeName: c.typeName,
      syncedAt: c.syncedAt.toISOString(),
    })),
    nomusStageByParent: [...stageByParentMap.entries()].map(([key, v]) => {
      const pCode = key.split("::")[0] ?? "";
      return {
        parentCode: pCode,
        componentCode: v.componentCode,
        componentDescription: v.componentDescription,
        quantity: v.qty,
        lineCount: v.count,
      };
    }),
    productBomLinks: bomLinks.map((row) => {
      const linkKind = row.materialId ? ("MATERIAL" as const) : row.childProductId ? ("PRODUCT" as const) : ("UNKNOWN" as const);
      const linkedCode = row.Material?.code ?? row.ChildProduct?.sku ?? "?";
      const linkedStatus = row.Material?.status ?? row.ChildProduct?.status ?? null;
      return {
        productBomLineId: row.id,
        parentSku: row.ParentProduct.sku,
        parentName: row.ParentProduct.name,
        linkKind,
        linkedCode,
        linkedDescription: row.Material?.description ?? row.ChildProduct?.name ?? null,
        linkedStatus,
        linkedActive: isRegistryActiveStatus(linkedStatus),
        quantity: row.quantity != null ? Number(row.quantity.toString()) : null,
        nomusComponentCode: row.nomusComponentCode,
        isNomusControlled: row.isNomusControlled,
        localException: row.localException,
      };
    }),
    resolver: resolver.map((r) => ({
      componentCode: r.componentCode,
      resolvedKind: r.resolvedKind,
      productId: r.productId ?? null,
      materialId: r.materialId ?? null,
      prefersMaterialRule: prefersMaterialForNomusComponent(r.componentCode),
    })),
    parentComparison,
    risks,
    recommendations,
    wouldNomusRecreateAfterCleanup,
    cleanupPreview: {
      productBomLinesToUnlink,
      registriesSafeToDeactivateOnly,
      registriesBlockedFromDelete,
    },
  };
}
