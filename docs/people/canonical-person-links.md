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
- identidade PF (se houver)
- responsável carteira (relacionamento)
- contato cadastral (snapshot)

## RH — Novo Colaborador

Campo **Vincular pessoa existente** + opção criar nova Person.
Conflitos exigem resolução campo a campo.
