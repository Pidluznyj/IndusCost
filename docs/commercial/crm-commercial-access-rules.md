# Regras de acesso — CRM Comercial

**Projeto:** IndusCost / My Industry  
**Atualizado:** 2026-07-14  
**Rota:** `/crm-commercial`  
**Service:** `src/lib/commercial/commercialAccessScopeService.ts`  
**Escopo canônico:** `src/lib/crmCommercialAccessScope.ts`

---

## 1. Responsável Comercial × Vendedor do Pedido

| Conceito | Fonte | Uso no CRM | Uso em comissão |
|----------|-------|------------|-----------------|
| **Responsável Comercial** | CRM / carteira (`CrmCustomerCommercialOwner`) | Escopo, agrupamento, follow-up, gestão | **Proibido** |
| **Vendedor do Pedido (Nomus)** | `SalesOrder.externalSellerId` / `nomusSellerName` | Auditoria / divergência na UI | **Eixo comissionável** |

- Se o vendedor do pedido estiver vazio → exibir **"Sem vendedor informado"**.
- Nunca substituir automaticamente o vendedor do pedido pelo Responsável Comercial.
- Pedido cujo vendedor Nomus é outro pode aparecer na carteira do responsável do **cliente**; isso **não** altera comissão.
- `SalesOrder.responsible` (FINANCEIRO / FATURAMENTO / setor) **não** é Responsável Comercial.

### Propostas

Propostas podem aparecer como origem/histórico comercial. **Não** são fonte oficial de indicadores de venda, faturamento, comissão ou pedido. KPIs de pedidos usam `SalesOrder` / `SalesOrderItem`.

### Prisma — anti-padrão corrigido

`CrmCustomerCommercialOwner` **não** é relação de `SalesOrder`. É proibido:

```ts
prisma.salesOrder.findMany({ include: { CrmCustomerCommercialOwner: true } })
```

Regra correta: buscar pedidos → resolver responsáveis em batch via
`resolveCommercialResponsibleMap` / `injectCommercialResponsibleIntoOrders`.

---

## 2. DTO canônico de escopo

`resolveCommercialCrmScopeDto` / `loadCommercialCrmScope` **sempre** retornam objeto
(nunca `undefined`):

```ts
{
  canViewAll: boolean;
  allowedCustomerIds: string[];
  allowedResponsibleIds: string[];
  denied: boolean;
  reason?: string;
}
```

| Perfil | DTO |
|--------|-----|
| SUPER_ADMIN / ADMIN | `{ canViewAll: true, allowed*: [], denied: false }` |
| COMMERCIAL_MANAGER | igual a admin enquanto não houver hierarquia (*fallback*) |
| SELLER com carteira | `{ canViewAll: false, allowedCustomerIds: [...], allowedResponsibleIds: [...], denied: false }` |
| SELLER sem carteira / sem vínculo | `{ canViewAll: false, allowed*: [], denied: false, reason?: "..." }` → **dashboard vazio** |
| VIEWER / sem permissão | `{ canViewAll: false, allowed*: [], denied: true, reason: "..." }` → **403 tratado** |

**Nunca** retornar erro **500** por escopo vazio ou `IN []` mal montado.

---

## 3. Matriz por perfil

| Perfil | Gestão Geral | Gestão por Responsável | Carteira | Observação |
|--------|--------------|------------------------|----------|------------|
| **SUPER_ADMIN** | Sim (tudo) | Sim | Sim | Bypass total no backend |
| **ADMIN** | Sim (tudo) | Sim | Sim | Bypass total no backend |
| **COMMERCIAL_MANAGER** | Sim* | Sim* | Sim* | *Fallback sem hierarquia → vê todos |
| **SELLER** | Não (403) | Só própria carteira | Só seus clientes | Sem carteira → vazio, não 500 |
| **VIEWER** | Não | Não | Não | 403 / denied — nunca dados alheios |

\* **TODO(commercial-hierarchy):** restringir gestor à equipe quando o modelo existir.

Mensagens amigáveis (frontend):

- `"Você não tem acesso a esta visão."` (403 genérico)
- Mensagens de vínculo / carteira vindas do backend (`SELLER_NOT_LINKED`)
- Payload vazio: `"Nenhum cliente encontrado para sua carteira."`

---

## 4. Endpoints

| Endpoint | Guard |
|----------|-------|
| `GET /api/crm/management-dashboard` | `requireCrmCommercialGeneralScope` (só `global`) |
| `GET /api/crm/seller-dashboard` | `resolveCrmSellerDashboardQueryScope` (SELLER força própria identidade; sem vínculo → own vazio) |
| `GET /api/crm/customers` | `requireCrmCommercialDataScope` + filtro owner-only |

Queries:

- `canViewAll` → sem filtro de cliente/responsável.
- `!canViewAll` + IDs → `customerId IN (...)`.
- `!canViewAll` + IDs vazios → payload vazio **sem** consultar o universo.

---

## 5. Comissões e Pedidos

- Comissão continua no **vendedor Nomus do pedido**.
- CRM não altera cálculo/sync/fechamento de comissão.
- Tela Pedidos de Venda permanece no eixo Nomus (independente do CRM).

---

## 6. Diagnóstico / QA

```bash
npx tsx tmp-audits/inspect-crm-commercial-scope-error.ts
npx tsx tmp-audits/inspect-crm-commercial-dashboard-admin.ts
npx tsx tmp-audits/inspect-crm-commercial-owner-resolution.ts
npx tsx scripts/qaCrmCommercialAccessScope.ts
```

---

## 7. Pendências

1. Hierarquia gestor → responsáveis da equipe.
2. Smoke visual com DB após deploy (admin + seller com/sem carteira).
