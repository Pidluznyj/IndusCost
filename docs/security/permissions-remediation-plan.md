# Plano de remediação — permissões

**Status:** planejamento apenas (sem alteração de runtime).  
**Arquitetura:** `permissions-definitive-architecture.md`.  
**Diagnóstico:** commit `48ef617`.

---

## 1. Objetivos

1. Uma única decisão efetiva de autorização no backend.
2. Matriz administrativa = fonte de grants/denies **lidos em runtime**.
3. Eliminar bleeds (AP→Conciliação, `costs.view`→RH, ROLE_MATRIX, path unmapped).
4. Migrar sem converter bugs históricos em permissões oficiais.
5. Caso piloto **Leticia**: somente Contas a Pagar.

---

## 2. Fases (visão)

| Fase | Nome | Objetivo | Migration? | Servidor? |
|------|------|----------|------------|-----------|
| 0 | Contrato & verdade | Fechar docs + tabela-verdade + critérios | Não | Não |
| 1 | Validador CI | Fail build se contrato≠seed≠FE≠sidebar | Não | Não |
| 2 | Resolvedor BE (shadow) | Implementar resolve; comparar com legado; não enforce | Não* | Log only |
| 3 | DTO sessão | `/api/auth/me` devolve `effective` | Talvez version | Deploy |
| 4 | Deny real + dual-write | UI/persistência deny; materialize sem baseline indesejado no modo restrição | Não | Deploy |
| 5 | Remover ROLE_MATRIX / fallbacks FE | Default DENY | Não | Deploy |
| 6 | Aliases 1:1 + mega-keys | Hotfix bleeds; migração controlada | Scripts dry-run | Deploy+report |
| 7 | Unificar catálogo | Contrato → seed/FE | Seed sync | Deploy |
| 8 | Sidebar/rotas/abas/botões | Mesmo resourceKey | Não | Deploy |
| 9 | Guards API por módulo | Pessoas, Máquinas, Financeiro, piloto AP | Não | Deploy |
| 10 | Snapshot & comparação | Etapa A preservação | Não (report) | Read-only DB |
| 11 | Backfill saneado | Etapa B — só grants classificados | Sim/script | Ops |
| 12 | Sessão/cache | Version + invalidação | Sim (campo) | Deploy |
| 13 | Auditoria & RC | Gaps zero críticos; Leticia verde | Não | Homolog |
| 14 | Remover legado | Bag deixa de ser fonte | Sim opcional | Deploy final |

\*Shadow pode usar só código.

**Total de fases de implementação encadeáveis:** **24 prompts** (§4) agrupados nas fases acima.

---

## 3. Estratégia de migração sem alterar acessos à força

### Etapa A — Preservação (obrigatória antes de enforce)

1. Script **read-only** (futuro): para cada `AppUser`, calcular:
   - acesso legado atual (bag + aliases atuais);
   - acesso estruturado se resolvedor novo rodasse;
   - diff classificado.
2. Classificar cada grant efetivo:

| Classe | Significado | Ação na Etapa B |
|--------|-------------|-----------------|
| INTENTIONAL | Override allow / perfil explícito | Preservar como override/resource |
| ROLE_BASELINE | Vem do preset da role | Preservar só se produto confirmar |
| PROFILE | Veio do AccessProfile | Preservar se perfil ainda desejado |
| DIRECT_LEGACY | Chave na bag sem override | Projetar 1:1 se mapeável |
| ALIAS_BLEED | Ex.: AP→Conciliação | **Não** promover; reportar |
| MEGA_KEY | Ex.: `costs.view`→RH | **Não** promover; mapear intent se houver |
| FALLBACK | ROLE_MATRIX / unmapped path | **Não** promover |
| ERROR | Inconsistência | Investigar |

3. Gerar relatório CSV/MD por usuário (inclui Leticia).
4. **Não** escrever grants canônicos a partir de ALIAS_BLEED / MEGA_KEY / FALLBACK.

### Etapa B — Saneamento controlado

