import { LEGAL_ALIAS_TYPES, type LegalAliasType } from "./legalExposureContracts.js";

export type ExposureAliasRow = {
  id: string;
  entityId: string;
  type: LegalAliasType;
  value: string;
  active: boolean;
  createdAt: string;
};

export const ALIAS_TYPE_LABELS: Record<LegalAliasType, string> = {
  LEGAL_NAME: "Razão social",
  TRADE_NAME: "Nome fantasia",
  OLD_LEGAL_NAME: "Razão social anterior",
  ABBREVIATION: "Abreviação",
  OTHER: "Outro",
};

export function exposureAliasListPath(entityId: string): string {
  return `/api/legal-exposure/entities/${entityId}/aliases`;
}

export function exposureAliasCreateRequest(entityId: string): { method: "POST"; path: string } {
  return { method: "POST", path: exposureAliasListPath(entityId) };
}

export function exposureAliasPatchRequest(aliasId: string): { method: "PATCH"; path: string } {
  return { method: "PATCH", path: `/api/legal-exposure/aliases/${aliasId}` };
}

export function buildCreateAliasBody(input: {
  value: string;
  type: string;
}): { ok: true; body: { value: string; type: LegalAliasType } } | { ok: false; error: string } {
  const value = input.value.trim();
  if (!value) return { ok: false, error: "Informe o valor do alias." };
  if (!(LEGAL_ALIAS_TYPES as readonly string[]).includes(input.type)) {
    return { ok: false, error: "Tipo de alias inválido." };
  }
  return { ok: true, body: { value, type: input.type as LegalAliasType } };
}

export const ALIAS_TYPE_OPTIONS = LEGAL_ALIAS_TYPES.map((type) => ({
  type,
  label: ALIAS_TYPE_LABELS[type],
}));
