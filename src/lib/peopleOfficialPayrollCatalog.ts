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
};

export type OfficialPayrollHrCatalogItem = {
  id: string;
  code: string;
  name: string;
  category: string;
  typeLabel: string;
  isFinancial: boolean;
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

export function mapPayrollComponentToHrCatalogItem(
  row: OfficialPayrollCatalogRow
): OfficialPayrollHrCatalogItem {
  return {
    id: row.id,
    code: officialPayrollBenefitCode(row.id),
    name: row.name,
    category: row.type,
    typeLabel: payrollTypeLabel(row.type),
    isFinancial: row.calculationType === "FIXED",
  };
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
