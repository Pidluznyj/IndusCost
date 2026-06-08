# Checklist Operacional — Melhorias de Integridade IndusCost

Referência: [`system-integrity-improvement-plan.md`](./system-integrity-improvement-plan.md)  
Relatório: [`system-integrity-implementation-report.md`](./system-integrity-implementation-report.md)

---

## Pré-implementação

- [x] Ler auditoria e plano — **implementado**
- [ ] Confirmar decisão humana INT-002 — **não implementado** (aguardando decisão)
- [ ] Confirmar decisão humana INT-003 — **não implementado** (aguardando decisão)
- [ ] Confirmar decisão humana INT-015 — **não implementado** (aguardando decisão)
- [x] `npm run lint` OK — **teste:** `npm run lint`
- [x] `npm run build` OK — **teste:** `npm run build`

---

## Fase A — Frota (INT-001, INT-004, INT-013, INT-038)

### Código

- [x] `fleetUsageOps.ts`: remover write direto de `status` no checkin — **implementado**
- [x] `fleetUsageOps.ts`: recalc após commit do checkin — **implementado** (`trigger: CHECKIN`)
- [x] `fleetUsageOps.ts`: checkout via recalc — **implementado** (`trigger: CHECKOUT`)
- [x] `fleetReservationRoutes.ts`: approve sem `RESERVED` direto — **implementado**
- [x] `fleetReservationRoutes.ts`: recalc após approve — **implementado**
- [x] `fleetReservationOps.ts`: sync delega ao recalc — **implementado**
- [x] replace-vehicle usa recalc — **implementado**
- [x] `currentKm` separado do status — **implementado**

### Testes

- [x] Teste manutenção + reserva (INT-013/038) — **implementado** `fleetVehicleStatusOps.test.ts`
- [x] Teste checkin + manutenção (INT-001) — **implementado** `fleetVehicleStatusOps.test.ts`
- [x] `npm run test:fleet` OK — **131 pass**

### Validação manual

- [ ] Veículo manutenção bloqueante → checkin — **pendente validação manual**
- [ ] Aprovar reserva com manutenção — **pendente validação manual**
- [ ] Cancelar reserva — **pendente validação manual**

---

## Fase B — Permissões (parcial)

### Implementado (INT-008, INT-009, INT-010)

- [ ] INT-002 employees — **não implementado** — motivo: exige decisão humana
- [ ] INT-002 machines — **não implementado** — motivo: exige decisão humana
- [ ] INT-002 materials — **não implementado** — motivo: exige decisão humana
- [ ] INT-002 opex — **não implementado** — motivo: exige decisão humana
- [ ] INT-002 simulations — **não implementado** — motivo: exige decisão humana
- [ ] INT-003 reports — **não implementado** — motivo: exige decisão humana
- [x] INT-008 `getVisibleProductTabs` — **implementado** — teste: `modulePermissions.test.ts`
- [x] INT-009 maintenance — **implementado** — teste: `modulePermissions.test.ts`
- [x] INT-010 taxes — **implementado** — teste: `modulePermissions.test.ts`

### Testes

- [x] `modulePermissions.test.ts` — **6 pass**
- [ ] `npm run audit:permissions` — **não executado** (sem mudança INT-002/003)

### Validação manual

- [ ] Produto aba Custo sem tab perm — **pendente**
- [ ] Manutenção oculta sem `maintenance.view` — **pendente**
- [ ] Impostos oculto sem `taxes.view` — **pendente**

---

## Fase C — Nomus + segurança (parcial)

### Nomus (INT-005)

- [x] Helper `productCostSnapshot.ts` — **implementado**
- [x] cost-impact usa helper — **implementado**
- [x] apply-preview snapshot real — **implementado**
- [x] apply POST passa resolver — **implementado**
- [x] Fórmula material intacta (INT-014 fora) — **confirmado**

### Segurança (INT-015)

- [ ] Proteger `/api/test-db` — **não implementado** — motivo: exige decisão humana

### Testes

- [x] `productCostSnapshot.test.ts` — **3 pass**
- [ ] Teste comparativo preview vs cost-impact integração — **não criado** (requer DB piloto)
- [ ] test-db auth — **não aplicável** (INT-015 adiado)

### Validação manual

- [ ] SKU piloto preview vs cost-impact — **pendente**
- [ ] curl test-db — **adiado**

---

## Pós-implementação

- [x] `npx prisma validate` OK
- [x] `npm run lint` OK
- [x] `npm run build` OK
- [ ] Smoke manual módulos — **pendente operador**

---

## Backlog (não implementado nesta onda)

- [ ] INT-006 — decisão humana
- [ ] INT-007 — KPI pedidos
- [ ] INT-011, INT-012 — paginação clientes
- [ ] INT-014 — fórmula CIU
- [ ] INT-016–046 — conforme plano §2.2

---

*Checklist atualizado após implementação 2026-06-05.*
