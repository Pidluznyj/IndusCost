# Pessoa canônica — vínculos

## Identidade (FK `personId`)

- Employee ↔ Person (unique)
- AppUser ↔ Person (unique)
- CommissionPerson ↔ Person
- FleetDriver ↔ Person
- Customer ↔ Person (apenas PF)

## Relacionamento (sem personId de identidade da empresa)

- Gestor: `Employee.managerId`
- Responsável carteira: `CrmCustomerCommercialOwner`
- Vendedor pedido: `SalesOrder.externalSellerId` + aliases
- Contato cadastral: snapshot + opcional `Customer.contactPersonId` → Person (não é PJ)

## Login

1. `corporateEmail` ajuda a achar AppUser
2. `POST /api/employees/:id/link-user` é explícito
3. Conflito se AppUser já tem outro Employee/Person

## Clientes

Aba **Pessoas e vínculos**:
- identidade PF (`Customer.personId` ↔ Person) — vincular / desvincular com confirmação
- contato → Person (`Customer.contactPersonId`) — PJ ou PF; **não** é identidade da empresa
- responsável carteira (`CrmCustomerCommercialOwner`) — relacionamento
- vendedores dos pedidos Nomus (`SalesOrder`) — relacionamento, eixo comissionável
- gestor da conta (texto `accountOwner`) — legado
- PUT bruto `/api/customers/:id` **não** aceita `personId` / `contactPersonId`

Permissões de escrita: `customers.edit` **e** (`people.link.manage` | `users.manage`).

## RH — Novo Colaborador

Campo **Vincular pessoa existente** + opção criar nova Person.
Conflitos exigem resolução campo a campo.

## RH — Vínculos no sistema (ficha do colaborador)

Leitura executiva agregada (sem regras paralelas de comissão/carteira):

- Endpoint: `GET /api/employees/:id/system-links` (`employees.links.view` | `employees.view` | `employees.edit` | `people.search`)
- Manage/desvínculo: `employees.links.manage` | `people.link.manage` | `employees.edit` | `users.manage`
- Contrato canônico: `admin.employees.links` (view/manage)
- DTO: tipo, entidade, status, origem, data, ação, alerta; IDs só em `audit` quando permitido
- Fontes: AppUser, hierarquia RH, CommissionPerson + aliases, Frota, Customer identidade/contato, carteira CRM via `sellerExternalId`
- Permissões por módulo no card: `users.manage`/`settings.view`, `commissions.view`, `customers.view`, `fleet.view`
- Fornecedor ↔ Person: **não existe** no schema (fora do agregador)
- Vendedor de pedidos: aparece via **aliases / pessoa comissionada** (eixo oficial), não como pedido individual
- Legado: `GET /api/people/:id/links` ainda devolve buckets + `executive`

## Matriz RH (contrato + legado)

| Capacidade | resourceKey | Ação | Legado (OR) |
|------------|-------------|------|-------------|
| Menu / lista | `admin.employees` | view | `employees.view`, `costs.view` |
| Criar | `admin.employees` | create | `employees.create`, `employees.edit` |
| Editar | `admin.employees` | update | `employees.edit` |
| Dados pessoais | `admin.employees.personal_data` | view | `employees.personal_data.view`, `people.pii.view`, `employees.edit` |
| Adm. / notas | `admin.employees.administrative_data` | view | `employees.administrative_data.view`, `employees.edit` |
| Sensível | `admin.employees.sensitive_data` | view | `employees.sensitive_data.view`, `employees.edit` |
| Vínculos | `admin.employees.links` | view/manage | ver acima |
| User link | `admin.employees.user_link` | manage | `employees.user_link.manage`, `employees.edit`, `users.manage` |
| EPI | `admin.employees.epi` | manage | `employees.epi.manage`, `employees.edit` |

**Editor de RH (2026-09-21).** Editor := legado `employees.edit` **OU** canônico `admin.employees:update` (SUPER_ADMIN sempre) — regra única em `buildEmployeePermissionBag` (`src/lib/employeesPermissions.ts`). Onde a coluna "Legado (OR)" lista `employees.edit`, leia "Editor de RH": para o editor o bag responde `employees.edit = true`, então ele recebe todas as facetas acima e todas as capabilities da ficha, inclusive valores em R$ (`admin.employees.compensation_values`), salvo deny individual **explícito** em `admin.employees.compensation_values:view` (`deny > allow`).

Nos guards de **Vínculos** (`admin.employees.links` view/manage, `canonicalPersonRoutes`) e **User link** / lookups (`admin.employees.user_link` manage, `employeeLookupRoutes`), o `server.ts` injeta `requireResourceOrHrEditor`: nas facetas `admin.employees.*` o editor passa mesmo sem grant próprio da faceta. Só a ausência de grant (`DENY_DEFAULT`) é suprida — deny individual explícito (`OVERRIDE_DENY` no recurso ou `ANCESTOR_VIEW_DENY`, listados em `canonicalAccess.overrideDenied`), recurso desconhecido, ação não suportada e usuário inativo seguem no 403 oficial. Chaves fora de `admin.employees.*` vão direto para o `requireResource` normal.

A máscara de PII e as caps do agregador de vínculos (`canonicalPersonRoutes.ts`, `viewerCapsInput`) reconhecem o Editor de RH desde 2026-09-22: um editor só pelo canônico (`admin.employees:update|create`, sem `employees.edit` legado) vê PII no painel Vínculos como quem tem a chave legada. Detalhes da regra: [`docs/hr/employee-functional-record.md`](../hr/employee-functional-record.md#editor-de-rh).

## Homologação

Roteiro por persona + deploy/rollback: [`canonical-person-homologation-checklist.md`](./canonical-person-homologation-checklist.md).
