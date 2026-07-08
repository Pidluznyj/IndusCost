# Inteligência de Mercado — checklist operacional de deploy (produção)

**Projeto:** IndusCost / My Industry  
**Módulo:** Materiais → Inteligência de Mercado  
**Atualizado:** 2026-07-08  

## Escopo de responsabilidade

| Quem | Faz | Não faz |
|------|-----|---------|
| **Cursor (código)** | Corrigir código, reviews de migration, testes, build local, checks, commit/push, este checklist | Não acessa servidor, não roda deploy, não roda `psql` em produção |
| **Servidor (ops)** | `git pull`, backup, `migrate deploy`, `generate`, build, restart, logs, health, SQL, UAT autenticado | Não altera regras de negócio neste fluxo |

> **Deploy NÃO é executado a partir do Cursor.**

**Proibido neste fluxo:** `prisma db push`, `prisma migrate dev`, `DROP`/`TRUNCATE` manuais, alterar dados de produção sem autorização.

---

## Pacote liberado (commits)

Deployar **`origin/main` no tip**:

| Commit | Conteúdo |
|--------|----------|
| `04fbe8f` | Fix boot: remove imports fantasmas + PUT alert-config duplicada em audit routes |
| `887f927` | Testes MI no gate (`test:market-intelligence` → `npm test` / `build:safe`) |
| `79dd691` | `check:server-imports` + smoke HTTP das rotas MI |
| `bd0b565` | Documentação/auditoria das 13 migrations MI + SQL SELECT |
| `aa7482b` / `6c5f144` / **`636b2d8` (tip)** | Fixes locais pós-auditoria (fleet short-link, Brent format, USD sem `R$`) |

**Target de produção:** `636b2d8` (`git rev-parse HEAD` deve bater após pull).

**Rollback imediato conhecido (pré-MI estável):** `de6ba73` — só se o pacote MI inteiro precisar ser desligado. Preferir rollback para o tip anterior ao pull se o pull já incluiu só estes commits.

---

## 0. Pré-requisitos no servidor

- PostgreSQL **≥ 15** (`ADD VALUE IF NOT EXISTS`).
- Path típico do app: `/opt/induscost` (ajustar se diferente).
- `DATABASE_URL` no `.env` de produção.
- `APP_UPLOADS_DIR` persistente (recomendado: `/var/lib/induscost/uploads`).
- Processo Node gerenciado por `systemd` / `pm2` / equivalente (ajustar nomes abaixo).
- Opcional: `BRENT_COMMODITY_SCHEDULER_ENABLED` (`false`/`0`/`off`/`no` desliga cron Brent).

---

## 1. Backup (OBRIGATÓRIO antes de migrate)

Ajustar nome do banco / usuário conforme o ambiente.

```bash
# Exemplo pg_dump (rodar como role com permissão de leitura)
TS=$(date +%Y%m%d_%H%M%S)
# Substituir: HOST, PORT, DBNAME, USER, DEST
pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -Fc -f "/var/backups/induscost/pre_mi_${TS}.dump"

# Conferir arquivo
ls -lh "/var/backups/induscost/pre_mi_${TS}.dump"
```

Opcional (código/artefato):

```bash
cd /opt/induscost
git rev-parse HEAD > "/var/backups/induscost/pre_mi_${TS}.gitsha"
tar -czf "/var/backups/induscost/pre_mi_${TS}_uploads.tgz" -C "$(dirname "${APP_UPLOADS_DIR:-./data/uploads}")" "$(basename "${APP_UPLOADS_DIR:-./data/uploads}")" 2>/dev/null || true
```

**GO parcial:** backup existe e `ls` mostra tamanho > 0.

---

## 2. Git

```bash
cd /opt/induscost
git fetch origin
git status
git rev-parse HEAD          # anotar SHA anterior (rollback)
git checkout main
git pull origin main
git rev-parse HEAD          # esperado: 636b2d8… (ou tip atual de origin/main se já avançou; deve incluir 04fbe8f…636b2d8)
git log --oneline -15
```

Confirmar presença na história:

```bash
git merge-base --is-ancestor 04fbe8f HEAD && echo "OK 04fbe8f"
git merge-base --is-ancestor 887f927 HEAD && echo "OK 887f927"
git merge-base --is-ancestor 79dd691 HEAD && echo "OK 79dd691"
git merge-base --is-ancestor bd0b565 HEAD && echo "OK bd0b565"
git merge-base --is-ancestor 636b2d8 HEAD && echo "OK 636b2d8"
```

---

## 3. Prisma

```bash
cd /opt/induscost
npx prisma validate
npx prisma migrate status
npx prisma migrate deploy
npx prisma generate
```

**Esperado:** as **13** migrations MI below aplicadas (ou já presentes, sem erro).

