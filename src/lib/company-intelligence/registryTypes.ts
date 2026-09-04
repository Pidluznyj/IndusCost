/**
 * Tipos compartilháveis (frontend + backend) da inteligência cadastral multi-fonte.
 * Sem Prisma, fetch ou Node builtins.
 */

export const CNPJ_SOURCE_PUBLICA = "publica.cnpj.ws" as const;
export const CNPJ_SOURCE_BRASIL_API = "brasilapi.com.br" as const;
export const ECONOMIC_SOURCE_BCB = "bcb.gov.br" as const;

export type CnpjCadastreSourceId =
  | typeof CNPJ_SOURCE_PUBLICA
  | typeof CNPJ_SOURCE_BRASIL_API;

export type CnpjProviderStatus =
  | "SUCCESS"
  | "NOT_FOUND"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "ERROR"
  | "INVALID_PAYLOAD"
  | "SKIPPED_CACHE";

export type CnpjSourceRole = "primary" | "secondary" | "fallback" | "economic";

export type CnpjSourceStatus = {
  source: string;
  displayName: string;
  role: CnpjSourceRole;
  status: CnpjProviderStatus | "UNAVAILABLE";
  fetchedAt: string | null;
  fromCache: boolean;
  latencyMs: number | null;
  message: string | null;
};

export type RegistryCompareStatus =
  | "MATCH"
  | "DIFFERENT"
  | "MISSING_PRIMARY"
  | "MISSING_SECONDARY"
  | "SINGLE_SOURCE";

export type CnpjFieldSourceValue = {
  source: string;
  value: string | null;
};

export type CnpjFieldProvenance = {
  field: string;
  label: string;
  chosenValue: string | null;
  chosenSource: string | null;
  values: CnpjFieldSourceValue[];
  status: RegistryCompareStatus;
};

/** Precedência cadastral: publica.cnpj.ws é primária; BrasilAPI complementa ou cobre fallback. */
export const CADASTRE_SOURCE_PRECEDENCE: readonly CnpjCadastreSourceId[] = [
  CNPJ_SOURCE_PUBLICA,
  CNPJ_SOURCE_BRASIL_API,
];

export const CNPJ_SOURCE_DISPLAY_NAME: Record<string, string> = {
  [CNPJ_SOURCE_PUBLICA]: "publica.cnpj.ws",
  [CNPJ_SOURCE_BRASIL_API]: "BrasilAPI",
  [ECONOMIC_SOURCE_BCB]: "Banco Central do Brasil",
};

export const REGISTRY_COMPARE_STATUS_LABEL: Record<RegistryCompareStatus, string> = {
  MATCH: "Iguais",
  DIFFERENT: "Divergente",
  MISSING_PRIMARY: "Só na fonte complementar",
  MISSING_SECONDARY: "Só na fonte principal",
  SINGLE_SOURCE: "Uma fonte",
};

export const PROVENANCE_FIELDS = [
  { field: "companyName", label: "Razão social" },
  { field: "tradeName", label: "Nome fantasia" },
  { field: "registrationStatus", label: "Situação cadastral" },
  { field: "openedAt", label: "Data de abertura" },
  { field: "legalNature", label: "Natureza jurídica" },
  { field: "companySize", label: "Porte" },
  { field: "shareCapital", label: "Capital social" },
  { field: "mainCnae", label: "CNAE principal" },
  { field: "address", label: "Endereço" },
  { field: "city", label: "Município" },
  { field: "state", label: "UF" },
  { field: "zipCode", label: "CEP" },
  { field: "partners", label: "QSA" },
  { field: "isMei", label: "MEI" },
] as const;
