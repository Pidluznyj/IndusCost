# Arquitetura — Conciliação de Carteira (Pedido × Saída × NF × CR × Caixa)

Documento de **arquitetura técnica** da Conciliação de Carteira.  
Models/migration da fato e do run: **implementados**. Motor de alocação, UI e cron: **ainda não**.

Relacionado: [Inventário Nomus documentosEstoque](./nomus-portfolio-reconciliation-inventory.md).

---

## 0. Checklist de necessidade

| Pergunta | Resposta |
|----------|----------|
| Isso realmente precisa existir? | **Sim.** Hoje o vínculo Pedido→NF é só por cabeçalho (`SalesOrderNfeLink`). Sem itemização + alocação, a carteira e a previsão de caixa misturam NFs compartilhadas (ex. PD 02339). |
| Já existe algo semelhante? | **Parcial.** Comissões resolvem pedido a partir de NF no nível de título/cabeçalho. Fluxo/Faturamento não têm grão item×pedido. |
| Precisa ser tabela física? | **Sim** — ver §4.0 (view não basta). |
| Camada paralela / read-only nas fontes? | **Sim.** Lê stages e pedidos; grava só em `PortfolioReconciliationRun` / `Fact`. |
| Evita mexer no financeiro oficial? | **Sim.** Não altera Fluxo, AR, Faturamento, Comissões nem `CommissionRecord`. |

---

## 1. Objetivo conceitual

Criar uma **camada paralela de conciliação** que una:

```
Pedido de Venda
  → NF / Documento de Saída (cabeçalho)
  → Documento de Estoque (itens físicos)
  → Contas a Receber
  → Previsão de Caixa (derivada, não oficial)
```

A **tabela fato** materializa evidências rastreáveis de atendimento / faturamento / recebimento.

### Perguntas que a fato deve responder

1. Quanto foi **vendido** no pedido?
2. Quanto foi **atendido fisicamente** (documento de estoque)?
3. Quanto foi **faturado** (NF)?
4. Quanto virou **contas a receber**?
5. Quanto foi **recebido**?
6. Quanto ainda está **aberto**?
7. Qual é a **fonte da previsão de caixa**?
8. Qual é o **grau de confiança**?
9. Qual **alerta de qualidade** existe?

---

## 2. Fontes de dados

| Fonte | Origem | Papel na conciliação | Mutável por esta linha? |
|-------|--------|----------------------|-------------------------|
| Pedido | Nomus `pedidos` → `SalesOrder` / `SalesOrderItem` | Demanda comercial (qtde/valor/produto) | Não |
| Vínculo Pedido↔NF | Sync pedido / backfill → `SalesOrderNfeLink` | Candidatos de NF por **cabeçalho** | Não |
| NF-e | Nomus `nfes` → `NomusNfe` | Cabeçalho fiscal / valor NF | Não |
| Documento de estoque | Nomus `documentosEstoque` → `NomusStockDocument` / `Item` | Itemização física (produto/qtde/valor) | Não (já isolado) |
| Contas a Receber | Nomus `contasReceber` → `NomusAccountsReceivable` | Títulos / baixa / saldo | Não |
| Previsão de caixa | **Derivada** da fato (futuro) | Visão paralela; **não** substitui Fluxo oficial | N/A |

---

## 3. Tabelas existentes usadas (somente leitura)

| Tabela | Chaves relevantes | Uso |
|--------|-------------------|-----|
| `SalesOrder` | `id`, `orderCode`, `externalSalesOrderId`, totais | Âncora do pedido |
| `SalesOrderItem` | `salesOrderId`, `externalProductId`, `quantity`, `negotiatedPrice`, `totalNetValue` | Demanda por produto |
| `SalesOrderNfeLink` | `salesOrderId`, `nfeExternalId`, `nfeNumber` | Candidatos NF do pedido |
| `NomusNfe` | `externalId`, `numero`, `valorLiquido` / XML | Cabeçalho fiscal |
| `NomusStockDocument` | `externalId`, `idNfe`, `tipoDocumentoEstoque`, `dataDocumento` | Documento de saída |
| `NomusStockDocumentItem` | `stockDocumentId`, `externalProductId`, `quantity`, `unitValue`, `estimatedTotalValue` | Itens físicos |
| `NomusAccountsReceivable` | `externalId`, `sourceInvoiceId` (= idNfe), `sourceInvoiceNumber`, valores, `dueDate`, `settlementDate` | Títulos da NF |

