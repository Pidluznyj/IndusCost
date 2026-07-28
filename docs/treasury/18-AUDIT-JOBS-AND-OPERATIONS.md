# Auditoria, jobs, troubleshooting e operação

## 1. Auditoria

| Item | Detalhe |
|------|---------|
| Model | `TreasuryAuditLog` append-only |
| Writer | `writeTreasuryAuditLog` (TX-aware) |
| Helpers | `buildTreasuryCreatedAudit`, `Updated`, `Reversed`, … |
| Entity types | ACCOUNT, BALANCE_SNAPSHOT, LEDGER_ENTRY, TRANSFER, PROMISE, … (ver `treasuryAuditContracts.ts`) |
| API | `GET /api/finance/treasury/audit` |
| UI | `/finance/treasury/audit` |
| Permissão | `finance.treasury.audit` `view` |

Imutabilidade reforçada por trigger SQL na migration de audit.  
Update/delete de log são rejeitados no serviço.

## 2. Jobs / filas

| Job | Persistência | Entrada |
|-----|--------------|---------|
| Recálculo de projeção | `TreasuryProjectionRecalcJob` | eventos de domínio + sync Nomus |
| Worker | `runTreasuryProjectionRecalcWorker` | claim/lock/retry/dead |
| Backfill complementos | CLI checkpoint file | `backfill:treasury:title-complements:*` |

Não há cron dedicado obrigatório no módulo: o worker é função de serviço invocável pelo processo/host.  
Sync Nomus continua nos scripts/rotas já existentes do IndusCost.

## 3. Observabilidade

| Endpoint | Uso |
|----------|-----|
| `GET /api/health` | Saúde global app |
| `GET /api/finance/treasury/health` | Flag módulo + checks básicos |
| `GET /api/finance/treasury/availability` | Scaffold + enabled |
| Dashboard freshness | Fontes CR/CP/saldos/complementos |

Logs: `console.*` com prefixos de domínio; payloads OFX mascarados.

## 4. Backup

Antes de qualquer migrate/deploy:

1. Backup PostgreSQL completo (procedimento do ambiente).
2. Verificar restore point / retenção.
3. Registrar horário e responsável.
4. Só então `git pull` + `prisma migrate deploy`.

Cursor **não** executa backup.

## 5. Migration

```bash
# Produção (operador humano)
npx prisma migrate deploy
npx prisma generate
```

Proibido em produção: `prisma db push`, `prisma migrate dev`.  
Lista de migrations Tesouraria: [11-MODELS.md](./11-MODELS.md).

Validação dry-run (sem escrita):

```bash
npm run validate:treasury:deploy
```

## 6. Rollback

1. **Dados:** restaurar backup se migration/corrupção.
2. **Código:** checkout tag/commit anterior → `npm ci` → build → restart.
3. **Negócio:** não apagar histórico Tesouraria para esconder divergência; usar reopen/reverse/caveat.
4. Flags: desligar `TREASURY_MODULE_ENABLED` se necessário (fail-closed).

Detalhe de deploy: [DEPLOYMENT_RUNBOOK.md](./DEPLOYMENT_RUNBOOK.md).

## 7. Troubleshooting

| Sintoma | Verificações |
|---------|--------------|
| Nav Tesouraria some | Flag mestra OFF? Sem `finance.treasury` view? |
| 403 em rota | Resource/action; subflag; ACL da conta |
| 409 no fechamento | `sourceHash` mudou — refrescar preview |
| Projeção defasada | Fila `TreasuryProjectionRecalcJob` stuck/dead? Worker rodando? |
| OFX duplicado | Esperado — fingerprint; status DUPLICATE no preview |
| Divergência saldo | Posição (`balance-position`) — não “zerar” silenciosamente |
| Prisma no FE | Rodar `npm run check:frontend-server-imports` |
| Complementos faltando | Backfill preview/apply |

## 8. Suporte

| Papel | Responsabilidade |
|-------|------------------|
| Financeiro | Operação diária, cobrança, programação, fechamento |
| Tesoureiro | Contas, saldos, OFX, conciliação, transferências |
| Auditor | Consulta `/audit`, relatórios export |
| TI | Deploy, migrate, flags env, filas, restore |

Canal: processo interno da empresa (não há helpdesk embutido no módulo).

## 9. Operação diária do financeiro (resumo)

1. **Abrir o dia** — ver [GUIDE-DAY-OPENING.md](./manuals/GUIDE-DAY-OPENING.md).  
2. Atualizar saldos / conferir freshness no dashboard.  
3. Tratar CR (expectativa, promessa, cobrança) e CP (programação).  
4. Importar OFX e conciliar.  
5. Revisar exceções/alertas.  
6. Recalcular/consultar agenda e cenários.  
7. **Fechar o dia** — ver [GUIDE-DAY-CLOSING.md](./manuals/GUIDE-DAY-CLOSING.md).  
8. Exportar relatórios se necessário.

Manual completo: [USER-MANUAL.md](./manuals/USER-MANUAL.md).
