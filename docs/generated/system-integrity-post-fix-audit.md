# Auditoria Pós-Correção de Integridade — IndusCost

**Data:** 2026-06-05  
**Commit implementação:** `5f81337` (`fix(system): resolve prioritized integrity inconsistencies`)  
**Commit auditoria:** _(preenchido após commit deste documento)_  
**Metodologia:** validação técnica (lint/build/testes) + `npm run audit:system-integrity` + inspeção manual de código pós-fix

---

## 1. Resumo

### Itens corrigidos nesta onda

| Grupo | IDs | Situação pós-fix |
|-------|-----|------------------|
| Frota — status operacional | INT-001, INT-013, INT-038 | **Resolvido** nos fluxos uso/reserva |
| Frota — writers competindo | INT-004 | **Parcial** — uso/reserva unificados; manutenção/financeiro ainda têm writes pontuais |
| Permissões UI↔API | INT-008, INT-009, INT-010 | **Resolvido** |
| Nomus apply-preview | INT-005 | **Resolvido** nas rotas API; **parcial** em scripts CLI sem resolver |

### Itens ainda pendentes

| IDs | Motivo |
|-----|--------|
| INT-002, INT-003 | Exigem decisão humana (aliases `costs.view` / `dashboard.view`) |
| INT-015 | Exigem decisão humana (`/api/test-db`) |
| INT-006–007, INT-011–014, INT-016–046 | Fora do escopo da onda anterior (plan §2.2) |

### Novos achados

| ID | Severidade | Descrição |
|----|------------|-----------|
| **POST-001** | Baixa | Script `systemIntegrityAudit.ts` (SYS-005/SYS-006) usa heurísticas desatualizadas — gera falsos positivos pós-fix |
| **POST-002** | Baixa | `CHECKIN_PENDING_BLOCK` em `fleetUsageOps.ts` ainda grava `BLOCKED` direto para pendência manual (recalc não modela) — comportamento intencional documentado |

**Nenhuma inconsistência crítica nova** que exija implementação imediata neste ciclo.

### Risco residual

| Risco | Nível | Nota |
|-------|-------|------|
| Aliases INT-002/003 | Médio | Menu abre módulos que API nega (403) |
| `/api/test-db` INT-015 | Médio | Superfície sem auth |
| Scripts Nomus CLI sem snapshot | Baixo | API alinhada; smoke scripts podem divergir |
| Writers frota em maintenance/finance | Baixo | Caminhos legados; cancel/complete já usam recalc |

---

## 2. Comparativo antes x depois

| ID anterior | Status | Evidência da resolução | Arquivos alterados | Teste associado |
|-------------|--------|------------------------|-------------------|-----------------|
| **INT-001** | **Resolvido** | Checkin atualiza só `currentKm` na tx; `recalculateVehicleOperationalStatus` após `applyCriticalChecklistOnCheckin` | `fleetUsageOps.ts` | `fleetVehicleStatusOps.test.ts` (INT-001) |
| **INT-004** | **Parcial** | Uso/reserva/sync unificados no recalc; `fleetMaintenanceOps.ts`/`fleetFinancialRoutes.ts` mantêm writes pontuais em fluxos específicos | `fleetUsageOps.ts`, `fleetReservationOps.ts`, `fleetReservationRoutes.ts` | `npm run test:fleet` (131 pass) |
| **INT-013** | **Resolvido** | Approve reserva sem `status: "RESERVED"` direto; sync pós-transaction | `fleetReservationRoutes.ts` | `fleetVehicleStatusOps.test.ts` (INT-013/038) |
| **INT-038** | **Resolvido** | `syncVehicleStatusAfterReservationChange` delega 100% ao recalc | `fleetReservationOps.ts` | `npm run test:fleet` |
| **INT-005** | **Parcial** | API apply-preview/apply/cost-impact usam `currentSnapshot` via `resolveCurrentCostSnapshotForNomus`; scripts CLI ainda omitem resolver | `nomusBomControlledApply.ts`, `productCostSnapshot.ts`, `server.ts` | `productCostSnapshot.test.ts` (3 pass) |
| **INT-008** | **Resolvido** | `getVisibleProductTabs` exige permissão tab explícita | `modulePermissions.ts` | `modulePermissions.test.ts` |
| **INT-009** | **Resolvido** | `maintenance` exige `maintenance.view` (sem `settings.view`) | `modulePermissions.ts` | `modulePermissions.test.ts` |
| **INT-010** | **Resolvido** | `taxes` exige `taxes.view` (sem `pricing.view`) | `modulePermissions.ts` | `modulePermissions.test.ts` |
| **INT-002** | **Pendente** | Alias `costs.view` preservado — decisão humana | — | `modulePermissions.test.ts` confirma legado |
| **INT-003** | **Pendente** | `dashboard.view` ainda abre Relatórios — decisão humana | — | `modulePermissions.test.ts` confirma legado |
| **INT-015** | **Pendente** | `GET /api/test-db` presente sem auth | — | SYS-004 audit script |
| **INT-006** | Pendente | 360 vs CRM intel — decisão humana | — | — |
| **INT-007** | Pendente | KPIs pedidos client vs server | — | — |
| **INT-011–012** | Pendente | Paginação/listas clientes | — | SYS-009 (ProposalModule) |
| **INT-014** | Pendente | Fórmula material triplicada | — | — |
| **INT-016–046** | Pendente | Conforme auditoria original §2.2 | — | — |