---

## 4. Tabelas novas (implementadas)

Migration: `prisma/migrations/20260710190000_portfolio_reconciliation_fact`

### 4.0 Por que tabela fato materializada (e não só view)?

| Opção | Avaliação |
|-------|-----------|
| **View SQL** | Recalcularia joins + regras de alocação a cada consulta; difícil versionar regra; sem snapshot histórico; ruim para comparar “antes/depois” de mudança de motor. |
| **Tabela fato + run** | Materializa resultado por execução; performance de leitura; auditoria (`traceJson` / `alertsJson`); comparação entre runs; reconstrução idempotente (`delete` facts do run + `insert`). |

Esta tabela **não** é fonte oficial do financeiro — é camada paralela para auditoria/comparação.

### 4.1 `PortfolioReconciliationRun`

Metadados de uma materialização manual (`preview` / `apply` / `manual`). Sem cron nesta etapa.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid | PK |
| `startedAt` / `finishedAt` | DateTime? | |
| `status` | enum `PENDING` \| `RUNNING` \| `SUCCESS` \| `FAILED` | |
| `mode` | enum `preview` \| `apply` \| `manual` | |
| `fromDate` / `toDate` | DateTime? | Janela |
| `customerExternalId` | Int? | Filtro opcional |
| `filtersJson` / `summaryJson` | Json? | |
| `errorMessage` | String? | |
| `createdAt` / `updatedAt` | DateTime | |

FK: `facts` → cascade delete ao apagar o run (reconstrução idempotente por run).

### 4.2 `PortfolioReconciliationFact`

Grão: combinação rastreável pedido × item × NF/saída × item estoque × CR/previsão (campos nullable para dados parciais).

**Sem FK obrigatória** para `SalesOrder`, `NomusNfe`, stock ou AR — apenas IDs/snapshots nullable, para não bloquear linhas incompletas. Única FK rígida: `runId`.

Grupos de campos: identificação cliente; pedido/item; valores pedido; NF; documento de estoque; alocação (qtde/valores pedido vs estoque + diferença de preço); CR (`receivableIdsJson`, totais, datas); previsão (`forecastSource`, `forecastDate`, `forecastValue`, `confidenceLevel`, `status`, `alertsJson`, `traceJson`).

Índices: `runId`, `salesOrderId`, `salesOrderItemId`, `customerExternalId`, `externalSalesOrderId`, `orderCode`, `nfeExternalId`, `stockDocumentExternalId`, `externalProductId`, `forecastDate`, `status`, `confidenceLevel`, `forecastSource`.

`forecastSource`: `RECEIVABLE` \| `NFE` \| `ORDER` \| `UNRESOLVED` (alinhado à prioridade CR > NF/doc > pedido).  
`confidenceLevel`: `HIGH` \| `MEDIUM` \| `LOW` \| `BLOCKED`.  
`status` (String): status dominante da arquitetura (`ORDER_ONLY`, `ITEM_ALLOCATED`, `PRICE_MISMATCH`, …).

### 4.3 O que ainda **não** criar

- UI / rotas / dashboard.
- Motor de alocação / script de materialização.
- Cron.
- Escrita em módulos oficiais.

---

## 5. Regra de vínculo (cadeia canônica)

