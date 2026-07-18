# OP-79 — Runbook: implantação controlada do Fluxo de Pedidos

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | OP-79 |
| **Atualizado** | 2026-07-17 |
| **Ambiente alvo** | Servidor autorizado (`/opt/induscost` ou equivalente) |
| **Feature flag UI** | `COMMERCIAL_SALES_ORDER_FLOW_ENABLED` (fail closed) |
| **Migrations** | `20260801120000_sales_order_flow_lifecycle_snapshots` · `20260802120000_sales_order_flow_event_observed_at` |

> **Este documento descreve comandos para o servidor.** O Cursor / agentes locais **não** executam estes passos em produção e **não** possuem acesso ao banco de produção.

---

## Princípios

1. **Fontes oficiais não são alteradas** pelo Fluxo de Pedidos.  
   O rebuild/recompute grava apenas estruturas derivadas:
   - `SalesOrderItemFlowSnapshot`
   - `SalesOrderFlowSnapshot`
   - `SalesOrderFlowEvent`
   - (management operacional, se usado) `SalesOrderFlowManagement`  
   Não altera `SalesOrder`, `SalesOrderItem`, OP Nomus, documentos de saída, NF-e, CR ou fluxo de caixa.

2. **Snapshots são reconstruíveis.**  
   Podem ser apagados e regenerados via `rebuild:sales-order-flow` a partir da evidência local já sincronizada (motores OP-49…OP-54). Ver `rebuild-runbook.md`.

3. **Rollout com flag desligada.**  
   Deploy + migrate + rebuild ocorrem **antes** de expor o Kanban. A UI/API HTTP do Kanban permanece 404 enquanto `COMMERCIAL_SALES_ORDER_FLOW_ENABLED` não for `true`/`1`/`yes`/`on`/`enabled`.

4. **Janela planejada.** Backup + working tree limpa + sem rebuild concorrente.

Documentos irmãos:

- `rebuild-runbook.md` — preview/apply, lock, checkpoint
- `production-audit-runbook.md` — auditor read-only por pedido (OP-78)
- `performance-review.md` — metas e orçamentos de query (OP-75)

---

## Pré-requisitos

- SSH no host da aplicação
- Acesso ao PostgreSQL do ambiente (preferir usuário de deploy com backup recente)
- Permissão para `systemctl` / `pm2` restart
- SHA de release aprovado em `main` (ou tag)
- Pedidos piloto conhecidos (ex.: `PD 02596`)

Variáveis úteis no shell:

```bash
export INDUSCOST_APP_DIR=/opt/induscost
cd "$INDUSCOST_APP_DIR"
```

---

## Checklist numerado (ordem obrigatória)

### 1. Verificar processos ativos

Confirmar que não há rebuild apply, migrate ou deploy concorrente.

```bash
# Serviço da app
systemctl status induscost --no-pager
# ou: pm2 status

# Lock de rebuild (só existe durante --apply)
ls -la tmp/sales-order-flow-rebuild.lock 2>/dev/null || echo "sem lock de rebuild"

# Processos suspeitos
ps aux | egrep 'rebuildSalesOrderFlow|prisma migrate|tsx scripts/' | grep -v egrep || true
```

**Critério:** sem segundo apply do Fluxo; serviço em estado conhecido (active/running ou parado de propósito na janela).

---

### 2. Verificar working tree

```bash
cd "$INDUSCOST_APP_DIR"
git fetch origin
git status
git rev-parse HEAD
git rev-parse origin/main   # ou a tag/SHA liberada
```

**Critério:** working tree limpa (ou apenas arquivos locais esperados, ex. `.env`). Sem commits locais não autorizados.

---

### 3. Confirmar backup existente

Antes de migrate/apply, confirmar backup PostgreSQL **recente** (janela da release).

```bash
# Exemplo — ajustar path/política do ambiente
ls -lah /var/backups/postgresql/ | tail -n 20
# ou inventário do backup gerenciado (RDS / pgBackRest / etc.)
```

Registrar: horário do backup, identificador, responsável.

**Critério:** backup restaurável cobrindo o estado pré-migrate. Sem backup válido → **abortar**.

---

### 4. Atualizar código

