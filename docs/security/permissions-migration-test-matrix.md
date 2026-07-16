# Matriz de testes — migração de permissões

**Status:** plano de testes (execução nas fases P18/P23/P24).  
**Arquitetura:** `permissions-definitive-architecture.md`.  
**Caso âncora:** Leticia — somente Contas a Pagar.

Legenda de resultado: **A** = allow / visível / 200; **D** = deny / oculto / 403; **—** = N/A.

---

## 1. Personas

| ID | Persona | Setup alvo |
|----|---------|------------|
| SA | SUPER_ADMIN | role SUPER_ADMIN, bag irrelevante |
| AD | ADMIN | role ADMIN + preset |
| V0 | VIEWER sem permissões | role VIEWER, overrides vazios, bag vazia / materialize mínimo |
| VL | VIEWER só Contas a Pagar (**Leticia**) | VIEWER + allow só `financeiro.contas_pagar` (+ modo restrição: deny resto) |
| RD | Role ampla + deny individual | ADMIN ou VIEWER comercial + deny `admin.employees` |
| PD | Perfil + deny | AccessProfile amplo + deny RH |
| CM | Gestor comercial | COMMERCIAL_MANAGER preset |
| SE | Vendedor | SELLER + seller ids |
| FR | Financeiro leitura | allows view finance submenus sem execute |
| RH | RH | `admin.employees` view (+ facets se houver) |
| EN | Engenharia | `engineering.products` / products.view 1:1 |
| LG | Usuário legado | bag com `costs.view` + `finance.view` (pré-saneamento) |
| SX | Sessão stale | VL após revoke mid-session |

---

## 2. Dimensões a testar (todas as personas)

Para cada persona, cobrir:

| Dimensão | Como |
|----------|------|
| Sidebar | Itens/grupos visíveis |
| Rota direta | Navigate URL / Layout |
| Aba | Tabs internas |
| Botão | Mutação UI |
| API GET | 200/403 |
| API mutação | POST/PUT/DELETE |
| Exportação | se existir |
| Sessão | `/api/auth/me` effective |
| Revogação | save deny → efeito |
| Parent/child | grupo vs submenu |
| Allow/deny | matriz |
| Aliases | legacy key não sangra |
| Logout/login | consistência |
| Refresh | F5 |
| Duas abas | stale vs nova |

---

## 3. Matriz resumida — navegação crítica

| Recurso / path | SA | AD | V0 | VL (Leticia) | RD | RH | EN | LG pré | LG pós-saneamento |
|----------------|----|----|----|--------------|----|----|----|--------|-------------------|
| Dashboard | A | A* | D | D** | A* | D | D | A? | conforme grant |
| Financeiro grupo (UX) | A | A | D | A (se filho) | A | D | D | A | A se AP |
| Contas a Pagar | A | A | D | **A** | A* | D | D | A? | A se AP |
| Conciliação | A | A | D | **D** | A* | D | D | A se bleed | **D** sem grant |
| Outros finance | A | A | D | **D** | * | D | D | * | * |
| Pessoas/RH `/employees` | A | A | D | **D** | **D** | **A** | D | A se costs | **D** sem employees |
| Máquinas | A | A | D | **D** | * | D | D | A se costs | **D** |
| Engenharia/Produtos | A | A | D | **D** | * | D | **A** | A se products | conforme |
| Suprimentos | A | A | D | **D** | * | D | D | A se costs/mat | **D** |
| OPEX | A | A | D | **D** | * | D | D | A se costs | só opex.view |
| Comercial/Pedidos | A | A | D | **D** (restrição) | * | D | D | * | * |
| Admin Usuários | A | A | D | **D** | * | D | D | D | D |

\* conforme preset role.  
\*\* política produto: piloto Leticia **sem** dashboard salvo grant explícito.

---

## 4. Matriz API — Leticia (VL) e RH

| Endpoint (exemplos) | VL | RH | Sem auth |
|---------------------|----|----|----------|
| `GET /api/auth/me` | A (effective só AP) | A | D |
| `GET /api/employees` | **D** | A | D |
| `GET /api/employees/lookups/*` | **D** | A | D |
| APIs Contas a Pagar (GET) | **A** | D | D |
| APIs Contas a Pagar (mutação) | D se só view | D | D |
| Portfolio reconciliation GET | **D** | D | D |
| Machines GET | **D** | D | D |
| Products GET | **D** | D | D |

