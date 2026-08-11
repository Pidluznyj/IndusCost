/**
 * Carga em LOTE do grafo de BOM para análise de saúde (BOM_INACTIVE_COMPONENT).
 *
 * Anti-N+1: BFS por níveis — UMA query `product.findMany` por nível de
 * profundidade cobre TODAS as raízes de uma vez (detalhe de 1 produto ou
 * geração consolidada com centenas usam o mesmo caminho). Nenhuma escrita.
 */

import type { PrismaClient } from "@prisma/client";
import {
  analyzeProductBomHealthFromGraph,
  type ProductBomGraph,
  type ProductBomGraphNode,
  type ProductBomHealthResult,
} from "./productBomHealth.js";

const MAX_GRAPH_DEPTH = 30;

export async function loadProductBomGraph(
  db: PrismaClient,
  rootProductIds: string[]
): Promise<ProductBomGraph> {
  const graph = new Map<string, ProductBomGraphNode>();
  let frontier = [...new Set(rootProductIds.filter(Boolean))];
  let depth = 0;

  while (frontier.length > 0 && depth < MAX_GRAPH_DEPTH) {
    const rows = await db.product.findMany({
      where: { id: { in: frontier } },
      select: {
        id: true,
        sku: true,
        name: true,
        status: true,
        ProductBOM: {
          orderBy: { id: "asc" },
          select: { childProductId: true },
        },
      },
    });

    const next = new Set<string>();
    for (const row of rows) {
      const childProductIds = row.ProductBOM.map((l) => l.childProductId).filter(
        (id): id is string => Boolean(id)
      );
      graph.set(row.id, {
        id: row.id,
        sku: row.sku,
        name: row.name,
        status: row.status ?? null,
        childProductIds,
      });
      for (const childId of childProductIds) {
        if (!graph.has(childId)) next.add(childId);
      }
    }

    frontier = [...next];
    depth += 1;
  }

  return graph;
}

/** Saúde da BOM de UM produto (detalhe/snapshot individual). */
export async function analyzeProductBomHealth(
  db: PrismaClient,
  productId: string
): Promise<ProductBomHealthResult> {
  const graph = await loadProductBomGraph(db, [productId]);
  return analyzeProductBomHealthFromGraph(productId, graph);
}

/**
 * Saúde da BOM de VÁRIOS produtos com um único grafo compartilhado
 * (geração consolidada / listagem da Engenharia).
 */
export async function analyzeProductsBomHealthBatch(
  db: PrismaClient,
  productIds: string[]
): Promise<Map<string, ProductBomHealthResult>> {
  const unique = [...new Set(productIds.filter(Boolean))];
  const out = new Map<string, ProductBomHealthResult>();
  if (unique.length === 0) return out;
  const graph = await loadProductBomGraph(db, unique);
  for (const id of unique) {
    out.set(id, analyzeProductBomHealthFromGraph(id, graph));
  }
  return out;
}
