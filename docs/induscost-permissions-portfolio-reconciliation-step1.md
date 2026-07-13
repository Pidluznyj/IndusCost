# Permissionamento — Passo 1: Conciliação de Carteira (módulo + abas)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-13 |
| **Escopo** | Extensão do motor RBAC existente — sem migration |

## Checklist pré-implementação (respondido)

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Precisa existir? | Sim — abas da Conciliação não tinham ACL dedicada (OR amplo) |
| 2 | Já existe motor? | Sim — `appAuth` + `permissionCatalog` + guards + PermissionEditor |
| 3 | User/Role/Session? | Sim — `AppUser` / `AppUserRole` / `AppSession` / `AccessProfile` |
| 4 | Middleware? | Sim — `requireAppAuth` / `requireAnyPermission` |
| 5 | Menu centralizado? | Sim — `modulePermissions` + `navigationGroups` + Sidebar |
| 6 | Padrão de tabs? | Sim — `type: "tab"` no catálogo (CRM/Produtos); página PR com tablist local |
| 7 | Reutilizar? | **Sim** — não criar tabelas Role/Permission |

## O que foi feito neste passo

Chaves no catálogo:

- `finance.portfolioReconciliation.view` (módulo/seção)
- `finance.portfolioReconciliation.conciliation.view` (aba)
- `finance.portfolioReconciliation.intelligence.view` (aba)
- `finance.portfolioReconciliation.orderToCashAudit.view` (aba)

Helpers centrais em `financePortfolioReconciliationPermissions.ts`.

Backend: rotas Conciliation / Intelligence / OrderToCashAudit com `requireAnyPermission` por aba.

Frontend: abas ocultas sem permissão; não chama API da Conciliação se a aba estiver bloqueada.

**Compatibilidade:** OR legado (`finance.view`, AR, AP, reports, Nomus) permanece — usuários atuais não são bloqueados.

**SUPER_ADMIN:** continua com todas as chaves via `getEffectivePermissions`.

## Não feito neste passo (próximos)

- Auditoria `AppUserChangeLog` de alteração de permissão
- Remoção do OR legado (só após backfill admin)
- Actions sensíveis (export/rebuild) com chaves dedicadas
- Outros menus/submenus do sistema além deste módulo

## Migration

**Nenhuma.** Catálogo em código; grants em `AppUser.permissions String[]`.