```bash
cd "$INDUSCOST_APP_DIR"
git pull --ff-only origin main
# se a release for um SHA fixo:
# git checkout <SHA_LIBERADO>

npm ci
# (ou npm install se a política do servidor não usar ci)
```

**Critério:** `HEAD` = SHA liberado; `package-lock.json` respeitado.

---

### 5. Revisar migrations

```bash
npx prisma migrate status
ls prisma/migrations | egrep 'sales_order_flow'
```

Esperado na fila / já aplicadas conforme ambiente:

| Migration | Conteúdo |
|-----------|----------|
| `20260801120000_sales_order_flow_lifecycle_snapshots` | Tabelas de snapshot/evento (aditiva) |
| `20260802120000_sales_order_flow_event_observed_at` | Ajuste `observedAt` em eventos |

**Critério:** apenas migrations conhecidas; SQL aditivo; **nenhuma** alteração em colunas oficiais de pedido/item.

---

### 6. Aplicar migration

```bash
npx prisma migrate deploy
npx prisma migrate status
```

**Critério:** status “Database schema is up to date” (ou equivalente); sem erro de drift.

---

### 7. Gerar Prisma Client

```bash
npx prisma generate
npx prisma validate
```

**Critério:** generate + validate exit 0.

---

### 8. Build

```bash
npm run build
```

**Critério:** build exit 0. Warnings de chunk size são aceitáveis; falhas de módulo/Prisma não.

---

### 9. Restart

```bash
sudo systemctl restart induscost
# ou: pm2 restart induscost
```

Logs imediatos:

```bash
sudo journalctl -u induscost.service -n 80 --no-pager
# ou: pm2 logs induscost --lines 80 --nostream
```

**Critério:** serviço volta a `active` / online; sem crash loop.

---

### 10. Validar serviço

```bash
curl -I http://localhost:3000
# smoke autenticado (cookie de sessão):
# GET /api/auth/me  → 200
```

**Critério:** HTTP saudável; login possível; sem 5xx contínuos nos logs.

---

### 11. Manter feature flag desligada

Neste ponto o código e as tabelas já podem existir, mas a UI/API do Kanban **permanece oculta**.

```bash
# Confirmar ausência ou valor explícito false
grep -E '^COMMERCIAL_SALES_ORDER_FLOW_ENABLED=' .env || echo "flag ausente (fail closed = OFF)"

# Se estiver true por engano, desligar e reiniciar:
# sed / editor: COMMERCIAL_SALES_ORDER_FLOW_ENABLED=false
# sudo systemctl restart induscost
```

Smoke (flag OFF):

```bash
# Sem cookie ou com usuário autenticado — esperado 404 enquanto desligada
curl -s -o /dev/null -w "%{http_code}\n" \
  http://localhost:3000/api/commercial/sales-order-flow/summary
```

**Critério:** resposta **404** (não expor feature). Menu “Fluxo de Pedidos” ausente.

> Rebuild, migrations e hooks de recompute **não** dependem desta flag. Ela controla só exposição UI/rotas HTTP do Kanban (`salesOrderFlowFeatureFlags.ts`).

---

### 12. Executar rebuild preview

Sem escrita. Ver `rebuild-runbook.md`.

```bash
npm run rebuild:sales-order-flow -- --preview
# opcionalmente por janela:
# npm run rebuild:sales-order-flow -- --preview --from=2026-01-01 --to=2026-12-31
```

**Critério:** exit 0 ou relatório compreensível; **sem** lock/checkpoint avançado; `DATABASE_URL` nos logs só sanitizada se o script logar banco.

---

### 13. Validar contadores

Do resumo do preview, conferir:

| Contador | Uso |
|----------|-----|
| `ordersSelected` / `ordersProcessed` | Escopo coerente com a base |
| `created` / `updated` / `unchanged` | Expectativa de first-run vs reexecução |
| `errors` | Deve ser 0 antes do apply amplo |
| `durationMs` | Base para §17 |

**Critério:** erros isolados investigados; sem surpresa de volume (ex.: zero pedidos quando a base tem PDs).

---

### 14. Executar piloto por Pedido

Apply **apenas** em pedido(s) piloto.

