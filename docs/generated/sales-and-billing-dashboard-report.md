# Relatório — Painel Gerencial: Pedidos de Venda e Faturamento

**Data:** 2026-06-05  
**Commit:** _(preenchido após commit)_

---

## 1. Problema identificado

A Visão Executiva misturava indicadores gerais de vários módulos (Nomus, frota, RH, clientes) com KPIs comerciais em layout único, dificultando substituir o BI gerencial por área. Propostas não são fonte confiável para gestão operacional.

---

## 2. Por que propostas foram removidas da visão principal

Propostas representam pipeline/oportunidade. Pedidos de venda (`SalesOrder`) consolidam emissão, valores líquidos e status operacionais. A aba **Funil de Vendas** no dashboard continua usando propostas.

---

## 3. Nova estrutura por abas internas

Endpoint mantido: `GET /api/dashboard/executive-summary`

Payload reorganizado:

```json
{
  "generatedAt": "...",
  "permissions": { "salesOrders": true, "billing": true },
  "tabs": {
    "salesOrders": { ... },
    "billing": { ... }
  },
  "unavailableIndicators": []
}
```

Frontend `/dashboard` → aba **Visão Executiva** → sub-abas:
- **Pedidos de Venda**
- **Faturamento**

Abas **Operação/Financeiro** e **Funil de Vendas** preservadas.

---

## 4. Aba Pedidos de Venda — indicadores e regras

| Indicador | Fonte | Regra |
|-----------|-------|-------|
| Pedidos no ano/mês | `SalesOrder.totalNetValue` | `issueDate` no período; `status != CANCELLED` |
| Ticket médio | calculado | valor emitido no mês ÷ quantidade |
| Carteira aberta | `SUM(totalNetValue)` | não cancelado + sem `nfes.dataProcessamento` |
| Média diária | calculado | valor ÷ dias úteis decorridos (seg–sex) |
| Pedidos atrasados | count + lista | entrega prevista vencida + sem NF + não cancelado |
| Meta / % atingimento | calculado | mesmo mês ano anterior × 1,30 |
| Evolução mensal | gráfico | emissão mês a mês: ano atual vs anterior |
| Status dos pedidos | breakdown | agrupado por `SalesOrder.status` (exceto cancelados) |

**Data de entrega:** campo `expectedDeliveryDate` (origem Nomus `dataEntregaPadrao`).

---

## 5. Aba Faturamento — indicadores e regras

| Indicador | Fonte | Regra |
|-----------|-------|-------|
| Faturamento mês/ano | `SalesOrder.totalNetValue` | NF com `dataProcessamento` no período; **cliente de mercado** |
| Mesmo mês ano anterior | idem | período equivalente |
| Projeção do mês | calculado | média diária × dias úteis totais do mês |
| Meta / atingimento | × 1,30 | faturamento mesmo mês ano anterior |
| Meta anual | × 1,30 | faturamento total ano anterior |
| YTD comparativo | agregação | acumulado até hoje vs mesmo período ano anterior |
| Ticket médio faturado | calculado | faturamento mês ÷ pedidos faturados |
| Média diária faturada | dias úteis | faturamento mês ÷ dias úteis decorridos |
| Evolução mensal | gráfico | mês a mês: atual, anterior, retrasado, meta |
| Acumulado mensal | gráfico linha | soma progressiva por mês |
| Realizado vs projetado | gráfico | mês atual, projeção, meta |
| Top clientes | agregação | faturamento ano; exclui grupo |
| Recentes | lista | NF processada, status NF quando disponível |

**Valor base:** `totalNetValue` do pedido. Campo de valor fiscal na NF não está estruturado de forma confiável — documentado como limitação.

**Status NF:** quando `nfe->>'status'` existe, exibido na lista; critério de inclusão continua sendo `dataProcessamento` (não há mapeamento confiável de “4 - Autorizada” no código).

---

## Regra de exclusão de empresas do grupo no faturamento

### Por que excluir
Lazarios, Koppetel e SM Comércio de Plásticos emitem NF entre si (operações intragrupo). Incluir esses clientes infla o faturamento gerencial e mascara a **venda real de mercado**.

### CNPJs usados (critério principal)
| Empresa | CNPJ |
|---------|------|
| Koppetel | 14.055.501/0001-80 (`14055501000180`) |
| Lazarios | 72.569.510/0001-95 (`72569510000195`) |
| SM | **CNPJ pendente de confirmação no cadastro** |

