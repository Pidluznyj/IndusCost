# Arquitetura definitiva — Usuários e Permissões

**Status:** contrato de solução (sem implementação neste documento).  
**Base:** diagnóstico `48ef617` — `permissions-runtime-diagnosis.md`, `permissions-test-user-trace.md`, `permissions-definitive-solution-options.md`.  
**Princípio:** o frontend **nunca** é autoridade de segurança; o backend resolve e valida.

---

## 1. Decisões fechadas

| # | Decisão | Valor |
|---|--------|--------|
| 1 | Resolvedor oficial | `resolveEffectiveAccess` (novo módulo backend, ex.: `src/lib/security/effectiveAccessResolver.ts`) |
| 2 | Onde roda | **Sempre no backend** (guards API + montagem de `/api/auth/me`). FE só consome DTO |
| 3 | DTO de sessão | `EffectiveAccessDto` em `/api/auth/me` (ver §4) |
| 4 | Contrato FE/BE | Uma fonte tipada (`permissionContract`) → seed, FE catalog, navegação, testes |
| 5 | Combinação | Role baseline ⊕ AccessProfile snapshot ⊕ overrides allow/deny (ver §3) |
| 6 | Deny | Deny explícito **vence** role e perfil |
| 7 | Parent/filho | Parent negado ⇒ filhos inacessíveis na UI e na API; filho allow **não** eleva parent MENU automaticamente (ver exceção §3.2) |
| 8 | SUPER_ADMIN | Bypass total no resolvedor; matriz read-only |
| 9 | Último SUPER_ADMIN | Mantém guards atuais (`LAST_SUPER_ADMIN`, self `users.manage`) |
| 10 | Sessão após edit | Bump `permissionsVersion` + invalidação de sessões do usuário alvo; FE admin força `loadMe` se self-edit |
| 11 | Transição | Dual-write + aliases **1:1** temporários; snapshot pré-migração |
| 12 | Fim da bag como fonte | Quando telemetria de aliases = 0 e guards 100% resourceKey |
| 13 | Bag durante transição | Cache/materialização **derivada** do resolvedor (não autoridade) |
| 14 | Aliases | Só 1:1 com o recurso canônico; mega-keys proibidas no estado final |
| 15 | APIs | `requireResource(resourceKey, action)` |
| 16 | UI | Sidebar, rota, aba, botão e API usam a **mesma** decisão (DTO ou mirror tipado do DTO) |

---

## 2. Arquitetura alvo (diagrama)

```
┌─────────────────────────────────────────────────────────────┐
│ permissionContract (fonte tipada única)                     │
│  → seed DB · catálogo FE · navegação · validador · docs     │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│ Persistência                                                │
│  AppUser.role                                               │
│  AccessProfile (snapshot aplicado → role + baseline flags)  │
│  UserPermissionOverride (allow | deny por resourceKey+axis) │
│  AppUser.permissions[]  [TEMP: cache dual-write]            │
│  AppUser.permissionsVersion / session epoch                 │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│ resolveEffectiveAccess (BACKEND — autoridade)               │
│  SUPER_ADMIN → ALL                                          │
│  else: rolePreset ⊕ profileBaseline ⊕ overrides             │
│  deny > allow > inherit                                     │
│  unknown resource/action → DENY                             │
└───────────────────────────┬─────────────────────────────────┘
                            │
          ┌─────────────────┴─────────────────┐
          ▼                                   ▼
   EffectiveAccessDto                    requireResource()
   (/api/auth/me)                        (cada API)
          │
          ▼
   AuthContext (só consome)
   canView/Execute/Manage(resourceKey)
   sidebar · Layout · tabs · PermissionGate
```

**Não aceito no alvo:** `ROLE_MATRIX` FE liberando acesso; `canAccessModule` como caminho paralelo permanente; path `unmapped` = allow; `costs.view` abrindo RH/Máquinas/etc.

---

## 3. Precedência final (tabela-verdade)

### 3.1 Ordem de avaliação (por `resourceKey` × eixo view|execute|manage)

1. Se `role === SUPER_ADMIN` → **ALLOW** (todas as ações do contrato).
2. Se `resourceKey` inexistente no contrato → **DENY**.
3. Se `action` não registrada no recurso → **DENY**.
4. Carregar override do usuário para `(resourceKey, axis)`:
   - `deny` → **DENY** (vence tudo abaixo).
   - `allow` → candidato ALLOW (ainda sujeito a parent).
   - ausência → **herdar** do baseline efetivo.
5. Baseline efetivo = merge:
   - **Role preset** (seed oficial por role) como base;
   - Se AccessProfile aplicado: perfil define o **snapshot inicial** de role+flags (substituindo preset puro no momento da aplicação); overrides posteriores apliquem-se sobre esse snapshot.
   - Permissões diretas legadas (`AppUser.permissions[]`) na transição: projetadas para flags estruturadas **somente** via mapa 1:1; nunca via mega-key ampla.