```text
SalesOrder
  └─ SalesOrderItem                    (pedido → itens)
  └─ SalesOrderNfeLink                 (pedido → NF cabeçalho)
         │ nfeExternalId
         ▼
      NomusNfe.externalId
         │ mesmo id
         ▼
      NomusStockDocument.idNfe
         └─ NomusStockDocumentItem     (documento → itens físicos)
         
NomusAccountsReceivable.sourceInvoiceId  ≈  NomusNfe.externalId / idNfe
  (fallback: sourceInvoiceNumber ≈ nfeNumber — mais frágil)
```

### Detalhamento

| Elo | Como | Confiança |
|-----|------|-----------|
| `SalesOrder` → `SalesOrderItem` | FK `salesOrderId` | Alta |
| `SalesOrder` → `SalesOrderNfeLink` | FK `salesOrderId` | Alta no vínculo; **baixa** na alocação de valor (só cabeçalho) |
| `SalesOrderNfeLink.nfeExternalId` → `NomusNfe.externalId` | igualdade de id externo | Alta |
| `NomusNfe.externalId` → `NomusStockDocument.idNfe` | igualdade | Alta (quando documento existe) |
| `NomusStockDocument` → `NomusStockDocumentItem` | FK | Alta |
| Item pedido ↔ item estoque | `SalesOrderItem.externalProductId` = `NomusStockDocumentItem.externalProductId`, com consumo de saldo por ordem temporal | Média–alta; ambígua se produto repetido / NF compartilhada |
| `NomusAccountsReceivable` → NF | preferir `sourceInvoiceId` = `idNfe`; senão número | Média (CR é da NF, não do pedido) |

**Implicação:** CR no nível da NF exige **rateio** para o pedido quando a NF atende mais de um pedido ou tem itens não alocados ao PD.

---

## 6. Regra de prioridade de caixa (camada paralela)

Para **previsão / visão de carteira** (não altera o Fluxo oficial):

| Prioridade | Fonte | Quando usar |
|------------|-------|-------------|
| 1 (maior) | **CR confirmado** | Existe título AR ligado à NF alocada; usar vencimento / baixa / saldo do título (rateado se necessário) |
| 2 | **NF / documento alocado** | Há alocação itemizada (ou parcial) Pedido↔documento; projetar caixa a partir do valor alocado + política de prazo (a definir) |
| 3 (menor) | **Pedido em carteira** | Saldo do pedido ainda sem alocação confiável; projetar a partir do pedido (carteira pura) |

```text
CR confirmado  >  NF/documento alocado  >  pedido em carteira
```

Cada linha da fato deve registrar `forecastSource` correspondente para auditoria da pergunta 7.

---

## 7. Status de confiança (`confidenceStatus`)

Valores propostos (enum futuro):

| Status | Significado |
|--------|-------------|
| `ORDER_ONLY` | Só pedido; sem NF / documento / CR |
| `HEADER_ONLY_LINK` | Há `SalesOrderNfeLink`, sem itemização/alocação |
| `STOCK_DOCUMENT_ITEMIZED` | Documento de estoque com itens carregado; alocação ao pedido ainda não resolvida |
| `ITEM_ALLOCATED` | Item de documento alocado a item de pedido |
| `PARTIALLY_ALLOCATED` | Parte da qtde/valor do pedido ou do documento alocada |
| `FULLY_ALLOCATED` | Demanda do item/pedido coberta pela alocação |
| `OVER_LINKED_BY_HEADER` | Soma de cabeçalhos NF vinculados > valor do pedido |
| `PRICE_MISMATCH` | Unitário documento ≠ unitário pedido (além de tolerância) |
| `QUANTITY_SURPLUS_IN_NFE` | Qtde no documento > saldo restante do pedido para o produto |
| `RECEIVABLE_CONFIRMED` | CR da NF associado à alocação (possivelmente rateado) |
| `RECEIVED` | Valor recebido (baixa) refletido na linha |
| `DATA_QUALITY_ISSUE` | Inconsistência estrutural (ids faltando, parse, etc.) |
| `AMBIGUOUS_ALLOCATION` | Mais de uma forma válida de alocar; motor não escolhe sozinho |

