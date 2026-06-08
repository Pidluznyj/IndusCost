# Plano Técnico de Melhorias de Integridade — IndusCost

**Data:** 2026-06-05  
**Origem:** `docs/generated/system-integrity-audit.md` (38 achados INT-001 … INT-038 + 8 baixos INT-039 … INT-046)  
**Restrição desta fase:** apenas planejamento — nenhuma alteração funcional de código de negócio.

---

## 1. Objetivo

Corrigir inconsistências documentadas na auditoria de integridade, estabelecendo **fonte única de verdade por domínio** (status operacional de veículo, permissões UI↔API, snapshot CIU Nomus) com **diffs mínimos e seguros**, preservando compatibilidade e sem refatoração ampla de `server.ts`.

O objetivo imediato é eliminar estados de banco incorretos (frota), telas que abrem módulos negados pela API (403) e divergências de preview Nomus que podem bloquear/liberar apply incorretamente.

---

## 2. Escopo desta fase

### 2.1 Melhorias que serão implementadas agora (Fases A → C)

| Grupo | IDs | Resumo |
|-------|-----|--------|
| **Frota — status operacional** | INT-001, INT-004, INT-013, INT-038 | Unificar writers pós checkin, approve reserva e sync reserva em `recalculateVehicleOperationalStatus()` |
| **Permissões — UI↔API** | INT-002, INT-003, INT-008, INT-009, INT-010 | Remover aliases legados que abrem menu sem guard correspondente; alinhar abas de produto |
| **Nomus — apply-preview** | INT-005 | Passar mesmo `CurrentCostSnapshot` do endpoint cost-impact em `buildControlledApplyPreview` |
| **Segurança mínima** | INT-015 | Proteger `GET /api/test-db` com autenticação ou remover em produção |

### 2.2 Melhorias para fases futuras (Ondas D → F e além)

| Onda | IDs | Motivo do adiamento |
|------|-----|---------------------|
| **D — KPI comercial** | INT-007, INT-024 | Novo endpoint agregado; impacto em Pedidos + Relatórios |
| **E — Listas clientes** | INT-011, INT-012, INT-019, INT-020 | Typeahead/paginação unificada; múltiplos consumidores |
| **F — Fórmula material CIU** | INT-014 | Extração compartilhada; risco de drift em custos |
| **CRM / Comercial** | INT-006, INT-021, INT-022, INT-034 | Exige decisão de semântica “compra” |
| **Produtos / Propostas** | INT-016, INT-017, INT-018, INT-025, INT-026 | By design, FE-only ou baixo risco operacional |
| **Prisma / schema** | INT-030, INT-031, INT-032 | Migrations de enum — alto custo, baixa urgência |
| **Infra / docs** | INT-033, INT-037, INT-039 … INT-046 | Governança, UX, arredondamentos intencionais |

### 2.3 Itens que exigem decisão humana antes de mexer

| ID | Decisão necessária |
|----|-------------------|
| **INT-002** | Remover alias `costs.view` no FE **ou** expandir guards no backend (como frota) para aceitar `costs.view` nas rotas employees/machines/materials/opex/simulations |
| **INT-003** | Relatórios: exigir `reports.view` no menu **ou** adicionar OR `dashboard.view` em `GET /api/reports/data` |
| **INT-006** | Commercial 360 (propostas APPROVED) vs CRM intel (SalesOrder): unificar backend **ou** rotular UI com fonte explícita |
| **INT-016** | Confirmar se divergência HH/HM congelados pós-apply Nomus é aceitável (documentado como by design) |
| **INT-015** | Remover rota, exigir auth admin, ou restringir a `NODE_ENV !== 'production'` |
| **INT-030–032** | Priorizar quais campos String migrar para enum Prisma |

---

## 3. Priorização

