import type { AppUserRole } from "@/src/lib/appAuthClient";
import { fetchJsonOk } from "@/src/lib/http";

export type AccessProfileRecord = {
  id: string;
  name: string;
  description: string | null;
  roleBase: AppUserRole | null;
  systemKey: string | null;
  permissions: string[];
  isSystem: boolean;
  isActive: boolean;
  userCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AccessProfileFormState = {
  name: string;
  description: string;
  roleBase: AppUserRole | "";
  permissions: string[];
  isActive: boolean;
};

export const EMPTY_ACCESS_PROFILE_FORM: AccessProfileFormState = {
  name: "",
  description: "",
  roleBase: "",
  permissions: [],
  isActive: true,
};

export type AccessProfileLinkedUser = {
  id: string;
  name: string;
  email: string;
  role: AppUserRole;
  isActive: boolean;
  permissions: string[];
  matchesProfile: boolean;
};

export type AccessProfileApplyPreview = {
  profileId: string;
  profileName: string;
  profilePermissions: string[];
  users: Array<{
    id: string;
    name: string;
    email: string;
    beforePermissions: string[];
    afterPermissions: string[];
    beforeRole: AppUserRole;
    afterRole: AppUserRole;
    willChange: boolean;
    matchesProfileBefore: boolean;
    gained: string[];
    lost: string[];
  }>;
  changeCount: number;
  customizedCount: number;
};

export async function fetchAccessProfilesList(options?: {
  activeOnly?: boolean;
  includeInactive?: boolean;
  search?: string;
}): Promise<AccessProfileRecord[]> {
  const params = new URLSearchParams();
  if (options?.activeOnly) params.set("activeOnly", "1");
  if (options?.includeInactive) params.set("includeInactive", "1");
  if (options?.search?.trim()) params.set("search", options.search.trim());
  const qs = params.toString();
  const res = await fetchJsonOk<{ profiles: AccessProfileRecord[] }>(
    `/api/access-profiles${qs ? `?${qs}` : ""}`
  );
  return Array.isArray(res.profiles) ? res.profiles : [];
}

export async function fetchAccessProfileLinkedUsers(profileId: string) {
  return fetchJsonOk<{
    profile: AccessProfileRecord;
    users: AccessProfileLinkedUser[];
  }>(`/api/access-profiles/${profileId}/linked-users`);
}

export async function fetchAccessProfileApplyPreview(
  profileId: string,
  userIds?: string[]
) {
  return fetchJsonOk<{ preview: AccessProfileApplyPreview }>(
    `/api/access-profiles/${profileId}/apply-preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds: userIds ?? null }),
    }
  );
}

export async function applyAccessProfileToUsersClient(
  profileId: string,
  args: {
    userIds?: string[];
    confirm: boolean;
    overwriteCustomized?: boolean;
  }
) {
  return fetchJsonOk<{
    result: {
      applied: number;
      skipped: number;
      results: Array<{ userId: string; status: string }>;
    };
  }>(`/api/access-profiles/${profileId}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userIds: args.userIds ?? null,
      confirm: args.confirm,
      overwriteCustomized: args.overwriteCustomized !== false,
    }),
  });
}