1. Hotfix de aliases (para de criar bleed novo) **depois** do snapshot A.
2. Aplicar overrides explícitos conforme intenção de negócio (piloto Leticia primeiro).
3. Remover mega-keys das listas de API após usuários terem keys canônicas.
4. Backfill só com aprovação do relatório.

### Caso Leticia (aceite)

| Recurso | Alvo |
|---------|------|
| `financeiro.contas_pagar` view (+ execute se política) | ALLOW |
| `financeiro.conciliacao_carteira` | DENY |
| Demais `financeiro.*` | DENY |
| `admin.employees*` | DENY |
| `operations.machines` | DENY |
| `engineering.*` / produtos | DENY |
| `suprimentos*` | DENY |
| Comercial (se intenção só AP) | DENY (modo restrição) |
| Dashboard | Negócio decide; default DENY no piloto restrito |

---

## 4. Backlog — prompts cirúrgicos futuros

Cada prompt futuro: analisar → propor → implementar → avaliar → corrigir → testar → documentar → commit → push.

### P01 — Contrato e tabela-verdade final

- **Objetivo:** Codificar a verdade de `permissions-definitive-architecture.md` em tipos/docs de contrato versionados.
- **Escopo:** `permissionContract/*`, doc de precedência, testes de tabela-verdade unitários (sem mudar runtime).
- **Deps:** nenhuma.
- **Risco:** baixo.
- **Aceite:** testes da matriz SUPER_ADMIN/deny/inherit/unknown→deny.
- **Testes:** contract truth-table.
- **Rollback:** reverter commit.
- **Migration:** não. **Servidor:** não.

### P02 — Validador de consistência CI

- **Objetivo:** Falhar CI se contrato ≠ seed ≠ FE keys ≠ sidebar map **em gaps novos**.
- **Escopo:** `check:permission-consistency` + baseline temporário + npm/test.
- **Deps:** P01.
- **Risco:** baixo (baseline → error em regressões).
- **Aceite:** detecta ausência `admin.employees` no seed vs FE; strict verde com baseline.
- **Docs:** `docs/security/permissions-consistency.md`
- **Rollback:** desligar script.
- **Migration:** não.
- **Status:** implementado (2026-07-16).

### P03 — Resolvedor backend único (shadow)

- **Objetivo:** `resolveEffectiveAccess` + comparação com bag/aliases; log divergências.
- **Escopo:** `src/lib/security/effectiveAccess/*` (sem wire em `/me` ainda).
- **Deps:** P01.
- **Risco:** médio (perf quando wired).
- **Aceite:** fixtures role/perfil/allow/deny/parent/Leticia/alias/mega-key; shadow Leticia `next_stricter` em bleed.
- **Rollback:** módulo não referenciado pelo runtime.
- **Migration:** não.
- **Status:** implementado (2026-07-16) — **sem** substituir login/sidebar/APIs.

### P04 — DTO de sessão

- **Objetivo:** `/api/auth/me` retorna `effectiveAccess` (+ version placeholder).
- **Escopo:** tipos FE-safe, builder P03, validação, flag `EFFECTIVE_ACCESS_DTO_IN_ME`, bag intacta.
- **Deps:** P03.
- **Risco:** baixo (flag default off; clients ignoram campo).
- **Aceite:** DTO Leticia/SA/VIEWER vazio válidos; `/me` sem flag inalterado.
- **Rollback:** desligar flag.
- **Migration:** `permissionsVersion` ainda placeholder (P21).
- **Status:** implementado (2026-07-16) — shadow.
- **Docs:** `permissions-effective-access-dto.md`

### P05 — Deny real na UI/API admin

- **Objetivo:** desmarcar baseline allow → deny persistido; clear override; modo restrição absoluta.
- **Escopo:** `overridesPayloadFromDraft`, `userPermissionAdmin*`, UI matriz.
- **Deps:** P01.
- **Risco:** médio (muitos overrides).
- **Aceite:** VIEWER + deny comercial → dual-write sem `crm.view`.
- **Rollback:** limpar overrides / restore-role-default; modo `absolute` só sob demanda.
- **Migration:** não (Boolean? já modela INHERIT/ALLOW/DENY).
- **Status:** implementado (2026-07-16).
- **Docs:** `permissions-override-persist.md`