| ID | Severidade | Prioridade | Motivo | Implementar agora? | Justificativa |
|----|------------|------------|--------|-------------------|---------------|
| INT-001 | Crítica | P0 | Checkin ignora manutenção bloqueante | **Sim** (Fase A) | Estado DB incorreto em produção |
| INT-004 | Crítica | P0 | Três writers competindo | **Sim** (Fase A) | Raiz estrutural; corrige INT-001/013/038 |
| INT-013 | Alta | P0 | Approve reserva → RESERVED direto | **Sim** (Fase A) | Mesmo domínio frota |
| INT-038 | Média | P0 | `syncVehicleStatusAfterReservationChange` ignora manutenção | **Sim** (Fase A) | Depreciar em favor do recalc |
| INT-002 | Crítica | P0 | `costs.view` abre menu, API nega | **Sim** (Fase B) | 403 recorrente; decisão alias vs backend |
| INT-003 | Crítica | P0 | `dashboard.view` abre Relatórios | **Sim** (Fase B) | Mesmo padrão INT-002 |
| INT-008 | Alta | P1 | Abas produto visíveis sem tab perm | **Sim** (Fase B) | 403 ao abrir aba Custo/Composição |
| INT-009 | Alta | P1 | `settings.view` → Manutenção | **Sim** (Fase B) | Guard exige `maintenance.view` |
| INT-010 | Alta | P1 | `pricing.view` → Impostos | **Sim** (Fase B) | Guard exige `taxes.view` |
| INT-005 | Alta | P1 | Apply-preview snapshot null | **Sim** (Fase C) | Gates COST_UNRESOLVED divergentes |
| INT-015 | Alta | P1 | `/api/test-db` sem auth | **Sim** (Fase C) | Superfície de ataque |
| INT-007 | Alta | P2 | KPIs pedidos client vs server | **Não** | Novo endpoint; escopo D |
| INT-011 | Alta | P2 | Três contratos paginação clientes | **Não** | Escopo E |
| INT-012 | Alta | P2 | Propostas/Pedidos carregam todos clientes | **Não** | Escopo E |
| INT-014 | Alta | P2 | Fórmula material triplicada | **Não** | Refactor CIU; escopo F |
| INT-006 | Alta | P2 | 360 vs CRM intel | **Não** | Exige decisão humana |
| INT-016–018 | Média | P3 | By design / mitigado | **Não** | Documentar apenas |
| INT-019–025 | Média | P3 | Escala, FE-only, duplicação | **Não** | Baixo risco imediato |
| INT-026–029 | Média | P3 | Permissões órfãs, display | **Não** | Pós Fase B |
| INT-030–037 | Média/Baixa | P4 | Prisma, docs, infra | **Não** | Governança |
| INT-039–046 | Baixa | P4 | Intencional / UX | **Não** | Sem ação obrigatória |

---

## 4. Estratégia por módulo

### 4.1 Frota — status operacional

| Aspecto | Detalhe |
|---------|---------|
| **Problema** | INT-001, INT-004, INT-013, INT-038: checkin, approve reserva e sync reserva escrevem `FleetVehicle.status` diretamente, sem considerar manutenções bloqueantes, uso ativo ou matriz completa de transição. |
| **Fonte de verdade correta** | `recalculateVehicleOperationalStatus()` em `src/lib/fleetVehicleStatusOps.ts` — usa `collectActiveFleetBlockers()`, manutenção com `blocksVehicle`, reservas ativas e contexto de uso. |
| **Backend** | • `fleetUsageOps.ts` (~L277–286): após checkin, remover `vehicleStatus` direto; chamar `recalculateVehicleOperationalStatus(vehicleId, { trigger: 'checkin' })` fora da transaction ou após commit.<br>• `fleetReservationRoutes.ts` (~L242–245): approve — remover `status: "RESERVED"` direto; chamar recalc após transaction.<br>• `fleetReservationOps.ts` `syncVehicleStatusAfterReservationChange`: depreciar lógica paralela; delegar ao recalc (manter wrapper fino para compatibilidade de call sites).<br>• Revisar checkout/checkin paths em `fleetUsageOps.ts` para IN_USE → recalc no fechamento. |
| **Frontend** | Nenhuma mudança de regra. `FleetVehiclesTab.tsx` continua lendo DB (INT-029 permanece para fase futura). Validar grid após correção backend. |
| **Testes** | Estender `fleetVehicleStatusOps.test.ts`: cenário checkin com manutenção bloqueante ativa → status BLOCKED/MAINTENANCE, não AVAILABLE.<br>Novo teste em `fleetValidation.test.ts` ou arquivo dedicado: approve reserva com manutenção ativa.<br>`npm run test:fleet`. |
| **Permissões** | Sem impacto — frota usa `fleetPermissionResolve.ts` separado. |
| **Prisma** | Sem migration — apenas writes corretos em `FleetVehicle.status`. |
| **Riscos** | Recalc dentro de transaction longa pode deadlock; chamar **após** commit. Regressão em fluxo cancelamento reserva (já usa sync — migrar para recalc). |
| **Validação manual** | 1) Veículo em manutenção bloqueante → checkin uso → status não fica AVAILABLE.<br>2) Aprovar reserva com manutenção ativa → status reflete bloqueio.<br>3) Cancelar reserva → recalc libera veículo.<br>4) `npm run test:fleet:smoke` (ambiente dev). |

