/**
 * Quem pode alterar o Responsável Comercial do cliente.
 * Super administrador e supervisor/gestor comercial. A permissão
 * `crm.customers.assign_seller` sozinha não libera outros perfis.
 */

export type CommercialOwnerAssignAccess = {
  role?: string | null;
  accessProfileName?: string | null;
};

const ALLOWED_PROFILE_NAMES = new Set(["supervisor comercial", "gestor comercial"]);

function normalizeProfileName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function canAssignCustomerCommercialOwnerAccess(
  auth: CommercialOwnerAssignAccess | null | undefined
): boolean {
  const role = (auth?.role ?? "").trim().toUpperCase();
  if (role === "SUPER_ADMIN" || role === "COMMERCIAL_MANAGER") return true;
  return ALLOWED_PROFILE_NAMES.has(normalizeProfileName(auth?.accessProfileName));
}
