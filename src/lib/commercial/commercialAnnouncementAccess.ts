/**
 * Quem pode abrir o Gerador de Comunicados (Comercial).
 * Super administrador e o perfil de acesso do supervisor de vendas.
 * Mesmo critério de customerListReportExportAccess: papel SUPER_ADMIN ou nome do perfil.
 * Sem API própria: a ferramenta roda no navegador e nada é enviado ao servidor.
 */

export const COMMERCIAL_ANNOUNCEMENTS_ROUTE_PATH = "/commercial/announcements";
export const COMMERCIAL_ANNOUNCEMENTS_PAGE_TITLE = "Gerador de Comunicados";
export const COMMERCIAL_ANNOUNCEMENTS_PAGE_SUBTITLE =
  "Monte comunicados com a identidade da Lazarios e exporte em JPEG para e-mail e WhatsApp.";

export type CommercialAnnouncementAccess = {
  role?: string | null;
  accessProfileName?: string | null;
};

/** "Supervisor comercial" é o nome que o perfil já tem em outras regras do sistema. */
const SUPERVISOR_PROFILE_NAMES = new Set(["supervisor de vendas", "supervisor comercial"]);

function normalizeProfileName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isSalesSupervisorProfileName(value: string | null | undefined): boolean {
  return SUPERVISOR_PROFILE_NAMES.has(normalizeProfileName(value));
}

export function canUseCommercialAnnouncementGenerator(
  auth: CommercialAnnouncementAccess | null | undefined
): boolean {
  if (!auth) return false;
  if ((auth.role ?? "").trim().toUpperCase() === "SUPER_ADMIN") return true;
  return isSalesSupervisorProfileName(auth.accessProfileName);
}