**Evidência atual:**

```277:286:src/lib/fleetUsageOps.ts
    let vehicleStatus: "AVAILABLE" | "BLOCKED" | "MAINTENANCE" = hasPending ? "BLOCKED" : "AVAILABLE";
    if (criticalFail) vehicleStatus = "BLOCKED";

    await tx.fleetVehicle.update({
      where: { id: reservation.vehicleId },
      data: {
        currentKm: checkinKm,
        status: vehicleStatus,
      },
    });
```

```242:245:src/lib/fleetReservationRoutes.ts
        await tx.fleetVehicle.update({
          where: { id: existing.vehicleId },
          data: { status: "RESERVED" },
        });
```

---

### 4.2 Permissões — módulos e abas

| Aspecto | Detalhe |
|---------|---------|
| **Problema** | INT-002, INT-003, INT-008, INT-009, INT-010: UI libera módulos/abas que APIs negam com 403. |
| **Fonte de verdade correta** | Guards em `server.ts` + `permissionCatalog.ts` — a UI deve espelhar permissões efetivas da API, não aliases legados unilaterais. |
| **Backend (opção conservadora — recomendada)** | **Não** expandir aliases no backend nesta fase; apenas alinhar FE. Se decisão humana optar por compatibilidade legada, adicionar OR `costs.view` / `dashboard.view` nos guards correspondentes (espelhar padrão documentado em `docs/FLEET_PERMISSIONS.md`). |
| **Frontend** | `src/lib/modulePermissions.ts`:<br>• Remover `\|\| check.hasPermission(LEGACY_COSTS_VIEW)` de employees/machines/materials/opex/simulations **ou** documentar expansão backend.<br>• `reports`: remover `\|\| dashboard.view` **ou** adicionar OR no handler reports.<br>• `getVisibleProductTabs`: remover fallback “todas abas com só products.view”; exigir `products.tab.*` por aba.<br>• `maintenance`: remover `\|\| settings.view`.<br>• `taxes`: remover `\|\| pricing.view`. |
| **Testes** | Testes unitários em novo arquivo `modulePermissions.test.ts` (ou estender existente): usuário só com `costs.view` não acessa employees; só `dashboard.view` não acessa reports; só `products.view` não vê aba cost.<br>`npm run audit:permissions` pós-correção; atualizar `docs/generated/permissions-audit-report.md`. |
| **Permissões** | Impacto direto em perfis legados que dependiam de aliases — comunicar antes do deploy. |
| **Prisma** | Nenhum. |
| **Riscos** | Usuários perdem acesso visual a módulos que antes viam (comportamento correto). Rollback = restaurar aliases. |
| **Validação manual** | Perfil teste só `costs.view`: menu employees/machines oculto; API continua 403 se forçado.<br>Perfil só `dashboard.view`: Relatórios oculto.<br>Produto: aba Custo oculta sem `products.tab.cost`. |

**Evidência atual:**

```86:111:src/lib/modulePermissions.ts
    case "employees":
      return check.hasPermission("employees.view") || check.hasPermission(LEGACY_COSTS_VIEW);
    // ...
    case "reports":
      return check.hasPermission("reports.view") || check.hasPermission("dashboard.view");
```

```254:262:src/lib/modulePermissions.ts
export function getVisibleProductTabs(check: PermissionChecker): ProductTabId[] {
  const hasAnyTabPerm = PRODUCT_TAB_IDS.some((id) =>
    check.hasPermission(PRODUCT_TAB_PERMISSIONS[id])
  );
  if (!hasAnyTabPerm && check.hasPermission("products.view")) {
    return [...PRODUCT_TAB_IDS];
  }
  return PRODUCT_TAB_IDS.filter((id) => check.hasPermission(PRODUCT_TAB_PERMISSIONS[id]));
}
```

---

### 4.3 Nomus — apply-preview vs cost-impact

