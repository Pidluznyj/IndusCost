-- Alinhamento pós Fase 1 Gestão de Frota: índices de listagem (idempotente) + seed FleetSettings ausente.

CREATE INDEX IF NOT EXISTS "FleetDriver_cnhExpirationDate_idx" ON "FleetDriver"("cnhExpirationDate");
CREATE INDEX IF NOT EXISTS "FleetDriver_unit_idx" ON "FleetDriver"("unit");

CREATE INDEX IF NOT EXISTS "FleetMaintenance_openedAt_idx" ON "FleetMaintenance"("openedAt");

CREATE INDEX IF NOT EXISTS "FleetCost_competence_idx" ON "FleetCost"("competence");

CREATE INDEX IF NOT EXISTS "FleetFine_infractionDate_idx" ON "FleetFine"("infractionDate");

CREATE INDEX IF NOT EXISTS "FleetIncident_incidentDate_idx" ON "FleetIncident"("incidentDate");

INSERT INTO "FleetSettings" ("key", "value", "description") VALUES
('bloquearReservaDocumentoVencido', 'false', 'Bloquear reserva quando documento do veículo estiver vencido'),
('bloquearRetiradaCnhVencida', 'true', 'Bloquear retirada quando CNH do motorista estiver vencida'),
('checklistRetiradaObrigatorio', 'false', 'Checklist de retirada obrigatório'),
('checklistDevolucaoObrigatorio', 'false', 'Checklist de devolução obrigatório'),
('diasAlertaDocumento', '30', 'Dias antes do vencimento para alerta de documento'),
('diasAlertaCnh', '30', 'Dias antes do vencimento para alerta de CNH'),
('percentualAlertaFranquiaKm', '80', 'Percentual da franquia de km para alerta'),
('manutencaoValorAprovacao', '5000', 'Valor estimado (R$) a partir do qual manutenção exige aprovação')
ON CONFLICT ("key") DO NOTHING;
