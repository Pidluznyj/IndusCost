# Checklist Operacional — Melhorias de Integridade IndusCost

Marcar cada item ao implementar. Ordem: **Fase A → B → C**.

Referência: [`system-integrity-improvement-plan.md`](./system-integrity-improvement-plan.md)

---

## Pré-implementação (todas as fases)

- [ ] Ler `docs/generated/system-integrity-audit.md` e este plano
- [ ] Confirmar decisão humana INT-002 (`costs.view`: remover alias FE vs expandir backend)
- [ ] Confirmar decisão humana INT-003 (`dashboard.view` vs `reports.view`)
- [ ] Confirmar decisão humana INT-015 (`test-db`: auth vs 404 prod vs remover)
- [ ] `git status --short` limpo ou branch dedicada criada
- [ ] `npm run lint` OK
- [ ] `npm run build` OK

---

## Fase A — Frota: recalc único (INT-001, INT-004, INT-013, INT-038)

### Código

- [ ] `fleetUsageOps.ts`: remover write direto de `status` no checkin (~L277–286)
- [ ] `fleetUsageOps.ts`: chamar `recalculateVehicleOperationalStatus` após commit do checkin
- [ ] `fleetUsageOps.ts`: revisar checkout/fechamento uso — recalc no fechamento se aplicável
- [ ] `fleetReservationRoutes.ts`: approve — remover `status: "RESERVED"` direto (~L242–245)
- [ ] `fleetReservationRoutes.ts`: approve — recalc após transaction
- [ ] `fleetReservationOps.ts`: `syncVehicleStatusAfterReservationChange` delega ao recalc
- [ ] Verificar outros call sites de sync (cancel, reject, change vehicle) usam recalc
- [ ] Manter update de `currentKm` separado do status no checkin

### Testes

- [ ] Teste: checkin com manutenção `blocksVehicle` ativa → status ≠ AVAILABLE
- [ ] Teste: approve reserva com manutenção bloqueante → status reflete bloqueio
- [ ] Teste: cancel reserva → recalc libera veículo quando sem outros bloqueios
- [ ] `npm run test:fleet` OK

### Validação manual

- [ ] Veículo em manutenção bloqueante → checkin → grid não mostra Disponível
- [ ] Aprovar reserva → status coerente com manutenção/uso
- [ ] Cancelar reserva aprovada → veículo volta conforme regras
- [ ] (Opcional dev) `npm run test:fleet:smoke`

### Aceite Fase A

- [ ] Nenhum path em usage/reserva escreve `FleetVehicle.status` sem recalc
- [ ] PR/commit isolado; mensagem sugerida: `fix(fleet): unify vehicle status via recalc`

---

## Fase B — Permissões UI↔API (INT-002, INT-003, INT-008, INT-009, INT-010)

### Código — `modulePermissions.ts`

- [ ] INT-002: employees — remover `\|\| LEGACY_COSTS_VIEW` (ou expandir backend se decidido)
- [ ] INT-002: machines — idem
- [ ] INT-002: materials — idem
- [ ] INT-002: opex — idem
- [ ] INT-002: simulations — idem
- [ ] INT-003: reports — remover `\|\| dashboard.view` (ou OR no backend se decidido)
- [ ] INT-008: `getVisibleProductTabs` — remover fallback “todas abas com só products.view”
- [ ] INT-009: maintenance — remover `\|\| settings.view`
- [ ] INT-010: taxes — remover `\|\| pricing.view`

### Testes

- [ ] Criar/atualizar `modulePermissions.test.ts`
- [ ] Teste: só `costs.view` → employees/machines ocultos
- [ ] Teste: só `dashboard.view` → reports oculto
- [ ] Teste: só `products.view` → abas cost/composition ocultas
- [ ] Teste: só `settings.view` → maintenance oculto
- [ ] Teste: só `pricing.view` → taxes oculto
- [ ] `npm run audit:permissions` OK
- [ ] Atualizar `docs/generated/permissions-audit-report.md` se script gerar diff

### Validação manual

- [ ] Perfil legado `costs.view`: menus custo ocultos; sem 403 ao navegar
- [ ] Perfil `dashboard.view` sem `reports.view`: Relatórios oculto
- [ ] Produto: aba Custo oculta sem `products.tab.cost`
- [ ] Manutenção oculta sem `maintenance.view`
- [ ] Impostos oculto sem `taxes.view`

### Aceite Fase B

- [ ] Sidebar alinhada aos guards API para itens corrigidos
- [ ] PR/commit isolado; mensagem sugerida: `fix(permissions): align module menu with API guards`

---

## Fase C — Nomus snapshot + test-db (INT-005, INT-015)

### Código — Nomus

- [ ] Extrair helper `buildCurrentCostSnapshotForSku` (ou equivalente) de lógica em `server.ts` L3927–3950
- [ ] Usar helper no handler `GET /api/nomus/effective-pricing-bom/cost-impact`
- [ ] `nomusBomControlledApply.ts` ~L1194: passar snapshot real em vez de `null`
- [ ] Não alterar fórmula material (INT-014 fora de escopo)

### Código — Segurança

- [ ] `server.ts` ~L1620: proteger `GET /api/test-db` (auth ou 404 prod)

### Testes

- [ ] Teste: mesmo `parentCode` → preview gates === cost-impact gates
- [ ] Teste: `/api/test-db` sem token → 401 ou 404
- [ ] `npm run test:nomus:auto-sync-bom-apply` (subset relevante) OK

### Validação manual

- [ ] SKU piloto: apply-preview e painel cost-impact — mesmos unresolved/blockers
- [ ] curl test-db sem auth bloqueado

### Aceite Fase C

- [ ] Preview Nomus alinhado ao cost-impact para SKU com produto
- [ ] test-db inacessível em produção
- [ ] PR/commit isolado; mensagem sugerida: `fix(nomus): align apply-preview cost snapshot; secure test-db`

---

## Pós-implementação (cada fase)

- [ ] `npm run lint` OK
- [ ] `npm run build` OK
- [ ] `npx prisma validate` OK
- [ ] Smoke manual do módulo afetado
- [ ] Commit isolado por fase
- [ ] Push após revisão

---

## Não implementar nesta onda (registrar para backlog)

- [ ] INT-006 — Commercial 360 vs CRM intel (decisão humana)
- [ ] INT-007 — KPI pedidos endpoint único
- [ ] INT-011, INT-012 — paginação/typeahead clientes
- [ ] INT-014 — fórmula material CIU compartilhada
- [ ] INT-016–046 — média/baixa severidade conforme plano §2.2

---

## Rollback rápido

- [ ] Identificar hash do commit da fase
- [ ] `git revert <hash>` se regressão
- [ ] Frota: rodar diagnóstico integridade se dados inconsistentes
- [ ] Redeploy FE apenas se Fase B revertida

---

*Checklist operacional — complemento do plano técnico.*
