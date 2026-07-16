# Alternativas de solução definitiva — permissões (sem implementação)

Contexto: diagnóstico em `permissions-runtime-diagnosis.md`. Este documento **não** implementa nada; compara caminhos para a correção futura.

---

## Princípios desejados (alvo)

1. Uma intenção na matriz (“somente Contas a Pagar”) produz **exatamente** esse acesso em menu, rota e API.
2. Uma única fonte de verdade no runtime.
3. Deny explícito e ausência de grant distintos e previsíveis.
4. Sem mega-keys que abram módulos não relacionados.
5. FE e BE usam as mesmas `resourceKey` / flags.

---

## Alternativa 1 — Corrigir somente fallbacks / aliases

**Descrição:** Remover `finance.accountsPayable.view` dos aliases do pai `financeiro` e de `financeiro.conciliacao_carteira`; restringir `costs.view` fora de RH/Máquinas/Suprimentos; alinhar `ROLE_MATRIX` ao seed; mapear `opex` a resourceKey.

**Impacto:** Corrige bleeds mais gritantes com mudança localizada.  
**Risco:** Médio — usuários que “funcionavam” via alias amplo perdem acesso até regrant.  
**Compatibilidade:** Alta no curto prazo (bag legada continua).  
**Migration:** Não obrigatória; possível script de limpeza de bags.  
**Usuários existentes:** Podem precisar reajuste manual/matriz.  
**Logout:** Recomendado após deploy.  
**Esforço:** Baixo–médio.  
**Recomendação:** **Fazer como hotfix pontual**, insuficiente sozinha.

---

## Alternativa 2 — Corrigir precedência e deny

**Descrição:** Garantir que desmarcar sempre persista deny quando a intenção for negar; UI não confundir “igual ao baseline” com “usuário sem acesso se baseline for V”; opção “modo restrição absoluta” que gera deny em tudo que não estiver marcado.

**Impacto:** Matriz passa a conseguir retirar baseline VIEWER (comercial etc.).  
**Risco:** Médio — muitos overrides no DB.  
**Compatibilidade:** Boa se dual-write atualizado.  
**Migration:** Opcional (backfill denies).  
**Usuários:** Quem dependia do baseline amplo pode perder menus.  
**Logout:** Sim.  
**Esforço:** Médio.  
**Recomendação:** **Necessária** junto com (1) ou (3).

---

## Alternativa 3 — Resolvedor único obrigatório

**Descrição:** Um módulo (`resolveEffectiveAccess(user, resourceKey, action)`) usado por sidebar, Layout, PermissionGate e middleware API. Acaba com `canAccessModule` paralelo e ROLE_MATRIX divergente.

**Impacto:** Elimina divergência FE/BE e “menus fantasma”.  
**Risco:** Médio–alto (regressões em módulos ainda legados).  
**Compatibilidade:** Faseada com adapters.  
**Migration:** Não necessariamente de schema.  
**Usuários:** Comportamento muda onde havia fallback permissivo.  
**Logout:** Sim.  
**Esforço:** Alto.  
**Recomendação:** **Núcleo da solução definitiva**.

---

## Alternativa 4 — Remover dependência direta de role no frontend

**Descrição:** FE não usa `ROLE_MATRIX` nem `role === VIEWER` para liberar menu; role só para label e SUPER_ADMIN bypass alinhado ao BE.

**Impacto:** Bag vazia deixa de abrir Engenharia.  
**Risco:** Baixo se bag sempre materializada no create/save.  
**Compatibilidade:** Alta.  
**Migration:** Não.  
**Usuários:** VIEWER com bag vazia perde menus fantasma (desejável).  
**Logout:** Sim.  
**Esforço:** Baixo–médio.  
**Recomendação:** **Incluir** na solução definitiva.

---

## Alternativa 5 — Permissões efetivas calculadas pelo backend

**Descrição:** `/api/auth/me` (e guards) calculam flags a partir de role preset + overrides (+ opcional profile) **no servidor**, retornando `effectiveResourceFlags` ou bag já canônica. Sessão não “confia” só em snapshot desatualizado sem recálculo.

