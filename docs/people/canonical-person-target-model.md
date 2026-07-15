# Pessoa canônica — modelo-alvo

## Conceito

`Person` = identidade física.  
Papéis = `Employee`, `AppUser`, `CommissionPerson`, `FleetDriver`, `Customer` (somente PF).

Dados específicos de domínio **não** migram para Person.

## Matriz

| Entidade | Identidade ou relacionamento | Pessoa física? | personId? | Fonte de verdade específica |
|----------|------------------------------|----------------|-----------|-----------------------------|
| Person | identidade | sim | — | nome canônico, e-mails, CPF |
| Employee | identidade/papel RH | sim | sim | cargo, salário, CC, gestor |
| AppUser | papel acesso | sim | sim | senha, permissões |
| CommissionPerson | papel comercial | sim | sim | regras de comissão |
| FleetDriver | papel frota | sim | sim | CNH, reservas |
| Customer PF | identidade | sim | sim | taxId=CPF |
| Customer PJ | empresa | não | **não** | razão social |
| CrmCustomerCommercialOwner | relacionamento | — | não | carteira |
| Gestor (managerId) | relacionamento | — | via Employee | hierarquia RH |

## Busca

Server-side, debounce FE, limite 20–40, máscara de e-mail/CPF sem `people.pii.view` / `employees.edit`.

## Duplicidade

Auto-vínculo **somente** e-mail ou CPF exato (dry-run / apply inequívoco). Nome nunca é evidência suficiente. Telefone isolado nunca.

## Homologação / estado

- Modelo e FKs entregues; UI RH + Clientes + agregador de vínculos.
- Checklist: [`canonical-person-homologation-checklist.md`](./canonical-person-homologation-checklist.md)
- Migrations: ver [`canonical-person-migration-plan.md`](./canonical-person-migration-plan.md)
- Contato PJ: `Customer.contactPersonId` (não confundir com identidade PF).
