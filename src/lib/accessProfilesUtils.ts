import type { AppUserRole } from "@/src/lib/appAuthClient";
import { ALL_PERMISSION_KEYS } from "@/src/lib/permissionCatalog";
import { enablePermission } from "@/src/lib/permissionCatalogUtils";

const PERMISSION_KEY_SET = new Set(ALL_PERMISSION_KEYS);

function filterKnownPermissions(permissions: string[]): string[] {
  const out: string[] = [];
  for (const raw of permissions) {
    const key = raw.trim();
    if (PERMISSION_KEY_SET.has(key) && !out.includes(key)) out.push(key);
  }
  return out;
}

export function permissionsMatchProfile(
  userPermissions: string[],
  profilePermissions: string[]
): boolean {
  const a = filterKnownPermissions(userPermissions).sort().join("|");
  const b = filterKnownPermissions(profilePermissions).sort().join("|");
  return a === b;
}

export function applyProfilePermissionsRaw(profilePermissions: string[]): string[] {
  let acc: string[] = [];
  for (const key of filterKnownPermissions(profilePermissions)) {
    acc = enablePermission(acc, key);
  }
  return acc;
}

export function applyAccessProfileToUserFields(profile: {
  roleBase: AppUserRole | null;
  permissions: string[];
}): { role?: AppUserRole; permissions: string[] } {
  const permissions = filterKnownPermissions(profile.permissions);
  if (profile.roleBase === "SUPER_ADMIN") {
    return { role: "SUPER_ADMIN", permissions: [] };
  }
  if (profile.roleBase) {
    return { role: profile.roleBase, permissions };
  }
  return { permissions };
}
