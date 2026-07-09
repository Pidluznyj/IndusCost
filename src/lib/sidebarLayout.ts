/**
 * Estado visual do menu lateral — colapso desktop e drawer mobile.
 * Sem impacto em RBAC, rotas ou regras de negócio.
 */

export const SIDEBAR_COLLAPSED_STORAGE_KEY = "induscost.sidebar.collapsed";

export const SIDEBAR_LAYOUT_WIDTH_EXPANDED = 272;
/** Largura do rail recolhido — ícone + rótulo curto visível (touch-friendly). */
export const SIDEBAR_LAYOUT_WIDTH_COLLAPSED = 104;

/** Viewport abaixo de lg — sidebar vira drawer sobre o conteúdo. */
export const SIDEBAR_MOBILE_MEDIA_QUERY = "(max-width: 1023px)";

export function parseStoredSidebarCollapsed(raw: string | null | undefined): boolean {
  if (raw == null || raw.trim() === "") return false;
  const trimmed = raw.trim();
  if (trimmed === "true" || trimmed === "1") return true;
  if (trimmed === "false" || trimmed === "0") return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed === true;
  } catch {
    return false;
  }
}

export function serializeSidebarCollapsed(collapsed: boolean): string {
  return JSON.stringify(collapsed);
}

export function readStoredSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return parseStoredSidebarCollapsed(
    window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)
  );
}

export function persistSidebarCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    SIDEBAR_COLLAPSED_STORAGE_KEY,
    serializeSidebarCollapsed(collapsed)
  );
}

export function resolveSidebarAsideWidth(input: {
  isMobile: boolean;
  desktopCollapsed: boolean;
}): number {
  if (input.isMobile) return SIDEBAR_LAYOUT_WIDTH_EXPANDED;
  return input.desktopCollapsed
    ? SIDEBAR_LAYOUT_WIDTH_COLLAPSED
    : SIDEBAR_LAYOUT_WIDTH_EXPANDED;
}
