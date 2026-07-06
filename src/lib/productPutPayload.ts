import type { Product } from "@/src/types/product";

/**
 * Monta o corpo de PUT /api/products/:id a partir do produto carregado (GET),
 * com substituição opcional da BOM — alinhado ao que o servidor espera.
 */
export function buildProductPutBody(
  p: Product,
  overrides?: {
    bom?: Array<{
      materialId?: string | null;
      childProductId?: string | null;
      quantity: number;
      lossPercentage: number;
      notes?: string | null;
    }>;
  }
) {
  const bom =
    overrides?.bom ??
    p.ProductBOM.map((b) => ({
      materialId: b.materialId ?? undefined,
      childProductId: b.childProductId ?? undefined,
      quantity: Number(b.quantity),
      lossPercentage: Number(b.lossPercentage),
      notes: b.notes ?? "",
    }));

  return {
    sku: p.sku,
    name: p.name,
    description: p.description ?? "",
    type: p.type,
    version: p.version,
    defaultLotSize: Number(p.defaultLotSize),
    cycleTimeSeconds: p.cycleTimeSeconds ?? null,
    cavities: p.cavities ?? null,
    setupTimeMin: p.setupTimeMin ?? null,
    efficiencyExpected: p.efficiencyExpected ?? null,
    costingMode: p.costingMode ?? "OWN_PROCESS",
    bom,
    routing: p.ProductRouting.map((r) => ({
      sequence: r.sequence,
      description: r.description ?? "",
      machineId: r.machineId,
      roleId: r.roleId,
      setupTimeMin: Number(r.setupTimeMin),
      operationTimeMin: Number(r.operationTimeMin),
      efficiencyExpected: Number(r.efficiencyExpected),
      cycleTimeSeconds: r.cycleTimeSeconds ?? undefined,
      cavities: r.cavities ?? undefined,
      notes: r.notes,
    })),
  };
}
