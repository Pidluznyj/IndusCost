# Regras oficiais — CRM Comercial (3 abas)

**Projeto:** IndusCost / My Industry  
**Status:** norma oficial (documentação) — **implementação de código em prompts seguintes**  
**Data:** 2026-07-13  
**Base:**  
- [`crm-commercial-current-inventory.md`](./crm-commercial-current-inventory.md)  
- [`crm-commercial-data-source-diagnostics.md`](./crm-commercial-data-source-diagnostics.md)  
**Rota UI:** `/crm-commercial`

Este documento define o **comportamento desejado**. O código atual pode divergir (eixo híbrido, SQL próprio na Gestão Geral, etc.); a correção deve fechar o gap em relação a estas regras.

---

## 1. Definições

| Termo | Definição oficial |
|-------|-------------------|
| **CRM Comercial** | Módulo de carteira, relacionamento e follow-up comercial (`/crm-commercial`). |
| **Pedido** | Registro oficial em `SalesOrder` (+ itens em `SalesOrderItem`), espelhado do Pedido de Venda Nomus e/ou fluxo IndusCost. |
| **Motor oficial de pedidos** | Cadeia `salesOrderRulesEngine` / `salesOrderRulesAdapter` / métricas da tela Pedidos de Venda (`resolveOfficialScopedOrderMetrics`, Gestão de Pedidos). |
| **Indicador de pedido** | Qualquer KPI de quantidade, valor, carteira aberta, faturamento, cancelamento, ticket, produto líder ou clientes-com-pedido derivado de pedidos. |
| **Período** | Intervalo `[dateFrom, dateTo]` aplicado à **data de emissão** do pedido (`SalesOrder.issueDate`), salvo regra fiscal explícita de faturamento (data de NF). |
| **Cliente oficial** | Cadastro `Customer` (razão, fantasia, documento, contato, etc.). |
| **Carteira** | Conjunto de clientes sob um **Responsável Comercial** (ativo). |
| **Auditoria de pedido** | Informação complementar no detalhe/lista do pedido (vendedor Nomus, divergências), **sem** alterar o eixo da carteira. |

**Princípio mestre:** no CRM, a carteira se agrupa pelo **Responsável Comercial do Cliente**. Indicadores de pedido da carteira = pedidos oficiais **dos clientes** dessa carteira. Comissões e a tela Pedidos de Venda continuam no eixo **Vendedor do Pedido / Nomus**.

---

## 2. O que é Responsável Comercial

**Responsável Comercial do Cliente** é a pessoa (identidade comercial) designada para cuidar do **relacionamento, follow-up e carteira** daquele cliente no IndusCost.

| Aspecto | Regra |
|---------|--------|
| Persistência oficial | Modelo `CrmCustomerCommercialOwner` (atribuição **manual** pelo gestor/líder comercial, quando necessário). |
| Campos de identidade | `sellerIdentityKey`, `sellerCanonicalName`, `sellerResponsibleName`, `sellerExternalId`, `sellerAliasExternalIds`, `isActive`. |
| Quem define | Gestor/líder comercial (permissão `crm.customers.assign_seller` / ADMIN / SUPER_ADMIN). |
| Onde editar | Cadastro de Clientes → aba Responsável Comercial (pode ser exposto no CRM no futuro; a fonte continua a mesma tabela). |
| Uso no CRM | **Eixo principal** de Gestão por Responsável, Carteira de Clientes e (quando filtrado) Gestão Geral. |
| Uso em comissão | **Proibido.** Responsável comercial **nunca** gera comissão. |

Inferência Nomus (vendedor mais frequente nos pedidos do cliente) pode existir como **sugestão / fallback de exibição** quando não houver manual ativo — ver §8. Não substitui atribuição formal para “dono da carteira” quando o negócio exigir dono explícito.

---

## 3. O que é Vendedor do Pedido

**Vendedor do Pedido** é o vendedor informado no **Pedido de Venda no Nomus**, persistido no IndusCost em:

- `SalesOrder.externalSellerId` (ID Nomus)
- `SalesOrder.nomusSellerName` (nome Nomus)

| Aspecto | Regra |
|---------|--------|
| Fonte | Sync / espelho do pedido Nomus. |
| Campo legado | `SalesOrder.responsible` **não** é fonte oficial; só fallback de display/match legado até extinção. |
| Uso no CRM | **Auditoria e detalhe** do pedido; indicador quando diverge do responsável do cliente. |
| Uso em Pedidos de Venda | Eixo de filtro/agrupamento oficial da tela Pedidos. |
| Uso em carteira CRM | **Proibido** como dono permanente do cliente ou como único critério de atribuição de carteira. |

Quando vazio: exibir **"Pedido sem vendedor informado no Nomus."** (ver §10).

---

## 4. O que é Vendedor Comissionável

