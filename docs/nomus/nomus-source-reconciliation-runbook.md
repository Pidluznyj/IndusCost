# SYNC-10 — Runbook de produção: reconciliação CRUD Nomus

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | SYNC-10 (atualiza SYNC-08) |
| **Pré-requisitos** | SYNC-01…09 |
| **Atualizado** | 2026-07-17 |
| **Produção** | Cursor **não** tem acesso ao banco de produção — executar no host autorizado |
| **RC** | Sem deploy pelo agente · sem apply real nesta validação · ativação gradual |

---

## Checklist

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Todos os modos possuem preview? | **Sim** — backfill e reconcile SO/AR/AP |
| 2 | Ausências exigem payload completo? | **Sim** — `SUCCESS` + `payloadComplete` + flag |
| 3 | Entidades independentes? | **Sim** — Pedido ≠ CR ≠ CP |
| 4 | Kill switch por entidade? | **Sim** — fail-closed |
| 5 | Rollback operacional? | **Sim** — ver seção Rollback |

---

## Flags (fail-closed)

Ausência / lifecycle de reconciliação:

```bash
NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENABLED=0
NOMUS_SOURCE_RECONCILE_AR_ENABLED=0
NOMUS_SOURCE_RECONCILE_AP_ENABLED=0
```

Exclusão operacional de `MISSING_CONFIRMED` (SYNC-07):

```bash
NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENABLED=0
NOMUS_OPS_EXCLUDE_MISSING_AR_ENABLED=0
NOMUS_OPS_EXCLUDE_MISSING_AP_ENABLED=0
```

Valores que ligam: `1` | `true` | `yes` | `on` | `enabled`. Qualquer outro / ausente = **off**.

---

## Comandos de preview (sem escrita)

```bash
# Backfill inicial (não declara ausência)
npm run backfill:nomus:lifecycle:preview -- --entity=all

# Pedidos
npm run reconcile:nomus:sales-orders -- preview
npm run reconcile:nomus:sales-orders -- preview --orderCode="PD 02739"

# Contas a Receber (independente do Pedido)
npm run reconcile:nomus:accounts-receivable -- preview
npm run reconcile:nomus:accounts-receivable -- preview --externalId=17748

# Contas a Pagar
npm run reconcile:nomus:accounts-payable -- preview
```

Apply (somente no host autorizado, após preview):

```bash
npm run backfill:nomus:lifecycle:apply -- --entity=all --batch-size=200
npm run reconcile:nomus:sales-orders -- apply --confirm-candidates ...
npm run reconcile:nomus:accounts-receivable -- apply ...
npm run reconcile:nomus:accounts-payable -- apply ...
```

Flags CLI comuns: `--externalId`, `--orderCode` (Pedidos), `--from` / `--to`, `--batch-size`, `--confirm-candidates`, `--explain`, `--json` / `--csv`, `--resume-cursor`.

---

## Sequência obrigatória em produção (21 passos)

1. **Verificar processos de escrita** — confirmar que syncers diários/manuais e locks não conflitam com o piloto; não iniciar apply paralelo no mesmo universo.
2. **Backup do banco** — snapshot/restore point antes de migration e de qualquer apply.
3. **Registrar commit** — anotar o hash do release candidate (SYNC-10) no ticket de mudança.
4. **Deploy com flags desligadas** — publicar código com todos os kill switches e `NOMUS_OPS_EXCLUDE_MISSING_*` em off.
5. **Aplicar migration** — `prisma/migrations/20260803120000_nomus_source_lifecycle_contract` (aditiva).
6. **Validar schema** — `npx prisma validate` + checar enums/colunas `sourcePresenceStatus` / `NomusSourceSyncRun`.
7. **Executar backfill inicial** — preview → apply (`PRESENT`, timestamps seguros; **não** declara ausência).
8. **Preview de Pedidos** — `reconcile:nomus:sales-orders -- preview` na janela do piloto; revisar completude.
9. **Piloto PD 02739** — preview direcionado (`--orderCode="PD 02739"`); só avançar se payload COMPLETE.
10. **Ativar lifecycle de Pedidos** — ligar `NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENABLED` e apply controlado.
11. **Validar consumidores** — gestão/CRM/flow ainda tratam `MISSING_CANDIDATE` como operacional; confirmados só saem com flag ops.
12. **Preview de CR** — `reconcile:nomus:accounts-receivable -- preview` (universo próprio).
13. **Consultar CR 17748 de forma independente** — `--externalId=17748`; **não** inferir do estado do Pedido.
14. **Ativar lifecycle de CR** — `NOMUS_SOURCE_RECONCILE_AR_ENABLED` + apply se COMPLETE.
15. **Preview de CP** — `reconcile:nomus:accounts-payable -- preview`; eixo = Data de Vencimento.
16. **Piloto de CP** — escolher título `PRESENT` aberto no preview (sem presumir ausência).
17. **Ativar lifecycle de CP** — `NOMUS_SOURCE_RECONCILE_AP_ENABLED` + apply controlado.
18. **Validar Fluxo de Caixa** — com/sem `NOMUS_OPS_EXCLUDE_MISSING_AP_ENABLED` / AR conforme plano.
19. **Validar Comissões** — históricos e apurações não dependem de delete físico; presença ops só após flags.
20. **Validar relatórios** — portfolio / order-to-cash / executivo; filtros de presença indexados.
21. **Acompanhar runs** — Settings → Observabilidade NomusSourceSyncRun (SYNC-09): métricas, alertas, drilldown.

Ligar `NOMUS_OPS_EXCLUDE_MISSING_*` **somente** depois dos passos 11/18–20 estáveis.

---

## Rollback operacional

1. **Desligar flags** — ausência (`NOMUS_SOURCE_RECONCILE_*`) e exclusão ops (`NOMUS_OPS_EXCLUDE_MISSING_*`).
2. **Preservar lifecycle registrado** — não limpar `sourcePresenceStatus` / timestamps; histórico permanece.
3. **Restaurar código anterior**, se necessário — redeploy do commit pré-RC.
4. **Restaurar banco somente como último recurso** — só se migration/dados tiverem sido corrompidos; preferir flags off.

---

## Migration

| Item | Path |
|------|------|
| Migration | `prisma/migrations/20260803120000_nomus_source_lifecycle_contract/migration.sql` |
| Índices | `sourcePresenceStatus`, `lastSeenAt`, `lastSyncRunId`, runs por entidade/status |
| FK | `lastSyncRunId` → `NomusSourceSyncRun` **ON DELETE SET NULL** (não apaga SO/AR/CP) |

---

## Pilotos

| Entidade | Piloto | Nota |
|----------|--------|------|
| Pedidos | **PD 02739** (`externalSalesOrderId` 2737) | OP-81 / SYNC-04 |
| CR | **externalId 17748** | Independente do Pedido |
| CP | Título `PRESENT` aberto do preview | Sem presumir ausência |

---

## Código de referência

| Peça | Path |
|------|------|
| RC / matriz | `src/lib/nomus/nomusCrudReconciliationReleaseCandidate.ts` |
| Doc RC | `docs/nomus/nomus-crud-reconciliation-release-candidate.md` |
| Engine | `src/lib/nomus/nomusSourceReconciliationEngine.ts` |
| Observabilidade | Settings → NomusSourceSyncRun (SYNC-09) |
