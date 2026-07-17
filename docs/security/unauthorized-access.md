# Acesso não autorizado (PERM-39)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-16 |
| **Status** | Modal + redirect confirmado |
| **Resolução** | `src/lib/unauthorizedAccess.ts` |
| **UI** | `UnauthorizedAccessGate` / `AccessDenied` / `NoPermissionsGranted` |

## Comportamento

Quando o usuário tenta acessar rota ou aba sem permissão:

1. O conteúdo **não** é renderizado
2. Modal: **“Você não tem acesso a este conteúdo.”**
3. Botão **OK**
4. Após OK → primeira rota permitida (`getSafeFirstAllowedPath` / ordem oficial do catálogo de navegação)

Não há redirect silencioso antes da confirmação do modal.

## Nenhuma rota permitida

- Página neutra (`NoPermissionsGranted`): “Nenhum acesso liberado”
- Orienta a procurar o administrador
- Sem `Navigate` → sem loop de redirecionamento

## Sessão / `permissionsVersion`

Após refresh de permissões (poll `/api/auth/permissions-version` ou evento stale), Layout / módulos reavaliam o path e a aba ativa. Se o acesso atual passar a ser negado, o mesmo modal PERM-39 é exibido.

## SUPER_ADMIN

Rotas mapeadas permanecem `allowed` (sem modal).

## Testes

```bash
npx tsx --test src/lib/unauthorizedAccess.perm39.test.ts
npm run test:resource-navigation
```
