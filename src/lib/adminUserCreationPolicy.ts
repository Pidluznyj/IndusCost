import { AppUserRole } from "@prisma/client";

/**
 * Novo usuário nasce sem autoridade. Perfil, role operacional, permissões e
 * vínculo comercial são definidos somente depois pelos fluxos administrativos.
 */
export function resolveNewUserInitialAccess() {
  return {
    role: AppUserRole.VIEWER,
    permissions: [] as string[],
    accessProfileId: null,
    externalSellerId: null,
    externalSellerIds: [] as number[],
    sellerResponsibleName: null,
  };
}