**Vendedor Comissionável** é a mesma identidade operacional do **Vendedor do Pedido (Nomus)** usada pelo módulo de **Comissões**.

| Aspecto | Regra |
|---------|--------|
| Fonte | `externalSellerId` / `nomusSellerName` do pedido (regras de comissão existentes). |
| Relação com Responsável Comercial | **Independente.** Podem coincidir ou divergir. |
| CRM | Não altera comissão; não usa responsável comercial para apuração. |
| Pedido sem vendedor Nomus | Tratado pelas regras de comissão já existentes (“sem vendedor informado”); CRM apenas **exibe** o aviso. |

Nenhuma regra deste documento altera cálculo de comissão, fluxo de caixa, contas a receber, relatório presidencial ou OrderToCashAudit.

---

## 5. Regras por aba

### 5.1 Gestão Geral

| Item | Regra oficial |
|------|----------------|
| **Finalidade** | Visão executiva geral do CRM Comercial (risco, volume, carteira, follow-up). |
| **Eixo padrão** | Global (todos os clientes/pedidos no escopo de permissão). Filtro opcional futuro por Responsável Comercial **não** muda a fonte de pedido. |
| **Fonte de pedidos** | `SalesOrder` / `SalesOrderItem` via **motor oficial** da tela Pedidos de Venda (mesmas definições de válido, valor, carteira aberta, faturado, cancelado, ticket). |
| **Fonte de clientes** | `Customer` oficial. |
| **Responsável** | Exibir / segmentar por Responsável Comercial do Cliente quando houver breakdown por carteira. |
| **Faturamento** | Cards de faturamento usam regra fiscal oficial (NF-e / vínculo NFe do motor), **não** inventar segunda regra. |
| **Propostas** | Proibido como fonte de indicadores de pedido. |

**Indicadores obrigatórios (período selecionável alinhado a `issueDate`, salvo card fiscal):**

- Pedidos emitidos  
- Valor de pedidos  
- Carteira aberta (qtd)  
- Valor em carteira  
- Pedidos faturados  
- Valor faturado  
- Pedidos cancelados  
- Ticket médio  
- Clientes com pedido  
- Produto líder  
- Clientes sem compra (regra de janela documentada na implementação)  
- Follow-ups (atrasados / próximos), se a fonte `CommercialActivity` estiver disponível  

### 5.2 Gestão por Vendedor → conceito oficial: Gestão por Responsável Comercial

| Item | Regra oficial |
|------|----------------|
| **Nome visual** | Pode permanecer **“Gestão por Vendedor”** **somente se** a UI deixar explícito (subtítulo/tooltip/filtro) que o filtro é o **Responsável Comercial da carteira**, não o vendedor comissionável do pedido. Preferência de produto: renomear para **“Gestão por Responsável Comercial”** ou **“Gestão por Carteira”**. |
| **Finalidade** | Responder: como está a carteira sob responsabilidade dessa pessoa? |
| **Filtro principal** | **Responsável Comercial do Cliente** (`sellerIdentityKey` / identidade consolidada do owner). |
| **Pedidos incluídos** | Todos os `SalesOrder` oficiais dos **clientes** sob esse responsável (no período), **independentemente** do vendedor Nomus do pedido. |
| **Vendedor do pedido** | Coluna/lista de auditoria; **não** define inclusão na carteira. |
| **Propostas** | Proibido como fonte. |
| **Comissão** | Fora de escopo. |

**Indicadores obrigatórios (mesmo motor oficial de pedidos, universo = carteira do responsável):**

- Pedidos emitidos / valor  
- Carteira aberta / valor em carteira  
- Pedidos faturados / valor faturado  
- Pedidos cancelados  
- Ticket médio  
- Clientes com pedido  
- Produto líder  
- Clientes que precisam follow-up  
- Clientes sem compra  
- Pedidos / clientes em risco (critérios de risco CRM alinhados à Gestão Geral)  

Perguntas que a aba **deve** responder:

1. Como está a carteira sob responsabilidade dessa pessoa?  
2. Quanto os clientes dela pediram?  
3. Quanto está aberto?  
4. Quanto foi faturado?  
5. Quais clientes precisam follow-up?  
6. Quais clientes sem compra?  
7. Quais pedidos estão em risco?  

### 5.3 Carteira de Clientes

| Item | Regra oficial |
|------|----------------|
| **Finalidade** | Gestão da base de clientes e relacionamento. |
| **Fonte de cliente** | `Customer` oficial. |
| **Dono da carteira** | Responsável Comercial do Cliente. |
| **Histórico de compra** | `SalesOrder` / motor oficial (último pedido, valor acumulado, recorrência). |
| **Relacionamento** | `CommercialActivity`, perfil CRM (`CrmCustomerProfile`), risco/temperatura. |
| **Proibido** | Vendedor do pedido como dono permanente; Proposta como origem oficial de histórico de compra; lógica de comissão. |