6. Parent chain: se qualquer ancestral MENU/SUBMENU tem view efetiva **DENY**, filho **DENY** para navegação e para APIs daquele subárvore (salvo SUPER_ADMIN).
7. Default final se nada concede → **DENY**.

### 3.2 Parent vs child

| Situação | Resultado alvo |
|----------|----------------|
| Parent deny, child allow | **DENY** filho (inconsistência; validador admin alerta; save rejeita ou força alinhamento) |
| Parent allow, child deny | Filho DENY; irmãos independentes |
| Parent NONE/inherit deny, child allow | Na UI de navegação: filho **não** eleva parent MENU (grupo só aparece se houver filho allow **e** parent não deny). Parent MENU pode ser “virtual” (visível se ≥1 filho allow) **sem** conceder APIs do parent genérico |
| Child allow Contas a Pagar | **Não** concede Conciliação nem `financeiro` genérico |

**Exceção de UX (não de segurança):** grupo accordion “Financeiro” pode renderizar se **qualquer** submenu financeiro tiver view — mas o item `/finance` genérico e APIs `finance.view` **não** liberam. Seções internas exigem resourceKey próprio.

### 3.3 Checkbox / override (contrato UI)

| Ação na matriz | Persistência | Semântica |
|----------------|--------------|-----------|
| Marcar view (≠ baseline) | Override `allow` (`canView: true`) | Conceder explicitamente |
| Desmarcar view (baseline era allow) | Override `deny` (`canView: false`) | Retirar o que role/perfil dava |
| Desmarcar (baseline já NONE) | **Nada** (herdar NONE) ou, em “modo restrição absoluta”, deny explícito em tudo não marcado |
| Igualar ao baseline após editar | **Remover** override (limpar) → volta a herdar |
| “Reset recurso” | Delete override daquele key | Herança pura |

**Modo recomendado do editor (piloto Contas a Pagar / VIEWER restrito):**

- **Modo diferencial** (padrão atual melhorado): diff vs baseline → allow/deny/clear.
- **Modo restrição absoluta** (opt-in por usuário): ao salvar, gera deny em todo recurso do contrato não marcado allow. Necessário para “somente Contas a Pagar” sem herdar comercial VIEWER.

### 3.4 Origem do acesso (auditoria UI)

Cada célula efetiva deve expor `source`:

`SUPER_ADMIN | ROLE | PROFILE | OVERRIDE_ALLOW | OVERRIDE_DENY | LEGACY_PROJECTED | DENY_DEFAULT`

---

## 4. DTO `/api/auth/me`

```ts
type EffectiveAccessDto = {
  user: SafeAppUserIdentity; // id, name, email, role, profile meta, sellers, …
  permissionsVersion: number; // bump em todo save de ACL
  // Transição: manter bag legada somente leitura / deprecada
  legacyPermissions?: string[]; // TEMP — não usar para auth FE
  effective: {
    // mapa compacto resourceKey → flags
    byResource: Record<string, { canView: boolean; canExecute: boolean; canManage: boolean; source: string }>;
    // opcional: lista só dos keys com algum allow (payload menor)
    allowedKeys?: string[];
  };
};
```

**Regras:**

- Cookie/sessão identifica o usuário; **não** embute árvore completa de permissões no token.
- Cada request API: auth → carrega user → `resolveEffectiveAccess` (com cache curto por `userId+permissionsVersion`, ver §5).
- FE: `hasPermission(legacyKey)` torna-se adapter temporário que consulta projeção 1:1; preferir `canView(resourceKey)`.

---

## 5. Sessão, cache e invalidação

| Tema | Decisão |
|------|--------|
| JWT | Identidade/sessão apenas (modelo atual de cookie app) |
| Recálculo | Por request no guard **ou** cache in-memory/Redis keyed por `userId:permissionsVersion` TTL ≤ 60s |
| Save ACL | Incrementa `permissionsVersion`; invalida cache; opcionalmente destrói outras sessões do usuário (revogação crítica) |
| Admin edita outro user | Alvo precisa `me`/reload; ideal: invalidar sessões server-side do alvo |
| Admin edita a si | Resposta do save inclui DTO; client chama `loadMe` imediato |
| Aba antiga | Polling leve de `permissionsVersion` no `me`/heartbeat **ou** 403 + force reload quando versão diverge |
| localStorage | **Proibido** para ACL; só UI chrome (sidebar collapsed) |
| Logout/login | Suficiente como fallback; **não** é o único mecanismo após Fase sessão |

---

## 6. Papéis dos artefatos no alvo

| Artefato | Papel final |
|----------|-------------|
| `permissionContract` | Fonte tipada única |
| Seed / `PermissionResource` | Materialização DB do contrato |
| Role preset | Baseline por role |
| AccessProfile | Template → aplica snapshot (role + flags); não é segundo resolvedor no runtime |
| `UserPermissionOverride` | Allow/deny explícitos — **lidos no runtime** |
| `AppUser.permissions[]` | TEMP cache dual-write → depois derivado ou removido |
| FE catalog | Gerado/validado a partir do contrato (sem árvore paralela solta) |
| `ROLE_MATRIX` | **Removido** |
| `canAccessModule` | Adapter deprecatório → remove |

