# Relatório de Implementação — Melhorias de Integridade IndusCost

**Data:** 2026-06-05  
**Commit:** _(preenchido após commit)_  
**Plano base:** `docs/generated/system-integrity-improvement-plan.md`

---

## 1. Resumo do que foi implementado

Correções mínimas e testáveis conforme Fases A, B (parcial) e C (parcial) do plano:

| Fase | IDs | Resultado |
|------|-----|-----------|
| **A — Frota** | INT-001, INT-004, INT-013, INT-038 | Status operacional unificado via `recalculateVehicleOperationalStatus()` após checkin, checkout, approve/troca de reserva e sync de reserva |
| **B — Permissões** | INT-008, INT-009, INT-010 | Menu/abas alinhados aos guards API (manutenção, impostos, abas produto) |
| **C — Nomus** | INT-005 | Apply-preview e apply API usam mesmo snapshot CIU que cost-impact |

Itens **não implementados** por exigir decisão humana: **INT-002**, **INT-003**, **INT-015**.

---

## 2. Itens do plano atendidos

| ID | Status | Notas |
|----|--------|-------|
| INT-001 | ✅ | Checkin não grava `AVAILABLE`/`BLOCKED` direto; recalc após `applyCriticalChecklistOnCheckin` |
| INT-004 | ✅ | Writers paralelos substituídos por recalc central |
| INT-013 | ✅ | Approve reserva sem `status: RESERVED` direto |
| INT-038 | ✅ | `syncVehicleStatusAfterReservationChange` delega ao recalc |
| INT-008 | ✅ | Removido fallback “todas abas com só products.view” |
| INT-009 | ✅ | Removido `\|\| settings.view` em maintenance |
| INT-010 | ✅ | Removido `\|\| pricing.view` em taxes |
| INT-005 | ✅ | Snapshot via `productCostSnapshot.ts` + `resolveCurrentCostSnapshotForNomus` no server |
| INT-002 | ⏸️ | **Decisão humana** — alias `costs.view` preservado |
| INT-003 | ⏸️ | **Decisão humana** — alias `dashboard.view` em reports preservado |
| INT-015 | ⏸️ | **Decisão humana** — `/api/test-db` inalterado |
| INT-006–046 | ⏸️ | Fora do escopo desta onda (plan §2.2) |

---

## 3. Arquivos alterados

| Arquivo | Mudança |
|---------|---------|
| `src/lib/fleetUsageOps.ts` | Checkin/checkout: km na tx; status via recalc; pendência manual preservada |
| `src/lib/fleetReservationOps.ts` | Sync reserva → recalc |
| `src/lib/fleetReservationRoutes.ts` | Approve/troca veículo → recalc |
| `src/lib/fleetVehicleStatusOps.test.ts` | Testes INT-001/013/038 |
| `src/lib/modulePermissions.ts` | INT-008, INT-009, INT-010 |
| `src/lib/modulePermissions.test.ts` | **Novo** — testes permissões |
| `src/lib/productCostSnapshot.ts` | **Novo** — helper snapshot CIU |
| `src/lib/productCostSnapshot.test.ts` | **Novo** — testes snapshot |
| `src/lib/nomusBomControlledApply.ts` | Snapshot no preview/apply |
| `server.ts` | Helpers snapshot; rotas Nomus apply-preview/apply/cost-impact |

---

## 4. Testes criados/ajustados

| Teste | Comando |
|-------|---------|
| Frota status (131 testes) | `npm run test:fleet` |
| Permissões INT-008–010 | `npx tsx --test src/lib/modulePermissions.test.ts` |
| Snapshot CIU | `npx tsx --test src/lib/productCostSnapshot.test.ts` |
| Prisma | `npx prisma validate` |
| TypeScript | `npm run lint` |
| Build | `npm run build` |

**Resultado:** todos passaram.

---

## 5. Riscos residuais

| Risco | Severidade | Mitigação |
|-------|------------|-----------|
| INT-002/003 — aliases legados ainda abrem menu com 403 na API | Média | Aguardar decisão humana; documentado |
| INT-015 — `/api/test-db` exposto | Média | Aguardar decisão humana |
| Pendência manual no checkin usa write pontual `BLOCKED` (recalc não modela) | Baixa | Audit `CHECKIN_PENDING_BLOCK`; futuro: admin_block |
| Scripts Nomus CLI sem `resolveCurrentCostSnapshot` | Baixa | Comportamento legado (null); API alinhada |
| Usuário só `products.view` sem tab perms — modal sem abas | Baixa | Esperado pós INT-008; perfis devem ter `products.tab.*` |

---

## 6. Validação manual necessária

| Rota/tela | Ação | Resultado esperado |
|-----------|------|-------------------|
| **Frota → Uso → Devolução** | Checkin em veículo com manutenção bloqueante ativa | Grid não mostra “Disponível”; status MAINTENANCE/BLOCKED |
| **Frota → Reservas** | Aprovar reserva com manutenção ativa no veículo | Status reflete bloqueio, não “Reservado” cego |
| **Frota → Reservas** | Cancelar reserva aprovada sem outros bloqueios | Veículo liberado (AVAILABLE ou RESERVED conforme outras reservas) |
| **Produtos → modal** | Login só com `products.view` (sem tab perms) | Abas cost/composition ocultas; sem 403 ao abrir modal |
| **Produtos → modal** | Login com `products.tab.cost` | Aba Custo visível e carrega API |
| **Sidebar** | Login só `settings.view` | Manutenção Predial oculta |
| **Sidebar** | Login só `pricing.view` | Tributos oculto |
| **Nomus → Apply preview** | Mesmo SKU no cost-impact e apply-preview | Mesmos gates `COST_UNRESOLVED` / blockers |
| **Nomus → Apply** | Aplicar BOM piloto | Gates consistentes com preview |

---

## 7. Próximos passos

1. **Decisão humana** INT-002, INT-003, INT-015 → implementar Fase B/C restante
2. **Onda D** — INT-007 KPI pedidos endpoint único
3. **Onda E** — INT-011/012 paginação clientes
4. Reexecutar `npm run audit:permissions` após resolver INT-002/003

---

*Gerado na etapa de implementação das melhorias priorizadas de integridade.*
