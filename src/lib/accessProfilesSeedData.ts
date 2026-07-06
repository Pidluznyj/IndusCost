import type { AppUserRole } from "@prisma/client";
import {
  applyTemplatePermissions,
  enablePermission,
  type PermissionTemplateId,
  PERMISSION_TEMPLATES,
} from "@/src/lib/permissionCatalogUtils.js";

export type AccessProfileSeed = {
  systemKey: string;
  name: string;
  description: string;
  roleBase: AppUserRole | null;
  permissions: string[];
  isSystem: true;
  isActive: true;
};

function tplPerms(id: PermissionTemplateId): string[] {
  return applyTemplatePermissions(id);
}

function buildAdminPermissions(): string[] {
  let acc = tplPerms("system_admin");
  for (const key of [
    "users.manage",
    "accessProfiles.view",
    "accessProfiles.manage",
    "crm.customers.assign_seller",
  ]) {
    acc = enablePermission(acc, key);
  }
  return acc;
}

const VIEWER_LIGHT_PERMISSIONS = [
  "dashboard.view",
  "crm.view",
  "customers.view",
  "proposals.view",
  "products.view",
  "reports.view",
  "guide.view",
].reduce((acc, key) => enablePermission(acc, key), [] as string[]);

export const SYSTEM_ACCESS_PROFILE_SEEDS: AccessProfileSeed[] = [
  {
    systemKey: "role_super_admin",
    name: "Super administrador",
    description: "Acesso total ao sistema; todas as permissões são concedidas automaticamente pelo role.",
    roleBase: "SUPER_ADMIN",
    permissions: [],
    isSystem: true,
    isActive: true,
  },
  {
    systemKey: "role_admin",
    name: "Administrador",
    description: "Administração do ERP, usuários, perfis de acesso e parâmetros sensíveis.",
    roleBase: "ADMIN",
    permissions: buildAdminPermissions(),
    isSystem: true,
    isActive: true,
  },
  {
    systemKey: "role_commercial_manager",
    name: "Gestor comercial",
    description: PERMISSION_TEMPLATES.commercial_manager.description,
    roleBase: "COMMERCIAL_MANAGER",
    permissions: tplPerms("commercial_manager"),
    isSystem: true,
    isActive: true,
  },
  {
    systemKey: "role_seller",
    name: "Vendedor",
    description: PERMISSION_TEMPLATES.seller.description,
    roleBase: "SELLER",
    permissions: tplPerms("seller"),
    isSystem: true,
    isActive: true,
  },
  {
    systemKey: "role_viewer",
    name: "Visualizador",
    description: "Consulta básica aos módulos principais, sem ações de escrita.",
    roleBase: "VIEWER",
    permissions: VIEWER_LIGHT_PERMISSIONS,
    isSystem: true,
    isActive: true,
  },
  {
    systemKey: "read_only",
    name: PERMISSION_TEMPLATES.read_only.label,
    description: PERMISSION_TEMPLATES.read_only.description,
    roleBase: "VIEWER",
    permissions: tplPerms("read_only"),
    isSystem: true,
    isActive: true,
  },
  {
    systemKey: "purchases",
    name: PERMISSION_TEMPLATES.purchases.label,
    description: PERMISSION_TEMPLATES.purchases.description,
    roleBase: null,
    permissions: tplPerms("purchases"),
    isSystem: true,
    isActive: true,
  },
  {
    systemKey: "engineering",
    name: PERMISSION_TEMPLATES.engineering.label,
    description: PERMISSION_TEMPLATES.engineering.description,
    roleBase: null,
    permissions: tplPerms("engineering"),
    isSystem: true,
    isActive: true,
  },
  {
    systemKey: "system_admin",
    name: PERMISSION_TEMPLATES.system_admin.label,
    description: PERMISSION_TEMPLATES.system_admin.description,
    roleBase: "ADMIN",
    permissions: tplPerms("system_admin"),
    isSystem: true,
    isActive: true,
  },
  {
    systemKey: "fleet_admin",
    name: PERMISSION_TEMPLATES.fleet_admin.label,
    description: PERMISSION_TEMPLATES.fleet_admin.description,
    roleBase: null,
    permissions: tplPerms("fleet_admin"),
    isSystem: true,
    isActive: true,
  },
  {
    systemKey: "fleet_operator",
    name: PERMISSION_TEMPLATES.fleet_operator.label,
    description: PERMISSION_TEMPLATES.fleet_operator.description,
    roleBase: null,
    permissions: tplPerms("fleet_operator"),
    isSystem: true,
    isActive: true,
  },
  {
    systemKey: "fleet_financial",
    name: PERMISSION_TEMPLATES.fleet_financial.label,
    description: PERMISSION_TEMPLATES.fleet_financial.description,
    roleBase: null,
    permissions: tplPerms("fleet_financial"),
    isSystem: true,
    isActive: true,
  },
  {
    systemKey: "fleet_maintenance",
    name: PERMISSION_TEMPLATES.fleet_maintenance.label,
    description: PERMISSION_TEMPLATES.fleet_maintenance.description,
    roleBase: null,
    permissions: tplPerms("fleet_maintenance"),
    isSystem: true,
    isActive: true,
  },
  {
    systemKey: "fleet_requester",
    name: PERMISSION_TEMPLATES.fleet_requester.label,
    description: PERMISSION_TEMPLATES.fleet_requester.description,
    roleBase: null,
    permissions: tplPerms("fleet_requester"),
    isSystem: true,
    isActive: true,
  },
  {
    systemKey: "fleet_viewer",
    name: PERMISSION_TEMPLATES.fleet_viewer.label,
    description: PERMISSION_TEMPLATES.fleet_viewer.description,
    roleBase: null,
    permissions: tplPerms("fleet_viewer"),
    isSystem: true,
    isActive: true,
  },
];