| Aspecto | Detalhe |
|---------|---------|
| **Problema** | INT-005: `buildControlledApplyPreview` passa `null` como snapshot; REST `GET /api/nomus/effective-pricing-bom/cost-impact` monta snapshot via `getProductCostAnalysis`. |
| **Fonte de verdade correta** | Snapshot CIU: mesma construção em `server.ts` L3927–3950 (`CurrentCostSnapshot` a partir de `getProductCostAnalysis`). Impacto Nomus: `buildNomusEffectiveBomCostImpact()` em `src/lib/nomusEffectiveBomCostImpact.ts`. |
| **Backend** | Extrair helper `buildCurrentCostSnapshotForSku(sku, cache)` compartilhado entre cost-impact handler e `nomusBomControlledApply.ts` (~L1194). Passar snapshot real em vez de `null`. **Não** alterar fórmula de material (INT-014 fora de escopo). |
| **Frontend** | Nenhuma — preview consome API existente. Validar que gates exibidos batem com painel cost-impact. |
| **Testes** | Teste comparativo: mesmo `parentCode` → preview gates === cost-impact gates.<br>`npm run test:nomus:auto-sync-bom-apply` (subset relevante). |
| **Permissões** | Sem alteração — rotas já usam `NOMUS_OPTIONAL_PRICING_PERMS`. |
| **Prisma** | Nenhum. |
| **Riscos** | Preview mais restritivo (correto); usuários podem ver mais `COST_UNRESOLVED` — comportamento alinhado ao painel. |
| **Validação manual** | SKU piloto com custo resolvido: apply-preview e cost-impact mostram mesmos unresolved/blockers. |

**Evidência atual:**

```1194:1199:src/lib/nomusBomControlledApply.ts
  const costImpact = product
    ? await buildNomusEffectiveBomCostImpact(
        trimmed,
        { recursive: false, maxDepth: 10 },
        null
      )
    : null;
```

---

### 4.4 Segurança — test-db

| Aspecto | Detalhe |
|---------|---------|
| **Problema** | INT-015: `GET /api/test-db` em `server.ts` ~L1620 sem autenticação. |
| **Fonte de verdade** | Rotas administrativas devem usar `requireAppAuth` + permissão mínima (`settings.view` ou env-only). |
| **Backend** | Adicionar guard ou `if (process.env.NODE_ENV === 'production') return 404`. |
| **Frontend** | Nenhum. |
| **Testes** | Request sem token → 401/404. |
| **Riscos** | Scripts locais que usam test-db precisam token — documentar. |
| **Validação manual** | curl sem auth → bloqueado. |

---

### 4.5 Módulos fora do escopo imediato (referência)

| Módulo | IDs | Fonte de verdade esperada | Ação futura |
|--------|-----|---------------------------|-------------|
| Pedidos/Relatórios | INT-007, INT-024 | `GET /api/reports/data` ou novo `/api/sales-orders/indicators` | Onda D |
| Clientes/CRM | INT-006, INT-011, INT-012 | `Customer` Prisma + contrato paginação único | Onda E + decisão INT-006 |
| Produtos CIU | INT-014, INT-016 | `getProductCostAnalysis()` | Onda F |
| Propostas | INT-017, INT-023 | Snapshot `ProposalItem.unitCost` | Documentar |
| Prisma | INT-030–032 | Enums schema | Migration dedicada |

---

## 5. Plano de implementação incremental

### Fase A — Frota: recalc único (P0)

| Campo | Conteúdo |
|-------|----------|
| **Objetivo** | Eliminar writers paralelos de status; toda mutação pós uso/reserva usa `recalculateVehicleOperationalStatus`. |
| **Arquivos prováveis** | `src/lib/fleetUsageOps.ts`, `src/lib/fleetReservationRoutes.ts`, `src/lib/fleetReservationOps.ts`, `src/lib/fleetVehicleStatusOps.ts`, `src/lib/fleetVehicleStatusOps.test.ts`, `src/lib/fleetValidation.test.ts` |
| **Mudanças técnicas** | 1) Substituir updates diretos de `status` por recalc pós-commit.<br>2) Refatorar `syncVehicleStatusAfterReservationChange` para chamar recalc (depreciar matriz local L136–145).<br>3) Manter update de `currentKm` no checkin separado do status. |
| **Testes** | `npm run test:fleet`; novos casos manutenção+checkin, manutenção+approve. |
| **Critério de aceite** | Nenhum path em fleetUsageOps/fleetReservationRoutes escreve `status` sem passar pelo recalc; testes verdes; smoke frota manual OK. |
| **Risco de regressão** | Médio — fluxos reserva/uso intensos; mitigar com testes e smoke. |

---

### Fase B — Permissões UI↔API (P0)

| Campo | Conteúdo |
|-------|----------|
| **Objetivo** | Menu e abas refletem guards reais da API; eliminar 403 por alias legado. |
| **Arquivos prováveis** | `src/lib/modulePermissions.ts`, `src/lib/modulePermissions.test.ts` (novo), `docs/generated/permissions-audit-report.md`, `scripts/auditPermissionsV1.ts` (se necessário) |
| **Mudanças técnicas** | Remover aliases documentados em §4.2 (após decisão INT-002/003). Ajustar `getVisibleProductTabs`. |
| **Testes** | Unit `modulePermissions`; `npm run audit:permissions`. |
| **Critério de aceite** | Zero módulos visíveis com 403 no fluxo padrão; audit permissions sem divergências UI/API para aliases corrigidos. |
| **Risco de regressão** | Baixo técnico; médio operacional (perfis legados). |