Enrich permitido por cliente: último pedido, valor no período/12m, carteira aberta, follow-up, flag de divergência responsável × vendedor do último pedido (informativo).

---

## 6. Fontes oficiais

| Domínio | Fonte oficial | Artefatos |
|---------|---------------|-----------|
| Pedido / item | `SalesOrder`, `SalesOrderItem` | Prisma + sync Nomus |
| Agregação de indicadores de pedido | Motor oficial Pedidos | `resolveOfficialScopedOrderMetrics`, management metrics / rules engine |
| Valor vendido | `SalesOrder.totalNetValue` | Data-base: `issueDate` |
| Carteira aberta | Pedido válido **sem** NF processada / `hasInvoice === false` no motor | Paridade com Gestão de Pedidos |
| Faturado | Regra fiscal do motor (NFe vinculada / processamento) | Cards de faturamento apenas |
| Cancelado | `SalesOrder.status === CANCELLED` | |
| Cliente | `Customer` | |
| Responsável comercial | `CrmCustomerCommercialOwner` (manual ativo) | |
| Vendedor do pedido | `externalSellerId`, `nomusSellerName` | |
| Follow-up | `CommercialActivity` | |
| Perfil / temperatura | `CrmCustomerProfile` | |

---

## 7. Campos / entidades proibidos como fonte de indicador de pedido

| Proibido | Motivo |
|----------|--------|
| `Proposal` / itens de proposta | Não são pedido oficial; não geram carteira/faturamento/comissão neste módulo |
| `SalesOrder.responsible` como **única** fonte de vendedor | Legado; sync oficial usa Nomus |
| Responsável comercial como vendedor comissionável | Conceitos distintos |
| `CommercialActivity.assignedTo` / `createdByName` como dono da carteira | São operação de follow-up, não `CrmCustomerCommercialOwner` |
| Usuário que criou o pedido no IndusCost | Não é eixo de carteira nem de comissão |
| Soma ad-hoc de propostas abertas como “carteira” | Substituído por carteira aberta de pedidos |

Permitido: `proposalId` apenas como **rastreabilidade** (“pedido sem proposta vinculada”), nunca como volume de negócio.

---

## 8. Regras de fallback

Ordem oficial para **exibir** responsável do cliente:

1. `CrmCustomerCommercialOwner` **manual ativo**  
2. Se não houver manual: inferência Nomus (vendedor mais frequente nos pedidos válidos do cliente) — marcada como **inferida**, não como atribuição formal  
3. Se nenhum: **"Cliente sem responsável comercial definido."** (§9)

Ordem oficial para **exibir** vendedor do pedido:

1. `nomusSellerName` (e/ou resolução por `externalSellerId`)  
2. Fallback legado `responsible` **somente** se Nomus vazio (transição)  
3. Se ambos vazios: **"Pedido sem vendedor informado no Nomus."** (§10)

**Escopo de carteira para KPIs (Gestão por Responsável):**

- Incluir clientes com owner **manual ativo** casando o filtro.  
- Política de inferidos:  
  - **Recomendado na correção:** incluir inferidos **somente** se o produto quiser cobertura sem assign manual; devem aparecer com badge **Inferido**.  
  - **Não** incluir cliente só porque teve **um** pedido com aquele vendedor Nomus se o responsável (manual ou inferido top) for outra pessoa.

**Proibido como fallback de carteira:** atribuir cliente à carteira A só porque o último pedido tem vendedor Nomus A, quando existe owner manual B.

---

## 9. Como tratar cliente sem responsável comercial

| Situação | Comportamento oficial |
|----------|------------------------|
| Lista Carteira / filtros por responsável | **Não** entra na carteira de ninguém (filtro por responsável). Em visão global, aparece com aviso. |
| Texto UI | **"Cliente sem responsável comercial definido."** |
| Gestão por Responsável | Não conta nos KPIs de nenhum responsável até assign ou política de inferido explícita. |
| Gestão Geral (global) | Entra nos totais globais de pedidos/clientes; breakdown por responsável usa bucket **“Sem responsável”**. |
| Ação sugerida | Gestor atribui responsável no Cadastro de Clientes. |

---

## 10. Como tratar pedido sem vendedor Nomus

| Situação | Comportamento oficial |
|----------|------------------------|
| Texto UI (detalhe / auditoria) | **"Pedido sem vendedor informado no Nomus."** |
| Inclusão em KPIs da carteira CRM | **Sim**, se o **cliente** estiver na carteira do responsável filtrado (eixo = cliente/responsável). |
| Inclusão em filtro da tela Pedidos / comissão | Conforme regras já existentes de “sem vendedor” (fora do escopo de alteração deste doc). |
| Não fazer | Preencher automaticamente com o Responsável Comercial do Cliente. |

