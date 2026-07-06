-- Identidade visual global (tabela nova, aditiva, sem FK, sem enum, sem backfill).

CREATE TABLE "BrandingSettings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyName" TEXT DEFAULT 'Lazarios Koppetel',
    "slogan" TEXT DEFAULT 'Soluções e qualidade em plásticos',
    "primaryColor" TEXT DEFAULT '#0EA5E9',
    "secondaryColor" TEXT DEFAULT '#1D4ED8',
    "systemCompactLogoDataUrl" TEXT,
    "systemExpandedLogoDataUrl" TEXT,
    "proposalLogoDataUrl" TEXT,
    "darkLogoDataUrl" TEXT,
    "faviconDataUrl" TEXT,
    "proposalCoverDataUrl" TEXT,
    "watermarkDataUrl" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrandingSettings_pkey" PRIMARY KEY ("id")
);
