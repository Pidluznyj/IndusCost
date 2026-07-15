# Pessoa canônica — inventário de entidades

| | |
|---|---|
| Data | 2026-07-15 |
| Escopo | Frontend, backend e Prisma — pessoas e relacionamentos |
| Alteração funcional neste prompt | Nenhuma |

## Como ler a matriz

- **Identidade / relacionamento / snapshot** — papel conceitual no modelo.
- **PF / empresa / ambíguo** — natureza da entidade.
- **Pode vincular a Person?** — se um futuro (ou atual) `personId` → `Person` faz sentido.
- **Tipo de vínculo recomendado** — FK de identidade vs manter domínio vs manter string/snapshot.
- **Migration / backfill** — impacto residual (muitos já cobertos pela migration `20260715190000_canonical_person`).

---

## Matriz mestre

| Entidade | Identidade / relacionamento / snapshot | PF / empresa | Campos identificadores principais | Pode vincular a Person? | Tipo de vínculo recomendado | Risco de duplicidade | Migration | Backfill |
|----------|----------------------------------------|--------------|-----------------------------------|-------------------------|-----------------------------|----------------------|-----------|----------|
| **Person** | identidade (hub) | PF | `displayName`, `socialName`, `corporateEmail`, `personalEmail`, `cpfNormalized`, `phoneNormalized`, `status` | — (é o hub) | hub | médio se criado só por nome | já existe | N/A |
| **Employee** | identidade (papel RH) | PF | `name`, `socialName`, `corporateEmail`, `personalEmail`, `cpf`, `phone`, `status`; `managerId`/`managerName` | sim — **já tem** `personId` unique | FK identidade + domínio RH | alto vs AppUser/FleetDriver | feito | forte (CPF/e-mail) |
| **AppUser** | identidade (conta) + escopo seller | PF (conta) | `name`, `email`, `isActive`, `externalSellerId(s)`, `sellerResponsibleName` | sim — **já tem** `personId` unique; também `employeeId` | FK identidade (preferir alinhado ao Employee) | médio (e-mail) | feito | via Employee/e-mail |
| **CommissionPerson** | identidade de domínio comercial | PF (típico) | `name`, `email`, `document`, `nomusPersonId`, `type`, `active`, `source` | sim — **já tem** `personId` | FK identidade (N:1 ok) | alto; há dedupe | feito | document/Nomus ID |
| **CommissionPersonAlias** | relacionamento (sinônimo Nomus) | ambíguo (texto) | `rawSellerId`, `rawSellerName`, `normalizedSellerName`, `status` | não direto | manter → CommissionPerson → Person | baixo (anti-dup) | não | N/A |
| **FleetDriver** | identidade (papel frota) | PF | `name`, `cpf`, CNH, `phone`, `email`, `status` | sim — **já tem** `personId` | FK identidade | alto vs Employee (CPF) | feito | excelente via CPF |
| **Customer** | identidade org **ou** PF | ambíguo (`taxId` 11=PF / 14=PJ) | `companyName`, `tradeName`, `taxId`, `contactName`, `email`, `phone`, `accountOwner`, `status` | **somente PF** — já tem `personId` | FK identidade se PF; PJ **não** | médio | feito (nullable) | PF: taxId→CPF; PJ: nunca |
| **Customer.contactName** | snapshot / relacionamento denormalizado | PF (contato) | `contactName`, `email`, `phone` | futuro Contact, não Client PJ | **não** igualar a Customer.personId | alto | sem modelo Contact | não auto |
| **CrmCustomerCommercialOwner** | relacionamento (carteira) | papel sobre Customer | `sellerCanonicalName`, `sellerResponsibleName`, `sellerExternalId`, `sellerIdentityKey`, aliases JSON | opcional futuro | **domínio**; opcional FK CommissionPerson/Person | alto vs commission/AppUser | se FK futura | por Nomus ID/chave |
| **SalesOrder / Proposal** `responsible`, `externalSellerId`, `nomusSellerName` | relacionamento soft | ambíguo | strings + Int Nomus | via CommissionPerson | soft + alias engine | alto | não forçar Person no pedido | via seller ID |
| **Employee.managerId** | relacionamento hierárquico | PF | `managerId`, `managerName` legado | via Employee | manter self-FK Employee | nome legado | feito (managerId) | — |
| **Role** | catálogo de cargo | — | `name`, salário base | não | não é pessoa | — | — | — |
| **FinancialSupplier** | identidade empresa (às vezes PF) | ambíguo | `displayName`, `document` / normalized | só se PF inequívoca | preferir empresa; Person raro | médio | só se necessário | fraco (CNPJ) |
| **FinancialSupplierAlias** | alias Nomus→supplier | ambíguo | nome/documento originais, external ID | não | manter | — | — | — |
| **SupplierServiceTermination** | snapshot legal | ambíguo | `personName`, `personDocument`, representantes, testemunhas | soft opcional | **manter snapshot** imutável | snapshot intencional | não obrigar personId | opcional pós-fato |
| **NomusAccountsReceivable** | party externo (stage) | ambíguo | **`personId` Int Nomus**, `personName`, `personCnpj`, `personPhone` | **não** como UUID Person | match documento → Customer | alto se mal interpretado | não FK Person | CNPJ/CPF |
| **NomusAccountsPayable** | party externo (stage) | ambíguo | idem Int `personId` + nome/CNPJ | **não** como UUID Person | match → FinancialSupplier | alto | não FK Person | documento |
| **Project.commercialOwner / technicalOwner** | relacionamento soft | ambíguo (nome) | strings | soft | string **ou** FK AppUser futuro | alto | opcional | fraco (nome livre) |
| **CommercialActivity.assignedTo** + createdBy* | relacionamento / snapshot | PF típico | `assignedTo`, `createdByName/Phone/Email` | soft | snapshot; opcional userId | alto | opcional | por e-mail |
| **PurchaseRequest.requester** | relacionamento snapshot | PF | `requester` string | soft | snapshot; opcional AppUser | alto | opcional | fraco |
| **MaintenanceRequest.requester / responsible** | relacionamento snapshot | PF | strings + history `changedBy` | soft | snapshot | alto | opcional | fraco |
| **FleetReservation.requesterUserId** | relacionamento | PF (user) | UUID string **sem** `@relation` Prisma | via AppUser.personId | formalizar FK→AppUser | médio | baixo (só FK) | sessões futuras |
| **FleetReservation.approvedBy** | snapshot | PF | string | soft | snapshot | — | — | — |
| **FleetPublicReservationRequest** | relacionamento + snapshot | PF | requester CPF/nome/e-mail/telefone, `driverId` | via CPF → Driver/Person | snapshot + Driver FK | alto | driverId já | CPF |
| **FleetReservationChecklist.completedBy*** | snapshot | PF | CPF/nome | soft via CPF | snapshot | — | — | — |
| **BrandingSettings** commercial contact | contato da **empresa** | empresa | `commercialContactName/Email/Phone`; `document` = CNPJ | **não** | settings org | N/A | não | N/A |
| **Employee** emergency contact | relacionamento familiar | PF | `emergencyContactName/Phone/Relationship` | tipicamente não | manter no RH | — | não | N/A |
| **ComponentPerformanceChangeLog** | snapshot auditoria | PF | `responsiblePersonName`, `changedByUser*` | soft | snapshot | — | não | — |
| **MaterialMarketQuote** approvedBy/createdBy | snapshot | — | nomes | soft | snapshot | — | não | — |

