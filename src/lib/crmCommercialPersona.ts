/**
 * Regra pura e compartilhada da persona comercial do CRM.
 *
 * A autorização de tela/dados continua sendo validada no backend. Este helper
 * apenas garante que frontend e backend interpretem os mesmos grants.
 */
export type CrmCommercialRole =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "COMMERCIAL_MANAGER"
  | "SELLER"
  | "VIEWER"
  | string;

export type CrmCommercialPersonaInput = {
  role: CrmCommercialRole;
  canViewShell: boolean;
  canViewGeneral: boolean;
  canViewSellerTab: boolean;
  canViewPortfolio: boolean;
  canViewCustomer360: boolean;
  canViewOwn: boolean;
  canViewAll: boolean;
};

export type CrmCommercialPersona = {
  dataScope: "global" | "own" | "none";
  canUseCrm: boolean;
  canViewGeneral: boolean;
  canViewSeller: boolean;
  canViewPortfolio: boolean;
  canViewCustomer360: boolean;
  canFilterAllSellers: boolean;
  sellerLocked: boolean;
};

/**
 * Precedência de segurança:
 * - ADMIN/SUPER_ADMIN: global;
 * - SELLER: sempre own quando há grant CRM utilizável;
 * - COMMERCIAL_MANAGER: global (fallback até existir hierarquia de equipe);
 * - perfil custom/VIEWER com own+all: own vence, exceto se Gestão Geral estiver
 *   explicitamente liberada.
 * - crm.view isolado só revela shell técnico; não concede dados nem menu útil.
 */
export function resolveCrmCommercialPersona(
  input: CrmCommercialPersonaInput
): CrmCommercialPersona {
  const roleGlobal =
    input.role === "SUPER_ADMIN" ||
    input.role === "ADMIN" ||
    input.role === "COMMERCIAL_MANAGER";
  const hasUsableView =
    input.canViewGeneral ||
    input.canViewSellerTab ||
    input.canViewPortfolio ||
    input.canViewCustomer360;
  const sellerHasUsableGrant =
    input.canViewSellerTab ||
    input.canViewPortfolio ||
    input.canViewOwn ||
    input.canViewAll ||
    input.canViewShell;

  let dataScope: CrmCommercialPersona["dataScope"] = "none";
  if (roleGlobal) {
    dataScope = "global";
  } else if (input.role === "SELLER" && sellerHasUsableGrant) {
    dataScope = "own";
  } else if (input.canViewOwn) {
    // Fail-closed para perfil custom incoerente com own + all.
    dataScope = input.canViewGeneral ? "global" : "own";
  } else if (input.canViewAll || input.canViewGeneral) {
    dataScope = "global";
  }

  const canViewGeneral = dataScope === "global" && input.canViewGeneral;
  const canViewSeller = dataScope !== "none" && input.canViewSellerTab;
  const canViewPortfolio =
    dataScope !== "none" &&
    (input.canViewPortfolio ||
      input.canViewCustomer360 ||
      input.canViewGeneral ||
      (dataScope === "global" && input.canViewAll));
  const canViewCustomer360 = dataScope !== "none" && input.canViewCustomer360;
  const canUseCrm =
    dataScope !== "none" &&
    (hasUsableView ||
      canViewSeller ||
      canViewPortfolio ||
      (input.role === "SELLER" && sellerHasUsableGrant));

  return {
    dataScope,
    canUseCrm,
    canViewGeneral,
    canViewSeller,
    canViewPortfolio,
    canViewCustomer360,
    canFilterAllSellers: dataScope === "global" && (input.canViewAll || roleGlobal),
    sellerLocked: dataScope === "own",
  };
}
