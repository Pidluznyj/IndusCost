/**
 * Resolver compartilhado de identidade comercial no CRM.
 *
 * Reutiliza a mesma língua já usada para "Vendedor do Pedido"
 * (`orderSellerIdentityResolver` + enrich de CommissionPerson/Alias).
 *
 * Regras:
 * - labels executivas = nome canônico / displayName;
 * - nunca "Vendedor ID XXXX" como nome principal;
 * - rawId fica em auditoria técnica.
 */
import {
  COMMERCIAL_RESPONSIBLE_NONE_LABEL,
  ORDER_SELLER_NOT_INFORMED_LABEL,
  ORDER_SELLER_UNMAPPED_LABEL,
  isSellerIdOnlyLabel,
  resolveCommercialResponsibleDisplay,
  resolveOrderSellerIdentity,
  type ResolvedCommercialResponsibleDisplay,
  type ResolvedOrderSellerIdentity,
} from "@/src/lib/commercial/orderSellerIdentityResolver.js";

export {
  COMMERCIAL_RESPONSIBLE_NONE_LABEL,
  ORDER_SELLER_NOT_INFORMED_LABEL,
  ORDER_SELLER_UNMAPPED_LABEL,
  isSellerIdOnlyLabel,
  resolveCommercialResponsibleDisplay,
  resolveOrderSellerIdentity,
};

export type CommercialPersonDisplaySource =
  | "CRM"
  | "AUTO_FROM_SALES_ORDER_SELLER"
  | "SALES_ORDER"
  | "COMMISSION_ALIAS"
  | "COMMISSION_PERSON"
  | "RAW_FALLBACK"
  | "NONE";

export type CommercialPersonDisplay = {
  rawId: string | null;
  rawName: string | null;
  canonicalId: string | null;
  canonicalName: string | null;
  displayName: string;
  isMapped: boolean;
  source: CommercialPersonDisplaySource;
};

/** Nome executivo válido — rejeita vazio e "Vendedor ID N". */
export function cleanExecutiveCommercialName(
  name: string | null | undefined
): string | null {
  const t = (name ?? "").trim().replace(/\s+/g, " ");
  if (!t || isSellerIdOnlyLabel(t)) return null;
  return t;
}

export function resolveCommercialPersonDisplay(input: {
  rawId?: number | string | null;
  rawName?: string | null;
  canonicalId?: string | null;
  canonicalName?: string | null;
  source?: CommercialPersonDisplaySource | string | null;
  fallbackLabel?: string | null;
  /** Quando true (default), ID sem nome → "Vendedor não mapeado". */
  allowUnmapped?: boolean;
}): CommercialPersonDisplay {
  const rawIdNum =
    typeof input.rawId === "number"
      ? input.rawId
      : typeof input.rawId === "string" && /^\d+$/.test(input.rawId.trim())
        ? Number.parseInt(input.rawId.trim(), 10)
        : null;
  const rawId =
    rawIdNum != null && Number.isFinite(rawIdNum) && rawIdNum > 0
      ? String(rawIdNum)
      : null;
  const rawName = cleanExecutiveCommercialName(input.rawName);
  const canonicalName = cleanExecutiveCommercialName(input.canonicalName);
  const canonicalId = input.canonicalId?.trim() || null;
  const srcRaw = (input.source ?? "").toUpperCase();

  let source: CommercialPersonDisplaySource = "NONE";
  if (srcRaw.includes("AUTO")) source = "AUTO_FROM_SALES_ORDER_SELLER";
  else if (srcRaw.includes("ALIAS") || srcRaw === "COMMISSION_ALIAS")
    source = "COMMISSION_ALIAS";
  else if (srcRaw.includes("PERSON") || srcRaw === "COMMISSION_PERSON")
    source = "COMMISSION_PERSON";
  else if (srcRaw.includes("SALES") || srcRaw === "SALES_ORDER") source = "SALES_ORDER";
  else if (srcRaw === "CRM" || srcRaw === "MANUAL" || srcRaw.includes("OWNER"))
    source = "CRM";
  else if (canonicalName || rawName || rawId) source = "RAW_FALLBACK";

  if (canonicalName) {
    return {
      rawId,
      rawName,
      canonicalId,
      canonicalName,
      displayName: canonicalName,
      isMapped: true,
      source: source === "NONE" ? "COMMISSION_ALIAS" : source,
    };
  }

  if (rawName) {
    return {
      rawId,
      rawName,
      canonicalId,
      canonicalName: null,
      displayName: rawName,
      isMapped: false,
      source: source === "NONE" ? "RAW_FALLBACK" : source,
    };
  }

  if (rawId && input.allowUnmapped !== false) {
    return {
      rawId,
      rawName: null,
      canonicalId: null,
      canonicalName: null,
      displayName: input.fallbackLabel?.trim() || ORDER_SELLER_UNMAPPED_LABEL,
      isMapped: false,
      source: "RAW_FALLBACK",
    };
  }

  return {
    rawId: null,
    rawName: null,
    canonicalId: null,
    canonicalName: null,
    displayName:
      input.fallbackLabel?.trim() || COMMERCIAL_RESPONSIBLE_NONE_LABEL,
    isMapped: false,
    source: "NONE",
  };
}

export function resolveOrderSellerDisplay(input: {
  rawId?: number | string | null;
  rawName?: string | null;
  canonicalId?: string | null;
  canonicalName?: string | null;
  source?: string | null;
}): CommercialPersonDisplay {
  return resolveCommercialPersonDisplay({
    ...input,
    fallbackLabel: ORDER_SELLER_UNMAPPED_LABEL,
    allowUnmapped: true,
  });
}

export function resolveCommercialOwnerDisplay(input: {
  rawId?: number | string | null;
  rawName?: string | null;
  canonicalId?: string | null;
  canonicalName?: string | null;
  source?: string | null;
}): CommercialPersonDisplay {
  return resolveCommercialPersonDisplay({
    ...input,
    fallbackLabel: ORDER_SELLER_UNMAPPED_LABEL,
    allowUnmapped: true,
  });
}

export function commercialPersonFromOrderSeller(
  resolved: ResolvedOrderSellerIdentity
): CommercialPersonDisplay {
  return {
    rawId:
      resolved.rawExternalId != null ? String(resolved.rawExternalId) : null,
    rawName: resolved.rawName,
    canonicalId: resolved.canonicalId,
    canonicalName: resolved.canonicalName,
    displayName: resolved.displayName,
    isMapped: resolved.isMapped,
    source:
      resolved.source === "ALIAS"
        ? "COMMISSION_ALIAS"
        : resolved.source === "SALES_ORDER"
          ? "SALES_ORDER"
          : resolved.source === "NONE"
            ? "NONE"
            : "RAW_FALLBACK",
  };
}

export function commercialPersonFromResponsible(
  resolved: ResolvedCommercialResponsibleDisplay
): CommercialPersonDisplay {
  return resolveCommercialOwnerDisplay({
    rawId: null,
    rawName: resolved.name,
    canonicalName: resolved.name,
    canonicalId: resolved.id,
    source: resolved.source === "AUTO_ASSIGNED" ? "AUTO_FROM_SALES_ORDER_SELLER" : "CRM",
  });
}
