# PERM-27 — Diagnóstico: falha ao criar/salvar AccessProfile

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | PERM-27 |
| **Data** | 2026-07-16 |
| **Escopo** | Diagnóstico + testes de reprodução (sem redesenho de UI / sem correção de produto) |
| **Testes** | `src/lib/accessProfilesSaveDiagnosis.test.ts` |

---

## 1. Fluxo completo (código)

```text
AccessProfilesModule (form + PermissionMatrix)
  → validateForm() / previewPermissions (materialize draft → bag legado)
  → POST/PUT /api/access-profiles  JSON { name, description, roleBase, permissions[], isActive }
  → registerAccessProfilesRoutes
       requireAppAuth + requireResource("admin.settings.security", view|manage)
  → parseAccessProfileBody(req.body)
  → createAccessProfile / updateAccessProfile
       normalizePermissionsInput = filterKnownPermissions (PERMISSION_CATALOG)
       prisma.accessProfile.create|update
       writeAccessProfileAuditPlans (falhas só console.warn — não abortam save)
  → JSON { profile } | { error, message }
  → fetchJsonOk → HttpError(message) → setFormError
```

| Camada | Arquivo | Papel |
|--------|---------|--------|
| Formulário | `src/components/AccessProfilesModule.tsx` | Editor + matriz + validate/persist |
| Matriz bridge | `src/lib/accessProfilesMatrix.ts` | Draft ↔ bag legado |
| Client HTTP | `fetchJsonOk` (`src/lib/http.ts`) | Erros tipados |
| Rotas | `src/lib/accessProfilesRoutes.ts` | Auth + parse + status codes |
| Service | `src/lib/accessProfilesService.ts` | Create/update/normalize/audit |
| Prisma | `AccessProfile.permissions String[]` | Snapshot legado (não grants estruturados) |
| Guard API | `requireResource("admin.settings.security", …)` via `server.ts` | |

**Não há repository separado** — Prisma é chamado direto no service.

---

## 2. Causas raiz identificadas (sem try/catch genérico)

### Causa raiz principal (create/save) — **ROOT CAUSE D**

No select de **role base**, o formulário faz:

```ts
hydrateMatrix(form.permissions, roleBase);
```

Em **criação**, `form.permissions` permanece `[]` enquanto as marcações vivem só em `matrixDraft`.  
Ao mudar o role (fluxo comum: marcar permissões → escolher VIEWER/SELLER), a matriz é **reidratada do bag vazio** e o draft é descartado.

Efeito:

1. `previewPermissions` volta a `[]`
2. `validateForm()` retorna *"Selecione ao menos uma permissão ou defina role Super administrador."*
3. O usuário vê “não salva” mesmo após ter marcado a matriz

Reproduzido em teste: `ROOT CAUSE D`.

### Causa raiz colateral (módulo) — **ROOT CAUSE C**

`AccessProfilesModule` usa `overwriteCustomized` / `setOverwriteCustomized` **sem** `useState`.

Ao abrir o modal **Aplicar aos usuários**, o React lança `ReferenceError` na renderização do checkbox.  
Não é o path de create/save, mas quebra a superfície irmã do mesmo módulo.

Reproduzido em teste: `ROOT CAUSE C` (assinatura estática do fonte).

### Comportamentos agravantes (não mascarados)

| ID | Comportamento | Impacto |
|----|---------------|---------|
| B | ALLOW em `resourceKey` sem alias 1:1 no dual-write pode materializar bag vazia | FE bloqueia save (mesma mensagem de “sem permissão”) |
| — | `filterKnownPermissions` descarta chaves fora do `PERMISSION_CATALOG` (ex.: `engineering.products`) | Save “sucesso” com menos permissões do que a UI sugere |
| — | Backend responde `{ error, message }`; FE lê `code` em `parseApiErrorPayload` | Mensagem ok; `HttpError.code` fica `undefined` |
| — | BE **aceita** perfil com `permissions: []`; FE **bloqueia** | Divergência FE/BE documentada |
| A | Guard API `admin.settings.security` manage | **OK** com bags `users.manage` / `accessProfiles.manage` (não é a falha atual) |

O handler de rota ainda tem `catch` → `INTERNAL_ERROR` genérico para erros inesperados; **auditoria** engole falhas com `console.warn` e **não** impede o save (correto para não mascarar falha de persistência do perfil).

---

## 3. Matriz de cenários (testes)

| Cenário | Resultado observado | Teste |
|---------|--------------------|-------|
| Criar perfil válido (bag legado) | OK | `cria perfil válido…` |
| Editar perfil | OK | `edita perfil…` |
| Salvar sem recursos | FE bloquearia; BE aceita `[]` | `salvar perfil sem recursos…` |
| ALLOW / DENY / INHERIT | Materializa/remove/preserva bag | `ALLOW / DENY / INHERIT…` |
| Nome duplicado | `P2002` → `NAME_ALREADY_EXISTS` 409 | `nome duplicado…` |
| Recurso desconhecido | Filtrado silenciosamente | `recurso/permissão desconhecida…` |
| Perfil inativo | create/update `isActive` OK | `perfil inativo…` |
| Payload legado | `parseAccessProfileBody` OK | `payload legado…` |
| Erro validação nome | Message chega ao FE; `code` some | `erro de validação INVALID_NAME…` |
| Auth FE vs API | Alinhados para bags admin | `ROOT CAUSE A` |
| Materialize vazio | Documentado | `ROOT CAUSE B` |
| `overwriteCustomized` | Bug confirmado | `ROOT CAUSE C` |
| Wipe por roleBase | **Causa raiz do save** | `ROOT CAUSE D` |

```bash
npx tsx --test src/lib/accessProfilesSaveDiagnosis.test.ts
```

---

## 4. O que NÃO foi feito (PERM-27)

- Não redesenhar a tela
- Não corrigir o wipe de `hydrateMatrix` nem o `useState` faltante (correção de produto = prompt seguinte)
- Não inventar dados de banco

---

## 5. Correção recomendada (próximo prompt)

1. Ao mudar `roleBase`, reidratar a partir de `previewPermissions` / draft atual (não de `form.permissions` stale), ou só resetar quando SUPER_ADMIN.
2. Declarar `const [overwriteCustomized, setOverwriteCustomized] = useState(true)`.
3. Opcional: mapear `error` → `code` no client **ou** emitir `code` no JSON das rotas de AccessProfile.
4. Opcional: rejeitar no BE bag vazia (não-SUPER_ADMIN) alinhado ao FE, ou permitir FE salvar vazio conscientemente.

---

## 6. Payload de referência (create)

```json
{
  "name": "Perfil Diagnóstico",
  "description": "teste",
  "roleBase": "VIEWER",
  "permissions": ["dashboard.view", "crm.view"],
  "isActive": true
}
```

Persistência: somente bag legado (`String[]`). ALLOW/DENY/INHERIT existem na matriz UI e são **projetados** para presença/ausência de chaves no array.
`)
