# Rebuild oficial — OrderToCashAudit (Conciliação de Carteira)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Script TS** | `scripts/rebuildOrderToCashAudit.ts` |
| **Runner shell** | `scripts/runOrderToCashAuditRebuild.sh` |
| **Motor** | `src/lib/sales/orderToCashAuditBuilder.ts` |
| **Helpers CLI** | `src/lib/sales/orderToCashAuditRebuild.ts` |
| **Tabelas** | `OrderToCashAuditRun`, `OrderToCashAuditFact` |
| **Logs** | `/var/log/induscost/order-to-cash-audit` (fallback `/tmp/induscost-order-to-cash-audit`) |
| **Abas alimentadas** | Conciliação · Inteligência da Carteira · Auditoria Pedido → Caixa |

---

## Objetivo

Popular/atualizar a base **derivada, reconstruível e read-only** que as três abas da Conciliação de Carteira consomem (direto ou via adapter).

| Grava | Não grava / não altera |
|-------|------------------------|
| `OrderToCashAuditRun` | Fluxo de Caixa |
| `OrderToCashAuditFact` | Contas a Receber oficial (só lê) |
| | Comissões |
| | Relatório Presidencial |
| | SalesOrder / NF / Stock / syncs Nomus |

**Não chama Nomus.** Usa somente a base local já sincronizada.

---

## Quando rodar sync Nomus vs rebuild O2C

| Situação | Ação |
|----------|------|
| Pedidos/NFs/docs/CR desatualizados no IndusCost | Rodar **sync Nomus** dos módulos oficiais |
| Syncs ok, mas abas Conciliação/Inteligência/Auditoria desatualizadas | Rodar **rebuild OrderToCashAudit** |
| Só quer simular totais | `preview` (não grava) |
| Quer materializar nova run | `apply` (cria nova run + facts) |

O rebuild **não substitui** sync. Se a fonte local estiver velha, a run materializada também ficará velha.

---

## Ordem correta (oficial)

```text
1. sync Sales Orders
2. sync NFes
3. sync Stock Documents
4. sync Accounts Receivable
5. rebuild OrderToCashAudit preview
6. rebuild OrderToCashAudit apply
```

Exemplos de sync (runners existentes — **não** fazem parte deste script):

```bash
bash scripts/runNomusSalesOrdersSync.sh apply
bash scripts/runNomusNfesSync.sh apply
# stock documents: runner/comando oficial do ambiente
bash scripts/runNomusAccountsReceivableSync.sh apply
```

Em seguida o rebuild:

```bash
# Run geral (mesmo período da run de referência 41c2470a…)
bash scripts/runOrderToCashAuditRebuild.sh preview 2025-06-01 2026-12-31
bash scripts/runOrderToCashAuditRebuild.sh apply 2025-06-01 2026-12-31

# Britânia (cliente Nomus 200) + ano
bash scripts/runOrderToCashAuditRebuild.sh preview --customerExternalId 200 --year 2026
bash scripts/runOrderToCashAuditRebuild.sh apply --customerExternalId 200 --year 2026
```

Equivalente via npm / tsx:

```bash
npm run rebuild:order-to-cash-audit:preview -- --from 2025-06-01 --to 2026-12-31
npm run rebuild:order-to-cash-audit:apply -- --from 2025-06-01 --to 2026-12-31
```

---

## Parâmetros

| Flag / forma | Descrição |
|--------------|-----------|
| `preview` \| `apply` | Modo (obrigatório no runner) |
| `FROM TO` (posicional) | Atalho para `--from` / `--to` |
| `--from` / `--to` | Período `YYYY-MM-DD` (eixo default: emissão do pedido) |
| `--year` | Ano-calendário (alternativa a from/to) |
| `--customerExternalId` | Código Nomus do cliente (ex.: Britânia = `200`) |
| `--orderCode` | Pedido específico |
| `--salesOrderId` | UUID do pedido |
| `--dateAxis` | Eixo do período (default `ORDER_ISSUE_DATE`) |
| `--limit` | Limite de pedidos (smoke) |
| `--fail-if-sync-active` | Abort apply (exit `3`) se lock/IntegrationRun Nomus parecer ativo |
| `--help` | Ajuda CLI |

Env úteis:

| Variável | Efeito |
|----------|--------|
| `ORDER_TO_CASH_AUDIT_LOG_DIR` | Diretório de log (default `/var/log/induscost/order-to-cash-audit`) |
| `ORDER_TO_CASH_AUDIT_FAIL_IF_SYNC_ACTIVE=1` | Mesmo que `--fail-if-sync-active` |
| `INDUSCOST_APP_DIR` | Root da app no servidor (default `/opt/induscost`) |

---

## Segurança

1. **Não chama Nomus** — só lê tabelas locais.
2. **Antes do apply**, o script **avisa** se houver:
   - locks Nomus em `/tmp/induscost-nomus-*.lock`
   - `IntegrationRun` Nomus sem `finishedAt` com status RUNNING-like
   - outro `OrderToCashAuditRun` ainda `RUNNING`
