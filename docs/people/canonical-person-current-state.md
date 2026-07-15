# Pessoa canônica — estado atual (auditoria)

| | |
|---|---|
| Data | 2026-07-15 |
| Escopo | Identidade compartilhada entre papéis |

## Veredito

**Não havia** modelo `Person` / `Party` / `Individual` global. Pessoas viviam em silos:

| Entidade | Tipo | Identidade? |
|----------|------|-------------|
| Employee | RH | sim |
| AppUser | login | sim (conta) |
| CommissionPerson (+ Alias) | comissões | identidade de domínio |
| FleetDriver | frota | sim |
| Customer | PF/PJ sem tipo explícito | org / PF denormalizado |
| CrmCustomerCommercialOwner | carteira | **relacionamento** |
| SalesOrder.externalSellerId | pedido | relacionamento/soft |
| SupplierServiceTermination.person* | snapshot | não reutilizável |
| Nomus AR/AP personId | integração | externo |

Ausentes: `CustomerContact`, `SupplierContact`.

## Riscos

- Duplicidade de nome/e-mail entre módulos
- AppUser↔Employee já 1:1; demais soft-links
- Merge automático por nome seria perigoso
