# Nomus — Contas a Pagar: agendamento e execução manual

Relatório da fase **NOMUS-AP-SCHEDULE-A** (rotina recorrente, execução manual e status).

## Contexto

A fundação de Contas a Pagar Nomus foi entregue na fase **NOMUS-AP-SYNC-A** (`NomusAccountsPayable`, script `nomusAccountsPayableSync.ts`, endpoint summary).

Esta fase adiciona:

- runner shell com lock dedicado;
- persistência em `IntegrationRun`;
- endpoints de status/execução manual no Admin;
- card UI isolado de Contas a Pagar;
- agendamento recomendado a cada 2 horas;
- testes de parsing/status.

## Rotina recorrente (a cada 2 horas)

### Script runner

```bash
/opt/induscost/scripts/runNomusAccountsPayableSync.sh apply
```

Características:

- Lock dedicado: `/tmp/induscost-nomus-accounts-payable.lock`
- Log runner: `/tmp/induscost-nomus-sync/runner-accounts-payable_apply_<stamp>.log`
- Define `NOMUS_AP_INCREMENTAL=1` → estratégia `full_refresh_upsert`
- Se lock ocupado: `SKIPPED`, `EXIT_CODE=0`, não inicia segunda execução
- Logs incluem `STARTED_AT`, `FINISHED_AT`, `EXIT_CODE`, métricas JSON do script TS

### Cron recomendado (servidor)

```cron
17 */2 * * * INDUSCOST_APP_DIR=/opt/induscost /opt/induscost/scripts/runNomusAccountsPayableSync.sh apply >> /var/log/induscost-nomus-ap-cron.log 2>&1
```

## Estratégia incremental adotada

**v1: sync recorrente completo controlado (`full_refresh_upsert`)**

Motivo: a API `contasPagar` no código atual não expõe filtro confiável por `dataModificacao`. A rotina recorrente:

1. Pagina todas as páginas (até limite de segurança `maxPages=200`);
2. Faz upsert local;
3. Atualiza `syncedAt` em registros inalterados (`payloadHash` igual);
4. **Não** apaga registros locais ausentes na API;
5. **Não** presume cancelamento sem evidência da API.

**TODO técnico:** quando a API Nomus confirmar filtros incrementais, evoluir para janela por `dataModificacao` ou equivalente.

## Execução manual (Admin)

1. Configurações → Logs de Sincronização Nomus
2. Card **Contas a Pagar Nomus**
3. Botão **Rodar Contas a Pagar agora**
4. Confirmar frase: `RODAR CONTAS A PAGAR NOMUS`
5. Acompanhar status no card e logs na tabela (filtro target: Contas a pagar)

Permissões:

- Status: `settings.nomus.view` ou `settings.view`
- Execução: `settings.nomus.sync` ou `settings.view`

## Consultar status

### API

- `GET /api/settings/nomus-sync/accounts-payable-status`
- `POST /api/settings/nomus-sync/accounts-payable-run` (409 se já estiver rodando)

### Campos principais

- `overallStatus`: RUNNING | SUCCESS | FAILED | STALE | SKIPPED | NOT_RUN_RECENTLY | IDLE
- `isActuallyRunning`: true somente com processo `pgrep` ou lock `flock` ativo
- `metrics`: pagesRead, recordsRead, mapped, created, updated, unchanged, errors
- `recommendedAction`: orientação em caso de falha/stale

### Saúde integrada

- `GET /api/integrations/nomus/health` inclui target `accounts-payable` (stale após 2h)

## Arquivos criados

| Arquivo | Papel |
|---------|--------|
| `scripts/runNomusAccountsPayableSync.sh` | Runner shell + lock + log |
| `src/lib/nomusAccountsPayableSyncConstants.ts` | Lock, script, stale MS |
| `src/lib/nomusAccountsPayableSyncLogParse.ts` | Parse log/status STALE/RUNNING |
| `src/lib/nomusAccountsPayableSyncStatusTypes.ts` | Tipos + labels UI |
| `src/lib/nomusAccountsPayableSyncRunner.ts` | Status service + start manual |
| `src/components/NomusAccountsPayableSyncCard.tsx` | Card Admin |
| `src/lib/nomusAccountsPayableSyncLogParse.test.ts` | Testes schedule |

## Validação no servidor

```bash
cd /opt/induscost
git pull origin main
npm ci
npx prisma validate
chmod +x scripts/runNomusAccountsPayableSync.sh

INDUSCOST_APP_DIR=/opt/induscost ./scripts/runNomusAccountsPayableSync.sh apply

curl -s -b cookies.txt https://<host>/api/settings/nomus-sync/accounts-payable-status | jq .
```

Conferir:

- último log em `/tmp/induscost-nomus-sync/runner-accounts-payable_apply_*.log`
- registro em `IntegrationRun` com `target = accounts-payable`
- cron `17 */2 * * *` registrado
