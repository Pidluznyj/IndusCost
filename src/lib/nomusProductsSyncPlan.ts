/**
 * Planejamento puro (sem Prisma) das mutações de Product do sync Nomus /produtos.
 *
 * Contrato de ciclo de vida e identidade (Nomus → IndusCost):
 * - Identidade oficial: `sourceExternalId` (id do produto no Nomus). Matching
 *   prefere identidade já vinculada; SKU é fallback para legado ainda não
 *   vinculado, e o vínculo é persistido no primeiro match inequívoco.
 * - SKU mudou no Nomus mantendo o mesmo id → atualiza o SKU do mesmo Product
 *   (campo Nomus-controlled), NUNCA cria produto duplicado. Se o novo SKU já
 *   pertence a outro Product → ambiguidade: nenhuma escrita, reporta.
 * - `ativo: false` EXPLÍCITO no payload → Product.status = "INACTIVE".
 *   Ausência do produto na resposta NUNCA inativa (paginação incompleta,
 *   timeout ou filtro não podem causar inativação em massa).
 * - `ativo: true` (linha elegível) → status = "ACTIVE" (reativação inclusa).
 * - Produto que só existe no IndusCost (sem linha correspondente no Nomus)
 *   não é tocado por este planejador — ele simplesmente nunca entra aqui.
 * - `type` NÃO é atualizado automaticamente: troca de tipo passa pelo fluxo
 *   de reclassificação com análise de impacto. Divergências de inferência
 *   HIGH-confidence são apenas reportadas (`typeMismatch`).
 */
import { createHash } from "node:crypto";
import type { ItemType } from "@prisma/client";
import { normalizeSku } from "./nomusBomComparison.js";

export type ExistingProductSnapshot = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  type: ItemType;
  status: string | null;
  ncm: string | null;
  sourceSystem: string | null;
  sourceExternalId: string | null;
  isNomusControlled: boolean;
};

export type ProductLifecycleRow = {
  externalId: number;
  sku: string;
  /** Nome seguro escolhido pelo mapper (nunca SKU-like em updates de nome). */
  chosenName: string;
  nameLooksLikeSku: boolean;
  description: string | null;
  /** NCM cadastral do payload (mapper: texto trim()ado ou null) — campo Nomus-controlled. */
  ncm: string | null;
  type: ItemType;
  typeInferenceConfidence: "HIGH" | "LOW";
  /** `ativo` explícito do payload Nomus. */
  ativo: boolean;
  raw: Record<string, unknown>;
};

export type ProductSyncMutation =
  | {
      kind: "CREATE";
      sku: string;
      name: string;
      description: string | null;
      ncm: string | null;
      type: ItemType;
      sourceExternalId: string;
      nomusPayloadHash: string;
    }
  | {
      kind: "UPDATE";
      productId: string;
      sku: string;
      /** Campos efetivamente alterados (para changelog/diagnóstico). */
      changedFields: string[];
      data: {
        sku?: string;
        name?: string;
        description: string | null;
        ncm: string | null;
        status: "ACTIVE";
        sourceExternalId: string;
        nomusPayloadHash: string;
      };
      typeMismatch: { current: ItemType; inferred: ItemType } | null;
    }
  | {
      kind: "DEACTIVATE";
      productId: string;
      sku: string;
      previousStatus: string | null;
      data: {
        status: "INACTIVE";
        sourceExternalId: string;
        nomusPayloadHash: string;
      };
    }
  | {
      kind: "SKIP_ALREADY_INACTIVE";
      productId: string;
      sku: string;
    }
  | {
      kind: "SKIP_AMBIGUOUS_IDENTITY";
      sku: string;
      externalId: string;
      reason: string;
      conflictProductId: string | null;
    }
  | {
      kind: "SKIP_NOT_FOUND_INACTIVE";
      sku: string;
      externalId: string;
    };

export function hashNomusProductPayload(raw: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(raw)).digest("hex");
}

export type ProductMatchIndex = {
  byExternalId: Map<string, ExistingProductSnapshot>;
  bySkuKey: Map<string, ExistingProductSnapshot>;
};

export function buildProductMatchIndex(
  products: ExistingProductSnapshot[]
): ProductMatchIndex {
  const byExternalId = new Map<string, ExistingProductSnapshot>();
  const bySkuKey = new Map<string, ExistingProductSnapshot>();
  for (const p of products) {
    if (p.sourceExternalId) byExternalId.set(p.sourceExternalId, p);
    bySkuKey.set(normalizeSku(p.sku), p);
    bySkuKey.set(p.sku, p);
  }
  return { byExternalId, bySkuKey };
}

function matchExisting(
  row: ProductLifecycleRow,
  index: ProductMatchIndex
):
  | { kind: "byExternalId"; product: ExistingProductSnapshot }
  | { kind: "bySku"; product: ExistingProductSnapshot }
  | { kind: "ambiguous"; reason: string; conflictProductId: string | null }
  | { kind: "none" } {
  const externalId = String(row.externalId);
  const byExt = index.byExternalId.get(externalId);
  if (byExt) return { kind: "byExternalId", product: byExt };

  const bySku = index.bySkuKey.get(row.sku) ?? index.bySkuKey.get(normalizeSku(row.sku));
  if (!bySku) return { kind: "none" };
  if (bySku.sourceExternalId && bySku.sourceExternalId !== externalId) {
    return {
      kind: "ambiguous",
      reason: `Product ${bySku.sku} já vinculado ao id Nomus ${bySku.sourceExternalId}; linha traz id ${externalId}.`,
      conflictProductId: bySku.id,
    };
  }
  return { kind: "bySku", product: bySku };
}

