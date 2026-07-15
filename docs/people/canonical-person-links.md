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
