/**
 * Parse/normalização de IDs Nomus no vínculo AppUser ↔ vendedor.
 */

export function parseExternalSellerIdsInput(raw: unknown): number[] {
  const out: number[] = [];
  const push = (value: unknown) => {
    const n =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number.parseInt(value.trim(), 10)
          : NaN;
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
  };
  if (Array.isArray(raw)) {
    for (const item of raw) push(item);
  } else if (typeof raw === "string" && raw.trim()) {
    for (const part of raw.split(/[,;\s]+/)) push(part);
  } else if (raw != null && raw !== "") {
    push(raw);
  }
  return out.sort((a, b) => a - b);
}

/** ID canônico legado: menor ID da seleção (estável). */
export function resolvePrimaryExternalSellerId(ids: readonly number[]): number | null {
  if (!ids.length) return null;
  return Math.min(...ids);
}

/**
 * Resolve vínculo comercial a partir do body (create/patch).
 * Aceita `externalSellerIds` (preferido) e/ou `externalSellerId` legado.
 */
export function resolveAppUserSellerLinkFromBody(body: {
  externalSellerId?: unknown;
  externalSellerIds?: unknown;
  sellerResponsibleName?: unknown;
}): {
  externalSellerIds: number[];
  externalSellerId: number | null;
  sellerResponsibleName: string | null;
} {
  const fromArray = parseExternalSellerIdsInput(body.externalSellerIds);
  const legacy =
    body.externalSellerId === null || body.externalSellerId === undefined
      ? []
      : parseExternalSellerIdsInput(body.externalSellerId);
  const externalSellerIds = fromArray.length > 0 ? fromArray : legacy;
  const sellerResponsibleName =
    typeof body.sellerResponsibleName === "string"
      ? body.sellerResponsibleName.trim() || null
      : null;
  return {
    externalSellerIds,
    externalSellerId: resolvePrimaryExternalSellerId(externalSellerIds),
    sellerResponsibleName,
  };
}
