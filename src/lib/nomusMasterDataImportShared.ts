/**
 * Helpers puros da Carga Mestre Nomus.
 *
 * NÃO importar Prisma, @prisma/client ou libs server-side neste arquivo.
 */

import type { MasterDataClassification } from "@/src/lib/nomusMasterDataImportTypes";

export const CLASSIFICATION_LABEL: Record<MasterDataClassification, string> = {
  EXISTING_PRODUCT: "Já existe como Produto",
  EXISTING_MATERIAL: "Já existe como Material",
  EXISTING_BOTH_AMBIGUOUS: "Ambíguo bloqueado (Product + Material)",
  RESOLVED_AS_MATERIAL: "Ambíguo resolvido — Material",
  RESOLVED_AS_PRODUCT: "Ambíguo resolvido — Product",
  SAFE_PRODUCT_CANDIDATE: "Produto/componente seguro para cadastro",
  SAFE_MATERIAL_CANDIDATE: "Material seguro para cadastro",
  AMBIGUOUS_REVIEW: "Precisa revisão",
  BLOCKED_INVALID_CODE: "Bloqueado — código inválido",
  BLOCKED_LOCAL_PROCESS_CODE: "Bloqueado — montagem local (800.xx)",
  BLOCKED_MISSING_DESCRIPTION: "Bloqueado — descrição vazia",
  BLOCKED_UNSUPPORTED_REQUIRED_FIELDS: "Bloqueado — falta dado obrigatório",
  SKIPPED_OPTIONAL_MASTER_ALREADY_EXISTS: "Já existe — não será importado",
};

const SAFE_SET: MasterDataClassification[] = [
  "SAFE_PRODUCT_CANDIDATE",
  "SAFE_MATERIAL_CANDIDATE",
];

const BLOCKED_SET: MasterDataClassification[] = [
  "BLOCKED_INVALID_CODE",
  "BLOCKED_LOCAL_PROCESS_CODE",
  "BLOCKED_MISSING_DESCRIPTION",
  "BLOCKED_UNSUPPORTED_REQUIRED_FIELDS",
];

const EXISTING_SET: MasterDataClassification[] = [
  "EXISTING_PRODUCT",
  "EXISTING_MATERIAL",
  "EXISTING_BOTH_AMBIGUOUS",
  "RESOLVED_AS_MATERIAL",
  "RESOLVED_AS_PRODUCT",
  "SKIPPED_OPTIONAL_MASTER_ALREADY_EXISTS",
];

const RESOLVED_AMBIGUITY_SET: MasterDataClassification[] = [
  "RESOLVED_AS_MATERIAL",
  "RESOLVED_AS_PRODUCT",
];

export function isResolvedAmbiguityClassification(cls: MasterDataClassification): boolean {
  return RESOLVED_AMBIGUITY_SET.includes(cls);
}

export function isRealAmbiguousBlockedClassification(cls: MasterDataClassification): boolean {
  return cls === "EXISTING_BOTH_AMBIGUOUS";
}

export function classificationLabelFor(cls: MasterDataClassification): string {
  return CLASSIFICATION_LABEL[cls] ?? "—";
}

export function isSafeClassification(cls: MasterDataClassification): boolean {
  return SAFE_SET.includes(cls);
}

export function isBlockedClassification(cls: MasterDataClassification): boolean {
  return BLOCKED_SET.includes(cls);
}

export function isExistingClassification(cls: MasterDataClassification): boolean {
  return EXISTING_SET.includes(cls);
}

export function isAssemblyLocalCode(code: string): boolean {
  return code.trim().startsWith("800.");
}

export function isValidCode(code: string): boolean {
  const trimmed = code.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > 64) return false;
  return true;
}

/**
 * Limpa a descrição removendo asteriscos decorativos e múltiplos espaços,
 * mas preservando o conteúdo significativo.
 */
export function cleanNomusDescription(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/[*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