**Impacto:** Editor e runtime passam a falar a mesma língua; overrides passam a valer mesmo se dual-write falhar.  
**Risco:** Médio (performance; contrato do `me`).  
**Compatibilidade:** Dual-write pode permanecer temporário.  
**Migration:** Não obrigatória.  
**Usuários:** Acesso reflete matriz após próximo `me`.  
**Logout:** Ideal; ou `me` a cada load.  
**Esforço:** Médio–alto.  
**Recomendação:** **Fortemente recomendada** com (3).

---

## Alternativa 6 — Migrar sidebar, rotas e APIs para o mesmo resourceKey

**Descrição:** Seed = FE catalog; toda rota/API usa `financeiro.contas_pagar`, `admin.employees`, etc.; listas `EMPLOYEES_VIEW_PERMISSIONS` deixam de aceitar `costs.view` como RH.

**Impacto:** Contas a Pagar deixa de abrir Conciliação; RH deixa de abrir por costs.  
**Risco:** Alto se feito de uma vez — quebra quem só tem mega-keys.  
**Compatibilidade:** Precisa período com aliases.  
**Migration:** Seed sync + possível data fix.  
**Usuários:** Regrant necessário para keys canônicas.  
**Logout:** Sim.  
**Esforço:** Alto.  
**Recomendação:** **Obrigatória** para fechar o buraco estrutural.

---

## Alternativa 7 — Compatibilidade legada temporária

**Descrição:** Manter dual-write e aliases **restritos** (1:1, sem cruzamento AP↔Conciliação; sem `costs.view`→RH) durante transição; telemetria de keys legadas ainda em uso.

**Impacto:** Permite deploy gradual.  
**Risco:** Baixo se aliases forem estreitos.  
**Compatibilidade:** Máxima.  
**Migration:** Não.  
**Usuários:** Menor atrito.  
**Logout:** Conforme releases.  
**Esforço:** Médio (governança).  
**Recomendação:** **Usar como ponte**, com prazo de remoção.

---

## Alternativa 8 — Eliminar modelo legado após transição

**Descrição:** Remover `AppUser.permissions[]` como fonte (ou torná-lo cache derivado), apagar ROLE_MATRIX, `canAccessModule` legado, mega-keys do catálogo.

**Impacto:** Modelo único limpo.  
**Risco:** Alto se prematuro.  
**Compatibilidade:** Só após (5)+(6)+(7).  
**Migration:** Sim (dados + código).  
**Usuários:** Todos revalidados.  
**Logout:** Sim.  
**Esforço:** Muito alto.  
**Recomendação:** **Fase final**, não primeiro passo.

---

## Pacote recomendado (ordem)

1. **Hotfix de aliases** (Alt. 1) — para o bleed Contas a Pagar → Conciliação e `costs.view`→RH.  
2. **Deny / modo restrição** (Alt. 2) — para VIEWER não reabrir Comercial sem querer.  
3. **Remover ROLE_MATRIX FE** (Alt. 4).  
4. **Effective flags no backend + resolvedor único** (Alt. 5 + 3).  
5. **Unificar resourceKeys sidebar/rotas/APIs** (Alt. 6) com ponte (Alt. 7).  
6. **Eliminar legado** (Alt. 8) quando telemetria zerar.

**Não recomendado:** só esconder itens na sidebar sem alinhar API/rota; só “pedir logout” sem corrigir aliases; só documentar sem mudança de resolvedor.

---

## Checklist de aceite (pós-correção futura)

- [ ] Usuário VIEWER com somente `financeiro.contas_pagar` view: vê/abre Contas a Pagar; **não** vê Conciliação, Engenharia, RH, Máquinas, Suprimentos, opex.  
- [ ] Desmarcar Comercial gera deny efetivo (menu e API).  
- [ ] `/api/employees` 403 sem grant RH canônico.  
- [ ] `/api/auth/me` reflete matriz sem depender de bag “suja”.  
- [ ] Testes que hoje documentam o bug passam a afirmar o comportamento desejado (invertidos conscientemente).
