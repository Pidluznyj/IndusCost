# Coleta automática do Petróleo Brent

Este documento descreve a rotina oficial que atualiza a cotação do **Petróleo
Brent** exibida no header do sistema (Inteligência de Mercado / IndusCost).

## Agenda oficial

| Horário (America/Sao_Paulo) | Slot                | Cron equivalente         |
|-----------------------------|---------------------|--------------------------|
| **07:00**                   | `MORNING_EARLY`     | `0 7  * * 1-5`           |
| **11:00**                   | `MORNING_LATE`      | `0 11 * * 1-5`           |
| **14:00**                   | `AFTERNOON_EARLY`   | `0 14 * * 1-5`           |
| **16:00**                   | `AFTERNOON_LATE`    | `0 16 * * 1-5`           |

- **Timezone**: `America/Sao_Paulo` (aplicado via `Intl.DateTimeFormat`).
- **Dias úteis**: **sim** — segunda a sexta apenas. Em fins de semana o
  scheduler descarta o disparo e o header mantém a última cotação válida
  (nunca sobrescreve com "sem dado").
- **Regra oficial**: `BRENT_RUNS_ON_WEEKDAYS_ONLY = true` em
  `src/lib/brentCommodityJob.ts`.

Cron equivalente único (informativo — não usamos `node-cron`):

```
0 7,11,14,16 * * 1-5   # America/Sao_Paulo, dias úteis
```

## Como roda

- Engine: **`setInterval` de 60 s** dentro do processo Node do servidor
  (registro por efeito colateral em `registerBrentCommodityRoutes`).
- Não há duplicidade — o job tem uma única `startBrentCommodityScheduledJob`,
  guardada por `schedulerStarted` (idempotente).
- Cada slot só dispara uma vez por dia; a segunda chamada no mesmo minuto é
  descartada pelo `triggeredSlotKeys`.
- Habilitação: variável de ambiente `BRENT_COMMODITY_SCHEDULER_ENABLED`
  (default `true`; desabilitar com `false|0|off|no`).

## Rodar manualmente

Duas formas:

1. **CLI local**:
   ```powershell
   npm run collect:brent
   ```
   Chama `scripts/brentCommodityCollect.ts` → `collectBrentCommoditySnapshot({ trigger: "MANUAL" })`.

2. **Rota HTTP autenticada** (permissão `materials.edit`):
   ```
   POST /api/market-intelligence/commodities/brent/collect
   ```
   Também há a rota combinada Brent + PTAX:
   ```
   POST /api/market-intelligence/global-indicators/refresh
   ```

## Logs

Prefixo: `[brent-commodity-collection]`

| Evento                         | Formato exato                                                                |
|--------------------------------|-------------------------------------------------------------------------------|
| Registro do scheduler          | `registered job=brent-commodity-collection schedule=07:00, 11:00, 14:00, 16:00 tz=America/Sao_Paulo weekdaysOnly=true` |
| Scheduler desabilitado por env | `scheduler disabled via BRENT_COMMODITY_SCHEDULER_ENABLED`                    |
| Início do disparo agendado     | `update started at=<YYYY-MM-DD>T<HH>:<MM> tz=America/Sao_Paulo slot=<SLOT>`   |
| Fim do disparo agendado        | `update finished slot=<SLOT> action=<created\|skipped> durationMs=<n>`        |
| Fim de semana ignorado         | `skipped weekend at=<YYYY-MM-DD>T<HH>:<MM> tz=America/Sao_Paulo slot=<SLOT>`  |
| Cotação já registrada          | `skip trigger=<T> existing=<snapshotId>`                                      |
| Falha da API                   | `failure: <mensagem>`                                                         |
| Crash inesperado               | `scheduled job crashed: <error>`                                              |

Logs vão para `stdout/stderr` do processo Node — nenhum segredo/API key é
logado (Yahoo Finance não requer chave).

## O que acontece se a API não retornar cotação nova

- **Yahoo Finance indisponível**: um snapshot com `status = "FAILED"` é
  gravado no banco (append-only) e o `errorMessage` preservado; o header
  segue mostrando a **última cotação `SUCCESS`** (`getLatestBrentSnapshot`
  filtra por `status: "SUCCESS"` primeiro).
- **Fim de semana / dia sem cotação**: nenhum snapshot é criado. O header
  continua mostrando a última cotação válida.
- **Slot repetido no mesmo dia**: o `collect` detecta o `existing` snapshot
  daquele slot e retorna `action: "skipped"` sem sobrescrever.

## PTAX preservado

O PTAX (BCB) **não** foi migrado junto — sua agenda continua sendo
**09:00 e 15:30** todos os dias (schema, resolver e log próprios em
`src/lib/ptaxSnapshotJob.ts`). As duas cotações continuam saindo em
`GET /api/market-intelligence/global-indicators` para o header.

## Arquivos relevantes

| Item                             | Caminho                                                          |
|----------------------------------|------------------------------------------------------------------|
| Agenda oficial do Brent          | `src/lib/brentCommodityJob.ts`                                   |
| Coleta (fetch + persistência)    | `src/lib/brentCommodityCollection.ts`                            |
| Fetch Yahoo Finance              | `src/lib/brentCommodityService.ts`                               |
| Rotas HTTP + boot do scheduler   | `src/lib/brentCommodityRoutes.ts`                                |
| Job PTAX (independente)          | `src/lib/ptaxSnapshotJob.ts`                                     |
| Migration nova (enum expandido)  | `prisma/migrations/20260722140000_commodity_slot_expand_brent_schedule` |
| Diagnóstico                      | `tmp-audits/inspect-brent-update-schedule.ts`                    |
| QA estático + runtime            | `scripts/qaMarketIndicatorsSchedule.ts`                          |
| Testes unitários                 | `src/lib/brentCommodityCollection.test.ts`, `src/lib/ptaxSnapshotCollection.test.ts` |

## QA / diagnóstico

- **QA**: `npx tsx scripts/qaMarketIndicatorsSchedule.ts`
  Valida horários, timezone, dias úteis, ausência de duplicidade e que o
  PTAX foi preservado.
- **Diagnóstico local**: `npx tsx tmp-audits/inspect-brent-update-schedule.ts`
  Imprime o job encontrado, cron expression, timezone, próximos horários
  esperados no Brasil e resumo PTAX.

## Não alterado por esta rotina

- Fluxo de Caixa, Contas a Receber, Comissões, Relatório Presidencial,
  Pedidos de Venda: **nada** foi tocado.
- Header layout: nada. Apenas a cadência do fetch mudou.
- Cálculo de PTAX: preservado.