Uma linha pode combinar status “principal” + alertas; na v1, preferir **um status dominante** + lista de alertas.

---

## 8. Alertas de qualidade

| Alerta | Disparo típico | Exemplo PD 02339 |
|--------|----------------|------------------|
| NF vinculada só por cabeçalho | Link existe, sem alocação item | Estado atual antes do motor |
| Soma de cabeçalhos de NF > pedido | Σ valores NF linkadas > `totalNetValue` | 108.240 + 168.075 + 78.975 ≫ 158.000 |
| Item de documento sem item de pedido | `externalProductId` no doc sem linha no PD | Itens 538, 453 na NF 7052 |
| Produto repetido em NF posterior após pedido já atendido | Saldo do produto no PD = 0 e nova NF traz o mesmo produto | NF 7195 (452, 455) após 6845 |
| Preço unitário do documento ≠ pedido | \|unit doc − unit pedido\| > tolerância | NF 6845 @ 4,92 vs pedido @ ~5,85 |
| Qtde documento > saldo do pedido | Ex.: 537 com 10.000 no doc vs 5.000 no PD | NF 7052 produto 537 |
| CR na NF depende de rateio para o pedido | Título `sourceInvoiceId` = NF compartilhada | Qualquer CR das três NFs |

---

## 9. Decisão: não alterar módulos oficiais

| Módulo | Decisão |
|--------|---------|
| Contas a Receber | Somente leitura de `NomusAccountsReceivable` |
| Faturamento / `NomusNfe` | Somente leitura |
| Fluxo de Caixa | **Não** alterar motor/UI oficiais; previsão de carteira é camada paralela |
| Comissões | **Não** alterar; resolução NF→pedido de comissão permanece independente |
| `SalesOrder` / itens / NfeLink | **Não** alterar schema nem sync oficial nesta etapa |

Escrita permitida (futuro): apenas tabelas novas da conciliação (`PortfolioReconciliationFact` e afins).

---

## 10. Caso de validação — PD 02339 (Britânia)

| Campo | Valor |
|-------|-------|
| `SalesOrder.id` | `3915fa28-1947-4388-bb27-2699c3cbb516` |
| `externalSalesOrderId` | 2335 |
| `orderCode` | PD 02339 |
| Valor pedido | R$ 158.000,00 |

### Itens positivos do pedido (referência)

| Produto | Qtde | Unitário pedido |
|---------|------|-----------------|
| 456 | 3.000 | 5,85 |
| 452 | 9.000 | 5,85 |
| 537 | 5.000 | 5,86 |
| 455 | 10.000 | 5,85 |

### NFs / documentos de estoque (probe real)

| NF | idNfe | Doc estoque | Itens (resumo) | Total doc |
|----|-------|-------------|----------------|-----------|
| 6845 | 6937 | 7951 | 456×3k@4,92; 452×9k@4,92; 455×10k@4,92 | 108.240 |
| 7052 | 7188 | 8175 | 537×10k@5,86; 452×4,5k@5,85; 538×6,2k@5,85; 453×8k@5,86 | 168.075 |
| 7195 | 7377 | 8422 | 452×3,5k@5,85; 455×10k@5,85 | 78.975 |

### Expectativa do motor (ainda não implementado)

1. **NF 6845:** alocar 456/452/455 nas qtdes do pedido → `ITEM_ALLOCATED` + alerta `PRICE_MISMATCH` (4,92 vs 5,85).
2. **NF 7052:** alocar só **5.000** de 537 ao PD → `PARTIALLY_ALLOCATED` / `QUANTITY_SURPLUS_IN_NFE`; itens 452/538/453 não devem consumir saldo já atendido / inexistente no PD sem regra explícita.
3. **NF 7195:** **não** consumir automaticamente (produtos já atendidos) → alerta de repetição + `AMBIGUOUS_ALLOCATION` ou exclusão automática com status de qualidade.
4. Cabeçalhos: marcar `OVER_LINKED_BY_HEADER`.
5. CR: se existir por `idNfe`, status `RECEIVABLE_CONFIRMED` só na fração alocada; alerta de rateio.