3. Com `--fail-if-sync-active`, o apply **aborta** (exit `3`) em vez de só avisar.
4. O runner shell usa `flock` em `/tmp/induscost-order-to-cash-audit-rebuild.lock` (seguro para cron futuro; **cron ainda não configurado**).
5. Exit codes:
   - `0` — sucesso (preview ok ou apply `SUCCESS`)
   - `1` — erro real / apply `PARTIAL` ou `FAILED`
   - `2` — erro de CLI / modo inválido
   - `3` — sync ativo e `--fail-if-sync-active`
   - `0` com mensagem SKIPPED — outro rebuild O2C já segura o flock (idempotente para cron)

---

## Saída executiva

Preview e apply imprimem:

- `totalOrders`
- `totalFacts`
- `totalOrderValue`
- `totalAllocatedValue`
- `totalReceivableValue`
- `totalReceivedValue`
- `totalOpenValue`
- `totalBlockedValue`
- `orderToCashStageCounts`
- `alertCounts`

No apply: também `runId` e `status` (`SUCCESS` \| `PARTIAL` \| `FAILED`).

---

## Logs

```bash
# Preferencial
ls -lt /var/log/induscost/order-to-cash-audit/

# Fallback (se /var/log não for gravável)
ls -lt /tmp/induscost-order-to-cash-audit/

# Último log
tail -n 200 /var/log/induscost/order-to-cash-audit/rebuild_apply_*.log
```

Cada execução do runner gera `rebuild_<mode>_<UTC-stamp>.log` com stdout/stderr completo.

---

## Como validar run geral

1. Apply geral:

```bash
bash scripts/runOrderToCashAuditRebuild.sh apply 2025-06-01 2026-12-31
```

2. Conferir no log / console: `status=SUCCESS`, `totalOrders` / `totalFacts` coerentes.
3. Na UI **Financeiro → Conciliação de Carteira**:
   - aba **Conciliação**: sem filtro deve carregar a run geral O2C mais recente (`customerFilter` null);
   - meta da tela mostra **última run** + banner “Fonte: OrderToCashAudit”;
   - seletor de runs lista entradas `O2C · SUCCESS · …`.
4. Referência histórica (já criada): run `41c2470a-b685-4765-a954-77110fd8cf5c` — 1283 pedidos / 5860 facts.

---

## Como validar Britânia

```bash
bash scripts/runOrderToCashAuditRebuild.sh preview --customerExternalId 200 --year 2026
bash scripts/runOrderToCashAuditRebuild.sh apply --customerExternalId 200 --year 2026
```

Na UI:

| Aba | Como validar |
|-----|----------------|
| **Conciliação** | Filtro cliente `200` + ano `2026` — cards sem duplicar CR; pedidos Britânia coerentes |
| **Inteligência** | Mesmo cliente — board/maturidade a partir dos facts O2C |
| **Auditoria Pedido → Caixa** | `customerExternalId=200` + `year=2026` — run específica se existir; senão geral filtrada |

API smoke (Auditoria):

```text
GET /api/finance/portfolio-reconciliation/order-to-cash-audit?customerExternalId=200&year=2026&page=1&pageSize=50
```

---

## Qual run a tela está usando?

| Aba | Resolução |
|-----|-----------|
| **Conciliação** | Preferencial: último `OrderToCashAuditRun` SUCCESS com `customerFilter=null` (ou `runId` escolhido). Fallback: Portfolio legado. Meta na UI: id curto + data + banner O2C. |
| **Inteligência** | Mesma preferência O2C + adapter; banner `dataSource=order_to_cash_audit`. |
| **Auditoria** | Política: run específica (cliente+ano) → run geral → mensagem amigável sem run. Payload inclui `run.id` / meta. |

Runs antigas **não são apagadas** pelo apply — cada apply cria uma run nova. A UI usa a SUCCESS mais recente (geral) salvo se o usuário escolher outra no seletor.

---

## Cron (futuro)

O runner já é seguro para cron (`set -e`, flock, exit codes, logs).  
**Não configurar cron neste documento** — apenas deixar pronto. Sugestão futura (não ativa):

```cron
# Exemplo futuro — NÃO instalar ainda
# 30 3 * * * INDUSCOST_APP_DIR=/opt/induscost /opt/induscost/scripts/runOrderToCashAuditRebuild.sh apply 2025-06-01 2026-12-31 --fail-if-sync-active
```

---

## Relação com docs legados

- Detalhes técnicos do builder / PD 02339: `docs/sales/order-to-cash-audit-rebuild.md`
- Plano de fonte das abas: `docs/finance/portfolio-reconciliation-tabs-data-source-plan.md`

Este arquivo (`docs/finance/order-to-cash-audit-rebuild-official.md`) é o **procedimento operacional oficial** para popular a base das 3 abas.
