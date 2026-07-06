/**
 * Camada de regra: quem controla cada campo (Nomus x IndusCost).
 *
 * Conceitos:
 * - Produto Nomus-controlled: existe no Nomus e foi sincronizado pelo botão "Atualizar engenharia
 *   pelo Nomus". Tem `isNomusControlled = true`.
 * - Produto local: criado no IndusCost sem origem Nomus. `isNomusControlled = false`.
 * - Linha ProductBOM Nomus-controlled: criada/atualizada a partir da BOM efetiva Nomus.
 * - Linha ProductBOM local exception: linha local autorizada formalmente em produto Nomus-controlled.
 */

export type EngineeringSourceSystem = "NOMUS" | "INDUSCOST";

export type ProductOwnershipSnapshot = {
  id: string;
  sku: string;
  sourceSystem: EngineeringSourceSystem | null;
  isNomusControlled: boolean;
  lastNomusSyncAt: Date | null;
};

export type ProductBomLineOwnershipSnapshot = {
  id: string;
  productId: string;
  sourceSystem: EngineeringSourceSystem | null;
  isNomusControlled: boolean;
  localException: boolean;
  lastNomusSyncAt: Date | null;
};

/** Campos do Product cujo valor passa a ser ditado pelo Nomus quando o produto é Nomus-controlled. */
export const NOMUS_CONTROLLED_PRODUCT_FIELDS = [
  "sku",
  "name",
  "description",
  "type",
  "status",
  "sourceSystem",
  "sourceExternalId",
  "isNomusControlled",
  "lastNomusSyncAt",
  "nomusPayloadHash",
] as const;

/** Campos do Product que permanecem locais mesmo em produto Nomus-controlled. */
export const LOCAL_EDITABLE_PRODUCT_FIELDS = [
  "defaultLotSize",
  "version",
  "cycleTimeSeconds",
  "cavities",
  "setupTimeMin",
  "efficiencyExpected",
] as const;

/** Campos da ProductBOM ditados pelo Nomus em linhas Nomus-controlled. */
export const NOMUS_CONTROLLED_BOM_FIELDS = [
  "materialId",
  "childProductId",
  "quantity",
  "lossPercentage",
  "nomusComponentCode",
  "sourceSystem",
  "isNomusControlled",
  "lastNomusSyncAt",
] as const;

/** Campos de ProductBOM sempre editáveis localmente (mesmo em linha Nomus-controlled, com auditoria). */
export const LOCAL_EDITABLE_BOM_FIELDS = ["notes"] as const;

export type NomusControlledProductField = (typeof NOMUS_CONTROLLED_PRODUCT_FIELDS)[number];
export type LocalEditableProductField = (typeof LOCAL_EDITABLE_PRODUCT_FIELDS)[number];
export type NomusControlledBomField = (typeof NOMUS_CONTROLLED_BOM_FIELDS)[number];
export type LocalEditableBomField = (typeof LOCAL_EDITABLE_BOM_FIELDS)[number];

export function isNomusControlledProduct(product: ProductOwnershipSnapshot | null | undefined): boolean {
  if (!product) return false;
  return Boolean(product.isNomusControlled) || product.sourceSystem === "NOMUS";
}

export function isNomusControlledBomLine(
  bomLine: ProductBomLineOwnershipSnapshot | null | undefined
): boolean {
  if (!bomLine) return false;
  if (bomLine.localException) return false;
  return Boolean(bomLine.isNomusControlled) || bomLine.sourceSystem === "NOMUS";
}

export function isLocalExceptionBomLine(
  bomLine: ProductBomLineOwnershipSnapshot | null | undefined
): boolean {
  return Boolean(bomLine?.localException);
}

export function getNomusControlledProductFields(): readonly NomusControlledProductField[] {
  return NOMUS_CONTROLLED_PRODUCT_FIELDS;
}

export function getLocalEditableProductFields(): readonly LocalEditableProductField[] {
  return LOCAL_EDITABLE_PRODUCT_FIELDS;
}

export function getNomusControlledBomFields(): readonly NomusControlledBomField[] {
  return NOMUS_CONTROLLED_BOM_FIELDS;
}

export function getLocalEditableBomFields(): readonly LocalEditableBomField[] {
  return LOCAL_EDITABLE_BOM_FIELDS;
}

export type EditEntity =
  | { kind: "PRODUCT"; snapshot: ProductOwnershipSnapshot | null | undefined }
  | { kind: "PRODUCT_BOM_LINE"; snapshot: ProductBomLineOwnershipSnapshot | null | undefined };

/**
 * Decide se um campo de uma entidade pode ser editado manualmente pelo usuário (UI).
 * O backend ainda decide separadamente quem pode aplicar o sync (apenas regras Nomus).
 */
export function canEditEngineeringField(
  entity: EditEntity,
  field: string,
  _context?: { user?: { id?: string | null } | null }
): { allowed: boolean; reason?: string } {
  if (entity.kind === "PRODUCT") {
    const nomusControlled = isNomusControlledProduct(entity.snapshot);
    if (!nomusControlled) return { allowed: true };
    if ((LOCAL_EDITABLE_PRODUCT_FIELDS as readonly string[]).includes(field)) {
      return { allowed: true };
    }
    if ((NOMUS_CONTROLLED_PRODUCT_FIELDS as readonly string[]).includes(field)) {
      return {
        allowed: false,
        reason: "Campo controlado pelo Nomus. Altere no Nomus e sincronize novamente.",
      };
    }
    return { allowed: true };
  }

  if (entity.kind === "PRODUCT_BOM_LINE") {
    if (isLocalExceptionBomLine(entity.snapshot)) {
      return { allowed: true };
    }
    if (!isNomusControlledBomLine(entity.snapshot)) {
      return { allowed: true };
    }
    if ((LOCAL_EDITABLE_BOM_FIELDS as readonly string[]).includes(field)) {
      return { allowed: true };
    }
    if ((NOMUS_CONTROLLED_BOM_FIELDS as readonly string[]).includes(field)) {
      return {
        allowed: false,
        reason: "Linha controlada pelo Nomus. Altere no Nomus e sincronize novamente.",
      };
    }
    return { allowed: true };
  }

  return { allowed: true };
}

/** Helper de UI: rótulo curto do status de ownership. */
export function ownershipBadge(product: ProductOwnershipSnapshot | null | undefined):
  | { label: "Controlado pelo Nomus"; tone: "nomus" }
  | { label: "Local"; tone: "local" }
  | null {
  if (!product) return null;
  if (isNomusControlledProduct(product)) {
    return { label: "Controlado pelo Nomus", tone: "nomus" };
  }
  return { label: "Local", tone: "local" };
}
