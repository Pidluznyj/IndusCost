# Diagnóstico de fontes de dados — CRM Comercial vs Pedidos de Venda

**Projeto:** IndusCost / My Industry  
**Tipo:** read-only (sem correção de regra neste prompt)  
**Data:** 2026-07-13  
**Script:** `tmp-audits/inspect-crm-commercial-data-sources.ts` (cópia versionada: `scripts/inspect-crm-commercial-data-sources.ts`)  
**Parâmetros alvo:** `--days=30` · `--responsibleName="GISLENE LIMA"` · `--sellerName="GISLENE LIMA"`

---

## 1. Resultado do script

### 1.1 Execução neste workspace

```text
npx tsx tmp-audits/inspect-crm-commercial-data-sources.ts --days=30 --responsibleName="GISLENE LIMA" --sellerName="GISLENE LIMA"
```

| Campo | Valor |
|-------|--------|
| `generatedAt` | `2026-07-13T12:49:21.406Z` |
| Período resolvido | `2026-06-14` → `2026-07-13` (30 dias) |
| `sellerIdentityKey` | `gislene lima` |
| `dbReachable` | **false** |
| Erro | `Can't reach database server at localhost:5432` |

O ambiente Cursor aponta `DATABASE_URL` para **localhost:5432**, sem Postgres local.  
**Contagens A–E live não puderam ser materializadas aqui.** O JSON bruto ficou em `tmp-audits/crm-commercial-data-sources-last-run.json` (gitignored).

Para preencher números reais (produção/staging):

```bash
# com DATABASE_URL do ambiente alvo
npx tsx scripts/inspect-crm-commercial-data-sources.ts --days=30 --responsibleName="GISLENE LIMA" --sellerName="GISLENE LIMA"
```

O script, quando o DB responde, imprime e grava:

- **A)** origem oficial `SalesOrder` (totais, cancelados, sem vendedor Nomus, por vendedor, por responsável comercial, top clientes/produtos)
- **B)** CRM por responsável comercial (clientes, pedidos, valor, carteira aberta, faturados)
- **C)** pedidos cujo vendedor Nomus = Gislene
- **D)** diferença owner vs vendedor do pedido (+ escopo híbrido do seller-dashboard)
- **E)** até 20 exemplos em cada categoria de divergência
- Diagnóstico de “por que a aba zera”

### 1.2 Saída estrutural capturada (sempre)

```json
{
  "concepts": {
    "crmAxis": "Responsável Comercial do Cliente (CrmCustomerCommercialOwner) + escopo híbrido atual",
    "salesOrdersAxis": "Vendedor Nomus do pedido (externalSellerId + nomusSellerName)",
    "commissionsAxis": "Vendedor Nomus do pedido — nunca responsável comercial",
    "proposalIsOfficialOrderSource": false
  },
  "whySellerTabMayShowZeros": {
    "filterUsesOrderSeller": true,
    "filterUsesCommercialOwner": true,
    "apiUsesProposals": false,
    "frontendDoesNotClearNumbers": "CrmModule seta summary da API; zeros vêm do backend se ordersCount=0"
  }
}
```

---

## 2. Diagnóstico da Gislene (últimos 30 dias)

### 2.1 Perguntas obrigatórias (por que a aba “Gestão por Vendedor” zera?)

| Pergunta | Resposta (código atual) |
|----------|-------------------------|
| Filtro usa **vendedor do pedido**? | **Sim** — match `COALESCE(nomusSellerName, responsible)` + `externalSellerId` (`crmSellerMatchSql.ts`) |
| Filtro usa **responsável comercial**? | **Sim (parcial)** — `OR customerId IN (CrmCustomerCommercialOwner ativo)` (`buildCrmSellerPortfolioOrderScopeSql`) |
| Nome não bate? | UI manda `sellerIdentityKey` normalizado (`gislene lima`). Acento/caixa/espaços são normalizados. Risco residual: opção consolidada por ID (`__ID_ONLY__:N`) vs nome |
| Customer responsible vazio? | Sync Nomus seta `SalesOrder.responsible = null` e preenche `nomusSellerName`. Antes do COALESCE, filtro só em `responsible` **zerava**; pós-fix isso deve melhorar **após deploy** |
| Data errada? | Período UI → `dateFrom`/`dateTo` → filtro em **`issueDate`**. Preset “Últimos 30 dias” é coerente com o script |
| Endpoint retorna zero? | `GET /api/crm/seller-dashboard` devolve `summary.ordersCount` do motor oficial sobre IDs do escopo. Se escopo SQL = 0 pedidos → KPIs 0 |
| Frontend limpa resultado? | **Não** — `CrmModule` aplica o payload; não zera artificialmente |
| Permissões filtram? | `crm.seller.all` permite escolher Gislene; `crm.seller.own` força vínculo do usuário. Sem vínculo → UI bloqueia (“não vinculado”), não necessariamente cards 0 com nome selecionado |
| API usa propostas? | **Não** — service não consulta `Proposal` |