```bash
npm run rebuild:sales-order-flow -- --preview --order="PD 02596"
npm run rebuild:sales-order-flow -- --apply --order="PD 02596"
```

**Critério:** `created` ou `updated` = 1 (ou `unchanged` se já materializado); exit 0; lock liberado ao final.

---

### 15. Auditar pedidos conhecidos

Auditor read-only (OP-78) — não escreve, não chama Nomus.

```bash
npm run audit:sales-order:flow -- --order="PD 02596"
# Artefatos default:
# docs/generated/sales-order-flow-audit-PD02596.json
# docs/generated/sales-order-flow-audit-PD02596.md
```

Conferir no relatório: estágio consolidado, gargalo, divergência cálculo×snapshot, inconsistências, management.

**Critério:** `divergence.hasDivergence=false` (ou `planReason=fingerprint_match`) no piloto; inconsistências explicáveis; exit 0.

Repetir para a lista de pedidos conhecidos da release.

---

### 16. Executar backfill completo

Somente após piloto e auditoria OK.

```bash
# Preview do universo alvo
npm run rebuild:sales-order-flow -- --preview --from=YYYY-MM-DD --to=YYYY-MM-DD

# Apply em lotes (default batch-size=50)
npm run rebuild:sales-order-flow -- --apply --from=YYYY-MM-DD --to=YYYY-MM-DD

# Em falha parcial (idempotente / retomável):
# npm run rebuild:sales-order-flow -- --apply --resume-from="PD 0xxxx"
```

Opcional: `--include-completed` se a política da release incluir `SHIPPED_COMPLETED`.

**Critério:** `errors=0` (ou lista residual documentada); segunda execução tende a `unchanged`; checkpoint coerente.

---

### 17. Medir desempenho

Com snapshots materializados e flag **ainda** OFF (ou ON só para operadores de teste), medir latências reais no servidor.

Metas de referência (`performance-review.md` / `salesOrderFlowPerformance.ts`):

| Superfície | Meta |
|------------|------|
| Resumo | ≤ 1 s |
| Carga inicial do Kanban | ≤ 2 s |
| Página adicional de coluna | ≤ 1 s |
| Detalhe | ≤ 2 s |

Sugestão (ajustar auth):

```bash
# Com sessão autenticada e permissão commercial.sales_orders.flow:view
# (após ativar flag no passo 18, ou via túnel interno de staging)

time curl -s -o /dev/null -w "%{time_total}\n" \
  -H "Cookie: <sessao>" \
  "http://localhost:3000/api/commercial/sales-order-flow/summary"

# Listagem por stage (exemplo)
time curl -s -o /dev/null -w "%{time_total}\n" \
  -H "Cookie: <sessao>" \
  "http://localhost:3000/api/commercial/sales-order-flow?stage=WAITING_PRODUCTION_ORDER&limit=20"
```

Registrar `durationMs` do rebuild apply completo e tempos HTTP. Se estourar meta, **não** ativar flag em produção até triagem (índices/EXPLAIN — ver OP-75).

---

### 18. Ativar feature flag

```bash
# Em .env (ou unit/env do systemd):
COMMERCIAL_SALES_ORDER_FLOW_ENABLED=true

sudo systemctl restart induscost
# ou: pm2 restart induscost
```

Valores aceitos: `1`, `true`, `yes`, `on`, `enabled` (case-insensitive). Ausente/outro = OFF.

Smoke:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Cookie: <sessao>" \
  http://localhost:3000/api/commercial/sales-order-flow/summary
