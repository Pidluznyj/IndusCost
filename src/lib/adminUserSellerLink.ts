/**
 * Parse/normalização de IDs Nomus no vínculo AppUser ↔ vendedor.
 *
 * Fluxo operacional:
 * 1. Criar usuário (nasce VIEWER, sem perfil/vínculo).
 * 2. Definir role técnica SELLER ou COMMERCIAL_MANAGER (ou manter VIEWER com perfil).
 * 3. Vincular nome + ID(s) Nomus do vendedor do pedido — obrigatório para SELLER.
 */

/** Roles que podem receber vínculo Nomus no Admin → Usuários. */
export function roleAllowsSellerNomusLink(role: string | null | undefined): boolean {
  return (
    role === "SELLER" ||
    role === "COMMERCIAL_MANAGER" ||
    // VIEWER com perfil comercial: vínculo opcional após criação fail-closed.
    role === "VIEWER"
  );
}

/** Vendedor exige responsável + ao menos 1 ID Nomus; gestor/VIEWER são opcionais. */
export function roleRequiresSellerNomusLink(role: string | null | undefined): boolean {
  return role === "SELLER";
}

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
