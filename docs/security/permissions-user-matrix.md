# Permissões individuais do usuário (Prompt 10)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-15 |
| **UI** | `AdminUsersModule` + `PermissionMatrix` |
| **Bridge** | `src/lib/userPermissionsMatrix.ts` |

---

## Fluxo final

1. Selecionar usuário → carregar `GET /api/admin/users/:id/permissions`.
2. Exibir contexto: baseline da role, snapshot do Access Profile (se houver), bag legado materializado.
3. Editar na **matriz única** (Allow / Deny / Baseline).
4. Preview “como este usuário verá o sistema”.
5. Salvar → overrides (`null`=herdar, `true`=allow, `false`=deny) + dual-write `AppUser.permissions[]` + auditoria.
6. SUPER_ADMIN: matriz somente leitura.

## Regras de precedência

1. **Deny explícito** (`override === false`)  
2. **Allow explícito** (`override === true`)  
3. **Baseline da role** (`override === null`)

Negar o pai (`canView: false`) bloqueia filhos no acesso efetivo da árvore.

## Proteção administrativa

- Auto-lockout: não remover `users.manage` de si mesmo (client + server).
- Último SUPER_ADMIN: não rebaixar / inativar.
- Confirmação antes de mudanças em recursos críticos (`admin.usuarios`, etc.).
- Auditoria: quem / quando / antes→depois (aba já existente).

## Compatibilidade

- `UserPermissionTree` deixou de ser montado na UI (arquivo permanece; sem duplicidade visual).
- Runtime auth inalterado: ainda `AppUser.permissions[]` via dual-write.

## Testes

```bash
npm run test:user-permissions-matrix
```
