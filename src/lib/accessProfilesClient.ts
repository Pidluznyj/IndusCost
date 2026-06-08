import type { AppUserRole } from "@/src/lib/appAuthClient";

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
