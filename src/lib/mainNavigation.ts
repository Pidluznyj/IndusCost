/**
 * Segmentos de URL dos módulos principais (Fase 1 — alinhados aos ids do menu / Sidebar).
 * Fonte única para validação e documentação; a navegação efetiva usa react-router.
 */
export const MAIN_MODULE_PATH_SEGMENTS = [
  "dashboard",
  "employees",
  "machines",
  "materials",
  "products",
  "opex",
  "taxes",
  "pricing",
  "proposals",
  "customers",
  "simulations",
  "reports",
  "settings",
] as const;

export type MainModulePathSegment = (typeof MAIN_MODULE_PATH_SEGMENTS)[number];

export function isMainModulePathSegment(s: string): s is MainModulePathSegment {
  return (MAIN_MODULE_PATH_SEGMENTS as readonly string[]).includes(s);
}
