-- RBAC mínimo: usuários de aplicação e sessões (Fase 1K-B)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "AppUserRole" AS ENUM (
  'SUPER_ADMIN',
  'ADMIN',
  'COMMERCIAL_MANAGER',
  'SELLER',
  'VIEWER'
);

CREATE TABLE "AppUser" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "AppUserRole" NOT NULL DEFAULT 'VIEWER',
  "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "externalSellerId" INTEGER,
  "sellerResponsibleName" TEXT,
  "lastLoginAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppUser_email_key" ON "AppUser"("email");
CREATE INDEX "AppUser_role_idx" ON "AppUser"("role");
CREATE INDEX "AppUser_isActive_idx" ON "AppUser"("isActive");
CREATE INDEX "AppUser_externalSellerId_idx" ON "AppUser"("externalSellerId");

CREATE TABLE "AppSession" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "revokedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AppSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppSession_tokenHash_key" ON "AppSession"("tokenHash");
CREATE INDEX "AppSession_userId_idx" ON "AppSession"("userId");
CREATE INDEX "AppSession_expiresAt_idx" ON "AppSession"("expiresAt");
CREATE INDEX "AppSession_revokedAt_idx" ON "AppSession"("revokedAt");

ALTER TABLE "AppSession"
  ADD CONSTRAINT "AppSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
