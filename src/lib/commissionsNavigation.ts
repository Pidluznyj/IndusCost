/** Rotas canônicas do módulo Comissões (React Router). */

export const COMMISSIONS_BASE_PATH = "/commissions" as const;

export const COMMISSIONS_SECTION_IDS = [
  "dashboard",
  "payable",
  "generated",
  "future",
  "overdue",
  "persons",
  "rules",
  "exceptions",
  "audit",
  "settings",
] as const;

export type CommissionsSectionId = (typeof COMMISSIONS_SECTION_IDS)[number];

/** Rotas legadas — redirecionam para as novas seções. */
export const COMMISSIONS_LEGACY_PATH_REDIRECTS: Record<string, string> = {
  forecast: "/commissions/future",
  confirmed: "/commissions/generated",
  apuracao: "/commissions/generated",
  releases: "/commissions/payable",
  payments: "/commissions/payable?tab=payments",
};

export const COMMISSIONS_SECTION_PATHS: Record<CommissionsSectionId, string> = {
  dashboard: "/commissions",
  payable: "/commissions/payable",
  generated: "/commissions/generated",
  future: "/commissions/future",
  overdue: "/commissions/overdue",
  persons: "/commissions/persons",
  rules: "/commissions/rules",
  exceptions: "/commissions/exceptions",
  audit: "/commissions/audit",
  settings: "/commissions/settings",
};

export const COMMISSIONS_DEFAULT_SECTION: CommissionsSectionId = "dashboard";

export type CommissionsSectionDef = {
  id: CommissionsSectionId;
  label: string;
  path: string;
  description?: string;
};

export const COMMISSIONS_SECTIONS: CommissionsSectionDef[] = [
  {
    id: "dashboard",
    label: "Dashboard Gerencial",
    path: COMMISSIONS_SECTION_PATHS.dashboard,
    description: "Visão YTD e comparativos por vendedor",
  },
  {
    id: "payable",
    label: "Comissão a Pagar",
    path: COMMISSIONS_SECTION_PATHS.payable,
    description: "Comissão liberada pela baixa real do título (Contas a Receber)",
  },
  {
    id: "generated",
    label: "Comissão Gerada",
    path: COMMISSIONS_SECTION_PATHS.generated,
    description: "Comissão criada por NF/pedido faturado (competência do documento)",
  },
  {
    id: "future",
    label: "Comissões Futuras",
    path: COMMISSIONS_SECTION_PATHS.future,
    description: "Títulos a vencer — comissão prevista após pagamento do cliente",
  },
  {
    id: "overdue",
    label: "Comissões Atrasadas",
    path: COMMISSIONS_SECTION_PATHS.overdue,
    description: "Títulos vencidos sem baixa — comissão bloqueada por inadimplência",
  },
  {
    id: "persons",
    label: "Pessoas Comissionadas",
    path: COMMISSIONS_SECTION_PATHS.persons,
  },
  {
    id: "rules",
    label: "Regras de Comissão",
    path: COMMISSIONS_SECTION_PATHS.rules,
  },
  {
    id: "exceptions",
    label: "Exceções / Clientes sem Comissão",
    path: COMMISSIONS_SECTION_PATHS.exceptions,
  },
  {
    id: "audit",
    label: "Auditoria",
    path: COMMISSIONS_SECTION_PATHS.audit,
  },
  {
    id: "settings",
    label: "Configurações",
    path: COMMISSIONS_SECTION_PATHS.settings,
  },
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

export function isCommissionsLegacySectionSegment(segment: string): boolean {
  return segment in COMMISSIONS_LEGACY_PATH_REDIRECTS;
}

export function resolveCommissionsLegacyRedirect(segment: string): string | null {
  return COMMISSIONS_LEGACY_PATH_REDIRECTS[segment] ?? null;
}

export function isCommissionsCanonicalPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === COMMISSIONS_BASE_PATH) return true;
  const remainder = normalized.slice(COMMISSIONS_BASE_PATH.length + 1);
  const firstSegment = remainder.split("/").filter(Boolean)[0];
  if (!firstSegment) return true;
  if (isCommissionsSectionId(firstSegment)) return true;
  if (isCommissionsLegacySectionSegment(firstSegment)) return true;
  return false;
}

export function parseCommissionsSectionFromPath(pathname: string): CommissionsSectionId | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === COMMISSIONS_BASE_PATH) return "dashboard";
  const segments = normalized.split("/").filter(Boolean);
  const idx = segments.indexOf("commissions");
  if (idx < 0) return null;
  const next = segments[idx + 1];
  if (!next) return "dashboard";
  if (isCommissionsLegacySectionSegment(next)) {
    const redirect = resolveCommissionsLegacyRedirect(next);
    if (redirect) {
      const target = redirect.replace("/commissions/", "").split("?")[0];
      return isCommissionsSectionId(target) ? target : null;
    }
  }
  return isCommissionsSectionId(next) ? next : null;
}

export function resolveCommissionsCanonicalPath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === COMMISSIONS_BASE_PATH) return getCommissionsDefaultPath();
  const segments = normalized.split("/").filter(Boolean);
  const idx = segments.indexOf("commissions");
  const next = idx >= 0 ? segments[idx + 1] : null;
  if (next && isCommissionsLegacySectionSegment(next)) {
    return resolveCommissionsLegacyRedirect(next) ?? getCommissionsDefaultPath();
  }
  const section = parseCommissionsSectionFromPath(pathname);
  if (section) return getCommissionsSectionPath(section);
  return getCommissionsDefaultPath();
}
