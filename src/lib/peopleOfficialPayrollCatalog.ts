/**
 * Ponte da ficha (Pessoas / RH) para o cadastro oficial de
 * Administração → Configurações → Estrutura Operacional (PayrollComponent).
 * Não é um segundo catálogo: a lista e o nome vêm da verba oficial.
 */

export const OFFICIAL_PAYROLL_HR_CODE_PREFIX = "PAYROLL:" as const;

export const PAYROLL_COMPONENT_TYPE_LABELS: Record<string, string> = {
  BENEFIT: "Benefício",
  CHARGE: "Encargo",
  PROVISION: "Provisão",
};

export type OfficialPayrollCatalogRow = {
  id: string;
  name: string;
  type: string;
  calculationType: string;
  /** Valor da verba no cadastro (R$ fixo ou % do salário). */
  value?: number | null;
};

export type OfficialPayrollHrCatalogItem = {
  id: string;
  code: string;
  name: string;
  category: string;
  typeLabel: string;
  calculationType: string;
  isFinancial: boolean;
  /** Verba percentual: % do salário (não é valor monetário — sempre presente). */
  percentage: number | null;
  /** Verba fixa em R$ — a chave só existe com permissão de valores. */
  amount?: number | null;
};

/**
 * Verba oficial marcada no cadastro do colaborador (EmployeePayrollComponent), como a
 * ficha exibe em "Encargos & benefícios". Fonte única de benefícios: o valor é o do
 * cadastro e vale para todos que têm a verba.
 */
export type EmployeeOfficialBenefitItem = OfficialPayrollHrCatalogItem & {
  kind: "official";
  payrollComponentId: string;
  status: "ACTIVE";
};

export function officialPayrollBenefitCode(payrollComponentId: string): string {
  return `${OFFICIAL_PAYROLL_HR_CODE_PREFIX}${payrollComponentId}`;
}

export function payrollIdFromHrBenefitCode(code: string): string | null {
  if (!code.startsWith(OFFICIAL_PAYROLL_HR_CODE_PREFIX)) return null;
  const id = code.slice(OFFICIAL_PAYROLL_HR_CODE_PREFIX.length).trim();
  return id || null;
}

export function payrollTypeLabel(type: string): string {
  return PAYROLL_COMPONENT_TYPE_LABELS[type] ?? "Benefício";
}

function finiteOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : value == null ? NaN : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function mapPayrollComponentToHrCatalogItem(
  row: OfficialPayrollCatalogRow,
  opts?: { includeValues?: boolean }
): OfficialPayrollHrCatalogItem {
  const isFinancial = row.calculationType === "FIXED";
  const value = finiteOrNull(row.value);
  const item: OfficialPayrollHrCatalogItem = {
    id: row.id,
    code: officialPayrollBenefitCode(row.id),
    name: row.name,
    category: row.type,
    typeLabel: payrollTypeLabel(row.type),
    calculationType: row.calculationType,
    isFinancial,
    percentage: !isFinancial ? value : null,
  };
  // R$ nunca sai sem permissão de valores (a chave é omitida, não nula).
  if (isFinancial && opts?.includeValues) item.amount = value;
  return item;
}

export function toEmployeeOfficialBenefitItem(
  item: OfficialPayrollHrCatalogItem
): EmployeeOfficialBenefitItem {
  return { ...item, kind: "official", payrollComponentId: item.id, id: `pc:${item.id}`, status: "ACTIVE" };
}

/** Ordem de exibição das verbas: tipo (Benefício, Encargo, Provisão) e nome. */
export function comparePayrollCatalogRows(a: OfficialPayrollCatalogRow, b: OfficialPayrollCatalogRow): number {
  return a.type.localeCompare(b.type) || a.name.localeCompare(b.name, "pt-BR");
}

export function overlayOfficialPayrollName(input: {
  code: string;
  fallbackName: string;
  fallbackCategory: string;
  payrollById: ReadonlyMap<string, OfficialPayrollCatalogRow>;
}): { name: string; category: string; typeLabel: string } {
  const payrollId = payrollIdFromHrBenefitCode(input.code);
  const official = payrollId ? input.payrollById.get(payrollId) : undefined;
  const category = official?.type ?? input.fallbackCategory;
  return {
    name: official?.name ?? input.fallbackName,
    category,
    typeLabel: payrollTypeLabel(category),
  };
}
