# Inteligência de Mercado — checklist de deploy (produção)

**Projeto:** IndusCost  
**Módulo:** Materiais → Inteligência de Mercado  
**Atualizado:** 2026-07-08  

> **Deploy NÃO é executado a partir do Cursor.** Migrations e restart rodam no servidor (`/opt/induscost` ou caminho equivalente), com backup prévio.

**Proibido neste fluxo:** `prisma db push`, `prisma migrate dev`, `DROP`/`TRUNCATE` manuais, alterar dados de produção sem autorização.

---

## 1. Pré-deploy (build/CI ou máquina de release)

```bash
git fetch origin
git checkout feat/material-market-quote-attachments   # ou a branch/tag de release
git pull
npm ci   # ou npm install se lock estiver alinhado
npx prisma validate
npx prisma generate
npm test
# Suite obrigatória MI (também roda via npm test e build:safe):
npm run test:market-intelligence
# Smoke HTTP das rotas críticas MI (também incluso em test:market-intelligence):
npm run test:market-intelligence-smoke
# Guardrail de named exports no boot (também incluso em build:safe):
npm run check:server-imports
npm run build:safe
```

Anote o commit:

```bash
git rev-parse HEAD
```

---

## 2. Variáveis de ambiente (servidor)

| Variável | Obrigatória? | Default / nota |
|----------|--------------|----------------|
| `DATABASE_URL` | Sim | PostgreSQL produção |
| `APP_UPLOADS_DIR` | Recomendada | Default `./data/uploads`. Em produção use caminho persistente (ex. `/var/lib/induscost/uploads`). Anexos de cotação. |
| `BRENT_COMMODITY_SCHEDULER_ENABLED` | Opcional | Default **habilitado**. Use `false` / `0` / `off` / `no` para desligar o cron in-process. |
| PTAX / BCB | Não | API pública BCB Olinda — **sem API key**. |
| Brent / Yahoo | Não | `https://query1.finance.yahoo.com` — **sem API key**. |

Não há feature flag de UI dedicada: permissões RBAC (`materials.view` / `materials.edit` + permissões de câmbio manual no catálogo) controlam acesso.

---

## 3. Jobs / cron Brent

| Item | Detalhe |
|------|---------|
| Agenda | **09:00** e **15:30** `America/Sao_Paulo` |
| Onde roda | In-process no Node (`startBrentCommodityScheduledJob` ao registrar rotas Brent) |
| Enable/disable | `BRENT_COMMODITY_SCHEDULER_ENABLED` (ver acima) |
| Dedup | 1 sucesso por `(quoteDate, scheduledSlot)` — coleta adicional no mesmo slot é **skipped** |
| Falha | Grava `CommoditySnapshot` com `status=FAILED` + `errorMessage` (append-only) |
| Manual | `npm run collect:brent` ou `POST /api/market-intelligence/commodities/brent/collect` (`materials.edit`) |
| Logs | Prefixo `[brent-commodity-collection]` no stdout/stderr do processo Node |

PTAX em cotação USD: consulta BCB on-the-fly (com fallback de dias úteis anteriores). Snapshots `PtaxSnapshot` alimentam KPIs globais — se a tabela estiver vazia, a Home mostra KPI sem PTAX (não quebra a app). **Nota:** nesta entrega não há job de persistência diária de `PtaxSnapshot`; o KPI global de PTAX pode ficar vazio até existir coleta/persistência dedicada. A conversão nas cotações USD não depende dessa tabela.

---

## 4. Fallbacks de APIs externas

| Cenário | Comportamento |
|---------|---------------|
| **PTAX BCB falha** | Cotação USD salva com `ptaxFetchStatus=FAILED`, sem BRL; aviso ao usuário. Admin com permissão de câmbio manual pode informar taxa + justificativa (`exchangeOrigin=MANUAL`). |
| **Brent Yahoo falha** | Snapshot `FAILED` persistido; KPI/latest pode continuar mostrando último `SUCCESS`. Coleta manual/agendada não derruba o processo. |
| **Sem anexos dir** | Storage cria `APP_UPLOADS_DIR` sob demanda; garantir permissão de escrita e backup do volume. |