### 2.2 Hipótese mais provável para o zero observado na UI

Combinação de:

1. **Deploy ainda sem o fix** de `COALESCE(nomusSellerName, responsible)` + portfolio owner, **ou**
2. No período de 30 dias: **nenhum** pedido com vendedor Nomus = Gislene **e** **nenhum** cliente com `CrmCustomerCommercialOwner` ativo para `gislene lima`.

Sem DB alvo, não dá para afirmar (1) vs (2). O script live no servidor decide:

- Se `ordersByNomusSellerInPeriod > 0` ou `ordersByCommercialOwnerInPeriod > 0` mas UI = 0 → **deploy/código antigo ou período diferente**.
- Se ambos = 0 e `hybridSellerDashboardOrders = 0` → **zero correto para o eixo atual** (falta owner e/ou pedidos Nomus no período).

### 2.3 O que o script medirá no DB alvo (placeholders)

| Métrica | Esperado no JSON (`sections.*`) |
|---------|----------------------------------|
| Pedidos oficiais no período | `A_officialSalesOrder.totalOrdersInPeriod` |
| Pedidos Gislene (vendedor Nomus) | `C_ordersByNomusSeller.orders` |
| Pedidos clientes sob responsável comercial Gislene | `B_crmByCommercialOwner.ordersInPeriod` |
| Escopo híbrido seller-dashboard | `D_difference.hybridSellerDashboardOrders` |
| Clientes na carteira (union) | `comparisonTable.crmCarteiraUnionCustomers.customers` |

---

## 3. Tabela comparativa (eixos e fontes)

| Dimensão | CRM Gestão Geral | CRM Gestão por Vendedor / Responsável | Carteira de Clientes | Pedidos de Venda |
|----------|------------------|----------------------------------------|----------------------|------------------|
| **Endpoint** | `GET /api/crm/management-dashboard` | `GET /api/crm/seller-dashboard` | `GET /api/crm/customers` | `GET /api/sales-orders` / `.../management` |
| **Fonte de pedido** | `SalesOrder` (SQL próprio) | `SalesOrder` + KPIs `resolveOfficialScopedOrderMetrics` | Enrich/`SalesOrder` por cliente | `SalesOrder` + motor oficial |
| **Proposta como fonte?** | Não | Não | Não (intel tem bloco deprecated) | Não |
| **Eixo pessoa** | Nenhum (global) | Híbrido: owner comercial **OU** vendedor Nomus do pedido | Union: pedidos do vendedor ∪ owner manual | Só **vendedor Nomus** (`sellerKey` / `externalSellerId`) |
| **Campo data** | Vários (contato/compra); carteira aberta sem período de emissão no card principal | `issueDate` (+ NF `dataProcessamento` p/ faturado no período) | Filtros de contato/FU; pedidos do cliente sem o mesmo preset de 30d na lista | `issueDate` |
| **Status “válido”** | Compra: só `READY_TO_SEND`/`SENT_TO_NOMUS` | Exclui `CANCELLED`/`ERROR` | Pedidos válidos no enrich | Motor/lista (cancelados conforme filtro) |
| **Valor** | `totalNetValue` | `totalNetValue` (oficial) | N/A agregado de KPI seller | `totalNetValue` |
| **Carteira aberta** | Válido sem NF em `nomusRawResponse` | Motor `openPortfolio*` (+ lists SQL NF JSON) | Flag `hasOpenPortfolio` por cliente | `!hasInvoice` / NFe link |
| **Contagem no período (script)** | `crmGestaoGeralValidPurchaseStatusesInPeriod` | `crmGestaoPorVendedorHybridScope` | pedidos dos clientes do union | `salesOrdersScreenAllValidInPeriod` / `...FilteredByNomusSeller` |
| **Paridade com motor Pedidos** | **Não** (SQL + status estreito) | **Parcial** (KPIs oficiais; lists SQL paralelos) | Lista de clientes, não KPI de gestão | **Referência** |

**Causas prováveis de diferença numérica (quando o DB responder):**