### P06 — Correção dual-write

- **Objetivo:** materialize respeita deny; não reintroduz comercial no modo restrição; aliases só 1:1.
- **Escopo:** `permissionDualWrite/*`, `permissionRolePresets.ts`, create-user, apply perfil.
- **Deps:** P05.
- **Risco:** médio.
- **Aceite:** fixture Leticia bag sem bleed keys; sem baseline VIEWER silencioso no create.
- **Rollback:** reaplicar preset/perfil; sem migration.
- **Migration:** não.
- **Status:** implementado (2026-07-16).
- **Docs:** `permissions-dual-write.md`

### P07 — Remover fallback ROLE_MATRIX VIEWER

- **Objetivo:** bag vazia ⇒ nenhum menu (exceto SUPER_ADMIN).
- **Escopo:** `permissionsClient.ts` `resolveRawFlags`.
- **Deps:** P04 (bag/DTO sempre populados no create user).
- **Risco:** baixo–médio.
- **Aceite:** VIEWER bag vazia não vê Engenharia; teste diagnóstico invertido.
- **Rollback:** reverter commit.
- **Migration:** não.
- **Status:** implementado (2026-07-16).
- **Docs:** `permissions-frontend-fallbacks.md`

### P08 — Catálogo/seed alinhados

- **Objetivo:** engineering.*, admin.employees*, opex no contrato+seed; FE derivado.
- **Escopo:** seed data, contract resources, generate ou sync FE.
- **Deps:** P02.
- **Risco:** médio.
- **Aceite:** validador CI verde em error mode.
- **Rollback:** seed previous.
- **Migration:** seed sync no servidor.
- **Status (2026-07-16):** **feito.** Seed = legado PT ∪ derivados do contrato (`permissionSeedFromContract`); `configuracoes` deprecated retain; bridges PT obsoletos no contrato; FE+sidebar cobrem opex/taxes/reports/suppliers; strict consistency verde (baseline só ALIAS_* + FE_BE_KEY_MISMATCH + PERMISSIVE_FALLBACK). Dry-run: `permissions:seed:contract:dry` — **não** apply em produção.

### P09 — Aliases 1:1 (hotfix bleeds)

- **Objetivo:** Remover `finance.accountsPayable.view` de pai/conciliação; `costs.view` fora de RH/máquinas/suprimentos/simulador.
- **Escopo:** `permissionsClient.ts`, `permissionResourceSeedData.ts`, lists API.
- **Deps:** Snapshot Etapa A (P19) **antes** em produção; em código pode ir após snapshot local.
- **Risco:** **alto** em prod sem regrant.
- **Aceite:** testes diagnóstico passam no comportamento **desejado**.
- **Rollback:** revert aliases; restaurar bags do backup.
- **Migration:** não. **Servidor:** report + possível regrant.

### P10 — Migração sidebar

- **Objetivo:** Todo item com resourceKey; opex mapeado; grupos sem elevação indevida.
- **Escopo:** `sidebarMenuResources`, `sidebarNavigation`, `resourceNavigationAccess`.
- **Deps:** P04, P08.
- **Risco:** médio.
- **Aceite:** Leticia sidebar só AP (+ dashboard se política).
- **Rollback:** revert.

### P11 — Proteção de rotas

- **Objetivo:** Path unmapped → DENY ou allowlist; Layout 100% resource.
- **Escopo:** `resourceNavigationAccess`, `Layout.tsx`, App routes map.
- **Deps:** P10.
- **Risco:** médio (rotas esquecidas).
- **Aceite:** `/employees`  deny sem grant; unmapped sensível bloqueado.
- **Rollback:** revert.

### P12 — Proteção de abas

- **Objetivo:** Tabs finance/CRM/etc. via `filterTabsByView` + keys canônicas.
- **Escopo:** FinanceModule, CRM tabs, portfolio tabs.
- **Deps:** P10.
- **Risco:** médio.
- **Aceite:** AP não mostra abas de conciliação.
- **Rollback:** revert.

### P13 — Proteção de botões

