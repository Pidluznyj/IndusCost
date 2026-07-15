# Perfis de Acesso × Matriz única (Prompt 09)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-15 |
| **Status** | Perfis usam `PermissionMatrix`; snapshot preservado |
| **UI** | `src/components/AccessProfilesModule.tsx` |
| **Bridge** | `src/lib/accessProfilesMatrix.ts` |

---

## Comportamento do snapshot

- `AccessProfile.permissions[]` continua sendo o armazenamento oficial (legado).
- **Alterar/salvar um perfil não atualiza** `AppUser.permissions` dos vinculados.
- Aviso explícito no editor + contagem de usuários.
- Propagação só via ação **Aplicar** (preview antes/depois + confirmação).

## Fluxo final

1. Listar / criar / editar / duplicar / ativar-inativar (como antes).
2. Editor: matriz única (Ver/Criar/…/Gerenciar; `—` se ação inexistente).
3. Preview de aliases legados (+/−) antes de salvar.
4. Confirmação se alteração ampla ou houver usuários vinculados.
5. Materializa matriz → `permissions[]` (preserva unmapped).
6. **Aplicar aos usuários**: `POST .../apply-preview` → `POST .../apply` com `confirm: true` (transacional).

## APIs novas

| Método | Path |
|--------|------|
| GET | `/api/access-profiles/:id/linked-users` |
| POST | `/api/access-profiles/:id/apply-preview` |
| POST | `/api/access-profiles/:id/apply` |

## Compatibilidade

- Perfis antigos (só bag legado) carregam via `projectLegacyToStructured`.
- SUPER_ADMIN continua sem matriz (todas as permissões).
- Soft-delete / system profiles inalterados.

## Testes

```bash
npm run test:access-profiles-matrix
npm run test:auth:access-profiles
```