Lista exata de rotas finance/AP a fechar no P17/P18.

---

## 5. Cenários allow/deny / parent-child

| # | Setup | Esperado |
|---|-------|----------|
| T1 | Override allow AP | AP A; conciliação D |
| T2 | Baseline VIEWER comercial + deny comercial | Comercial D; sem `crm.view` na bag dual-write |
| T3 | Clear override (voltar herança) | Volta ao baseline role |
| T4 | Parent financeiro deny + child AP allow | Save rejeitado ou child efetivo D (política arch) |
| T5 | Parent virtual UX com só AP | Grupo visível; rotas/APIs irmãos D |
| T6 | Role ADMIN + deny employees | Sidebar/API RH D |
| T7 | Profile Visualizador + deny products | Engenharia D |
| T8 | Resource inexistente | D |
| T9 | Action execute sem view | D execute; UI botão D |
| T10 | SUPER_ADMIN | tudo A; matriz read-only |

---

## 6. Sessão e revogação

| # | Cenário | Esperado |
|---|---------|----------|
| S1 | Save ACL outro user | Alvo: próximo me/request D; admin UI atualiza alvo |
| S2 | Self-edit | `loadMe` imediato |
| S3 | Duas abas; revoke RH | Aba antiga: 403 ou force reload por version |
| S4 | Logout/login | Effective = matriz |
| S5 | Refresh F5 | Sem ROLE_MATRIX fantasma |
| S6 | localStorage limpo | ACL intacta (vem do me) |

---

## 7. Caso Leticia — checklist de aceite E2E

### Desejado

- [ ] Sidebar: Contas a Pagar acessível (via Financeiro se UX de grupo).
- [ ] Dentro de `/finance`: seção Contas a Pagar visível.
- [ ] APIs GET de AP autorizadas para view.
- [ ] Label role Visualizador ok.

### Bloqueado

- [ ] Conciliação de Carteira (menu, rota, abas, API).
- [ ] Contas a Receber / Fluxo / Relatório (sem grant).
- [ ] Pessoas/RH (menu, `/employees`, API).
- [ ] Máquinas.
- [ ] Engenharia / Simulador / Simulações.
- [ ] Suprimentos / OPEX.
- [ ] Comercial / Pedidos (no piloto restrição absoluta).
- [ ] Administração / Usuários / Permissões.

### Sessão

- [ ] `/api/auth/me` → `effective.byResource['financeiro.contas_pagar'].canView === true`.
- [ ] Conciliação e `admin.employees` canView false.
- [ ] Sem depender de `costs.view` / bleed AP.

### Regressão código

- [ ] Antigos testes DIAG de “bleed confirmado” viram testes de **não-bleed**.
- [ ] `permissionsRuntimeDiagnosis` atualizado ou substituído por suite desired.

---

## 8. Usuário legado (LG)

| Fase | Teste |
|------|-------|
| Pré P09 | Documentar acesso via costs (comportamento atual) |
| Shadow P03 | Diff report lista MEGA_KEY |
| Pós regrant | Mesmas tarefas com keys canônicas |
| Pós enforce | costs.view na bag **não** abre RH |
| Pós limpeza | Bag sem costs |

---

## 9. Automação sugerida

| Camada | Onde |
|--------|------|
| Unit | truth-table resolvedor; aliases 1:1; dual-write Leticia |
| Integration | requireResource em rotas piloto |
| Component | Sidebar filter VL |
| E2E (homolog) | Checklist §7 manual ou Playwright futuro |
| CI | `check:permission-consistency` + suite personas smoke |

---

## 10. Critério de saída da matriz

Migração só fecha quando:

1. Todas as personas §1 têm linha verde nas dimensões §2 para módulos do seu escopo.  
2. Leticia §7 100%.  
3. LG pós-saneamento sem dependência de mega-key.  
4. SX (stale session) coberto por P21.
