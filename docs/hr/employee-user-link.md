# Vínculo Employee ↔ AppUser (acesso ao sistema)

## Fluxo

1. Definir **e-mail corporativo** no colaborador (Prompt 05).
2. Consultar status (não cria login).
3. Se houver conta livre com o mesmo e-mail **e na mesma Pessoa canônica do colaborador (Pessoa ativa)** → **vincular com confirmação**. Só o e-mail não basta: sem a mesma Pessoa, a ligação é feita em Pessoas 360° › Regularizar vínculo existente.
4. Criar usuário novo só em **Configurações → Usuários** (fluxo administrativo explícito).
5. Desvincular remove só `employeeId` — não desativa login, não muda e-mail, não toca SUPER_ADMIN.

## Estados

| Estado | Significado |
|--------|-------------|
| `none` | Sem usuário de acesso |
| `available_match` | Usuário disponível para vínculo |
| `match_blocked` | Conta com o mesmo e-mail, mas o vínculo não pode ser feito aqui: sem a mesma Pessoa canônica (regularizar em Pessoas 360°), Pessoa em revisão, inativa ou unificada, ou é a conta de quem opera — o cartão mostra o motivo |
| `linked` | Usuário vinculado |
| `linked_inactive` | Vinculado porém inativo |
| `conflict` | Usuário vinculado a outra pessoa |
| `email_mismatch` | Login ≠ e-mail corporativo |

## Endpoints

| Método | Rota | Permissão |
|--------|------|-----------|
| GET | `/api/employees/:id/user-link-status` | `admin.employees.user_link:manage` |
| GET | `/api/employees/lookups/app-user-by-email` | `admin.employees:view` |
| POST | `/api/employees/:id/link-user` | `admin.employees.user_link:manage` |
| POST | `/api/employees/:id/unlink-user` | `admin.employees.user_link:manage` |

`admin.employees.user_link:manage` vem de `employees.user_link.manage`, `employees.edit` ou `users.manage` (legado), ou do grant canônico; o editor de RH recebe pela regra de `requireResourceOrHrEditor`, salvo deny explícito.

Transação Prisma com comparação-e-troca; auditoria persistida em `SecurityAuditLog` (`USER_IDENTITY_LINKED` / `USER_IDENTITY_UNLINKED`, origem `HR_LINK_USER` / `HR_UNLINK_USER`) além do log JSON.

Regras (política única `src/lib/security/accountIdentityLinkPolicy.ts`, a mesma de Pessoas 360°):

- ninguém vincula ou desvincula a **própria** conta, salvo SUPER_ADMIN com step-up;
- conta SUPER_ADMIN só por SUPER_ADMIN com step-up;
- e-mail igual não basta: conta e colaborador precisam estar na mesma Pessoa canônica; fora disso, `409 IDENTITY_CONFIRMATION_REQUIRED` e a regularização é feita em Pessoas 360°;
- sem usuário identificado na operação, `403 ACTOR_REQUIRED`.

Detalhes e validação: [../avaliacao-desempenho/identidade-avaliadores.md](../avaliacao-desempenho/identidade-avaliadores.md) §7.

## UI

Card **Acesso ao sistema** na ficha (aba Profissional e Vínculos).  
Novo Colaborador: e-mail corporativo não obriga vínculo; texto informa que o vínculo é posterior.
