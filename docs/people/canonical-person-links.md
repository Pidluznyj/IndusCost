# Pessoa canônica — vínculos

## Identidade (FK `personId`)

- Employee ↔ Person (unique)
- AppUser ↔ Person (unique)
- CommissionPerson ↔ Person
- FleetDriver ↔ Person
- Customer ↔ Person (apenas PF)

## Relacionamento (sem personId)

- Gestor: `Employee.managerId`
- Responsável carteira: `CrmCustomerCommercialOwner`
- Vendedor pedido: `SalesOrder.externalSellerId` + aliases
- Contato cadastral cliente: campos denormalizados

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
