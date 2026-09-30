/**
 * Quem pode exportar o relatório da grade Comercial > Clientes (Excel/PDF).
 * Super administrador e perfil Supervisor comercial.
 * Ver a tela não autoriza exportar a carteira.
 */

export type CustomerListReportExportAccess = {
  role?: string | null;
  accessProfileName?: string | null;
};

const SUPERVISOR_PROFILE_NAME = "supervisor comercial";

function normalizeProfileName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function canExportCustomerListReport(
  auth: CustomerListReportExportAccess | null | undefined
): boolean {
  const role = (auth?.role ?? "").trim().toUpperCase();
  if (role === "SUPER_ADMIN") return true;
  return normalizeProfileName(auth?.accessProfileName) === SUPERVISOR_PROFILE_NAME;
}