| Pasta | Objetivo |
|-------|----------|
| `20260714120000_material_market_monitoring` | Monitoramento em `Material` |
| `20260715120000_material_market_quotes` | Cotações |
| `20260716120000_commodity_snapshots` | Brent snapshots |
| `20260716130000_ptax_snapshots` | PTAX snapshots |
| `20260717120000_material_market_alerts` | Alertas |
| `20260717130000_material_market_quote_attachments` | Anexos + audit log |
| `20260718120000_material_market_alert_config` | Config alertas (+ seed GLOBAL) |
| `20260718125000_material_official_quote` | Cotação oficial |
| `20260718130000_material_quote_official_governance` | Governança + backfill |
| `20260719130000_material_quote_reliability_override` | Reliability override |
| `20260720120000_material_market_audit_events` | Audit events |
| `20260721120000_commodity_snapshot_scheduled_slot` | Slot Brent (+ troca de índice) |
| `20260721130000_material_market_purchase_link` | Vínculo compra |

Migrations são **aditivas**. Único `DROP` controlado: índice antigo de `CommoditySnapshot` (substituído).

---

## 4. Build

No servidor (após migrate/generate):

```bash
cd /opt/induscost
npm ci          # ou npm install se for o padrão do ambiente
npm run build
# Opcional (mais lento, recomendado se o host for a máquina de release):
# npm run build:safe
```

`build:safe` localmente já inclui: `check:frontend-server-imports` → `check:server-imports` → `test:market-intelligence` → `build` → `check:browser-bundle`.

---

## 5. Restart

Usar o gestor real do ambiente (exemplos):

```bash
# systemd
sudo systemctl restart induscost
sudo systemctl status induscost --no-pager

# ou pm2
# pm2 restart induscost
# pm2 status
```

**NO-GO imediato:** processo não sobe, ou reinicia em loop.

---

## 6. Logs

```bash
# systemd
sudo journalctl -u induscost -n 200 --no-pager
# acompanhar
# sudo journalctl -u induscost -f

# ou pm2
# pm2 logs induscost --lines 200
```

**Buscar e NÃO aceitar:**

- `does not provide an export named`
- `parseMaterialMarketAlertConfigPatch`
- `SyntaxError: The requested module`

**OK se aparecer:** `[brent-commodity-collection]` (job), startup sem SyntaxError de export.

---

## 7. Health check

```bash
curl -sS -o /tmp/induscost_health.json -w "%{http_code}\n" http://127.0.0.1:3000/api/health
# ou porta/host reais do reverse proxy
cat /tmp/induscost_health.json
```

Esperado: HTTP **200** e payload com status ok (padrão do app).

Smoke auth-gate (sem cookie = 401 é OK; crash/5xx de import NÃO):

```bash
BASE="${APP_BASE:-http://127.0.0.1:3000}"
for path in \
  "/api/materials/market-intelligence/monitored" \
  "/api/market-intelligence/commodities/brent/latest" \
  "/api/materials/market-intelligence/export"
do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE$path")
  echo "$code $path"
done
```

Esperado típico sem sessão: **401** (ou 403). **Não** deve derrubar o processo.

---

## 8. Validação SQL das migrations MI (só SELECT)

Rodar no PostgreSQL de produção **após** `migrate deploy` (ex.: `runuser -u postgres -- psql -d <DB> -P pager=off`).

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

-- 2) Tabelas-chave (esperado: 12 linhas)
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

-- 5) Commodity scheduledSlot / trigger
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
-- NÃO deve existir: CommoditySnapshot_commodityType_quoteDate_idx

-- 9) FKs MI
SELECT conname, conrelid::regclass AS from_table, confrelid::regclass AS to_table
FROM pg_constraint
WHERE contype = 'f'
  AND (
    conrelid::regclass::text LIKE '%MaterialMarket%'
    OR conrelid::regclass::text LIKE '%MaterialOfficialQuoteAudit%'
  )
ORDER BY 1;

