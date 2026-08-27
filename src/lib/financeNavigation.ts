/** Rotas canônicas do módulo Financeiro (React Router). */

export const FINANCE_BASE_PATH = "/finance" as const;

export const FINANCE_SECTION_IDS = [
  "one-page",
  "cash-flow",
  "accounts-receivable",
  "accounts-payable",
  "billing",
  "sales-orders",
  "cost-centers",
  "executive-report",
  "dre",
] as const;

export type FinanceSectionId = (typeof FINANCE_SECTION_IDS)[number];

/** Rotas financeiras fora das abas do FinanceModule (tela própria). */
export const FINANCE_STANDALONE_PATHS = {
  suppliers: "/finance/suppliers",
  "portfolio-reconciliation": "/finance/portfolio-reconciliation",
  treasury: "/finance/treasury",
} as const;

export type FinanceStandaloneId = keyof typeof FINANCE_STANDALONE_PATHS;

export const FINANCE_SECTION_PATHS: Record<FinanceSectionId, string> = {
  "one-page": "/finance/one-page",
  "cash-flow": "/finance/cash-flow",
  "accounts-receivable": "/finance/accounts-receivable",
  "accounts-payable": "/finance/accounts-payable",
  billing: "/finance/billing",
  "sales-orders": "/finance/sales-orders",
  "cost-centers": "/finance/cost-centers",
  "executive-report": "/finance/executive-report",
  dre: "/finance/dre",
};

export const FINANCE_DEFAULT_SECTION: FinanceSectionId = "cash-flow";

export type FinanceSectionDef = {
  id: FinanceSectionId;
  label: string;
  path: string;
};

export const FINANCE_SECTIONS: FinanceSectionDef[] = [
  {
    id: "one-page",
    label: "One Page",
    path: FINANCE_SECTION_PATHS["one-page"],
  },
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
    id: "sales-orders",
    label: "Pedidos de Venda",
    path: FINANCE_SECTION_PATHS["sales-orders"],
  },
  {
    id: "cost-centers",
    label: "Centros de Custo",
    path: FINANCE_SECTION_PATHS["cost-centers"],
  },
  {
    id: "executive-report",
    label: "Relatório Presidencial",
    path: FINANCE_SECTION_PATHS["executive-report"],
  },
  {
    id: "dre",
    label: "DRE Gerencial",
    path: FINANCE_SECTION_PATHS.dre,
  },
];

export function getFinanceSectionPath(sectionId: FinanceSectionId): string {
  return FINANCE_SECTION_PATHS[sectionId];
}

export function getFinanceSuppliersPath(): string {
  return FINANCE_STANDALONE_PATHS.suppliers;
}

export function getFinancePortfolioReconciliationPath(): string {
  return FINANCE_STANDALONE_PATHS["portfolio-reconciliation"];
}

export function isFinanceSuppliersStandalonePath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return normalized === FINANCE_STANDALONE_PATHS.suppliers;
}

export function isFinancePortfolioReconciliationStandalonePath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return normalized === FINANCE_STANDALONE_PATHS["portfolio-reconciliation"];
}

export function getFinanceTreasuryPath(): string {
  return FINANCE_STANDALONE_PATHS.treasury;
}

export function isFinanceTreasuryStandalonePath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return (
    normalized === FINANCE_STANDALONE_PATHS.treasury ||
    normalized.startsWith(`${FINANCE_STANDALONE_PATHS.treasury}/`)
  );
}

export function getFinanceDefaultPath(): string {
  return FINANCE_SECTION_PATHS[FINANCE_DEFAULT_SECTION];
}

export function isFinanceSectionId(value: string): value is FinanceSectionId {
  return (FINANCE_SECTION_IDS as readonly string[]).includes(value);
}

/** URL canônica do módulo Financeiro. */
export function isFinanceCostCenterDetailPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return /^\/finance\/cost-centers\/[0-9a-f-]{36}$/i.test(normalized);
}

export function buildFinanceCostCenterDetailPath(costCenterId: string): string {
  return `/finance/cost-centers/${costCenterId}`;
}

export function isFinanceCanonicalPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === FINANCE_BASE_PATH) return true;
  if (isFinanceSuppliersStandalonePath(normalized)) return true;
  if (isFinancePortfolioReconciliationStandalonePath(normalized)) return true;
  if (isFinanceTreasuryStandalonePath(normalized)) return true;
  if (isFinanceCostCenterDetailPath(normalized)) return true;
  return FINANCE_SECTION_IDS.some((id) => normalized === FINANCE_SECTION_PATHS[id]);
}

/** Detecta paths aninhados como /finance/accounts-receivable/accounts-payable/... */
export function hasNestedFinanceSectionPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (!normalized.startsWith(`${FINANCE_BASE_PATH}/`)) return false;
  const remainder = normalized.slice(FINANCE_BASE_PATH.length + 1);
  const segments = remainder.split("/").filter(Boolean);
  if (segments.length <= 1) {
    const only = segments[0] ?? "";
    return (
      segments.length === 1 &&
      !isFinanceSectionId(only) &&
      only !== "suppliers" &&
      only !== "portfolio-reconciliation" &&
      only !== "treasury"
    );
  }
  // /finance/treasury/* é standalone com sub-rotas próprias
  if (segments[0] === "treasury") return false;
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