1. Gestão Geral usa status mais estreito → menos pedidos que Pedidos/Seller.  
2. Seller CRM híbrido inclui pedidos de clientes owned mesmo com outro vendedor Nomus → pode ser **maior** que filtro Nomus da tela Pedidos.  
3. Carteira conta **clientes** (e opcionalmente todos os pedidos deles); Pedidos conta **linhas de pedido** pelo vendedor do pedido.  
4. NF via JSON vs `SalesOrderNfeLink` → divergência de “faturado/carteira aberta”.  
5. Período só em seller UI; Gestão Geral não aplica o mesmo filtro de 30 dias nos cards principais.

---

## 4. Lista de inconsistências

1. **Dois eixos no CRM seller** (owner ∪ vendedor pedido) vs **um eixo** em Pedidos (só Nomus) — diferença legítima se explícita; hoje a UI ainda diz “vendedor”.  
2. **Gestão Geral** não reutiliza `resolveOfficialScopedOrderMetrics`.  
3. **Status de compra** Gestão Geral ≠ universo do motor.  
4. **Enrich carteira** ainda lê `so.responsible` para “vendedor primário” do pedido (legado).  
5. **Detecção NF** dual (JSON raw vs NFe link).  
6. **Labels / breakdown** `assignedTo` / `createdByName` ≠ responsável comercial.  
7. **Resíduos Proposal** (intel deprecated, KPI “sem proposta”).  
8. **Zero Gislene** historicamente por filtro em `responsible` NULL pós-sync — corrigido no código recente; **depende de deploy + dados**.

---

## 5. Separação clara de conceitos

| Conceito | Correto para | Fonte | Não usar para |
|----------|--------------|-------|---------------|
| **Responsável Comercial do Cliente** | CRM (carteira, FU, relacionamento, agrupamento) | `CrmCustomerCommercialOwner` (+ inferência pontual) | Comissões; substituir vendedor do pedido |
| **Vendedor do Pedido (Nomus)** | Pedidos de Venda; **Comissões** | `externalSellerId` + `nomusSellerName` | Ser o único eixo de carteira CRM sem owner |
| **`SalesOrder.responsible` legado** | Fallback de display/match apenas | Campo legado (sync zera) | Fonte oficial isolada |
| **Proposta** | Histórico/negociação auxiliar | `Proposal` | Indicadores de pedido/carteira/financeiro |
| **Atividade `assignedTo` / criador** | Follow-up operacional | `CommercialActivity` | Dono da carteira / comissão |

---

## 6. Conclusão

### CRM está usando a origem correta?
**Quase.** Indicadores de pedido vêm de **`SalesOrder` / `SalesOrderItem`**, não de Proposta.  
A aba **Gestão por Vendedor** já chama o **motor oficial** (`resolveOfficialScopedOrderMetrics`).  
A aba **Gestão Geral** ainda usa **SQL próprio** → origem entidade OK, agregador **não** paritário com Pedidos.

### CRM está usando o eixo correto?
**Parcialmente.** O desejado para carteira é **Responsável Comercial do Cliente**.  
O código atual do seller-dashboard é **híbrido** (owner **OU** vendedor Nomus).  
Pedidos/Comissões continuam corretos no eixo Nomus (não alterados neste diagnóstico).

### Quais abas precisam correção? (próximos prompts — não feitos aqui)

| Aba | Precisa correção? | Foco sugerido |
|-----|-------------------|---------------|
| **Gestão por Vendedor** | **Sim** (eixo + paridade + validar zero Gislene no DB) | Eixo primário = responsável comercial; pedidos = todos do cliente; alinhar UI; confirmar deploy/COALESCE; rodar script no DB real |
| **Gestão Geral** | **Sim** (agregador/status) | Reusar motor oficial; alinhar status/carteira aberta; opcional filtro por responsável |
| **Carteira de Clientes** | **Sim** (consistência de display) | Enrich com `nomusSellerName`; eixo owner explícito; não misturar labels |

### Próximo passo operacional
Rodar o script **no host com o Postgres real** e colar o JSON em uma atualização deste doc (seções A–E preenchidas). Sem isso, o zero da Gislene na UI não pode ser fechado como “bug de filtro” vs “sem dados no eixo”.

---

## 7. Arquivos do diagnóstico

| Arquivo | Papel |
|---------|--------|
| `scripts/inspect-crm-commercial-data-sources.ts` | Script versionado (commit) |
| `tmp-audits/inspect-crm-commercial-data-sources.ts` | Cópia para o path pedido (gitignored `tmp-audits/`) |
| `tmp-audits/crm-commercial-data-sources-last-run.json` | Última saída (gitignored) |
| `docs/commercial/crm-commercial-current-inventory.md` | Inventário técnico prévio |
| `docs/commercial/crm-commercial-data-source-diagnostics.md` | Este documento |
