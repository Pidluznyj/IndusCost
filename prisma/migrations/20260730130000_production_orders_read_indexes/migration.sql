-- OP-21: índices aditivos para paginação e filtros do grid read-only.
CREATE INDEX "NomusProductionOrder_openedAt_externalId_idx"
ON "NomusProductionOrder"("openedAt", "externalId");

CREATE INDEX "NomusProductionOrder_status_openedAt_externalId_idx"
ON "NomusProductionOrder"("status", "openedAt", "externalId");

CREATE INDEX "NomusProductionOrder_tipo_openedAt_externalId_idx"
ON "NomusProductionOrder"("tipo", "openedAt", "externalId");
