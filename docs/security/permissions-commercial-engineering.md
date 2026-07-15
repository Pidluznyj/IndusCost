# Comercial e Engenharia — permissões (Prompt 13)

| | |
|---|---|
| **Padrão** | Comissões (`canViewResource` + legado para mutações) |
| **Fonte FE** | `commercialEngineeringPermissions.ts`, `permissionsClient` ResourceKeys, `sidebarMenuResources` |
| **Contrato** | `permissionContract/resources.ts` (ações só onde justificadas) |

---

## Recursos concluídos

### Comercial
| Módulo | Menu/rota (resourceKey) | Ações gated | API |
|--------|-------------------------|-------------|-----|
| CRM | já `comercial.crm` + tabs | escopos seller own/all | resource tabs |
| Clientes | `commercial.customers` | create / edit / import | legado create/edit |
| Propostas | `commercial.proposals` | já create/edit/delete/print | legado |
| Pedidos Nomus | `comercial.pedidos_venda` | export = view | `sales_orders.view` |
| Formação de Preço | `commercial.pricing` | simulate / tables / **delete** | delete → generate\|publish |

### Engenharia
| Módulo | resourceKey | Notas |
|--------|-------------|-------|
| Produtos + abas modal | `engineering.products` + `…tab.*` | `getVisibleProductTabs` hybrid |
| Simulador injeção | `engineering.transformation_simulator` | OR view legado |
| Suprimentos / MP | `suprimentos` (já) | edit/import FE |
| Inteligência de Mercado | tabs MI já | approve legado |
| Simulações | `engineering.simulations` | create gated |
| Projetos | `engineering.projects` | manage / SUPER_ADMIN delete |

## Gaps eliminados
- Clientes: botões CRUD/import sem gate
- Pricing DELETE com só `pricing.view`
- Módulos Comercial/Engenharia fora do mapa `SIDEBAR_MODULE_RESOURCE_KEYS`
- Abas de produto fora do audit tab registry / relational keys
- Export de pedidos sem cheque explícito de view

## Preservado
- Vendedor do pedido / canônico (comissões)
- CRM seller.own vs seller.all
- BOM / custos / Nomus (sem inventar delete fiscal)
- Pedidos Nomus sem CUD canônico

## Testes
```bash
npm run test:commercial-engineering-permissions
npm run audit:permission-contract
```
