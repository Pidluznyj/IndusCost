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

- Endpoint: `GET /api/employees/:id/system-links` (`employees.view` | `employees.edit`)
- DTO: tipo, entidade, status, origem, data, ação, alerta; IDs só em `audit` (se `people.link.manage` | `users.manage` | `employees.edit`)
- Fontes: AppUser, hierarquia RH, CommissionPerson + aliases, Frota, Customer identidade/contato, carteira CRM via `sellerExternalId`
- Permissões por módulo: `users.manage`/`settings.view`, `commissions.view`, `customers.view`, `fleet.view`
- Fornecedor ↔ Person: **não existe** no schema (fora do agregador)
- Vendedor de pedidos: aparece via **aliases / pessoa comissionada** (eixo oficial), não como pedido individual
- Legado: `GET /api/people/:id/links` ainda devolve buckets + `executive`
