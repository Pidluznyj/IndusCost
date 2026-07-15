# Vínculo Employee ↔ AppUser (acesso ao sistema)

## Fluxo

1. Definir **e-mail corporativo** no colaborador (Prompt 05).
2. Consultar status (não cria login).
3. Se houver AppUser livre com o mesmo e-mail → **vincular com confirmação**.
4. Criar usuário novo só em **Configurações → Usuários** (fluxo administrativo explícito).
5. Desvincular remove só `employeeId` — não desativa login, não muda e-mail, não toca SUPER_ADMIN.

## Estados

| Estado | Significado |
|--------|-------------|
| `none` | Sem usuário de acesso |
| `available_match` | Usuário disponível para vínculo |
| `linked` | Usuário vinculado |
| `linked_inactive` | Vinculado porém inativo |
| `conflict` | Usuário vinculado a outra pessoa |
| `email_mismatch` | Login ≠ e-mail corporativo |

## Endpoints

| Método | Rota | Permissão |
|--------|------|-----------|
| GET | `/api/employees/:id/user-link-status` | `employees.view` \| `employees.edit` |
| GET | `/api/employees/lookups/app-user-by-email` | idem |
| POST | `/api/employees/:id/link-user` | `employees.edit` \| `users.manage` |
| POST | `/api/employees/:id/unlink-user` | `employees.edit` \| `users.manage` |

Transação Prisma + auditoria JSON (`employee.link_user` / `employee.unlink_user`) com `actorUserId`.

## UI

Card **Acesso ao sistema** na ficha (aba Profissional e Vínculos).  
Novo Colaborador: e-mail corporativo não obriga vínculo; texto informa que o vínculo é posterior.
