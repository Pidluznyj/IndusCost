/** Rotas canônicas do módulo Comissões (React Router). */

export const COMMISSIONS_BASE_PATH = "/commissions" as const;

export const COMMISSIONS_SECTION_IDS = [
  "dashboard",
  "forecast",
  "confirmed",
  "releases",
  "payments",
  "persons",
  "rules",
  "audit",
  "settings",
] as const;

export type CommissionsSectionId = (typeof COMMISSIONS_SECTION_IDS)[number];

export const COMMISSIONS_SECTION_PATHS: Record<CommissionsSectionId, string> = {
  dashboard: "/commissions",
  forecast: "/commissions/forecast",
  confirmed: "/commissions/confirmed",
  releases: "/commissions/releases",
  payments: "/commissions/payments",
  persons: "/commissions/persons",
  rules: "/commissions/rules",
  audit: "/commissions/audit",
  settings: "/commissions/settings",
};

export const COMMISSIONS_DEFAULT_SECTION: CommissionsSectionId = "dashboard";

export type CommissionsSectionDef = {
  id: CommissionsSectionId;
  label: string;
  path: string;
};

export const COMMISSIONS_SECTIONS: CommissionsSectionDef[] = [
  { id: "dashboard", label: "Dashboard", path: COMMISSIONS_SECTION_PATHS.dashboard },
  { id: "forecast", label: "Comissões Previstas", path: COMMISSIONS_SECTION_PATHS.forecast },
  { id: "confirmed", label: "Comissões Confirmadas", path: COMMISSIONS_SECTION_PATHS.confirmed },
  { id: "releases", label: "Liberação por Recebimento", path: COMMISSIONS_SECTION_PATHS.releases },
  { id: "payments", label: "Pagamentos", path: COMMISSIONS_SECTION_PATHS.payments },
  { id: "persons", label: "Pessoas Comissionadas", path: COMMISSIONS_SECTION_PATHS.persons },
  { id: "rules", label: "Regras de Comissão", path: COMMISSIONS_SECTION_PATHS.rules },
  { id: "audit", label: "Auditoria", path: COMMISSIONS_SECTION_PATHS.audit },
  { id: "settings", label: "Configurações", path: COMMISSIONS_SECTION_PATHS.settings },
];

export function getCommissionsSectionPath(sectionId: CommissionsSectionId): string {
  return COMMISSIONS_SECTION_PATHS[sectionId];
}

export function getCommissionsDefaultPath(): string {
  return COMMISSIONS_SECTION_PATHS[COMMISSIONS_DEFAULT_SECTION];
}

export function isCommissionsSectionId(value: string): value is CommissionsSectionId {
  return (COMMISSIONS_SECTION_IDS as readonly string[]).includes(value);
}

export function isCommissionsCanonicalPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === COMMISSIONS_BASE_PATH) return true;
  const remainder = normalized.slice(COMMISSIONS_BASE_PATH.length + 1);
  const firstSegment = remainder.split("/").filter(Boolean)[0];
  return firstSegment != null && isCommissionsSectionId(firstSegment);
}

export function parseCommissionsSectionFromPath(pathname: string): CommissionsSectionId | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === COMMISSIONS_BASE_PATH) return "dashboard";
  const segments = normalized.split("/").filter(Boolean);
  const idx = segments.indexOf("commissions");
  if (idx < 0) return null;
  const next = segments[idx + 1];
  if (!next) return "dashboard";
  return isCommissionsSectionId(next) ? next : null;
}

export function resolveCommissionsCanonicalPath(pathname: string): string {
  const section = parseCommissionsSectionFromPath(pathname);
  if (section) return getCommissionsSectionPath(section);
  return getCommissionsDefaultPath();
}