---

## 11. Como tratar divergência responsável × vendedor do pedido

Quando, para um pedido (ou último pedido do cliente):

- existe Responsável Comercial do Cliente **e**
- existe Vendedor do Pedido Nomus **e**
- as identidades normalizadas **diferem**

então a UI **deve** mostrar indicador informativo:

> **"Responsável do cliente diferente do vendedor do pedido."**

| Obrigatório | Proibido |
|-------------|----------|
| Mostrar ambos os nomes (responsável vs vendedor do pedido) | Substituir um pelo outro |
| Manter pedido na carteira do **responsável** | Remover pedido da carteira do responsável porque o vendedor Nomus é outro |
| Usar vendedor Nomus só em auditoria / Pedidos / comissão | Gerar comissão pelo responsável comercial |

---

## 12. Critérios de aceite para correção

A correção das 3 abas só é aceita se **todos** os itens abaixo forem verdadeiros.

### 12.1 Conceitos
- [ ] Responsável Comercial, Vendedor do Pedido e Vendedor Comissionável estão separados na UI e na API.  
- [ ] Nenhum KPI de pedido do CRM usa `Proposal` como fonte.  
- [ ] Responsável comercial não entra em cálculo de comissão.

### 12.2 Fontes
- [ ] Indicadores de pedido usam `SalesOrder`/`SalesOrderItem` ou `resolveOfficialScopedOrderMetrics` (ou bundle oficial equivalente da Gestão de Pedidos).  
- [ ] Definições de carteira aberta / faturado / cancelado / valor / `issueDate` são as mesmas da tela Pedidos (diferença permitida **somente** no eixo de agrupamento).  
- [ ] Campos proibidos (§7) não alimentam KPIs.

### 12.3 Gestão Geral
- [ ] Exibe o conjunto de indicadores da §5.1.  
- [ ] Não depende de SQL com status de compra incompatível com o motor (ex.: só `READY_TO_SEND`/`SENT_TO_NOMUS` se o motor for mais amplo).  
- [ ] Faturamento respeita regra fiscal oficial.

### 12.4 Gestão por Responsável (aba hoje “por Vendedor”)
- [ ] Filtro principal = Responsável Comercial.  
- [ ] KPIs = pedidos dos **clientes** da carteira no período.  
- [ ] Vendedor Nomus não atribui carteira.  
- [ ] UI deixa claro o eixo (renomear ou subtítulo obrigatório).  
- [ ] Caso Gislene / 30 dias: se houver clientes com owner Gislene e pedidos no período, KPIs **não** ficam zerados apenas porque o vendedor Nomus do pedido é outro.  
- [ ] Script `scripts/inspect-crm-commercial-data-sources.ts` no DB alvo confirma: `B_crmByCommercialOwner.ordersInPeriod` ≈ KPIs da aba (mesmo universo).

### 12.5 Carteira de Clientes
- [ ] Dono = Responsável Comercial.  
- [ ] Histórico de compra via SalesOrder.  
- [ ] Avisos §§9–11 visíveis quando aplicável.

### 12.6 Não regressão
- [ ] Tela Pedidos de Venda inalterada no eixo Nomus.  
- [ ] Comissões, Fluxo de Caixa, Contas a Receber, Relatório Presidencial, OrderToCashAudit **sem** mudança de cálculo.  

### 12.7 Qualidade
- [ ] Testes unitários cobrindo: eixo owner vs Nomus; pedido sem vendedor; cliente sem responsável; divergência de nomes.  
- [ ] `check:server-imports`, `check:frontend-server-imports`, testes CRM relevantes e build OK.

---

## 13. Mapa rápido: correto por domínio

| Domínio | Eixo correto | Fonte de pedido |
|---------|--------------|-----------------|
| **CRM Comercial** | Responsável Comercial do Cliente | SalesOrder (motor oficial), universo = clientes da carteira |
| **Pedidos de Venda** | Vendedor do Pedido (Nomus) | SalesOrder (motor oficial) |
| **Comissões** | Vendedor Comissionável (= Nomus do pedido) | Regras de comissão existentes |

---

## 14. Referências de implementação (próximos prompts)

Arquivos candidatos (já inventariados; **não alterados por este documento**):

- `src/lib/crmSellerDashboardService.ts`, `crmSellerMatchSql.ts`, `crmCustomersList.ts`  
- `src/lib/crmManagementDashboardService.ts`, `crmOrderPortfolioSql.ts`  
- `src/lib/crmCustomerCommercialOwner.ts`  
- `src/lib/salesOrderRulesAdapter.ts` (`resolveOfficialScopedOrderMetrics`)  
- `src/components/CrmModule.tsx`, abas seller/management/portfolio  

Diagnóstico live: `scripts/inspect-crm-commercial-data-sources.ts`.
