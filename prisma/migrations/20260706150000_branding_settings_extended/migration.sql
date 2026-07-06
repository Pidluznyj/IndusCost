-- Colunas de identidade visual referenciadas no Prisma mas ausentes na tabela original.

ALTER TABLE "BrandingSettings" ADD COLUMN IF NOT EXISTS "tradeName" TEXT DEFAULT 'Lazarios';
ALTER TABLE "BrandingSettings" ADD COLUMN IF NOT EXISTS "document" TEXT;
ALTER TABLE "BrandingSettings" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
ALTER TABLE "BrandingSettings" ADD COLUMN IF NOT EXISTS "logoBase64" TEXT;
ALTER TABLE "BrandingSettings" ADD COLUMN IF NOT EXISTS "accentColor" TEXT DEFAULT '#3b82f6';
ALTER TABLE "BrandingSettings" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "BrandingSettings" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "BrandingSettings" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "BrandingSettings" ADD COLUMN IF NOT EXISTS "website" TEXT;
ALTER TABLE "BrandingSettings" ADD COLUMN IF NOT EXISTS "proposalFooterText" TEXT;
ALTER TABLE "BrandingSettings" ADD COLUMN IF NOT EXISTS "commercialContactName" TEXT;
ALTER TABLE "BrandingSettings" ADD COLUMN IF NOT EXISTS "commercialContactEmail" TEXT;
ALTER TABLE "BrandingSettings" ADD COLUMN IF NOT EXISTS "commercialContactPhone" TEXT;
