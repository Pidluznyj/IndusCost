-- Exposure: teor oficial sanitizado da comunicação DJEN. Aditivo.

ALTER TABLE "LegalCommunication" ADD COLUMN IF NOT EXISTS "officialText" TEXT;
ALTER TABLE "LegalCommunication" ADD COLUMN IF NOT EXISTS "officialHash" TEXT;
ALTER TABLE "LegalCommunication" ADD COLUMN IF NOT EXISTS "officialLink" TEXT;
