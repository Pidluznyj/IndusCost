import type { EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";
import { legacyPermissionGrantedByDto } from "@/src/lib/canAccessFromEffectiveAccess.js";
import { resolveCrmCommercialPersona } from "@/src/lib/crmCommercialPersona.js";
import { buildEffectiveAccessDtoFromUser } from "@/src/lib/security/effectiveAccessDto/buildFromUser.js";
import type { SeedAxisOverride } from "@/src/lib/security/effectiveAccessDto/mapOverrides.js";

export type CrmAccessInventoryUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  permissionsVersion: number;
  permissions: string[];
  accessProfile: { id: string; name: string; permissions: string[] } | null;
  permissionOverrides: SeedAxisOverride[];
  externalSellerId: number | null;
  externalSellerIds: number[];
  sellerResponsibleName: string | null;
};

export type CrmAccessInventoryIssue =
  | "CRM_SHELL_WITHOUT_USABLE_SCOPE"
  | "OWN_SCOPE_WITHOUT_COMMERCIAL_LINK"
  | "OWN_AND_ALL_SCOPE_AMBIGUOUS"
  | "PROFILE_SNAPSHOT_DRIFT";

export type CrmAccessInventoryRow = {
  userId: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  accessProfile: { id: string; name: string } | null;
  profilePermissions: string[];
  appUserPermissions: string[];
  effectiveCrmResources: string[];
  dataScope: "global" | "own" | "none";
  sellerLinked: boolean;
  issues: CrmAccessInventoryIssue[];
};

const CRM_PREFIXES = ["crm.", "customers.commercial360."] as const;

function normalized(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function crmPermissions(values: readonly string[]): string[] {
  return normalized(values).filter((key) =>
    CRM_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

function dtoHas(dto: EffectiveAccessMeDto, legacyPermission: string): boolean {
  return legacyPermissionGrantedByDto(dto, legacyPermission);
}

export function buildCrmAccessInventoryRow(
  user: CrmAccessInventoryUser
): CrmAccessInventoryRow {
  const dto = buildEffectiveAccessDtoFromUser({
    userId: user.id,
    role: user.role,
    accessProfilePermissions: user.accessProfile?.permissions ?? null,
    overrides: user.permissionOverrides,
    permissionsVersion: user.permissionsVersion,
    legacyCompatMode: false,
    audience: "session",
  }) as EffectiveAccessMeDto;

  const persona = resolveCrmCommercialPersona({
    role: user.role,
    canViewShell: dtoHas(dto, "crm.view"),
    canViewGeneral: dtoHas(dto, "crm.general.view"),
    canViewSellerTab: dtoHas(dto, "crm.seller.view"),
    canViewPortfolio: dtoHas(dto, "crm.customer_cockpit.view"),
    canViewCustomer360: dtoHas(dto, "customers.commercial360.view"),
    canViewOwn: dtoHas(dto, "crm.seller.own"),
    canViewAll: dtoHas(dto, "crm.seller.all"),
  });

  const sellerLinked =
    user.externalSellerId != null ||
    user.externalSellerIds.length > 0 ||
    Boolean(user.sellerResponsibleName?.trim());
  const issues: CrmAccessInventoryIssue[] = [];
  const hasShell = dtoHas(dto, "crm.view");
  const hasOwn = dtoHas(dto, "crm.seller.own");
  const hasAll = dtoHas(dto, "crm.seller.all");

  if (hasShell && !persona.canUseCrm) issues.push("CRM_SHELL_WITHOUT_USABLE_SCOPE");
  if (persona.dataScope === "own" && !sellerLinked) {
    issues.push("OWN_SCOPE_WITHOUT_COMMERCIAL_LINK");
  }
  if (hasOwn && hasAll) issues.push("OWN_AND_ALL_SCOPE_AMBIGUOUS");

  const profilePermissions = crmPermissions(user.accessProfile?.permissions ?? []);
  const appUserPermissions = crmPermissions(user.permissions);
  if (
    user.accessProfile &&
    JSON.stringify(profilePermissions) !== JSON.stringify(appUserPermissions)
  ) {
    issues.push("PROFILE_SNAPSHOT_DRIFT");
  }

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    accessProfile: user.accessProfile
      ? { id: user.accessProfile.id, name: user.accessProfile.name }
      : null,
    profilePermissions,
    appUserPermissions,
    effectiveCrmResources: dto.allowedResources.filter((key) =>
      key.startsWith("commercial.crm")
    ),
    dataScope: persona.dataScope,
    sellerLinked,
    issues,
  };
}

export function summarizeCrmAccessInventory(rows: readonly CrmAccessInventoryRow[]) {
  return {
    userCount: rows.length,
    activeUserCount: rows.filter((row) => row.isActive).length,
    globalScopeCount: rows.filter((row) => row.dataScope === "global").length,
    ownScopeCount: rows.filter((row) => row.dataScope === "own").length,
    noScopeCount: rows.filter((row) => row.dataScope === "none").length,
    issueCount: rows.reduce((total, row) => total + row.issues.length, 0),
    usersWithIssues: rows.filter((row) => row.issues.length > 0).length,
  };
}
