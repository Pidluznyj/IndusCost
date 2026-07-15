# Cadastro de Colaborador — plano de implementação

## Banco

Migration: `prisma/migrations/20260715180000_employee_registration_lookups`

- `corporateEmail` TEXT nullable + unique index `lower(corporateEmail)` WHERE NOT NULL
- `costCenterId` → `FinancialCostCenter` ON DELETE SET NULL
- `managerId` → `Employee` self FK ON DELETE SET NULL
- Campos legado `costCenter` / `managerName` mantidos como cache/rótulo

**Servidor (não executar pelo Cursor):**

```bash
npx prisma migrate deploy
npx prisma generate
# reiniciar o serviço Node do IndusCost
```

Rollback: revert da migration + redeploy do commit anterior.

## Backend

| Item | Arquivo |
|------|---------|
| Validação | `src/lib/employeeRegistration.ts` |
| Lookups + link-user | `src/lib/employeeLookupRoutes.ts` |
| CRUD | `server.ts` POST/PUT `/api/employees` via `prepareEmployeePersistedFields` |
| Login e-mail | `resolveLoginEmailForNewUser` prefere `corporateEmail` |

### Endpoints

| Método | Rota | Permissão |
|--------|------|-----------|
| GET | `/api/employees/lookups/cost-centers` | `employees.view` \| `edit` \| `costs.view` |
| GET | `/api/employees/lookups/managers` | idem |
| GET | `/api/employees/lookups/roles` | idem |
| GET | `/api/employees/:id/user-link-status` | idem |
| POST | `/api/employees/:id/link-user` | `employees.user_link.manage` \| `employees.edit` \| `users.manage` |
| GET | `/api/employees/:id/system-links` | `employees.links.view` \| `view` \| `edit` \| `people.search` |

## Frontend

- Aba Profissional: Identificação / Estrutura / Vínculo
- Selects oficiais para CC e gestor; e-mail corporativo
- Loading no submit; erro no rodapé; confirmação ao fechar sujo
- Ficha: exibe CC/gestor/e-mail; ação explícita “Vincular usuário”

## Compatibilidade

- Sem e-mail: permitido (legado)
- CC só texto: ainda edita; `unknownSelectionLabel` (legado)
- Gestor inativo já vinculado: preservado na edição
- Contrato legado fora do enum: preservado

## Testes

```bash
npx tsx --test src/lib/employeeRegistration.test.ts src/lib/adminUserEmployeeLink.test.ts src/lib/canonicalPersonHardening.integration.test.ts
npm run check:server-imports
npm run check:frontend-server-imports
npm run check:browser-bundle
npx prisma validate
npm run audit:permission-contract
npm test
npm run build
npx tsx scripts/canonical-person-migration-preflight.ts
```

## Homologação

Roteiro completo (personas + deploy + rollback):

→ [`../people/canonical-person-homologation-checklist.md`](../people/canonical-person-homologation-checklist.md)

Resumo rápido:

1. Criar colaborador com CC oficial + e-mail único
2. Duplicar e-mail (case) → 409
3. Gestor ≠ self; tentar ciclo A↔B
4. Editar legado (só texto CC) → grava; preferir ID
5. Vincular AppUser existente pelo e-mail corporativo
6. Sem `employees.edit` / facets → 403 / máscara
7. Abas pessoais/EPI/admin/vínculos conforme permissões

## Pendências

- Cadastro oficial de departamentos (texto livre permanece)
- Motor de EPI/estoque (fora do escopo)
- Apply de backfill Person só após dry-run aprovado em homolog (não prod cego)
