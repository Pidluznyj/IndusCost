/** Permissões UI DRE Gerencial — contrato finance.dre. */

export type FinanceDrePermissionCheck = {
  hasPermission: (key: string) => boolean;
};

export function canViewFinanceDre(auth: FinanceDrePermissionCheck): boolean {
  return (
    auth.hasPermission("finance.dre.view") ||
    auth.hasPermission("reports.view") ||
    auth.hasPermission("finance.view")
  );
}
