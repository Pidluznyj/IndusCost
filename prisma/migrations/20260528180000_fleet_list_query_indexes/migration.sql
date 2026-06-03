-- No-op intencional: esta pasta tinha timestamp anterior ao módulo frota (20260603120000),
-- o que impedia `migrate deploy` em bancos novos. Índices foram movidos para
-- 20260604120000_fix_fleet_schema_alignment (CREATE INDEX IF NOT EXISTS).
-- Bancos que já aplicaram o SQL antigo desta migration permanecem válidos.
SELECT 1;