---

## Detalhamento por domínio

### Pessoas / RH (`Employee`)

| Item | Valor |
|------|-------|
| Finalidade | Colaborador; custo mão de obra; ficha RH |
| Telas | `EmployeeModule.tsx`, ficha com aba vínculos |
| Endpoints | `/api/employees*`, lookups RH, `/api/employees/:id/person-link`, link-user |
| Services | `employeeRegistration.ts`, `employeeLookupRoutes.ts`, `employeeHrUi.ts`, `canonicalPersonService.server.ts` |
| Origem | Cadastro manual RH |
| Relacionamentos | `Role`, `managerId`, `FinancialCostCenter`, `AppUser` 1:1, `Person` |

### Usuários (`AppUser`)

| Item | Valor |
|------|-------|
| Finalidade | Login, ACL, escopo vendedor Nomus |
| Telas | `AdminUsersModule.tsx` |
| Endpoints | `/api/admin/users*` |
| Origem | Admin; vínculo obrigatório a Employee em novos fluxos |
| Observação | Credenciais e permissões **não** sobem para Person |

### Comissões

| Item | Valor |
|------|-------|
| Finalidade | Beneficiário/alias de comissão |
| Telas | `CommissionsPersonsPage` / components em `commissions/persons` |
| Endpoints | `/api/commissions/persons*` |
| Origem | MANUAL + NOMUS |
| Observação | Motor de identidade comercial permanece em CommissionPerson; Person é hub transversal |

### Clientes

| Item | Valor |
|------|-------|
| Finalidade | Cadastro comercial |
| Contatos | **Não há** CustomerContact — apenas `contactName`/`email`/`phone` |
| Responsável carteira | `CrmCustomerCommercialOwner` (relacionamento) |
| UI vínculos | `CustomerPeopleLinksPanel.tsx` → `/api/customers/:id/people-links` |

### Fornecedores

| Item | Valor |
|------|-------|
| Contatos | **Não há** SupplierContact |
| Prestador em distrato | Snapshot em `SupplierServiceTermination` |

### Frota / gestores / solicitantes / aprovadores

| Papel | Representação atual |
|-------|---------------------|
| Motorista | `FleetDriver` (+ personId) |
| Gestor RH | `Employee.managerId` |
| Solicitante compra | `PurchaseRequest.requester` string |
| Solicitante manutenção | `MaintenanceRequest.requester` string |
| Solicitante frota | `FleetReservation.requesterUserId` (UUID sem FK tipada) |
| Aprovador frota | `approvedBy` string |
| Responsável projeto | `Project.commercialOwner` / `technicalOwner` strings |

### Integração Nomus

`NomusAccountsReceivable.personId` / `NomusAccountsPayable.personId` são **Int de party Nomus**. Não confundir com `Person.id` UUID.

---

## Ausências confirmadas (após busca por nomes alternativos)

- `CustomerContact`, `SupplierContact`, `Contact`, `Party`, `Individual`, `Collaborator`, `People`
- Model Prisma `Seller` / `NomusSeller` / `ExternalSeller` (são campos + resolvers)
- Enum formal PF/PJ em `Customer` (inferência por comprimento de `taxId`)

---

## Mapa de `personId` UUID já no schema

```
Person
 ├── Employee.personId          UNIQUE (1:1)
 ├── AppUser.personId           UNIQUE (1:1)
 ├── CommissionPerson.personId  INDEX (N:1)
 ├── FleetDriver.personId       INDEX (N:1)
 └── Customer.personId         INDEX (somente PF recomendado)
```
