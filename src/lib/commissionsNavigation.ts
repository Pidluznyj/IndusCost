/** Rotas canônicas do módulo Comissões (React Router). */

/**
 * Modo simplificado: uma única tela de auditoria visual.
 * Telas antigas permanecem no código, mas ficam inacessíveis até revisão do modelo.
 */
export const COMMISSIONS_SIMPLIFIED_UI = true as const;

export const COMMISSIONS_BASE_PATH = "/commissions" as const;

export const COMMISSIONS_SECTION_IDS = [
  "monthlyClosing",
  "receivableForecast",
  "visualAudit",
  "customerExclusions",
] as const;

export type CommissionsSectionId = (typeof COMMISSIONS_SECTION_IDS)[number];

/** Seções legadas — código preservado; rotas redirecionam para /commissions. */
export const COMMISSIONS_DISABLED_SECTION_IDS = [
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

/** Rotas legadas → tela única de auditoria visual. */
export const COMMISSIONS_LEGACY_PATH_REDIRECTS: Record<string, string> = {
  dashboard: "/commissions",
  payable: "/commissions",
  generated: "/commissions",
  future: "/commissions",
  overdue: "/commissions",
  persons: "/commissions",
  rules: "/commissions",
  exceptions: "/commissions/exclusoes-cliente",
  audit: "/commissions",
  settings: "/commissions",
  forecast: "/commissions/previsao",
  confirmed: "/commissions",
  apuracao: "/commissions",
  releases: "/commissions",
  payments: "/commissions",
};

export const COMMISSIONS_SECTION_PATHS: Record<CommissionsSectionId, string> = {
  monthlyClosing: "/commissions",
  receivableForecast: "/commissions/previsao",
  visualAudit: "/commissions/auditoria",
  customerExclusions: "/commissions/exclusoes-cliente",
};

export const COMMISSIONS_DEFAULT_SECTION: CommissionsSectionId = "monthlyClosing";

export type CommissionsSectionDef = {
  id: CommissionsSectionId;
  label: string;
  path: string;
  description?: string;
};

export const COMMISSIONS_SECTIONS: CommissionsSectionDef[] = [
  {
    id: "monthlyClosing",
    label: "Fechamento do mês",
    path: COMMISSIONS_SECTION_PATHS.monthlyClosing,
    description:
      "Comissão oficial a pagar com base nos títulos baixados/recebidos no mês (settlementDate)",
  },
  {
    id: "receivableForecast",
    label: "Previsão",
    path: COMMISSIONS_SECTION_PATHS.receivableForecast,
    description: "Comissão prevista por vencimento de títulos em aberto no Contas a Receber",
  },
  {
    id: "visualAudit",
    label: "Auditoria Visual",
    path: COMMISSIONS_SECTION_PATHS.visualAudit,
    description: "Validação por pedido, NF, títulos e comissão por parcela (Contas a Receber)",
  },
  {
    id: "customerExclusions",
    label: "Exceções por cliente",
    path: COMMISSIONS_SECTION_PATHS.customerExclusions,
    description:
      "Clientes que não geram comissão — regra auditável com vigência, sem ocultar vendas",
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
  if (firstSegment === "auditoria") return true;
  if (firstSegment === "previsao") return true;
  if (firstSegment === "exclusoes-cliente") return true;
  if (isCommissionsSectionId(firstSegment)) return true;
  if (isCommissionsLegacySectionSegment(firstSegment)) return true;
  return false;
}

export function parseCommissionsSectionFromPath(pathname: string): CommissionsSectionId | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === COMMISSIONS_BASE_PATH) return "monthlyClosing";
  const segments = normalized.split("/").filter(Boolean);
  const idx = segments.indexOf("commissions");
  if (idx < 0) return null;
  const next = segments[idx + 1];
  if (!next) return "monthlyClosing";
  if (next === "auditoria") return "visualAudit";
  if (next === "previsao") return "receivableForecast";
  if (next === "exclusoes-cliente") return "customerExclusions";
  if (isCommissionsLegacySectionSegment(next)) return "monthlyClosing";
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