---

## 3. Pendências remanescentes

| Prioridade | Módulo | ID | Descrição | Recomendação |
|------------|--------|-----|-----------|--------------|
| **P0** | Permissões | INT-002 | `costs.view` abre employees/machines/etc.; API nega | Decidir: remover alias FE **ou** OR no backend |
| **P0** | Permissões | INT-003 | `dashboard.view` abre Relatórios; API exige `reports.view` | Decidir: alinhar menu **ou** OR na API |
| **P1** | Segurança | INT-015 | `/api/test-db` sem autenticação | Decidir: auth, 404 prod ou remover |
| **P1** | Nomus | INT-005 (residual) | Scripts CLI sem `resolveCurrentCostSnapshot` | Passar resolver nos scripts ou documentar divergência |
| **P2** | Pedidos/Relatórios | INT-007 | KPIs calculados no client | Onda D — endpoint agregado |
| **P2** | Clientes | INT-011, INT-012 | Três contratos paginação; Propostas carrega todos | Onda E — typeahead paginado |
| **P2** | Produtos/Nomus | INT-014 | Fórmula material CIU triplicada | Onda F — função compartilhada |
| **P2** | CRM/Clientes | INT-006 | Commercial 360 vs CRM intel | Decisão de semântica ou rotular UI |
| **P3** | Frota | INT-004 (residual) | Writers em maintenance/finance | Migrar writes restantes ao recalc |
| **P3** | Infra | INT-030–037, INT-039–046 | Prisma enums, docs, UX | Backlog governança |
| **P4** | Tooling | POST-001 | Heurísticas audit script desatualizadas | Atualizar `systemIntegrityAudit.ts` no próximo ciclo docs |

---

## 4. Validação técnica

| Comando | Resultado |
|---------|-----------|
| `git status --short` | Limpo (sem alterações pendentes) |
| `npx prisma validate` | OK — schema válido |
| `npm run lint` | OK — `tsc --noEmit` |
| `npm run build` | OK — Vite build |
| `npm run test:fleet` | OK — **131** testes pass |
| `npx tsx --test src/lib/modulePermissions.test.ts src/lib/productCostSnapshot.test.ts` | OK — **9** testes pass |
| `npm run audit:system-integrity` | 10 checks: **4 OK**, **6 ATENÇÃO** (pendências conhecidas + heurísticas desatualizadas) |

### Interpretação do audit script pós-fix

| Check | Resultado | Interpretação real |
|-------|-----------|-------------------|
| SYS-004 | ATENÇÃO | INT-015 pendente — correto |
| SYS-005 | ATENÇÃO | **Falso positivo** — ausência de `null` indica fix INT-005 aplicado |
| SYS-006 | ATENÇÃO | **Falso positivo** — recalc é chamado no checkin; mensagem do script desatualizada |
| SYS-007 | ATENÇÃO | INT-002/003 pendente — correto |
| SYS-009 | ATENÇÃO | INT-012 pendente — correto |

**Nenhum erro de build, lint ou teste** foi encontrado nesta validação.

---

## 5. Recomendação final

### Pronto para próxima fase?

**Sim, com ressalvas.** A onda priorizada (Frota P0, Permissões INT-008–010, Nomus INT-005 via API) está **validada tecnicamente** e **estável**. Não é necessário novo ciclo de correção imediato por falha de teste ou build.

### Próximo ciclo recomendado (decisão + implementação)

1. **Obter decisões humanas** INT-002, INT-003, INT-015.
2. **Implementar Fase B/C restante** conforme plano original.
3. **Validação manual** operacional (checklist em `system-integrity-implementation-report.md` §6).
4. **Atualizar** `scripts/systemIntegrityAudit.ts` para refletir heurísticas pós-fix (POST-001).
5. **Iniciar Onda D** (INT-007) após fechar permissões legadas.

### Novas inconsistências críticas?

**Não.** Nenhuma nova crítica identificada que exija implementação automática neste prompt.

---

*Auditoria pós-correção gerada após validação completa sem falhas técnicas.*