---

## 5. Migrations (ordem — todas aditivas)

Aplicar **somente** com:

```bash
# OBRIGATÓRIO: backup/snapshot do PostgreSQL antes
npx prisma migrate status
npx prisma migrate deploy
```

| Pasta | Objetivo | Tipo | Destrutiva? | Dependências |
|-------|----------|------|-------------|--------------|
| `20260714120000_material_market_monitoring` | Enum criticality + cols `Material` + idx monitorados | ADD | Não | `Material` |
| `20260715120000_material_market_quotes` | Tabela `MaterialMarketQuote` + enums FX/PTAX/status | ADD | Não | `Material`, `FinancialSupplier` |
| `20260716120000_commodity_snapshots` | `CommoditySnapshot` (Brent) | ADD | Não | — |
| `20260716130000_ptax_snapshots` | `PtaxSnapshot` | ADD | Não | — |
| `20260717120000_material_market_alerts` | `MaterialMarketAlert` + enums | ADD | Não | `Material` |
| `20260717130000_material_market_quote_attachments` | Anexos + `MaterialMarketQuoteAuditLog` + col reliability sugerida | ADD | Não | `MaterialMarketQuote` |
| `20260718120000_material_market_alert_config` | Config global/material + seed `GLOBAL` + audit config | ADD | Não | `Material` |
| `20260718125000_material_official_quote` | Flag oficial + unique parcial + `MaterialOfficialQuoteAudit` | ADD | Não | `Material`, `MaterialMarketQuote` |
| `20260718130000_material_quote_official_governance` | Status/aprovação + backfill OFFICIAL + relax `newQuoteId` | ALTER (+ UPDATE backfill) | Não* | cols oficiais existentes |
| `20260719130000_material_quote_reliability_override` | Cols reliability aplicada/override + backfill | ALTER (+ UPDATE) | Não | enum attachments |
| `20260720120000_material_market_audit_events` | `MaterialMarketAuditEvent` + enums | ADD | Não | `Material` (FK SET NULL) |
| `20260721120000_commodity_snapshot_scheduled_slot` | `scheduledSlot`/`trigger` + replace índice | ALTER (+ DROP INDEX) | Só índice antigo** | `CommoditySnapshot` |
| `20260721130000_material_market_purchase_link` | `MaterialMarketPurchaseLink` (+ enum values idempotentes) | ADD | Não | `Material`, `MaterialMarketQuote` |

\* `DROP NOT NULL` apenas em `MaterialOfficialQuoteAudit.newQuoteId` (coluna permanece; deixa de ser obrigatória).  
\*\* `DROP INDEX IF EXISTS CommoditySnapshot_commodityType_quoteDate_idx` — substituído por índice com `scheduledSlot`. Sem `DROP TABLE` / `TRUNCATE`.

**Ownership / permissões:** nenhum `OWNER TO`, `GRANT`, `SET ROLE` ou schema extra — objetos no `public` com o role da `DATABASE_URL`.

**UTF-8 BOM:** as 13 migrations MI foram conferidas sem BOM (`EF BB BF`). Requisito: PostgreSQL com `gen_random_uuid()` (já usado no restante do projeto). `ALTER TYPE ... ADD VALUE IF NOT EXISTS` (migration `purchase_link`) exige **PostgreSQL ≥ 15** — mesmo padrão das migrations de comissões/frota.

**Idempotência:** `PURCHASE_LINK` / `PURCHASE_LINKED` já entram em `CREATE TYPE` na migration `audit_events`; a migration `purchase_link` só reafirma com `ADD VALUE IF NOT EXISTS` (no-op se já existirem).

