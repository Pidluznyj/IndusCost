-- Índices para listagens paginadas da frota (filtros por data, competência, CNH).

CREATE INDEX IF NOT EXISTS "FleetDriver_cnhExpirationDate_idx" ON "FleetDriver"("cnhExpirationDate");
CREATE INDEX IF NOT EXISTS "FleetDriver_unit_idx" ON "FleetDriver"("unit");

CREATE INDEX IF NOT EXISTS "FleetMaintenance_openedAt_idx" ON "FleetMaintenance"("openedAt");

CREATE INDEX IF NOT EXISTS "FleetCost_competence_idx" ON "FleetCost"("competence");

CREATE INDEX IF NOT EXISTS "FleetFine_infractionDate_idx" ON "FleetFine"("infractionDate");

CREATE INDEX IF NOT EXISTS "FleetIncident_incidentDate_idx" ON "FleetIncident"("incidentDate");