Este caso é o **acceptance test** da primeira materialização da fato.

---

## 10.1 Calendário de pagamento por cliente (isolado)

Model: `PortfolioCustomerPaymentRule` (migration `20260710200000_portfolio_customer_payment_rule`).

- **Não** altera cadastro oficial de `Customer`.
- **Não** altera Fluxo/AR/Faturamento/Comissões.
- Service: `src/lib/finance/portfolioPaymentCalendar.ts`.

### Britânia (fallback embutido + insert manual opcional)

| Campo | Valor |
|-------|-------|
| `customerExternalId` | `200` |
| `allowedDaysJson` | `[10, 20, 30]` |
| `moveToNextAllowedDay` | `true` |

Ajuste: nunca antecipa (1–10→10, 11–20→20, 21–30→30, 31→10 do mês seguinte).

Forecast:
- `RECEIVABLE` → vencimento real do CR (**soberano**, sem recalcular).
- `NFE` → data NF + `defaultTermDays` + calendário.
- `ORDER` → entrega prevista + prazo + calendário.

### Configurar no servidor (após migrate deploy)

Sem seed automático. Insert manual opcional (o fallback em código já cobre Britânia):

```sql
INSERT INTO "PortfolioCustomerPaymentRule" (
  "id", "customerExternalId", "customerNameSnapshot", "allowedDaysJson",
  "defaultTermDays", "moveToNextAllowedDay", "isActive", "notes", "updatedAt"
) VALUES (
  gen_random_uuid()::text,
  200,
  'Britânia',
  '[10, 20, 30]'::jsonb,
  0,
  true,
  true,
  'Paga nos dias 10, 20 e 30',
  NOW()
)
ON CONFLICT ("customerExternalId") DO UPDATE SET
  "allowedDaysJson" = EXCLUDED."allowedDaysJson",
  "moveToNextAllowedDay" = EXCLUDED."moveToNextAllowedDay",
  "isActive" = true,
  "updatedAt" = NOW();
```

---

## 11. Riscos registrados

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| NF compartilhada entre pedidos | Superestimar carteira / caixa | Alocação por item + saldo; nunca usar 100% do cabeçalho |
| Preço documento ≠ pedido | Valor “faturado” diverge do comercial | Guardar ambos; alertar `PRICE_MISMATCH`; política de valor (pedido vs documento) explícita |
| CR só no nível NF | Rateio incorreto | Exigir alocação item antes de projetar CR no pedido; senão alerta |
| Ordem temporal de consumo | NF posterior “rouba” saldo | Ordenar docs por `dataDocumento`; consumir FIFO do saldo do item |
| Ambiguidade de produto | Duas linhas de pedido mesmo `externalProductId` | Preferir match por linha; se ambíguo → `AMBIGUOUS_ALLOCATION` |
| Contaminação do Fluxo oficial | Mudança indevida de caixa | Camada paralela; sem write no motor oficial |
| Duplicar lógica de comissões | Divergência NF→pedido | Não reutilizar motor de comissão para carteira; documentar diferença de grão |

---

## 12. Próximos passos (ordem sugerida)

1. **Carga** `NomusStockDocument` 12 meses no servidor (preview → apply).
2. **`prisma migrate deploy`** da migration `20260710190000_portfolio_reconciliation_fact` no servidor.
3. **Motor** de alocação (pure functions + testes PD 02339).
4. **Script manual** materializa `Run` + `Fact` (`preview` / `apply`, sem cron).
5. Só então: API/UI de conciliação e visão de caixa paralela (opcional).

---

## 13. Fora de escopo desta etapa de schema

- Motor / script de materialização.
- UI.
- Acesso a servidor / carga real.
- Alteração de Fluxo, AR, Faturamento ou Comissões.