**Schema drift (não bloqueante):** índice `Material_isMarketMonitored_idx` existe na migration SQL, mas `@@index([isMarketMonitored])` **não** está em `schema.prisma` (risco de `db push` futuro dropar o índice — **não usar** `db push` em produção). Índice parcial `MaterialMarketQuote_one_official_per_material_idx` só no SQL (esperado — Prisma não modela partial unique).

---

## 5.1 Checklist SQL pós-migrate (servidor — só SELECT)

Rodar **manualmente** no PostgreSQL após `migrate deploy` (ex.: `runuser -u postgres -- psql -d teste_bi -P pager=off`). Não executar do Cursor.

```sql
-- 1) Histórico Prisma: as 13 migrations MI devem aparecer
SELECT migration_name, finished_at, rolled_back_at
FROM "_prisma_migrations"
WHERE migration_name LIKE '%material_market%'
   OR migration_name LIKE '%commodity_snapshot%'
   OR migration_name LIKE '%ptax_snapshot%'
   OR migration_name LIKE '%material_official%'
   OR migration_name LIKE '%material_quote%'
ORDER BY migration_name;

-- 2) Tabelas-chave
SELECT c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'MaterialMarketQuote',
    'MaterialMarketQuoteAttachment',
    'MaterialMarketQuoteAuditLog',
    'MaterialOfficialQuoteAudit',
    'MaterialMarketAlert',
    'MaterialMarketAlertGlobalConfig',
    'MaterialMarketAlertConfig',
    'MaterialMarketAlertConfigAudit',
    'MaterialMarketAuditEvent',
    'MaterialMarketPurchaseLink',
    'CommoditySnapshot',
    'PtaxSnapshot'
  )
ORDER BY 1;
-- Esperado: 12 linhas

-- 3) Colunas Material (monitoramento)
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'Material'
  AND column_name IN (
    'isMarketMonitored', 'marketCriticality',
    'marketMonitoringFrequencyDays', 'marketNotes'
  )
ORDER BY 1;

-- 4) Colunas MaterialMarketQuote (oficial + reliability)
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'MaterialMarketQuote'
  AND column_name IN (
    'isOfficialReference', 'officialStatus',
    'suggestedReliabilityLevel', 'reliabilityLevel',
    'reliabilitySuggestedLevel', 'reliabilityOverrideReason',
    'reliabilitySetBy', 'reliabilitySetAt'
  )
ORDER BY 1;

-- 5) Commodity scheduledSlot / trigger NOT NULL
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'CommoditySnapshot'
  AND column_name IN ('scheduledSlot', 'trigger');

-- 6) Seed GLOBAL de alertas
SELECT id, "alertsEnabled", "daysWithoutQuote"
FROM "MaterialMarketAlertGlobalConfig"
WHERE id = 'GLOBAL';

-- 7) Enums (amostra)
SELECT t.typname, e.enumlabel
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN (
  'MaterialMarketCriticality',
  'MaterialMarketQuoteOfficialStatus',
  'MaterialMarketAuditEntityType',
  'MaterialMarketAuditEventType',
  'CommodityCollectionSlot',
  'CommodityCollectionTrigger'
)
ORDER BY 1, e.enumsortorder;
-- Conferir: PURCHASE_LINK / PURCHASE_LINKED; MORNING / AFTERNOON; SCHEDULED / MANUAL

-- 8) Índices hot-path
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'Material_isMarketMonitored_idx',
    'MaterialMarketQuote_materialId_quoteDate_idx',
    'MaterialMarketQuote_one_official_per_material_idx',
    'MaterialMarketQuote_materialId_isOfficialReference_idx',
    'MaterialMarketQuote_materialId_officialStatus_idx',
    'MaterialMarketAlert_materialId_status_idx',
    'MaterialMarketAlert_status_triggeredAt_idx',
    'MaterialMarketAuditEvent_materialId_occurredAt_idx',
    'CommoditySnapshot_commodityType_quoteDate_scheduledSlot_idx',
    'CommoditySnapshot_commodityType_status_collectedAt_idx',
    'PtaxSnapshot_status_collectedAt_idx',
    'MaterialMarketPurchaseLink_materialId_purchaseDate_idx'
  )
ORDER BY 1;
-- Não deve existir o índice antigo CommoditySnapshot_commodityType_quoteDate_idx

-- 9) FKs MI (Material / Quote / Supplier) + official audit
SELECT conname, conrelid::regclass AS from_table, confrelid::regclass AS to_table
FROM pg_constraint
WHERE contype = 'f'
  AND (
    conrelid::regclass::text LIKE '%MaterialMarket%'
    OR conrelid::regclass::text LIKE '%MaterialOfficialQuoteAudit%'
  )
ORDER BY 1;
-- CommoditySnapshot / PtaxSnapshot não têm FK (esperado)

-- 10) Contagens smoke (não precisam ser > 0 no go-live frio)
SELECT 'MaterialMarketQuote' AS t, COUNT(*) FROM "MaterialMarketQuote"
UNION ALL SELECT 'CommoditySnapshot', COUNT(*) FROM "CommoditySnapshot"
UNION ALL SELECT 'PtaxSnapshot', COUNT(*) FROM "PtaxSnapshot"
UNION ALL SELECT 'MaterialMarketAlert', COUNT(*) FROM "MaterialMarketAlert"
UNION ALL SELECT 'MaterialMarketAuditEvent', COUNT(*) FROM "MaterialMarketAuditEvent"
UNION ALL SELECT 'MaterialMarketPurchaseLink', COUNT(*) FROM "MaterialMarketPurchaseLink";
```