- **Objetivo:** PermissionGate/`canExecute`/`canManage` no DTO.
- **Escopo:** componentes críticos (users, employees, payables mutations).
- **Deps:** P04.
- **Risco:** baixo–médio.
- **Aceite:** botão mutação oculto+API 403 alinhados.
- **Rollback:** revert UI.

### P14 — Guards backend genéricos

- **Objetivo:** `requireResource(key, action)` middleware.
- **Escopo:** `permissionGuards` / novo helper; migração gradual rotas.
- **Deps:** P03.
- **Risco:** alto se big-bang — fazer por módulo.
- **Aceite:** helper testado; 2–3 rotas piloto.
- **Rollback:** flag dual-check.

### P15 — Migração Pessoas/RH

- **Objetivo:** Remover `costs.view` de `EMPLOYEES_*`; resource `admin.employees*`.
- **Escopo:** `employeesPermissions`, `server.ts` employees, lookups.
- **Deps:** P09, P14, P08.
- **Risco:** alto.
- **Aceite:** Leticia 403 em GET `/api/employees`.
- **Rollback:** re-add costs temporário + feature flag.
- **Migration:** não. **Servidor:** regrant RH users.

### P16 — Migração Máquinas

- **Objetivo:** Só `operations.machines` / `machines.view` 1:1; sem costs.
- **Escopo:** modulePermissions, machines routes.
- **Deps:** P09, P14.
- **Risco:** médio.
- **Aceite:** costs.view não abre `/machines`.
- **Rollback:** flag.

### P17 — Migração Financeiro

- **Objetivo:** Cada seção com key; `finance.view` não abre tudo; AP isolado.
- **Escopo:** finance*Permissions, FinanceModule nav, routes.
- **Deps:** P09, P12, P14.
- **Risco:** alto.
- **Aceite:** AP ≠ Conciliação ≠ AR ≠ fluxo.
- **Rollback:** flag.

### P18 — Caso piloto Contas a Pagar

- **Objetivo:** E2E Leticia desejado; fixtures + UI + API.
- **Escopo:** testes integração, doc homologação, seed de usuário de teste (não prod).
- **Deps:** P05–P17.
- **Risco:** médio.
- **Aceite:** checklist Leticia 100%.
- **Rollback:** N/A testes.

### P19 — Comparação legado vs novo (Etapa A)

- **Objetivo:** Relatório read-only impacto.
- **Escopo:** script dry-run (não altera dados).
- **Deps:** P03.
- **Risco:** baixo.
- **Aceite:** CSV com classes ALIAS_BLEED/MEGA_KEY.
- **Rollback:** N/A.
- **Servidor:** execução read-only futura.

### P20 — Backfill (Etapa B)

- **Objetivo:** Escrever overrides/canônicos só para classes aprovadas.
- **Escopo:** script apply com `--dry-run` / `--apply`.
- **Deps:** P19 + aprovação humana.
- **Risco:** **crítico**.
- **Aceite:** dry-run revisado; apply com backup.
- **Rollback:** restaurar dump + bags.
- **Migration/script:** sim. **Servidor:** sim.

### P21 — Sessão / cache

- **Objetivo:** `permissionsVersion`; invalidar sessões; FE reload.
- **Escopo:** auth session, save overrides, AuthContext.
- **Deps:** P04.
- **Risco:** médio.
- **Aceite:** deny RH → aba antiga recebe 403/`me` desatualizado detectado.
- **Rollback:** desligar invalidação.
- **Migration:** campo version.

### P22 — Auditoria

- **Objetivo:** Log de quem alterou ACL; origem do acesso na UI.
- **Escopo:** admin audit already partial + UI source badges.
- **Deps:** P05.
- **Risco:** baixo.
- **Aceite:** trilha save matriz.
- **Rollback:** revert UI.

### P23 — Regressão

- **Objetivo:** Suite personas (§ test matrix); inverter testes DIAG.
- **Escopo:** `permissionsRuntimeDiagnosis` → desired behavior; persona tests.
- **Deps:** P18.
- **Risco:** baixo.
- **Aceite:** CI verde; zero DIAG “bleed esperado”.
- **Rollback:** N/A.

### P24 — Release candidate