### Fallback por nome (SM e variações)
Até confirmação do CNPJ da SM, aplica-se filtro por nome normalizado (sem acentos, case-insensitive):
- `koppetel`, `lazarios`
- `sm comercio de plasticos` / `sm com ... plastic`
- nome fantasia exatamente `sm`

### Onde está implementado
| Arquivo | Função |
|---------|--------|
| `src/lib/groupCompanyCustomer.ts` | `isGroupCompanyCustomer`, `isMarketBillingCustomer` |
| `src/lib/billingMarketCustomerSql.ts` | `billingMarketCustomerFilterSql` (SQL) |
| `src/lib/billingDashboardMetrics.ts` | Todas as queries da aba Faturamento |

### Impacto esperado
Redução do faturamento consolidado na aba Faturamento em relação ao total bruto de NF processadas. Pedidos de Venda **não** aplicam esta exclusão (continuam refletindo emissão operacional).

### Limitações
- SM sem CNPJ confirmado — risco de falso negativo/positivo em nomes ambíguos contendo “SM”.
- Regra “Venda de Mercado” e “Faturamento Fiscal” do BI ainda não existem como campos dedicados; proxy inicial = NF processada + não cancelado + exclusão de grupo.
- Status NF “Autorizada” não filtrado nesta versão.

---

## 6. Regras transversais

### Pedido não cancelado
`SalesOrder.status != 'CANCELLED'` (enum Prisma `SalesOrderStatus`).

### NF processada / faturado
Existe elemento em `nomusRawResponse.nfes` com `dataProcessamento` preenchido (DD/MM/YYYY). Helper: `orderIsInvoicedSql`.

### Pedido atrasado
- não cancelado
- sem NF processada
- `expectedDeliveryDate` < hoje

### Carteira aberta
- não cancelado
- sem NF processada

### Meta +30%
`meta = realizado_período_anterior × 1,30` (fator `TARGET_GROWTH_FACTOR = 1.30`).

### Média por dia útil
Segunda a sexta; feriados não considerados nesta fase. Funções em `executiveDashboardWorkdays.ts`.

### Formatação executiva
`executiveDashboardFormatters.ts`:
- inteiros sem `,00`
- moeda 2 casas
- `formatExecutiveCompactCurrency` para cards (`R$ X Mi`, `R$ X mil`)
- percentuais 1–2 casas

Não altera `utils.ts` (precisão fina em custo/produto).

---

## 7. Indicadores para fases futuras

- Status logístico dedicado (não existe no schema)
- Feriados no calendário de dias úteis
- Margem, recompra, por vendedor, Nomus, produção
- Abas Clientes, RH, Frota no painel gerencial

---

## 8. Como adicionar novas abas

1. Criar `src/lib/<nome>DashboardMetrics.ts` com `build<Nome>DashboardTab(now)`.
2. Adicionar tipo em `executiveDashboardTypes.ts` (`tabs.<nome>`).
3. Orquestrar em `executiveDashboardService.ts` com permissão adequada.
4. Criar componente React `Executive<Nome>Tab.tsx`.
5. Registrar sub-aba em `ExecutiveDashboardPanel.tsx`.
6. Adicionar testes de regras puras + `npm run test:dashboard`.

---

## 9. Arquivos alterados

**Novos (faturamento mercado):** `groupCompanyCustomer.ts`, `billingMarketCustomerSql.ts`, `groupCompanyCustomer.test.ts`

**Alterados:** `billingDashboardMetrics.ts`, `ExecutiveBillingTab.tsx`, `ExecutiveDashboardCharts.tsx`, `executiveDashboardTypes.ts`, `salesOrderDashboardRules.ts`, `package.json`, docs

---

## 10. Testes executados

- `npx prisma validate`
- `npm run test:dashboard`
- `npm run lint`
- `npm run build`

---

## 11. Limitações conhecidas

- Faturamento depende de `nomusRawResponse.nfes` populado após integração Nomus.
- Um pedido com múltiplas NFes entra no mês da **última** `dataProcessamento`.
- Meta +30% é regra simplificada; ajustes futuros virão via prompts/BI.
- Permissão: `sales_orders.view` ou `reports.view`.

---

*Relatório gerado após implementação das abas Pedidos de Venda e Faturamento.*
