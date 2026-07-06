# Nomus — Contas a Receber: agendamento e execução manual

Relatório da fase **NOMUS-AR-SCHEDULE-A** (rotina incremental/recorrente, execução manual e status).

## Contexto

A fundação de Contas a Receber Nomus foi entregue no commit `65168fd` (modelo `NomusAccountsReceivable`, script `nomusAccountsReceivableSync.ts`, carga inicial validada com 5718 registros).

Esta fase adiciona:

- runner shell com lock dedicado;
- persistência em `IntegrationRun`;
- endpoints de status/execução manual no Admin;
- card UI isolado de Contas a Receber;
- agendamento recomendado a cada 2 horas;
- testes de parsing/status.

## Carga inicial (já validada)

```bash
cd /opt/induscost
npm run sync:nomus:accounts-receivable:apply
```

- Modo: `full_initial_or_manual` (sem `NOMUS_AR_INCREMENTAL=1`)
- Upsert por `externalId` + `payloadHash`
- Não remove registros locais ausentes na API

## Rotina recorrente (a cada 2 horas)

### Script runner

```bash
/opt/induscost/scripts/runNomusAccountsReceivableSync.sh apply
```

Características:

- Lock dedicado: `/tmp/induscost-nomus-accounts-receivable.lock` (não compete com rotina diária nem pedidos)
- Log runner: `/tmp/induscost-nomus-sync/runner-accounts-receivable_apply_<stamp>.log`
- Define `NOMUS_AR_INCREMENTAL=1` → estratégia `full_refresh_upsert`
- Se lock ocupado: `SKIPPED`, `EXIT_CODE=0`, não inicia segunda execução
- Logs incluem `STARTED_AT`, `FINISHED_AT`, `EXIT_CODE`, métricas JSON do script TS

### Cron recomendado (servidor)

Alinhado ao padrão de pedidos (minuto 17), deslocado para evitar colisão:

```cron
17 */2 * * * INDUSCOST_APP_DIR=/opt/induscost /opt/induscost/scripts/runNomusAccountsReceivableSync.sh apply >> /var/log/induscost-nomus-ar-cron.log 2>&1
```

> Ajuste o caminho de log conforme política do ambiente. O runner já grava log estruturado em `NOMUS_SYNC_LOG_DIR`.

## Estratégia incremental adotada

**v1: sync recorrente completo controlado (`full_refresh_upsert`)**

Motivo: a API `contasReceber` no código atual não expõe filtro confiável por data de modificação/vencimento/baixa. A rotina recorrente:

1. Pagina todas as páginas (até limite de segurança `maxPages=200`);
2. Faz upsert local;
3. Atualiza `syncedAt` em registros inalterados (`payloadHash` igual);
4. **Não** apaga registros locais ausentes na API;
5. **Não** presume cancelamento sem evidência da API.

**TODO técnico:** quando a API Nomus confirmar filtros incrementais, evoluir para janela por `dataModificacao` ou equivalente.

## Execução manual (Admin)

1. Configurações → Logs de Sincronização Nomus
2. Card **Contas a Receber Nomus**
3. Botão **Rodar Contas a Receber agora**
4. Confirmar frase: `RODAR CONTAS A RECEBER NOMUS`
5. Acompanhar status no card e logs na tabela (filtro target: Contas a receber)

Permissões:

- Status: `settings.nomus.view` ou `settings.view`
- Execução: `settings.nomus.sync` ou `settings.view`

## Consultar status

### API

- `GET /api/settings/nomus-sync/accounts-receivable-status`
- `POST /api/settings/nomus-sync/accounts-receivable-run`

### Campos principais

- `overallStatus`: RUNNING | SUCCESS | FAILED | STALE | SKIPPED | NOT_RUN_RECENTLY | IDLE
- `isActuallyRunning`: true somente com processo `pgrep` ou lock `flock` ativo
- `metrics`: pagesRead, recordsRead, mapped, created, updated, unchanged, errors
- `recommendedAction`: orientação em caso de falha/stale

### Saúde integrada

- `GET /api/integrations/nomus/health` inclui target `accounts-receivable` (stale após 2h)

## Arquivos alterados / criados

| Arquivo | Papel |
|---------|--------|
| `scripts/runNomusAccountsReceivableSync.sh` | Runner shell + lock + log |
| `scripts/nomusAccountsReceivableSync.ts` | IntegrationRun + incremental flag |
| `src/lib/nomusAccountsReceivableSyncConstants.ts` | Lock, script, stale MS |
| `src/lib/nomusAccountsReceivableSyncLogParse.ts` | Parse log/status STALE/RUNNING |
| `src/lib/nomusAccountsReceivableSyncStatusTypes.ts` | Tipos + labels UI |
| `src/lib/nomusAccountsReceivableSyncRunner.ts` | Status service + start manual |
| `src/lib/nomusAccountsReceivableIntegrationRun.ts` | Persist IntegrationRun |
| `src/lib/nomusAccountsReceivableSyncLogic.ts` | CLI incremental/syncStrategy |
| `src/components/NomusAccountsReceivableSyncCard.tsx` | Card Admin |
| `src/components/SettingsModule.tsx` | Wiring UI |
| `server.ts` | Endpoints + health target + parse logs AR |
| `src/lib/nomusAccountsReceivableSyncLogParse.test.ts` | Testes schedule |
| `package.json` | Script de teste estendido |

### Referências de padrão existente

- Rotina diária: `runNomusDailySync.sh`, `nomusDailySyncRunner.ts`, `NomusDailySyncCard.tsx`
- Pedidos 2h: `runNomusSalesOrdersSync.sh` (lock global, sem botão manual)
- Status/log: `nomusDailySyncLogParse.ts`, endpoints `daily-status` / `daily-run`

## Validação no servidor

```bash
cd /opt/induscost
git pull origin main
npm ci
npx prisma validate
npx prisma generate
chmod +x scripts/runNomusAccountsReceivableSync.sh

# Teste manual do runner
INDUSCOST_APP_DIR=/opt/induscost ./scripts/runNomusAccountsReceivableSync.sh apply

# Conferir lock (deve estar livre após término)
flock -n /tmp/induscost-nomus-accounts-receivable.lock -c true && echo "lock livre"

# Status via API (autenticado)
curl -s -b cookies.txt https://<host>/api/settings/nomus-sync/accounts-receivable-status | jq .

# Reiniciar app
sudo systemctl restart induscost   # ou comando equivalente do ambiente
```

Conferir:

- último log em `/tmp/induscost-nomus-sync/runner-accounts-receivable_apply_*.log`
- registro em `IntegrationRun` com `target = accounts-receivable`
- card Admin atualiza sem ficar preso em «Rodando» após término

## Comandos testados localmente

```bash
npx prisma validate
npm run test:nomus:accounts-receivable
npm run test:nomus:daily-sync
npm run lint
npm run build
```

## Limitações conhecidas

1. Incremental v1 = full refresh upsert (ver estratégia acima).
2. Cron não é instalado automaticamente pelo repositório — configurar no servidor.
3. Em Windows dev, `pgrep`/`flock` não detectam processo; status RUNNING depende de ambiente Linux no servidor.