-- 10) Contagens smoke (podem ser 0 em go-live frio)
SELECT 'MaterialMarketQuote' AS t, COUNT(*) FROM "MaterialMarketQuote"
UNION ALL SELECT 'CommoditySnapshot', COUNT(*) FROM "CommoditySnapshot"
UNION ALL SELECT 'PtaxSnapshot', COUNT(*) FROM "PtaxSnapshot"
UNION ALL SELECT 'MaterialMarketAlert', COUNT(*) FROM "MaterialMarketAlert"
UNION ALL SELECT 'MaterialMarketAuditEvent', COUNT(*) FROM "MaterialMarketAuditEvent"
UNION ALL SELECT 'MaterialMarketPurchaseLink', COUNT(*) FROM "MaterialMarketPurchaseLink";
```

---

## 9. Validação manual da tela (UAT autenticado)

Com usuário que tenha `materials.view` / `materials.edit` (e permissão de câmbio manual se testar override USD):

1. **Suprimentos** — catálogo abre; nav íntegra (sem regressão).
2. **Home MI** — Materiais → Inteligência de Mercado: lista/monitorados, KPIs (PTAX pode estar vazio sem job diário — não é crash).
3. **Lista monitoradas** — materias com flag de monitoramento.
4. **Tela 360** — abrir uma MP monitorada; seções carregam.
5. **Cotação BRL** — criar cotação; valor formatado em R$.
6. **Cotação USD** — criar; PTAX preview / path manual; valor **sem** prefixo R$ indevido.
7. **PTAX** — preview na cotação USD (BCB); falha → aviso, app não cai.
8. **Brent** — card/indicador na Home; opcional coleta manual.
9. **Gráfico histórico** — empty state ou série; sem erro de console grave.
10. **Simulação** — what-if responde.
11. **Alert-config** — salvar global e/ou material (rota canônica).
12. **Auditoria** — timeline/eventos após alteração.
13. **Exportação** — download/export sem 500.
14. **Anexo / confiabilidade** — se usado; gravar em `APP_UPLOADS_DIR`.

API úteis (autenticado):

- `GET /api/market-intelligence/commodities/brent/latest`
- `GET /api/materials/market-intelligence/monitored`
- Coleta manual Brent (edit): `POST /api/market-intelligence/commodities/brent/collect` ou `npm run collect:brent`

---

## 10. Critérios GO / NO-GO

### GO (todos obrigatórios)

- [ ] Backup DB feito e arquivo validado
- [ ] `git pull` no tip com ancestrais `04fbe8f` … `636b2d8`
- [ ] `prisma migrate deploy` sem erro; 13 migrations MI no `_prisma_migrations`
- [ ] Checklist SQL §8 OK (tabelas, enums, índices, seed GLOBAL)
- [ ] `prisma generate` + `npm run build` OK
- [ ] Restart OK; processo estável
- [ ] Logs **sem** `parseMaterialMarketAlertConfigPatch` / missing named export
- [ ] `/api/health` → 200
- [ ] Rotas MI sem sessão → 401/403 (não 502/crash)
- [ ] UAT §9: Home + 360 + 1 cotação + alert-config + 1 export sem tela quebrada
- [ ] Catálogo Suprimentos OK
- [ ] `APP_UPLOADS_DIR` gravável (se anexos forem usados)

### NO-GO (qualquer um)

- Processo não sobe ou loop de restart
- SyntaxError / named export no boot
- `migrate deploy` falhou ou migration órfã/duplicada
- Health ≠ 200
- UI MI branca / 500 em rotas autenticadas críticas
- Catálogo Suprimentos quebrado
- Backup não existe

**Ressalvas aceitáveis (não NO-GO sozinhas):**

- `PtaxSnapshot` vazio / KPI PTAX vazio (sem job diário dedicado nesta entrega)
- Brent never coletado → 404 no latest até primeira coleta
- Contagens de tabelas MI = 0 em go-live frio

---

## 11. Plano de rollback

### A) Só código (preferencial se migrate já rodou e schema é aditivo)

```bash
cd /opt/induscost
# SHA anotado no §2 ANTES do pull — ou last-known-good
git fetch origin
git checkout <SHA_ANTERIOR>
# Ex.: rollback total para pré-feature MI (só se necessário):
# git checkout de6ba73
npm ci
npx prisma generate
npm run build
# restart (systemd/pm2)
sudo systemctl restart induscost
curl -sS http://127.0.0.1:3000/api/health
```

Código antigo **ignora** tabelas MI novas; **não** dropar tabelas automaticamente.

### B) Schema / dados

- **Não** rodar migrate down automático.
- Restaurar dump só com plano DBA explícito:
  ```bash
  # EXEMPLO — só com autorização
  # pg_restore -h ... -d ... --clean --if-exists /var/backups/induscost/pre_mi_YYYYMMDD_HHMMSS.dump
  ```
- Uploads em `APP_UPLOADS_DIR`: **não apagar** no rollback de código.

### C) Kill-switch operacional

```bash
# Desligar coleta agendada Brent sem rollback de código
# No .env: BRENT_COMMODITY_SCHEDULER_ENABLED=false
# depois restart
```

---

## Variáveis / jobs (referência rápida)

| Item | Detalhe |
|------|---------|
| Brent schedule | 09:00 e 15:30 `America/Sao_Paulo`, in-process |
| Flag | `BRENT_COMMODITY_SCHEDULER_ENABLED` |
| PTAX cotação USD | BCB on-the-fly; fallback dias úteis; câmbio MANUAL com permissão |
| Anexos | `APP_UPLOADS_DIR` |

---

## O que o Cursor já validou localmente (não substitui UAT no servidor)

- Boot sem named-export fantasma (`04fbe8f`)
- `check:server-imports`, testes MI, smoke 401 das rotas, `build`
- Migrations auditadas como aditivas (`bd0b565`)
- UAT autenticado com dados reais: **pendente no servidor** (ops)

---

*Fim do checklist operacional. Executar somente no servidor.*
