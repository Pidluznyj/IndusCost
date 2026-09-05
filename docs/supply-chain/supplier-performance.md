# Avaliação de Pedidos de Compra e Desempenho de Fornecedores (OP-26)

> **Metodologia interna de avaliação de fornecedores.** A metodologia de
> pontuação descrita aqui é uma regra interna da empresa: não é fórmula prescrita
> pelo Inmetro nem por edição específica da ISO 9001. O IndusCost apenas fornece
> evidência consistente e rastreável do processo interno de avaliação e
> reavaliação de fornecedores.

## 1. Objetivo

Permitir que a empresa avalie fornecedores de forma simples e contínua, com
evidência de quem avaliou, quando avaliou e com quais notas — inclusive para
pedidos antigos (avaliação retroativa) — e acompanhar o desempenho consolidado
por critério e por período.

O processo inteiro é:

```text
PEDIDO DE COMPRA FINALIZADO
        ↓
AVALIAÇÃO DO PEDIDO (4 notas de 0 a 10)
        ↓
NOTA MÉDIA DO PEDIDO
        ↓
CONSOLIDAÇÃO AUTOMÁTICA
        ↓
DESEMPENHO DO FORNECEDOR
```

## 2. Fontes oficiais (sem cadastro paralelo)

| Conceito | Fonte canônica | Observação |
|---|---|---|
| Fornecedor | `FinancialSupplier` | Cadastro único. **Somente leitura** nesta feature. |
| Pedido de compra | `PurchaseOrder` | Unidade oficial da avaliação; já referencia `supplierId`. |
| Auditoria | `PurchaseOrderHistoryEvent` | Reutilizado — **nenhuma** tabela de histórico nova. |
| Avaliação | `PurchaseOrderSupplierEvaluation` | Única entidade criada. |

**O usuário avalia o PEDIDO DE COMPRA.** O IndusCost calcula o desempenho do
fornecedor a partir das avaliações dos pedidos dele. Não existe segunda avaliação
manual no cadastro do fornecedor, nem campo editável “nota do fornecedor”.

## 3. Elegibilidade

Um pedido só pode ser avaliado quando o status corrente for:

```text
RECEBIDO  ou  ENCERRADO
```

Todos os demais (`RASCUNHO`, `APROVADO`, `ENVIADO`, `EMITIDO`, `CONFIRMADO`,
`PARCIALMENTE_RECEBIDO`, `CANCELADO`) **não** são elegíveis. `CANCELADO` nunca é
elegível. Um pedido parcialmente recebido só se torna avaliável quando o workflow
oficial o levar a `ENCERRADO` — sem exceção específica para parcial.

A regra vive em **uma** função de domínio,
`isPurchaseOrderSupplierEvaluationEligible()`
(`src/lib/purchasing/supplierPerformance.ts`). O backend é a autoridade: a rota
revalida a elegibilidade **dentro da transação**, com o status corrente.

## 4. Critérios e fórmula (metodologia V1)

| Critério | Rótulo na UI | Peso |
|---|---|---|
| `quality` | Qualidade do produto/material | 25% |
| `delivery` | Prazo de entrega | 25% |
| `conformity` | Quantidade / conformidade | 25% |
| `service` | Atendimento / solução de problemas | 25% |

Cada nota vai de `0` a `10`, com **no máximo uma casa decimal** (0, 5, 7,5, 8,7, 10).
Os quatro critérios são obrigatórios — não existe rascunho de avaliação.

```text
NotaPedido = (Qualidade + Prazo + Conformidade + Atendimento) / 4
```

- Identificador interno: `SUPPLIER_ORDER_EVALUATION_V1`, `methodologyVersion = 1`,
  persistido em cada avaliação.
- Valor financeiro, quantidade comprada e número de itens **não** influenciam.
- Persistência em `NUMERIC(4,2)` — nunca `Float`.
- Cálculo em inteiros (décimos → centésimos) com arredondamento **HALF-UP**
  determinístico: `9,1 + 9,1 + 9,1 + 9,2 → 9,125 → 9,13`.