# Esperado: 200 (com permissão) ou 403 (sem permissão) — não 404
```

**Critério:** rotas do Kanban deixam de retornar 404 por feature flag.

---

### 19. Validar permissões

Matriz OP-63 (amostra):

| Capacidade | Resource / action |
|------------|-------------------|
| Ver Kanban | `commercial.sales_orders.flow` / `view` |
| Valores | `commercial.sales_orders.flow_values` / `view` |
| Timeline | `commercial.sales_orders.flow.timeline` / `view` |
| Management | `commercial.sales_orders.flow_management` / `manage` |
| Rebuild HTTP | `commercial.sales_orders.flow_rebuild` / `execute` |
| Produção (drawer) | recurso de OP / `view` |
| Fiscal (drawer) | fatura/NF conforme matriz |

Checklist manual por persona:

- [ ] Usuário **com** `flow:view` → menu + resumo 200
- [ ] Usuário **sem** `flow:view` → menu ausente; API 403
- [ ] Usuário sem OP/fiscal → drawer sem dados irmãos (backend omite)
- [ ] Management/rebuild negados → 403 em PATCH/POST

Seed de permissões (se a release incluir novos resources): seguir runbook de permissões (`permissions:seed` / validate) **antes** deste passo, na mesma janela ou anterior.

---

### 20. Validar tela

Browser (aba anônima / hard refresh):

1. Login com persona comercial autorizada
2. Navegar para `/commercial/sales-order-flow`
3. Conferir colunas do Kanban, contadores do resumo, scroll vertical
4. Abrir detalhe de pedido piloto — estágio, gargalo, próxima ação, progressos
5. Timeline / management (se permissão)
6. Comparar 1–2 pedidos com saída do `audit:sales-order:flow`

**Critério:** UI utilizável; sem tela branca; dados alinhados ao auditor.

---

### 21. Critérios de rollback

| Camada | Ação | Efeito |
|--------|------|--------|
| **UI imediata** | `COMMERCIAL_SALES_ORDER_FLOW_ENABLED=false` + restart | Kanban some (404); dados oficiais intactos |
| **Código** | `git checkout` / revert para SHA estável + `npm ci` + `npm run build` + restart | Remove código novo; migrations aditivas podem permanecer |
| **Snapshots derivados** | Truncate/delete das tabelas de snapshot/evento **ou** re-rebuild | Fontes oficiais intactas; Kanban vazio até rebuild |
| **Migration problemática** | Restore backup pré-migrate (§3) | Último recurso; janela de manutenção |
| **Rebuild parcial ruim** | Reaplicar `--apply` (idempotente) ou `--resume-from` após correção | Fingerprint evita rewrite desnecessário |

**Não fazer no rollback do Fluxo:**

- apagar/alterar `SalesOrder` / `SalesOrderItem` / OP / DS / NF para “corrigir” o Kanban;
- dropar bags de permissão sem runbook de ACL;
- apontar Cursor com `DATABASE_URL` de produção.

**Critério de sucesso do rollback UI:** flag OFF → 404 nas rotas do fluxo; operação comercial restante inalterada.

---

## Ordem compacta (cola operacional)

```text
1  processos     → 2 git limpo → 3 backup OK
4  git pull + npm ci
5  migrate status → 6 migrate deploy → 7 prisma generate
8  npm run build → 9 restart → 10 curl serviço
11 flag OFF confirmada
12 rebuild --preview → 13 contadores
14 apply --order piloto → 15 audit:sales-order:flow
16 apply backfill → 17 medir latência
18 flag ON + restart → 19 permissões → 20 tela
21 rollback documentado / ensaiado (flag OFF)
```

---

## Variáveis de ambiente relevantes

| Variável | Papel | Default seguro |
|----------|-------|----------------|
| `COMMERCIAL_SALES_ORDER_FLOW_ENABLED` | Expõe UI/API Kanban | ausente = **OFF** |
| `SALES_ORDER_FLOW_RECOMPUTE_AFTER_SYNC` | Recompute pós-sync Nomus | `true` (operacional; independente da UI) |
| `SALES_ORDER_FLOW_REBUILD_LOCK_FILE` | Path do lock apply | `tmp/sales-order-flow-rebuild.lock` |
| `SALES_ORDER_FLOW_REBUILD_CHECKPOINT_FILE` | Checkpoint apply | `tmp/sales-order-flow-rebuild.checkpoint.json` |
| `DATABASE_URL` | Prisma | nunca logar senha |

---

## Restrições finais

- Não executar este runbook a partir do Cursor contra produção.
- Não ativar a feature flag antes do piloto + auditoria + backfill aceitos.
- Não tratar snapshot divergente com edição manual das tabelas oficiais — usar auditor + rebuild.
- Fontes oficiais permanecem a verdade operacional; o Fluxo é projeção reconstruível.
