/**
 * Quem pode abrir o Gerador de Comunicados (Comercial).
 * Super administrador e quem tiver a permissão "Gerador de Comunicados", marcada no
 * perfil de acesso ou no usuário (Comercial › Gerador de Comunicados na matriz de permissões).
 * Sem API própria: a ferramenta roda no navegador e nada é enviado ao servidor.
 */

export const COMMERCIAL_ANNOUNCEMENTS_ROUTE_PATH = "/commercial/announcements";
export const COMMERCIAL_ANNOUNCEMENTS_PAGE_TITLE = "Gerador de Comunicados";
export const COMMERCIAL_ANNOUNCEMENTS_PAGE_SUBTITLE =
  "Monte comunicados com a identidade da Lazarios e exporte em JPEG para e-mail e WhatsApp.";

/** Chave da permissão de menu (catálogo) e recurso correspondente no contrato. */
export const COMMERCIAL_ANNOUNCEMENTS_VIEW_PERMISSION = "commercial.announcements.view";
export const COMMERCIAL_ANNOUNCEMENTS_RESOURCE_KEY = "commercial.announcements";

export function canUseCommercialAnnouncementGenerator(check: {
  hasPermission: (permission: string) => boolean;
  authUser?: { role?: string | null } | null;
}): boolean {
  if ((check.authUser?.role ?? "").trim().toUpperCase() === "SUPER_ADMIN") return true;
  return check.hasPermission(COMMERCIAL_ANNOUNCEMENTS_VIEW_PERMISSION);
}
