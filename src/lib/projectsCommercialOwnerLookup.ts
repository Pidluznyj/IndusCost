import type { AppUser, AppUserRole } from "@prisma/client";

export const PROJECTS_COMMERCIAL_OWNER_LOOKUP_LIMIT = 20;

const COMMERCIAL_ROLES: AppUserRole[] = [
  "SELLER",
  "COMMERCIAL_MANAGER",
  "ADMIN",
  "SUPER_ADMIN",
];

export type ProjectCommercialOwnerLookupItem = {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  source: "user";
};

export function formatCommercialOwnerDisplayName(user: Pick<AppUser, "name" | "sellerResponsibleName">): string {
  const seller = user.sellerResponsibleName?.trim();
  if (seller) return seller;
  return user.name.trim();
}

export function serializeCommercialOwnerLookupItem(
  user: Pick<AppUser, "id" | "name" | "email" | "role" | "sellerResponsibleName">
): ProjectCommercialOwnerLookupItem {
  return {
    id: user.id,
    name: formatCommercialOwnerDisplayName(user),
    email: user.email?.trim() || null,
    role: user.role,
    source: "user",
  };
}

export function buildCommercialOwnerSearchWhere(query: string) {
  const q = query.trim();
  if (!q) return undefined;
  return {
    OR: [
      { name: { contains: q, mode: "insensitive" as const } },
      { email: { contains: q, mode: "insensitive" as const } },
      { sellerResponsibleName: { contains: q, mode: "insensitive" as const } },
    ],
  };
}

export function buildSimulationCommercialOwnerPayload(name: string): string {
  return name.trim();
}

export { COMMERCIAL_ROLES };
