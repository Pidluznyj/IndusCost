/**
 * Catálogo de fontes da inteligência CNPJ multi-source.
 *
 * BCB: séries macroeconômicas (SELIC/IPCA/câmbio) NÃO enriquecem a identidade
 * de um CNPJ. Não há endpoint BCB no escopo atual que devolva cadastro
 * empresarial genérico por CNPJ — portanto a fonte fica `not_applicable`.
 */

export const CNPJ_SOURCE_BRASIL_API = "brasilapi" as const;
export const CNPJ_SOURCE_PUBLICA_CNPJ_WS = "publica.cnpj.ws" as const;
export const CNPJ_SOURCE_BCB = "bcb" as const;

export type CnpjSourceId =
  | typeof CNPJ_SOURCE_BRASIL_API
  | typeof CNPJ_SOURCE_PUBLICA_CNPJ_WS
  | typeof CNPJ_SOURCE_BCB;

export type CnpjSourceStatus = "ok" | "error" | "not_found" | "rate_limited" | "timeout" | "not_applicable";

export type CnpjSourceReport = {
  id: CnpjSourceId;
  label: string;
  status: CnpjSourceStatus;
  message?: string;
};

export const CNPJ_SOURCE_LABELS: Record<CnpjSourceId, string> = {
  [CNPJ_SOURCE_BRASIL_API]: "BrasilAPI (Receita Federal)",
  [CNPJ_SOURCE_PUBLICA_CNPJ_WS]: "publica.cnpj.ws",
  [CNPJ_SOURCE_BCB]: "Banco Central do Brasil",
};

export const BCB_CNPJ_NOT_APPLICABLE_REASON =
  "O BCB não oferece dados cadastrais empresariais genéricos por CNPJ no escopo atual do IndusCost. " +
  "SELIC/IPCA/câmbio são macroeconômicos e não enriquecem a identidade da empresa. " +
  "A fonte permanece reservada para integrações futuras (ex.: instituições supervisionadas).";

/** Precedência por campo: primeira fonte listada que tiver valor não vazio vence. */
export const CNPJ_FIELD_PRECEDENCE: Record<string, CnpjSourceId[]> = {
  companyName: [CNPJ_SOURCE_BRASIL_API, CNPJ_SOURCE_PUBLICA_CNPJ_WS],
  tradeName: [CNPJ_SOURCE_BRASIL_API, CNPJ_SOURCE_PUBLICA_CNPJ_WS],
  registrationStatus: [CNPJ_SOURCE_BRASIL_API, CNPJ_SOURCE_PUBLICA_CNPJ_WS],
  registrationStatusNormalized: [CNPJ_SOURCE_BRASIL_API, CNPJ_SOURCE_PUBLICA_CNPJ_WS],
  openedAt: [CNPJ_SOURCE_BRASIL_API, CNPJ_SOURCE_PUBLICA_CNPJ_WS],
  companySize: [CNPJ_SOURCE_BRASIL_API, CNPJ_SOURCE_PUBLICA_CNPJ_WS],
  legalNature: [CNPJ_SOURCE_BRASIL_API, CNPJ_SOURCE_PUBLICA_CNPJ_WS],
  shareCapital: [CNPJ_SOURCE_BRASIL_API, CNPJ_SOURCE_PUBLICA_CNPJ_WS],
  mainCnae: [CNPJ_SOURCE_BRASIL_API, CNPJ_SOURCE_PUBLICA_CNPJ_WS],
  secondaryCnaes: [CNPJ_SOURCE_BRASIL_API, CNPJ_SOURCE_PUBLICA_CNPJ_WS],
  address: [CNPJ_SOURCE_BRASIL_API, CNPJ_SOURCE_PUBLICA_CNPJ_WS],
  addressNumber: [CNPJ_SOURCE_BRASIL_API, CNPJ_SOURCE_PUBLICA_CNPJ_WS],
  addressComplement: [CNPJ_SOURCE_BRASIL_API, CNPJ_SOURCE_PUBLICA_CNPJ_WS],
  district: [CNPJ_SOURCE_BRASIL_API, CNPJ_SOURCE_PUBLICA_CNPJ_WS],
  city: [CNPJ_SOURCE_BRASIL_API, CNPJ_SOURCE_PUBLICA_CNPJ_WS],
  state: [CNPJ_SOURCE_BRASIL_API, CNPJ_SOURCE_PUBLICA_CNPJ_WS],
  zipCode: [CNPJ_SOURCE_BRASIL_API, CNPJ_SOURCE_PUBLICA_CNPJ_WS],
  phone: [CNPJ_SOURCE_PUBLICA_CNPJ_WS, CNPJ_SOURCE_BRASIL_API],
  email: [CNPJ_SOURCE_PUBLICA_CNPJ_WS, CNPJ_SOURCE_BRASIL_API],
  stateTaxIds: [CNPJ_SOURCE_PUBLICA_CNPJ_WS, CNPJ_SOURCE_BRASIL_API],
  partners: [CNPJ_SOURCE_PUBLICA_CNPJ_WS, CNPJ_SOURCE_BRASIL_API],
  isMei: [CNPJ_SOURCE_BRASIL_API, CNPJ_SOURCE_PUBLICA_CNPJ_WS],
  hasPartners: [CNPJ_SOURCE_PUBLICA_CNPJ_WS, CNPJ_SOURCE_BRASIL_API],
  sourceUpdatedAt: [CNPJ_SOURCE_PUBLICA_CNPJ_WS, CNPJ_SOURCE_BRASIL_API],
};

export function formatCnpjAggregateSourceLabel(reports: CnpjSourceReport[]): string {
  const ok = reports.filter((r) => r.status === "ok").map((r) => r.id);
  if (ok.length === 0) return "none";
  return ok.join("+");
}