- O frontend nunca envia `overallScore`: exibe a prévia usando o **mesmo** motor
  puro e o servidor recalcula e grava.

Não há tela de configuração de pesos no MVP.

## 5. Consolidação do fornecedor

A nota do fornecedor é **derivada por consulta**, nunca materializada:

```text
NotaFornecedor = AVG(overallScore das avaliações dos pedidos elegíveis no período)
```

Também são consolidadas as médias por critério (`AVG` de cada nota). O
arredondamento acontece só na apresentação — nunca linha a linha antes de agregar.

Entram no consolidado apenas pedidos que, **no momento da consulta**, estejam em
`RECEBIDO`/`ENCERRADO` e dentro do período. Um pedido que passe a `CANCELADO`
sai do consolidado *live*, mas a avaliação e o histórico são preservados (nunca há
DELETE).

### A avaliação é evidência protegida

A relação entre `PurchaseOrder` e a avaliação usa **restrição de exclusão**
(`onDelete: Restrict` / `ON DELETE RESTRICT`). Uma avaliação **não** é removida
automaticamente pela exclusão do pedido: apagar fisicamente um pedido já avaliado
falha no banco e passa a exigir decisão humana explícita. Isso protege a
evidência auditável do processo de qualificação de fornecedores — nada de
cascade delete silencioso.

### Por que não gravar a nota em `FinancialSupplier`

É proibido criar `FinancialSupplier.score` / `.rating` / `.qualityScore` /
`.performanceScore`. Motivos: elimina stale data, elimina sincronização, elimina
divergência, mantém `PurchaseOrder` como origem, evita mutar o cadastro mestre
(protegido pelo guardrail da cadeia) e preserva a rastreabilidade. Se medições
concretas mostrarem necessidade de cache/materialização, será outra missão.

## 6. Cobertura

```text
eligibleOrders  = pedidos RECEBIDO/ENCERRADO no período
evaluatedOrders = quantos deles têm avaliação
pendingOrders   = eligibleOrders − evaluatedOrders
coverage        = evaluatedOrders / eligibleOrders
```

| Situação | Resultado |
|---|---|
| `eligibleOrders = 0` | `coverage = null` e a tela mostra **“Sem pedidos elegíveis no período”** — nunca “0%”. |
| `eligibleOrders > 0` e `evaluatedOrders = 0` | `coverage = 0` (correto) e **nota `null`**, nunca `0`. |

Pedidos não avaliados **não recebem nota zero**: eles aparecem na cobertura.

## 7. Retroatividade e período

Avaliar hoje um pedido de fevereiro é um caso de uso obrigatório. A data real da
avaliação é preservada (`createdAt`/`updatedAt` nunca são forjados).

O eixo do período é sempre a **data do pedido**:

```text
referenceDate = COALESCE(PurchaseOrder.issuedAt, PurchaseOrder.createdAt)
```

Nunca `evaluation.createdAt` — senão uma avaliação retroativa de fevereiro
apareceria artificialmente em setembro. A mesma regra vale para cards, cobertura,
lista, relatório e CSV (`resolvePurchaseOrderEvaluationReferenceDate` e
`resolveSupplierPerformanceDateRange`).

Datas civis pt-BR são convertidas por componentes (`YYYY-MM-DD` → meia-noite
local), nunca por `new Date("YYYY-MM-DD")`. Fuso de negócio: `America/Sao_Paulo`.

> **Ordenação da lista de pedidos:** a filtragem usa `COALESCE` exato; a
> *ordenação* usa `issuedAt DESC NULLS LAST, createdAt DESC, code DESC`. Pedidos
> nunca emitidos (sem `issuedAt`) aparecem depois dos emitidos, ordenados pela
> criação. Simplificação deliberada de apresentação — nenhum número depende dela.

