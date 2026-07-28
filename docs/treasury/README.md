# Central de Tesouraria — Documentação

**Módulo:** IndusCost Financeiro → Central de Tesouraria  
**Base de código:** `src/lib/treasury/**`, `src/components/finance/treasury/**`  
**UI:** `/finance/treasury/*`  
**API:** `/api/finance/treasury/*`  
**Atualizado:** 2026-07-28

## Índice

### Planejamento e status
| Documento | Conteúdo |
|-----------|----------|
| [01-DISCOVERY.md](./01-DISCOVERY.md) | Auditoria inicial do repositório |
| [02-REQUIREMENTS-MAPPING.md](./02-REQUIREMENTS-MAPPING.md) | Mapeamento de requisitos |
| [03-IMPLEMENTATION-PLAN.md](./03-IMPLEMENTATION-PLAN.md) | Plano sequencial de prompts |
| [04-BASELINE.md](./04-BASELINE.md) | Baseline técnico / branch |
| [05-OFFICIAL-AR-AP-ADAPTER.md](./05-OFFICIAL-AR-AP-ADAPTER.md) | Adapter read-only Nomus CR/CP |
| [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) | Status por prompt |
| [FINAL-DELIVERY-REPORT.md](./FINAL-DELIVERY-REPORT.md) | Relatório final de entrega (Prompt 69) |
| [REQUIREMENTS-TRACEABILITY.md](./REQUIREMENTS-TRACEABILITY.md) | Matriz R01–R30 |
| [RELEASE-CANDIDATE-VALIDATION.md](./RELEASE-CANDIDATE-VALIDATION.md) | Gates e critérios RC (Prompt 68) |
| [PERFORMANCE_BENCHMARKS.md](./PERFORMANCE_BENCHMARKS.md) | Benchmarks de performance |
| [DEPLOYMENT_RUNBOOK.md](./DEPLOYMENT_RUNBOOK.md) | Resumo de implantação (usuário) |
| [PRODUCTION-DEPLOYMENT.md](./PRODUCTION-DEPLOYMENT.md) | Runbook completo de produção + scripts |
| [POST-DEPLOY-CHECKLIST.md](./POST-DEPLOY-CHECKLIST.md) | Validação funcional pós-deploy (A/B/C) |
| [ROLLBACK.md](./ROLLBACK.md) | Rollback seguro em produção |

### Documentação técnica (esta entrega)
| Documento | Conteúdo |
|-----------|----------|
| [10-ARCHITECTURE.md](./10-ARCHITECTURE.md) | Arquitetura e fronteiras |
| [11-MODELS.md](./11-MODELS.md) | Models e enums Prisma |
| [12-BUSINESS-RULES.md](./12-BUSINESS-RULES.md) | Regras de negócio |
| [13-APIS.md](./13-APIS.md) | Catálogo de APIs |
| [14-PERMISSIONS-AND-FEATURE-FLAGS.md](./14-PERMISSIONS-AND-FEATURE-FLAGS.md) | Permissões e flags |
| [15-PROJECTION-AND-DOUBLE-COUNTING.md](./15-PROJECTION-AND-DOUBLE-COUNTING.md) | Projeção e anti-dupla contagem |
| [16-DAILY-CLOSING.md](./16-DAILY-CLOSING.md) | Fechamento diário |
| [17-OFX-AND-RECONCILIATION.md](./17-OFX-AND-RECONCILIATION.md) | OFX e conciliação bancária |
| [18-AUDIT-JOBS-AND-OPERATIONS.md](./18-AUDIT-JOBS-AND-OPERATIONS.md) | Auditoria, jobs, backup, migration, rollback, suporte, operação |
| [19-ROLLOUT.md](./19-ROLLOUT.md) | Rollout progressivo e ordem de ativação |

### Manuais e guias
| Documento | Público |
|-----------|---------|
| [manuals/USER-MANUAL.md](./manuals/USER-MANUAL.md) | Usuário financeiro |
| [manuals/GUIDE-DAY-OPENING.md](./manuals/GUIDE-DAY-OPENING.md) | Abertura do dia |
| [manuals/GUIDE-DAY-CLOSING.md](./manuals/GUIDE-DAY-CLOSING.md) | Fechamento do dia |
| [manuals/GUIDE-COLLECTION.md](./manuals/GUIDE-COLLECTION.md) | Cobrança / CR operacional |
| [manuals/GUIDE-RECONCILIATION.md](./manuals/GUIDE-RECONCILIATION.md) | Conciliação bancária |

## Princípios fixos

1. Nomus é a fonte oficial dos títulos CR/CP.
2. Tesouraria guarda apenas complementos operacionais e dados bancários locais.
3. Nunca substituir `dueDate` oficial por expectativa/promessa/programação.
4. Valores críticos em Decimal / DTO string; fuso `America/Sao_Paulo`.
5. Sem exclusão física de histórico financeiro (cancelar / reverter / versionar).
6. Cursor não executa deploy, backup nem migrate em produção.

## Contato de operação

Operação diária: time financeiro.  
Implantação/servidor: time TI (ver [DEPLOYMENT_RUNBOOK.md](./DEPLOYMENT_RUNBOOK.md)).