/**
 * Decide a mutação de um Product para uma linha Nomus (ativa ou inativa).
 * Nunca decide nada para produtos ausentes da resposta Nomus.
 */
export function planProductSyncMutation(
  row: ProductLifecycleRow,
  index: ProductMatchIndex
): ProductSyncMutation {
  const externalId = String(row.externalId);
  const payloadHash = hashNomusProductPayload(row.raw);
  const match = matchExisting(row, index);

  if (match.kind === "ambiguous") {
    return {
      kind: "SKIP_AMBIGUOUS_IDENTITY",
      sku: row.sku,
      externalId,
      reason: match.reason,
      conflictProductId: match.conflictProductId,
    };
  }

  if (!row.ativo) {
    if (match.kind === "none") {
      return { kind: "SKIP_NOT_FOUND_INACTIVE", sku: row.sku, externalId };
    }
    const product = match.product;
    if ((product.status ?? "ACTIVE") === "INACTIVE") {
      return { kind: "SKIP_ALREADY_INACTIVE", productId: product.id, sku: product.sku };
    }
    return {
      kind: "DEACTIVATE",
      productId: product.id,
      sku: product.sku,
      previousStatus: product.status ?? null,
      data: {
        status: "INACTIVE",
        sourceExternalId: externalId,
        nomusPayloadHash: payloadHash,
      },
    };
  }

  if (match.kind === "none") {
    return {
      kind: "CREATE",
      sku: row.sku,
      name: row.chosenName,
      description: row.description,
      ncm: row.ncm,
      type: row.type,
      sourceExternalId: externalId,
      nomusPayloadHash: payloadHash,
    };
  }

  const product = match.product;
  const changedFields: string[] = [];
  // ncm segue a MESMA política do description (campo Nomus-controlled,
  // escrita incondicional): payload sem NCM → null sobrescreve — o cadastro
  // mestre do Nomus é a única fonte, nunca preservamos valor local divergente.
  const data: Extract<ProductSyncMutation, { kind: "UPDATE" }>["data"] = {
    description: row.description,
    ncm: row.ncm,
    status: "ACTIVE",
    sourceExternalId: externalId,
    nomusPayloadHash: payloadHash,
  };

  // SKU mudou no Nomus (match por identidade oficial): acompanhar. Se o novo
  // SKU já pertence a outro Product, ambiguidade — nenhum remapeamento.
  if (match.kind === "byExternalId" && normalizeSku(product.sku) !== normalizeSku(row.sku)) {
    const occupant =
      index.bySkuKey.get(row.sku) ?? index.bySkuKey.get(normalizeSku(row.sku));
    if (occupant && occupant.id !== product.id) {
      return {
        kind: "SKIP_AMBIGUOUS_IDENTITY",
        sku: row.sku,
        externalId,
        reason: `SKU ${row.sku} (novo SKU Nomus do produto ${product.sku}) já pertence ao Product ${occupant.id}.`,
        conflictProductId: occupant.id,
      };
    }
    data.sku = row.sku;
    changedFields.push("sku");
  }

  const willUpdateName =
    !row.nameLooksLikeSku && row.chosenName.length > 0 && (product.name ?? "") !== row.chosenName;
  if (willUpdateName) {
    data.name = row.chosenName;
    changedFields.push("name");
  }
  if ((product.description ?? null) !== (row.description ?? null)) changedFields.push("description");
  if ((product.ncm ?? null) !== (row.ncm ?? null)) changedFields.push("ncm");
  if ((product.status ?? "ACTIVE") !== "ACTIVE") changedFields.push("status");
  if (product.sourceExternalId !== externalId) changedFields.push("sourceExternalId");

  const typeMismatch =
    row.typeInferenceConfidence === "HIGH" && row.type !== product.type
      ? { current: product.type, inferred: row.type }
      : null;

  return {
    kind: "UPDATE",
    productId: product.id,
    sku: product.sku,
    changedFields,
    data,
    typeMismatch,
  };
}

/**
 * Linhas de ciclo de vida a partir do resultado do mapper: elegíveis (ativas)
 * + bloqueadas EXPLICITAMENTE inativas (ativo=false com sku/externalId).
 * Bloqueios por outros motivos (serviço, template, MP etc.) não geram
 * mutação de lifecycle.
 */
export function extractInactiveLifecycleRows(
  blocked: Array<{
    externalId: number | null;
    sku: string | null;
    reasons: string[];
    ativo: boolean | null;
  }>,
  rawBySkuKey: Map<string, Record<string, unknown>>
): ProductLifecycleRow[] {
  const rows: ProductLifecycleRow[] = [];
  for (const b of blocked) {
    if (b.externalId == null || !b.sku) continue;
    if (b.ativo !== false) continue;
    if (!b.reasons.includes("INACTIVE_PRODUCT_NOMUS")) continue;
    rows.push({
      externalId: b.externalId,
      sku: b.sku,
      chosenName: b.sku,
      nameLooksLikeSku: true,
      description: null,
      ncm: null, // DEACTIVATE não escreve ncm — irrelevante aqui.
      type: "PRODUCT",
      typeInferenceConfidence: "LOW",
      ativo: false,
      raw: rawBySkuKey.get(normalizeSku(b.sku)) ?? rawBySkuKey.get(b.sku) ?? {},
    });
  }
  return rows;
}