## 8. Revisão e concorrência

- A avaliação pode ser corrigida. Na UI a ação chama-se **“Revisar avaliação”**.
- Toda revisão exige **motivo obrigatório** (`revisionReason`).
- Não existe DELETE de avaliação no MVP.
- `revision` começa em `1` e incrementa a cada revisão.
- O cliente envia `expectedRevision`; o update é um *compare-and-swap*
  (`WHERE id = ? AND revision = ?`). Se outro usuário já salvou:

```text
409  SUPPLIER_EVALUATION_REVISION_CONFLICT
```

Nunca há last-write-wins silencioso. Duas criações simultâneas colidem no
`UNIQUE(purchaseOrderId)` e viram o mesmo erro de domínio — nunca erro bruto do
Prisma.

## 9. Auditoria

Reutiliza `PurchaseOrderHistoryEvent` com as ações:

- `SUPPLIER_EVALUATION_CREATED` — `{ evaluationId, revision, methodologyVersion, scores, supplierId, supplierName }`
- `SUPPLIER_EVALUATION_REVISED` — `{ evaluationId, revision, methodologyVersion, before, after }` + `reason`

A avaliação e o evento de auditoria são gravados na **mesma transação**. Se a
auditoria falhar, a avaliação não é gravada (ROLLBACK) — e vice-versa.

O autor é sempre resolvido da sessão autenticada no backend. `userId`,
`userName`, `overallScore`, `supplierId`, `methodologyVersion` e `revision`
enviados pelo browser são ignorados.

## 10. Permissões (sem resource novo)

| Ação | Exigência no backend |
|---|---|
| Ver avaliação de um pedido | `operations.purchases:view` |
| Criar / revisar avaliação | `operations.purchases:update` |
| Ver desempenho do fornecedor | `finance.suppliers:view` **e** `operations.purchases:view` |
| Avaliar a partir da tela do fornecedor | `finance.suppliers:view` **e** `operations.purchases:update` |

Nenhum resource `supplierEvaluation.*` / `quality.*` / `supplierPerformance.*`
foi criado. Esconder botão no frontend não substitui autorização: todas as rotas
têm guard no backend.

## 11. Feature flag

```text
env      : SUPPLY_CHAIN_SUPPLIER_PERFORMANCE_ENABLED   (default false)
resource : operations.supply_chain.supplier_performance.enabled
```

Fail closed: ausente ou valor inválido = desligada (aceita `1|true|yes|on|enabled`).
Com a flag **OFF**:

- nenhum menu/aba/card novo aparece;
- o frontend não chama nenhuma API da feature;
- as rotas novas respondem `404 API route not found`;
- nada muda nas telas atuais.

**Permissão ≠ feature flag** — as duas camadas são independentes e ambas valem.

## 12. API

| Método | Rota | Guard |
|---|---|---|
| `GET` | `/api/purchase-orders/:id/supplier-evaluation` | flag + `operations.purchases:view` |
| `PUT` | `/api/purchase-orders/:id/supplier-evaluation` | flag + `operations.purchases:update` |
| `GET` | `/api/supplier-performance/suppliers/:supplierId` | flag + `finance.suppliers:view` + `operations.purchases:view` |
| `GET` | `/api/supplier-performance/report` | idem |
| `GET` | `/api/supplier-performance/report.csv` | idem |
| `GET` | `/api/supplier-performance/orders.csv` | idem |

As rotas de desempenho **não** vivem sob `/api/finance/suppliers`: esse prefixo
pertence ao motor oficial de fornecedores, cuja mutação a partir da cadeia de
suprimentos é proibida.

Query do detalhe: `from`, `to` (civil `YYYY-MM-DD`), `evaluationStatus`
(`all|pending|evaluated|ineligible`), `page`, `pageSize` (default 50, teto 200).
Query do relatório: `from`, `to`, `supplierId`, `supplierStatus`, `sort`
(`name|score|coverage`), `includeOrders=1`.

