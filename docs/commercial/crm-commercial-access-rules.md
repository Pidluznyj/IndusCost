# Regras de acesso — CRM Comercial

**Projeto:** IndusCost / My Industry  
**Data:** 2026-07-13  
**Rota:** `/crm-commercial`  
**Service:** `src/lib/commercial/commercialAccessScopeService.ts`  
**Escopo canônico:** `src/lib/crmCommercialAccessScope.ts`

---

## 1. Responsável Comercial × Vendedor Comissionável

| Conceito | O que é | Onde vive | Uso no CRM | Uso em comissão |
|----------|---------|-----------|------------|-----------------|
| **Responsável Comercial do Cliente** | Dono da carteira / relacionamento | `CrmCustomerCommercialOwner` (+ vínculo `AppUser.externalSellerId` / `sellerResponsibleName`) | **Eixo de acesso e agrupamento** | **Proibido** |
| **Vendedor do Pedido (Nomus)** | Vendedor informado no Pedido de Venda | `SalesOrder.externalSellerId` / `nomusSellerName` | Auditoria / divergência | **Eixo comissionável** |

Princípio: o pedido entra na carteira CRM do **responsável do cliente**. Se o vendedor Nomus for outro, a UI/API sinaliza divergência — **sem alterar comissão**.

---

## 2. Matriz de acesso por perfil

| Perfil | Gestão Geral | Gestão por Responsável | Carteira | Filtro de responsável |
|--------|--------------|------------------------|----------|------------------------|
| **SUPER_ADMIN** | Sim (tudo) | Sim | Sim | Qualquer |
| **ADMIN** | Sim (tudo) | Sim | Sim | Qualquer |
| **COMMERCIAL_MANAGER** | Sim* | Sim* | Sim* | Qualquer* (fallback) |
| **SELLER** | **Não** (403 backend) | Só a própria carteira | Só seus clientes | Travado no próprio vínculo |
| **VIEWER** / sem carteira | Não | Não | Não | — |

\* **Fallback temporário:** sem hierarquia formal gestor → equipe, `COMMERCIAL_MANAGER` vê todos os responsáveis comerciais (`unrestricted`).  
**TODO(commercial-hierarchy):** restringir à equipe quando o modelo existir.

Mensagem amigável (sem acesso / sem vínculo):

> Você não possui carteira comercial vinculada ou permissão para acessar esta visão.

---

## 3. Regra de CRM por carteira

1. Cliente na carteira do usuário ⇔ existe `CrmCustomerCommercialOwner` **ativo** que casa com o vínculo do `AppUser` (`sellerIdentityKey` / nome / `externalSellerId`).
2. Pedidos da carteira = `SalesOrder` dos clientes acima (`issueDate`, motor oficial Pedidos).
3. Pedido **sem** vendedor Nomus **permanece** na carteira se o cliente tem responsável.
4. Pedido com Nomus ≠ responsável → flag de auditoria; **não** muda dono da carteira nem comissão.

Backend obrigatório (não só UI):

| Endpoint | Guard de escopo |
|----------|-----------------|
| `GET /api/crm/management-dashboard` | `requireCrmCommercialGeneralScope` (só global) |
| `GET /api/crm/seller-dashboard` | `resolveCrmSellerDashboardQueryScope` (SELLER ignora query de outro responsável) |
| `GET /api/crm/customers` | `requireCrmCommercialDataScope` + filtro owner-only |
| Profile / intelligence | `isCustomerInCrmCommercialScope` (owner-only) |

---

## 4. Regra de Pedidos de Venda

- Fonte: `SalesOrder` / `SalesOrderItem`.
- Período: `SalesOrder.issueDate`.
- Eixo da tela Pedidos: **vendedor Nomus** (independente do CRM).
- Proposal **não** é fonte de pedido no CRM.

---

## 5. Regra de Comissões

- Continuam no vendedor do pedido Nomus.
- CRM **não** altera cálculo, sync, fechamento ou identidade comissionável.
- `comissionamentoAfetado: false` nas sourceInfo do CRM.

---

## 6. Comportamentos

### Vendedor logado (SELLER)

- Entra em **Gestão por Responsável** / **Carteira** na própria identidade.
- Não vê Gestão Geral global (aba + API 403).
- Query `externalSellerId` / `sellerIdentityKey` de outro responsável é **ignorada**.
- Sem vínculo AppUser → 403 `SELLER_NOT_LINKED` + mensagem amigável.

### Supervisor / gestor (`COMMERCIAL_MANAGER`)

- Hoje: vê todos os responsáveis (fallback).
- Futuro: só equipe (`TODO(commercial-hierarchy)`).

### Admin / Super Admin

- Sem restrição de carteira; filtros livres.

### VIEWER / sem permissão

- Tabs CRM = NONE na matriz de recursos.
- APIs retornam 403 / empty autorizado — **nunca** dados de outros responsáveis.

---

## 7. Diagnóstico

```bash
npx tsx tmp-audits/inspect-crm-commercial-access-scope.ts
npx tsx tmp-audits/inspect-crm-commercial-access-scope.ts --email=user@empresa.com
```

---

## 8. Pendências

1. Modelar hierarquia gestor → responsáveis e aplicar no escopo.
2. Smoke visual com DB após deploy das regras de VIEWER/SELLER.
