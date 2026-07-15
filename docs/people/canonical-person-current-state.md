# Pessoa canônica — estado atual (auditoria)

| | |
|---|---|
| Data | 2026-07-15 |
| Escopo | Inventário de entidades de pessoa / relacionamento |
| Método | Schema Prisma + rotas/services/UI reais |
| Implementação neste prompt | **Nenhuma** (somente documentação) |

## Veredito

1. **Já existe** o modelo hub `Person` (migration `20260715190000_canonical_person`), com `personId` opcional em `Employee`, `AppUser`, `CommissionPerson`, `FleetDriver` e `Customer` (conceitualmente PF).
2. Antes dessa migration (e ainda para registros sem backfill), pessoas físicas conviviam em **silos** com soft-links por e-mail, CPF, Nomus ID ou nome.
3. **Não existem** modelos `CustomerContact`, `SupplierContact`, `Collaborator`, `Individual`, `Party` ou `Contact`.
4. Há **dois significados distintos** de `personId` no código:
   - UUID → `Person` (canônico IndusCost);
   - `Int?` em `NomusAccountsReceivable` / `NomusAccountsPayable` → ID de party **Nomus** (não é FK para `Person`).

## Identidade × relacionamento

| Tipo | Definição | Exemplos no sistema |
|------|-----------|---------------------|
| **Identidade** | Dois registros representam a mesma pessoa física | `Person`, `Employee`, `AppUser`, `CommissionPerson`, `FleetDriver`, `Customer` PF |
| **Relacionamento** | Uma pessoa exerce papel sobre outra entidade | Gestor (`managerId`), dono de carteira CRM, vendedor do pedido, solicitante, aprovador |
| **Snapshot** | Cópia imutável / denormalizada para documento ou auditoria | Distrato (`SupplierServiceTermination`), contato cadastral do cliente, responsáveis em texto livre |

## Silos principais (pré e pós hub)

| Domínio | Modelo / campo | Status vs Person |
|---------|----------------|------------------|
| RH | `Employee` | Tem `personId` (unique); UI de vínculos |
| Login | `AppUser` | Tem `personId` (unique) + `employeeId` 1:1 |
| Comissões | `CommissionPerson` + `CommissionPersonAlias` | Tem `personId`; identity de domínio comercial |
| Frota | `FleetDriver` | Tem `personId`; CPF forte |
| Clientes | `Customer` | Tem `personId` (somente PF); PJ = empresa |
| Carteira | `CrmCustomerCommercialOwner` | Relacionamento; sem `personId` |
| Pedidos/propostas | `responsible` / `externalSellerId` | Soft → CommissionPerson |
| Compras / manutenção | `requester` string | Relacionamento snapshot |
| Nomus CR/CP | `personId` Int + nome/CNPJ | Party externo |
| Fornecedores | `FinancialSupplier` | Empresa (raramente PF) |

## Riscos atuais

- Duplicidade entre `Employee` ↔ `AppUser` ↔ `CommissionPerson` ↔ `FleetDriver` por e-mail/CPF/nome.
- Merge automático por **nome semelhante** continua proibido (confiança baixa).
- Contato de cliente (`contactName`) **não** é identidade do cliente PJ.
- Confundir `Nomus*.personId` (Int) com `Person.id` (UUID) gera erro grave de integração.
- Backfill incompleto: muitos registros ainda com `personId` null (legado válido).

## Documentos relacionados

- Inventário detalhado: `docs/people/canonical-person-entity-inventory.md`
- Proposta (reuso do hub): `docs/people/canonical-person-target-proposal.md`
- Links / migration já existentes: `canonical-person-links.md`, `canonical-person-migration-plan.md`, `canonical-person-target-model.md`
