/** Rotas canônicas do módulo Financeiro (React Router). */

export const FINANCE_BASE_PATH = "/finance" as const;

export const FINANCE_SECTION_IDS = [
  "cash-flow",
  "accounts-receivable",
  "accounts-payable",
  "billing",
  "executive-report",
] as const;

export type FinanceSectionId = (typeof FINANCE_SECTION_IDS)[number];

export const FINANCE_SECTION_PATHS: Record<FinanceSectionId, string> = {
  "cash-flow": "/finance/cash-flow",
  "accounts-receivable": "/finance/accounts-receivable",
  "accounts-payable": "/finance/accounts-payable",
  billing: "/finance/billing",
  "executive-report": "/finance/executive-report",
};

export const FINANCE_DEFAULT_SECTION: FinanceSectionId = "accounts-receivable";

export type FinanceSectionDef = {
  id: FinanceSectionId;
  label: string;
  path: string;
};

export const FINANCE_SECTIONS: FinanceSectionDef[] = [
  {
    id: "cash-flow",
    label: "Fluxo de Caixa",
    path: FINANCE_SECTION_PATHS["cash-flow"],
  },
  {
    id: "accounts-receivable",
    label: "Contas a Receber",
    path: FINANCE_SECTION_PATHS["accounts-receivable"],
  },
  {
    id: "accounts-payable",
    label: "Contas a Pagar",
    path: FINANCE_SECTION_PATHS["accounts-payable"],
  },
  {
    id: "billing",
    label: "Faturamento",
    path: FINANCE_SECTION_PATHS.billing,
  },
  {
    id: "executive-report",
    label: "Relatório Presidencial",
    path: FINANCE_SECTION_PATHS["executive-report"],
  },
];

export function getFinanceSectionPath(sectionId: FinanceSectionId): string {
  return FINANCE_SECTION_PATHS[sectionId];
}

export function getFinanceDefaultPath(): string {
  return FINANCE_SECTION_PATHS[FINANCE_DEFAULT_SECTION];
}

export function isFinanceSectionId(value: string): value is FinanceSectionId {
  return (FINANCE_SECTION_IDS as readonly string[]).includes(value);
}

/** URL canônica do módulo Financeiro. */
export function isFinanceCanonicalPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === FINANCE_BASE_PATH) return true;
  return FINANCE_SECTION_IDS.some((id) => normalized === FINANCE_SECTION_PATHS[id]);
}

/** Detecta paths aninhados como /finance/accounts-receivable/accounts-payable/... */
export function hasNestedFinanceSectionPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (!normalized.startsWith(`${FINANCE_BASE_PATH}/`)) return false;
  const remainder = normalized.slice(FINANCE_BASE_PATH.length + 1);
  const segments = remainder.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return segments.length === 1 && !isFinanceSectionId(segments[0] ?? "");
  }
  return true;
}

/** Primeira seção financeira reconhecida na URL (para recuperar paths legados/aninhados). */
export function parseFinanceSectionFromPath(pathname: string): FinanceSectionId | null {
  const segments = pathname.split("/").filter(Boolean);
  const financeIdx = segments.indexOf("finance");
  if (financeIdx < 0) return null;
  for (let i = financeIdx + 1; i < segments.length; i += 1) {
    const seg = segments[i];
    if (isFinanceSectionId(seg)) return seg;
  }
  return null;
}

export function resolveFinanceCanonicalPath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === FINANCE_BASE_PATH) {
    return getFinanceDefaultPath();
  }
  const section = parseFinanceSectionFromPath(normalized);
  if (section) return getFinanceSectionPath(section);
  return getFinanceDefaultPath();
}
