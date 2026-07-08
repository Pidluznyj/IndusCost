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
npm run test:brent-commodity
npx tsx --test src/lib/materialMarketPtax.test.ts src/lib/materialMarketQuoteExchange.test.ts src/lib/marketGlobalIndicators.test.ts
npm run build
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

| Migration | Conteúdo / segurança |
|-----------|----------------------|
| `20260714120000_material_market_monitoring` | Colunas em `Material` + enum — defaults seguros |
| `20260715120000_material_market_quotes` | Tabela `MaterialMarketQuote` (append-only) |
| `20260716120000_commodity_snapshots` | `CommoditySnapshot` |
| `20260716130000_ptax_snapshots` | `PtaxSnapshot` |
| `20260717120000_material_market_alerts` | `MaterialMarketAlert` + enums |
| `20260717130000_material_market_quote_attachments` | Anexos + audit log + reliability |
| `20260718120000_material_market_alert_config` | Config global/material + seed `GLOBAL` |
| `20260718125000_material_official_quote` | Flag oficial + partial unique + audit base |
| `20260718130000_material_quote_official_governance` | Status/aprovação + evolução da audit |
| `20260720120000_material_market_audit_events` | Trilha unificada de auditoria |
| `20260721120000_commodity_snapshot_scheduled_slot` | `scheduledSlot` + `trigger` (backfill) |
| `20260721130000_material_market_purchase_link` | Vínculo cotação↔compra + enum values |

**Nenhuma** migration deste módulo faz `DROP TABLE` / `TRUNCATE` de dados de produção. Único `DROP` controlado: índice antigo de commodity substituído por índice com `scheduledSlot`.

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
- [ ] `migrate deploy` OK (sem migration duplicada/órfã)
- [ ] `prisma generate` + app restart OK
- [ ] Smoke Brent + lista de monitorados OK
- [ ] `APP_UPLOADS_DIR` persistente e com espaço
- [ ] Equipe ciente do fallback PTAX manual e do flag `BRENT_COMMODITY_SCHEDULER_ENABLED`
