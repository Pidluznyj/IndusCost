-- Permissionamento relacional (MENU/SUBMENU/TAB/ACTION).
-- Aditivo: não altera AppUser.permissions[], AccessProfile nem AppUserRole.
-- Runtime de auth continua no catálogo em código + String[] até cutover futuro.

CREATE TYPE "PermissionResourceType" AS ENUM ('MENU', 'SUBMENU', 'TAB', 'ACTION');

CREATE TABLE "PermissionResource" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "type" "PermissionResourceType" NOT NULL,
    "parentKey" TEXT,
    "module" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionResource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PermissionResource_key_key" ON "PermissionResource"("key");
CREATE INDEX "PermissionResource_type_idx" ON "PermissionResource"("type");
CREATE INDEX "PermissionResource_module_idx" ON "PermissionResource"("module");
CREATE INDEX "PermissionResource_parentKey_idx" ON "PermissionResource"("parentKey");
CREATE INDEX "PermissionResource_isActive_idx" ON "PermissionResource"("isActive");
CREATE INDEX "PermissionResource_sortOrder_idx" ON "PermissionResource"("sortOrder");

ALTER TABLE "PermissionResource"
  ADD CONSTRAINT "PermissionResource_parentKey_fkey"
  FOREIGN KEY ("parentKey") REFERENCES "PermissionResource"("key")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "RolePermission" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "role" "AppUserRole" NOT NULL,
    "resourceKey" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT false,
    "canExecute" BOOLEAN NOT NULL DEFAULT false,
    "canManage" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RolePermission_role_resourceKey_key" ON "RolePermission"("role", "resourceKey");
CREATE INDEX "RolePermission_role_idx" ON "RolePermission"("role");
CREATE INDEX "RolePermission_resourceKey_idx" ON "RolePermission"("resourceKey");

ALTER TABLE "RolePermission"
  ADD CONSTRAINT "RolePermission_resourceKey_fkey"
  FOREIGN KEY ("resourceKey") REFERENCES "PermissionResource"("key")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "UserPermissionOverride" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "resourceKey" TEXT NOT NULL,
    "canView" BOOLEAN,
    "canExecute" BOOLEAN,
    "canManage" BOOLEAN,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermissionOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserPermissionOverride_userId_resourceKey_key"
  ON "UserPermissionOverride"("userId", "resourceKey");
CREATE INDEX "UserPermissionOverride_userId_idx" ON "UserPermissionOverride"("userId");
CREATE INDEX "UserPermissionOverride_resourceKey_idx" ON "UserPermissionOverride"("resourceKey");

ALTER TABLE "UserPermissionOverride"
  ADD CONSTRAINT "UserPermissionOverride_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AppUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserPermissionOverride"
  ADD CONSTRAINT "UserPermissionOverride_resourceKey_fkey"
  FOREIGN KEY ("resourceKey") REFERENCES "PermissionResource"("key")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PermissionAuditLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actorUserId" UUID,
    "targetUserId" UUID,
    "targetRole" "AppUserRole",
    "resourceKey" TEXT,
    "action" TEXT NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PermissionAuditLog_actorUserId_idx" ON "PermissionAuditLog"("actorUserId");
CREATE INDEX "PermissionAuditLog_targetUserId_idx" ON "PermissionAuditLog"("targetUserId");
CREATE INDEX "PermissionAuditLog_targetRole_idx" ON "PermissionAuditLog"("targetRole");
CREATE INDEX "PermissionAuditLog_resourceKey_idx" ON "PermissionAuditLog"("resourceKey");
CREATE INDEX "PermissionAuditLog_action_idx" ON "PermissionAuditLog"("action");
CREATE INDEX "PermissionAuditLog_createdAt_idx" ON "PermissionAuditLog"("createdAt");

ALTER TABLE "PermissionAuditLog"
  ADD CONSTRAINT "PermissionAuditLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PermissionAuditLog"
  ADD CONSTRAINT "PermissionAuditLog_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