---

## 7. SUPER_ADMIN e salvaguardas

- Bypass só no resolvedor backend e no FE espelhando `role === SUPER_ADMIN` **após** `me` confiável.
- Matriz de overrides: read-only para SUPER_ADMIN.
- Impedir rebaixar/remover o **último** SUPER_ADMIN ativo (já existe — manter e cobrir com testes RC).
- Self-lock: não remover `users.manage` / acesso admin de si mesmo sem outro SUPER_ADMIN.

---

## 8. Compatibilidade na transição

1. **Fase preserva:** snapshot do acesso efetivo **legado atual** por usuário (relatório; não grava bug como grant oficial sem classificação).
2. **Fase ponte:** dual-write + aliases 1:1; resolvedor novo em shadow mode (compara, não bloqueia).
3. **Fase enforce:** guards e UI leem resolvedor; mega-keys deixam de autorizar módulos cruzados.
4. **Fase limpeza:** remove bag como fonte, ROLE_MATRIX, aliases, `canAccessModule`.

Bugs históricos (AP→Conciliação, `costs.view`→RH) **nunca** viram permissão canônica.

---

## 9. Compatibilidade com o código atual (exceções temporárias)

| Comportamento atual | Tratamento no plano |
|---------------------|---------------------|
| Overrides não lidos no login | Corrigido na Fase resolvedor+DTO |
| Alias AP em pai/conciliação | Hotfix aliases → depois remove |
| `costs.view` mega-key | Migração mega-key (doc dedicado) |
| Baseline VIEWER comercial | Modo restrição absoluta + deny |
| Path unmapped allow | Passar a DENY ou allowlist explícita |
| FE ROLE_MATRIX | Remover |
| FE `admin.employees` fora do seed | Unificar no contrato/seed |

---

## 10. Mapeamento às causas do diagnóstico

| Causa confirmada | Tratamento arquitetural |
|------------------|-------------------------|
| 1 Alias AP amplo | Aliases 1:1; parent não herda alias de filho |
| 2 `costs.view` mega-key | Substituir por keys canônicas; remover de EMPLOYEES/MACHINES/etc. |
| 3 Baseline VIEWER rematerializa comercial | Deny / modo restrição; resolvedor usa overrides live |
| 4 Desmarcar ≠ deny | Contrato UI §3.3 |
| 5 ROLE_MATRIX bag vazia | Remover; default DENY |
| 6 Catálogos divergentes | Fonte única + validador CI |
| 7 Sidebar/rota/API chaves diferentes | Mesmo resourceKey + `requireResource` |
| 8 Matriz não é runtime | Overrides no resolvedor de cada request/`me` |

---

## 11. Alinhamento FE / contrato / seed / backend (estado e alvo)

Fonte única alvo: `permissionContract` → deriva seed, FE, navegação, docs.

| Área | Hoje | Alvo |
|------|------|------|
| `permissionContract` | Existe (`resources.ts`) parcial | Autoridade tipada completa |
| `permissionResourceSeedData` | Árvore PT + aliases (faltam engineering/admin.employees) | Gerado/validado do contrato |
| Catálogo FE `permissionsClient` | Árvore paralela + ROLE_MATRIX | Gerado/validado; sem ROLE_MATRIX |
| `PERMISSION_CATALOG` | Chaves legadas | Só aliases 1:1 deprecados → remoção |
| Sidebar | Mix resourceKey + `canAccessModule` | 100% resourceKey do contrato |
| Rotas | `evaluatePathViewAccess`; unmapped=allow | Allowlist; default DENY |
| Tabs | Parcial | `filterTabsByView` obrigatório |
| Guards BE | Listas legadas OR | `requireResource(key, action)` |
| Aliases | Amplos / cruzados | 1:1 ou proibidos |

**Template por resourceKey** (preencher no P02):

`key | contrato | seed | FE | BE guard | parent | view | ações | alias 1:1? | divergência`

Divergências já conhecidas a eliminar: `admin.employees*` e `engineering.*` no FE sem seed; `opex` sem resourceKey; AP alias no pai/conciliação.

---

## 12. Decisões ainda pendentes (produto / ops)

1. Introduzir coluna `permissionsVersion` via migration — **sim** na fase sessão (ou reutilizar `updatedAt` + epoch em sessão; preferir campo explícito).
2. Invalidar **todas** as sessões do usuário no save vs só bump de versão — **recomendado invalidar em revogação crítica** (deny admin/RH/finance).
3. AccessProfile no runtime: só snapshot na aplicação **ou** re-ler perfil a cada resolve — **recomendado snapshot na aplicação + overrides**; evitar dual source.
4. Payload `me` full map vs allowlist — decidir por tamanho do contrato (pode ser >100 keys).
5. Prazo para remover `AppUser.permissions[]` do contrato público do `me`.