- **Objetivo:** Homolog + checklist deploy; gaps críticos/altos = 0.
- **Escopo:** docs runbook, smoke, Leticia, SUPER_ADMIN last.
- **Deps:** P15–P23.
- **Risco:** release.
- **Aceite:** ver §5.
- **Rollback:** plano §6.
- **Servidor:** deploy homolog→prod.

---

## 5. Critérios de aceite da solução definitiva

- [ ] Uma única decisão efetiva (resolvedor BE).
- [ ] Deny individual funciona (role e perfil).
- [ ] Nenhum fallback “sem chave = permitido”.
- [ ] VIEWER bag vazia não libera módulos.
- [ ] Nenhuma mega-key libera módulo não relacionado.
- [ ] FE e BE mesmo resourceKey.
- [ ] Rota direta bloqueada sem grant.
- [ ] API direta bloqueada sem grant.
- [ ] Sidebar / aba / botão alinhados.
- [ ] Sessão atualiza após mudança (version/invalidação).
- [ ] SUPER_ADMIN bypass + último SUPER_ADMIN protegido.
- [ ] Legados migrados com relatório (bugs não promovidos).
- [ ] Zero endpoint sensível só com auth.
- [ ] Zero gap crítico/alto na auditoria RC.
- [ ] Testes Leticia passam no comportamento **desejado**.
- [ ] Build + checks + testes verdes.

---

## 6. Riscos críticos

| Risco | Mitigação |
|-------|-----------|
| Remover `costs.view` quebra usuários legítimos de custos | Snapshot A; regrant `opex.view` / keys canônicas antes do enforce |
| Modo restrição remove comercial de todos VIEWER | Opt-in por usuário; piloto Leticia |
| Payload `me` grande | allowlist compacta + cache |
| Path unmapped DENY quebra deep links | Allowlist explícita de rotas públicas autenticadas |
| Backfill promove bleed | Classes ALIAS_BLEED/MEGA nunca auto-apply |
| Dual shadow diverge | Bloquear enforce até taxa divergência < limiar |

---

## 7. Rollback (por camada)

| Camada | Rollback |
|--------|----------|
| Código | Revert git / redeploy previous artifact |
| Feature flags | Desligar enforce resolvedor; voltar bag |
| Dados overrides | Restore table `UserPermissionOverride` do backup |
| Bags | Restore `AppUser.permissions` do snapshot A |
| Sessão | Logout em massa / restart limpa cache version |
| Seed | Re-seed previous revision |

**Regra:** nenhum P09–P20 em produção sem backup DB + snapshot A.

---

## 8. Deploy futuro (não executar agora)

1. Backup DB + export bags/overrides.  
2. Sync Nomus check (ops).  
3. Migration `permissionsVersion` se P21.  
4. Seed sync contrato.  
5. Dry-run P19; revisar.  
6. Build + deploy.  
7. Restart.  
8. Smoke SUPER_ADMIN / ADMIN / Leticia.  
9. Monitor 403 spike + shadow diff.  
10. Rollback code+data se regressão.

---

## 9. Dependências entre prompts (resumo)

```
P01 → P02 → P08
P01 → P03 → P04 → P21
P01 → P05 → P06 → P09
P04 → P07 → P10 → P11 → P12 → P13
P03 → P14 → P15|P16|P17 → P18
P03 → P19 → P20
P18 → P23 → P24
P05 → P22
```

Hotfix P09 **depois** de P19 em produção; em dev pode prototipar com fixtures.

---

## 10. Confirmação anti-diagnóstico

| Causa | Prompt(s) |
|-------|-----------|
| 1 Alias AP | P09, P17, P18 |
| 2 costs mega | P09, P15, P16, megakey doc |
| 3 Baseline VIEWER | P05, P06, P18 |
| 4 Deny frágil | P05 |
| 5 ROLE_MATRIX | P07 |
| 6 Catálogos | P01, P02, P08 |
| 7 Chaves divergentes | P10–P17 |
| 8 Matriz ≠ runtime | P03, P04 |

Bugs **não** preservados como oficiais: §3 Etapa A classes ALIAS_BLEED / MEGA_KEY / FALLBACK.