---

### Fase C — Nomus snapshot + test-db (P1)

| Campo | Conteúdo |
|-------|----------|
| **Objetivo** | Apply-preview usa mesmo snapshot CIU que cost-impact; fechar `/api/test-db`. |
| **Arquivos prováveis** | `src/lib/nomusBomControlledApply.ts`, `server.ts` (handler cost-impact + test-db), helper novo em `src/lib/` (ex.: `productCostSnapshot.ts`) |
| **Mudanças técnicas** | Extrair builder de snapshot; usar em preview; guard test-db. |
| **Testes** | Teste comparativo preview vs cost-impact; teste auth test-db. |
| **Critério de aceite** | Gates idênticos para SKU piloto; test-db inacessível sem auth em prod. |
| **Risco de regressão** | Baixo Nomus (alinhamento); nulo test-db. |

---

### Fases futuras (referência — não implementar agora)

| Fase | Objetivo | IDs |
|------|----------|-----|
| **D** | Endpoint KPI pedidos único | INT-007, INT-024 |
| **E** | Typeahead clientes paginado | INT-011, INT-012 |
| **F** | Função material CIU compartilhada | INT-014 |

---

## 6. Plano de testes

### 6.1 Gates obrigatórios (cada PR)

| Comando | Expectativa |
|---------|-------------|
| `npm run lint` | `tsc --noEmit` sem erros |
| `npm run build` | Vite build OK |
| `npx prisma validate` | Schema válido |

### 6.2 Testes existentes por fase

| Fase | Scripts |
|------|---------|
| A | `npm run test:fleet`, opcional `npm run test:fleet:smoke` |
| B | `npm run audit:permissions`, testes unit modulePermissions |
| C | `npm run test:nomus:auto-sync-bom-apply` (subset), teste snapshot |

### 6.3 Novos testes necessários

| Teste | Tipo | Fase |
|-------|------|------|
| checkin + manutenção bloqueante → status correto | Unit | A |
| approve reserva + manutenção → recalc | Unit/integração | A |
| `canAccessModule` matriz permissões | Unit | B |
| `getVisibleProductTabs` sem fallback legado | Unit | B |
| preview vs cost-impact gates iguais | Unit | C |
| GET `/api/test-db` sem token → 401/404 | Integração | C |

### 6.4 Smoke tests manuais por módulo

| Módulo | Passos |
|--------|--------|
| Frota | Manutenção bloqueante → tentar checkin → grid status coerente |
| Permissões | Login perfil limitado → navegar sidebar → sem 403 |
| Nomus | Abrir apply-preview e cost-impact mesmo SKU → comparar unresolved |
| Segurança | curl test-db bloqueado |

---

## 7. Plano de rollback

| Cenário | Ação |
|---------|------|
| **Fase A — regressão frota** | Revert commit da fase; writers diretos restaurados. Dados inconsistentes: rodar `fleetIntegrityDiagnostic` + correção manual por veículo ou script recalc em lote. |
| **Fase B — perfis sem acesso** | Revert `modulePermissions.ts` ou restaurar aliases; redeploy FE apenas. |
| **Fase C — Nomus preview quebrado** | Revert helper snapshot; preview volta a `null` (estado anterior documentado). |
| **test-db** | Revert guard; restaurar acesso dev. |
| **Geral** | Cada fase = PR/commit isolado; `git revert <hash>` por fase; não misturar domínios no mesmo revert. |

---

## 8. Checklist de execução

Ver arquivo operacional: [`system-integrity-implementation-checklist.md`](./system-integrity-implementation-checklist.md)

**Ordem para o próximo prompt:**

1. **Fase A** (Frota P0) — INT-001, INT-004, INT-013, INT-038  
2. **Fase B** (Permissões P0) — INT-002, INT-003, INT-008, INT-009, INT-010 — **confirmar decisão aliases antes**  
3. **Fase C** (Nomus + segurança) — INT-005, INT-015  

Cada fase: branch/PR isolado, testes §6, validação manual §4, sem alterar regras de negócio fora do achado.

---

*Plano derivado de auditoria read-only. Código citado verificado em 2026-06-05.*