### Filtros são fail-fast

A API é contrato formal: um filtro **enviado explicitamente e inválido** retorna
`400 INVALID_SUPPLIER_PERFORMANCE_FILTER` (com `field`) — nunca é ignorado em
silêncio. Ignorar ampliaria a consulta (`from` inválido viraria período aberto)
ou devolveria dataset vazio sem explicação (`from > to`).

| Situação | Resultado |
|---|---|
| `from`/`to` ausentes | sem recorte de período |
| `from`/`to` fora de `YYYY-MM-DD` ou data impossível | `400`, `field: from`/`to` |
| `from > to` | `400`, `field: period` |
| `evaluationStatus` ausente | `all` |
| `evaluationStatus` fora da lista | `400` |
| `sort` ausente | `name` |
| `sort` fora da lista | `400` |
| `supplierStatus` ausente | sem filtro |
| `supplierStatus` fora de `FinancialSupplierStatus` | `400` |
| `supplierId` não-UUID | `400` |
| `page` / `pageSize` | normalizados/clamped (não são filtros semânticos) |

Os parsers tolerantes (`parseSupplierPerformance*`) continuam existindo para a
UI, onde um valor intermediário não deve explodir a tela; o boundary HTTP usa os
parsers estritos `parseSupplierPerformanceApi*`.

### Códigos de erro

```text
400  INVALID_SUPPLIER_EVALUATION_SCORE
400  INVALID_SUPPLIER_EVALUATION_PAYLOAD
400  INVALID_SUPPLIER_PERFORMANCE_FILTER
403  (sem permissão)
404  PURCHASE_ORDER_NOT_FOUND / SUPPLIER_NOT_FOUND
404  API route not found          (feature flag OFF)
409  PURCHASE_ORDER_NOT_ELIGIBLE_FOR_SUPPLIER_EVALUATION
409  SUPPLIER_EVALUATION_REVISION_CONFLICT
```

### Moeda

O valor exibido/exportado respeita `PurchaseOrder.currency` (BRL, USD, EUR…) via
`formatPurchaseOrderAmount`. **Não há conversão cambial em lugar nenhum**: valor
e moeda saem exatamente como negociados. Moeda ausente ou inválida cai para
`CÓDIGO 1.000,00` e nunca é apresentada como `R$`. O CSV detalhado traz
`purchase_order_currency` ao lado de `purchase_order_amount`. O relatório
consolidado não soma valores financeiros — a nota não depende de valor, então
não existe total multi-moeda.

## 13. Experiência

**Pedido de Compra** (`PurchaseOrderModule`): seção “Avaliação do fornecedor”.
Não elegível → aviso, sem formulário. Elegível e não avaliado → “Ainda não
avaliado” + **Avaliar fornecedor**. Avaliado → nota geral, os quatro critérios,
quem avaliou e quando + **Revisar avaliação**.

**Fornecedor** (`FinanceSupplierCadastroDrawer`, apenas em `mode = edit`): aba
**Desempenho** com filtro de período (Últimos 6 meses / 12 meses / Todos /
Personalizado — default 12 meses), cards (nota geral, quatro critérios, cobertura)
e **todos** os pedidos do período — não apenas os avaliados — com filtros
`Todos | Pendentes | Avaliados | Não elegíveis` e paginação no servidor.
“Avaliar” abre exatamente o **mesmo** componente de formulário do pedido; ao
salvar, linha, cards, cobertura e nota são atualizados sem reload da aplicação.

**Relatório** (`/finance/suppliers/performance`, a partir de Financeiro >
Fornecedores): filtros De/Até/Fornecedor/Status, tabela consolidada, totais,
detalhe opcional de pedidos, bloco de metodologia, impressão print-friendly
(o usuário usa “Imprimir → Salvar como PDF” do navegador) e CSV.

## 14. Performance

