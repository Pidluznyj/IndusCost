# Central de Tesouraria — Validação Release Candidate

**Atualizado:** 2026-07-28  
**Escopo:** gates locais pré-release (Cursor **não** executa produção).  
**Companion:** `POST-DEPLOY-CHECKLIST.md`, `PRODUCTION-DEPLOYMENT.md`, `REQUIREMENTS-TRACEABILITY.md`.

---

## 1. Critérios de release candidate

| Critério | Esperado |
|----------|----------|
| Matriz R01–R30 | Sem `MISSING`; `PARTIAL` só com lacuna documentada |
| Money | DTOs/API string decimal; sem Float em regras |
| Timezone civil | Defaults America/Sao_Paulo (`todayTreasuryCivilDateInSaoPaulo`) |
| Exclusão | Soft cancel/reverse/version — sem DELETE físico de domínio |
| Divergência | Nunca inventar igualdade observado=calculado=conciliado |
| Prisma no FE | Zero imports `@prisma/client` em `src/components/finance/treasury` |
| Migrations | Aditivas; sem `db push` / reset em prod |
| Flags | Fail-closed (`treasury.*.enabled`) |
| Deploy | Scripts + runbook prontos; execução pelo ops |

---

## 2. Gates locais obrigatórios (RC)

Executar na raiz do repositório:

```bash
# Schema
set DATABASE_URL=postgresql://user:pass@localhost:5432/induscost_validate
npx prisma validate

# Isolamento FE ↔ server
npm run check:frontend-server-imports
npm run check:server-imports

# Suíte Tesouraria
npm run test:treasury

# Validação deploy (sem aplicar migrate)
npm run validate:treasury:deploy

# Bundle (após build)
npm run build
npm run check:browser-bundle
```

**Aceite RC:** todos PASS; `test:treasury` pode ter **1 skip** gated (`TREASURY_TEST_DATABASE_URL` ausente).

---

## 3. Auditoria final (Prompt 68) — achados e correções

| Achado | Severidade | Correção |
|--------|------------|----------|
| Relatório `daily-position` forçava calculated=reconciled=observed e divergence=0 | CRÍTICO | Calculado = observado + ledger ACTIVE; conciliado = OFX ledgerBalance persistido; divergência explícita |
| Repos de posição (movimentos oficiais / conciliado) retornavam `[]` stub | CRÍTICO | Ledger ACTIVE + saldo OFX em `summaryJson` |
| Defaults de data civil em UTC | ALTO | `todayTreasuryCivilDateInSaoPaulo` em schemas/UI/health gaps |
| Accept/unmatch sem client FE | MÉDIO | `treasuryReconciliationApi` + UI workspace |
| Update alert-settings sem audit | MÉDIO | `ALERT_SETTINGS` + `writeTreasuryAuditLog` |
| Health sem moduleEnabled/ACL e `ASSUMED_OK` | MÉDIO | Flag + `view` + probe Prisma real |
| Docs “DONE” contradizendo stubs | MÉDIO | Traceability + STATUS atualizados |

**Não bloqueantes (aceitáveis / documentados):**
- `TreasuryScaffoldPage` / queries scaffold (estrutura + testes)
- Cron catalog vazio (fila PostgreSQL cobre recálculo)
- 1 teste full-flow skip sem Postgres seguro
- UI `placeholder=` e mocks só em testes

---

## 4. Checklist funcional RC (homolog)

Ver classes A/B/C em `POST-DEPLOY-CHECKLIST.md`. Mínimo RC:

1. Flag OFF → rotas 404/403  
2. Conta → saldo → dashboard (camadas distintas)  
3. Expectativa CR sem mutar `dueDate`  
4. Projeção calculate/latest/compare  
5. OFX preview/apply idempotente + ledgerBalance no lote  
6. Accept + unmatch + reverse  
7. Fechamento + reabertura versionada  
8. Relatório daily-position com divergência não mascarada  
9. Audit list após mutação crítica  

---

## 5. Evidências esperadas no commit RC

- `docs/treasury/IMPLEMENTATION_STATUS.md` Prompt **68** `DONE`
- `docs/treasury/REQUIREMENTS-TRACEABILITY.md` alinhada
- Este arquivo
- Código das correções acima
- Gates §2 verdes (exceto skip gated)
