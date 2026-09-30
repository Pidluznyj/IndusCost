-- Exposure: fontes aditivas de enriquecimento. Sem DROP, TRUNCATE, DELETE ou unique global de CNJ.

ALTER TYPE "LegalExposureSource" ADD VALUE IF NOT EXISTS 'JUSBRASIL';
ALTER TYPE "LegalExposureSource" ADD VALUE IF NOT EXISTS 'TRIBUNAL_PUBLIC';
ALTER TYPE "LegalExposureSource" ADD VALUE IF NOT EXISTS 'WEB_DISCOVERY';