- Detalhe do fornecedor: número **fixo** de consultas (fornecedor, contagem
  elegível, avaliações do período, contagem da lista, página da lista).
- Relatório global: `groupBy` por fornecedor + uma consulta das avaliações do
  período + uma dos nomes — **sem query por fornecedor**.
- O resumo cobre a população filtrada inteira, nunca só a página visível.
- `select` explícito e mínimo; nenhum `rawJson`/payload Nomus em listagem.
- Único índice novo: o `UNIQUE(purchaseOrderId)` exigido pela regra. O filtro de
  período aproveita os índices já existentes de `issuedAt` e `createdAt`, e o
  recorte por fornecedor o índice existente de `supplierId`.
- Sem Redis, cache distribuído, materialized view, cron, trigger ou event bus.
- Export detalhado limitado a 20.000 pedidos (acima disso, a API pede período menor).

## 15. Fora do MVP

SCAR, PPAP, 8D, portal do fornecedor, inspeção avançada, homologação,
certificados, workflow de aprovação de fornecedor, IA, **sugestão automática das
notas** a partir de `expectedDeliveryDate`/`receivedAt`/`quantityAccepted`
(dados existem, mas nesta fase todas as notas são informadas pelo usuário),
preço/volume financeiro no cálculo, ponderação por valor, classificação A/B/C/D
ou Aprovado/Reprovado, bloqueio automático de fornecedor, qualquer alteração no
Nomus / Contas a Pagar / custo / estoque / Material / Product / BOM, snapshot
congelado de relatório, tabela configurável de metodologia, cron/job, backfill
automático de avaliações históricas e exclusão física de avaliações.

## 17. Worklist de Pedidos Nomus

A tela **Compras → Avaliação Fornecedor** avalia o **Pedido Nomus**
(`NomusPurchaseOrder.id`). Isso é uma identidade distinta do `PurchaseOrder`
interno: não há FK entre os dois, e a feature **não** associa por número,
fornecedor, valor ou data.

- Tabela: `NomusPurchaseOrderSupplierEvaluation` (UNIQUE por pedido Nomus).
- Motor de nota: o mesmo `computeSupplierOrderEvaluation` (V1, 25% cada).
- Elegibilidade Nomus: `stage = RECEIVED` e não cancelado.
- Fornecedor só é gravado com confiança EXACT/HIGH e `financialSupplierId` conhecido.
- Sem writeback Nomus. Sem rascunho persistido (as quatro notas continuam obrigatórias).
- Sem sugestão automática (MVP OP-26: desconhecido = null, nunca 0).
- Lote: `POST /api/supplier-performance/nomus-orders/batch` chama o save unitário
  por item; falha em um pedido não apaga o sucesso dos outros.

## 18. Arquivos

```text
src/lib/purchasing/supplierPerformance.ts             motor puro (fórmula, elegibilidade, período, DTOs)
src/lib/purchasing/supplierPerformanceCsv.ts          CSV puro (anti formula injection)
src/lib/purchasing/supplierPerformance.server.ts      Prisma: escrita transacional + agregações
src/lib/purchasing/supplierPerformanceRoutes.ts       Express: flag + permissões
src/lib/purchasing/supplierPerformanceClient.ts       cliente HTTP + hook da flag
src/lib/purchasing/supplierPerformance.test.ts        testes do motor
src/lib/purchasing/supplierPerformanceSchema.test.ts  contrato schema/migration/rotas/UI
src/components/supply-chain/supplier-performance/     UI (form, card, aba, relatório, print CSS)
src/lib/purchasing/nomusPurchaseOrderEvaluation.ts            elegibilidade/identidade Nomus
src/lib/purchasing/nomusPurchaseOrderEvaluation.server.ts     worklist + save/batch
src/components/supply-chain/supplier-performance/NomusSupplierEvaluationWorklistPage.tsx
prisma/migrations/20260923120000_nomus_purchase_order_supplier_evaluation/
```
