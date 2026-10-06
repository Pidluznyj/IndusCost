/**
 * Consulta da Política Comercial vigente (somente leitura).
 * Não cria permissão nova: reutiliza papéis comerciais + audiência de aceite.
 * Puro (sem Node crypto) — seguro para frontend.
 */

export const COMMERCIAL_POLICY_CONSULT_ROLES = [
  "SELLER",
  "COMMERCIAL_MANAGER",
  "ADMIN",
  "SUPER_ADMIN",
] as const;

export type CommercialPolicyConsultRole = (typeof COMMERCIAL_POLICY_CONSULT_ROLES)[number];

export const COMMERCIAL_POLICY_CONSULT_ROUTE_PATH = "/commercial/policy";
export const COMMERCIAL_POLICY_CONSULT_PAGE_TITLE = "Política Comercial";
export const COMMERCIAL_POLICY_CONSULT_PAGE_SUBTITLE =
  "Consulta da política comercial vigente. Somente leitura — sem edição ou publicação.";

export function isCommercialPolicyConsultRole(role: string | null | undefined): boolean {
  const normalized = (role ?? "").trim().toUpperCase();
  return (COMMERCIAL_POLICY_CONSULT_ROLES as readonly string[]).includes(normalized);
}

/**
 * Quem pode abrir a tela de consulta e baixar o PDF oficial da versão vigente.
 * Inclui quem está na audiência de aceite (flag manual), além dos papéis comerciais.
 * Espelha isCommercialPolicyAudience sem importar commercialPolicyRules (node:crypto).
 */
export function canConsultCommercialPolicy(user: {
  role?: string | null;
  mustAcceptCommercialPolicy?: boolean | null;
} | null | undefined): boolean {
  if (!user) return false;
  if (isCommercialPolicyConsultRole(user.role)) return true;
  return user.mustAcceptCommercialPolicy === true;
}