---

## 6. Passos no servidor (após backup)

```bash
cd /opt/induscost   # ajustar se necessário
git fetch origin
git pull            # branch/tag liberada
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build       # se o deploy publicar artefato buildado no mesmo host

# Restart do processo Node (exemplos — usar o gestor real do ambiente)
# systemctl restart induscost
# pm2 restart induscost

# Conferir kill-switch Brent (opcional)
# grep BRENT_COMMODITY .env
```

---

## 7. Smoke test pós-restart

Com sessão autenticada (`materials.view` / `materials.edit`):

1. UI: Materiais → Inteligência de Mercado (lista + detalhe 360º).
2. `GET /api/market-intelligence/commodities/brent/latest` — 200 com snapshot ou 404 se nunca coletado.
3. `GET /api/market-intelligence/commodities/jobs` — lista job Brent.
4. Opcional: `POST /api/market-intelligence/commodities/brent/collect` ou `npm run collect:brent`.
5. Criar/abrir cotação USD: PTAX automático ou caminho de câmbio manual.
6. Upload de anexo (se usado): gravar sob `APP_UPLOADS_DIR`.
7. Logs: buscar `[brent-commodity-collection]` após horário agendado ou coleta manual.

---

## 8. Rollback (alto nível)

- **Código:** voltar tag/commit anterior + restart.
- **Migrations:** não reverter SQL automaticamente. Rollback de schema só com plano DBA (migrations são aditivas; tabelas novas podem ficar órfãs sem impacto se o código antigo as ignora).
- **Uploads:** volume `APP_UPLOADS_DIR` permanece; não apagar.

---

## 9. Critérios de go-live

- [ ] Backup DB feito
- [ ] `migrate deploy` OK (sem migration duplicada/órfã) — **13** pastas MI listadas acima
- [ ] Checklist SQL §5.1 OK (histórico, tabelas, enums, índices)
- [ ] `prisma generate` + app restart OK
- [ ] Smoke Brent + lista de monitorados OK
- [ ] `APP_UPLOADS_DIR` persistente e com espaço
- [ ] Equipe ciente do fallback PTAX manual e do flag `BRENT_COMMODITY_SCHEDULER_ENABLED`
