# OP-45 — Auditoria da base técnica do Fluxo de Pedidos

**Projeto:** IndusCost / My Industry

**Data da auditoria:** 2026-07-17

**Escopo:** código, schema, migrations, testes e documentação disponíveis localmente

**Fora do escopo:** banco de produção, chamadas ao Nomus e implementação do Kanban

## 1. Conclusão executiva

O Kanban Comercial de Pedidos **não precisa criar um novo master de pedido,
item, OP, Documento de Saída ou NF-e**. As fontes locais necessárias já existem,
mas estão em estágios com níveis diferentes de maturidade:

1. `SalesOrder` e `SalesOrderItem` são a fonte comercial local.
2. O status operacional do item já é normalizado a partir de
   `itensPedido[].status`; o classificador FIN-03 já converte esse estado em
   obrigação futura, parcial, concluída, corte, cancelamento ou desconhecido.
3. `NomusProductionOrder` e `NomusProductionOrderSalesLink` são o stage e o
   vínculo oficiais de OP com pedido/item. A quantidade planejada está
   normalizada; a quantidade produzida **não está**.
4. `NomusStockDocument` e `NomusStockDocumentItem` são a fonte de Documento de
   Saída. O resolver canônico DS já cruza Documento, NF-e, Pedido, item, O2C e CR
   sem fuzzy matching.
5. `NomusNfe` e `SalesOrderNfeLink` são as fontes fiscais e de vínculo
   Pedido→NF-e. Não existe hoje um campo normalizado de **data de envio/saída da
   mercadoria pela NF-e**; existem emissão/processamento e datas do Documento.
6. O motor financeiro efetivo já existe em
   `salesOrderPlannedReceivables.ts`, com precedência
   `CR real ≥ Documento válido ≥ previsão do Pedido`. O Kanban deve consumi-lo,
   nunca recalcular cobertura financeira.
7. A Gestão de Pedidos, o detalhe do Pedido, a Auditoria 360°, a tela de OP e os
   drawers atuais fornecem loaders, DTOs, filtros, paginação e componentes
   reutilizáveis.
8. A lacuna central não é uma nova tabela de Kanban, mas um **read-model
   composto e paginado**, calculado a partir das fontes existentes.

O maior risco de implementação é usar `SalesOrder.nomusRawResponse` como fonte
operacional principal quando já existem stages normalizados para item, OP,
Documento e NF-e. O raw deve ficar restrito a fallback auditável para campos
ainda não normalizados.

## 2. Regra de fonte da verdade

O Kanban deve seguir estas precedências:

- comercial: `SalesOrder` / `SalesOrderItem`;
- atendimento do item: campos Nomus persistidos em `SalesOrderItem` +
  `classifySalesOrderItemFinancialFulfillment`;
- produção: `NomusProductionOrder` +
  `NomusProductionOrderSalesLink` com `isCurrent = true`;
- documento/logística: `NomusStockDocument` / `NomusStockDocumentItem`;
- vínculo fiscal: `SalesOrderNfeLink`;
- NF-e: `NomusNfe`;
- financeiro real: `NomusAccountsReceivable`;
- agenda financeira residual: `buildSalesOrderPlannedReceivables`;
- conciliação derivada: `OrderToCashAuditFact`, somente como evidência
  reconstruível, nunca como master.

Não criar:

- `KanbanSalesOrder`, cópia de `SalesOrder` ou status manual paralelo;
- `OutputDocument` paralelo ao stage `NomusStockDocument`;
- vínculo OP→Pedido por SKU se existe
  `NomusProductionOrderSalesLink.externalSalesOrderItemId`;
- quantidade faturada inferida pelo valor da NF;
- saldo financeiro por `Pedido − NF`;
- data de envio inferida de `dataProcessamento` sem contrato explícito.

## 3. Pedido e item

### 3.1 Modelos

`SalesOrder` (`prisma/schema.prisma`) guarda:

- identidade local e Nomus: `id`, `externalSalesOrderId`,
  `externalSalesOrderCode`, `orderCode`;
- cliente, vendedor e empresa;
- `status` local (`DRAFT`, `READY_TO_SEND`, `SENT_TO_NOMUS`, `CANCELLED`,
  `ERROR`);
- emissão, previsão de entrega e condições comerciais;
- totais comerciais;
- `nomusRawResponse` como evidência bruta;
- relações com itens, NFs e OPs.

O enum `SalesOrderStatus` representa o ciclo de criação/envio do IndusCost. Ele
**não é** o status de liberação/atendimento do Pedido no Nomus.

`SalesOrderItem` guarda:

- quantidade e snapshots comerciais;
- identidade da linha Nomus (`nomusItemExternalId`,
  `nomusItemSequence`);
- `nomusItemStatusRaw` e `nomusItemStatusNormalized`;
- `nomusQuantityFulfilled` e `nomusQuantityPending`;
- `nomusIsCanceled`, `nomusIsCut`, `nomusIsStale`;
- confiança/motivo do matching e `nomusRawItem`;
- relação com `NomusProductionOrderSalesLink`.

O status deve ser avaliado **por linha**, não por SKU. O mesmo produto pode
aparecer várias vezes com estados diferentes.

### 3.2 Normalização oficial do status Nomus

Fonte reutilizável:
`src/lib/sales/nomusSalesOrderItemStatus.ts`.

Mapa implementado:

- `1` → `PENDING` / Aguardando liberação;
- `2` → `RELEASED` / Liberado;
- `3` → `PARTIAL` / Atendido parcialmente;
- `4` → `FULFILLED` / Atendido totalmente;
- `5` → `FULFILLED_WITH_CUT` / Atendido com corte;
- `6` → `CANCELED` / Cancelado;
- outro → `UNKNOWN`, preservando o bruto.

Evidência local documentada:

- códigos `4` e `6`: evidência forte em casos reais/fixtures;
- código `5`: coberto por testes e texto Nomus;
- código `2`: fixture de pedido com linha “Liberado”;
- códigos `1` e `3`: contrato consolidado no código, mas sem validação de
  produção equivalente à de `4`/`6`.

### 3.3 Liberação do Pedido

Não há coluna canônica `SalesOrder.isReleased`.

O que existe:

- por item: `nomusItemStatusNormalized === "RELEASED"` e `isReleased` do parser;
- agregado legado: `salesOrderLifecycleStatus.ts`, que deriva
  `awaiting_release`, `released`, `in_progress` etc. a partir dos itens;
- timeline: `salesOrderLifecycleTimeline.ts` considera o pedido liberado quando
  há item liberado ou qualquer item que deixou `awaiting_release`.

Essa regra agregada é útil para UI, mas precisa ser explicitada no Kanban. Para
evitar falso “liberado” em pedido misto, o read-model deve expor separadamente:

- `releasedItems`;
- `awaitingReleaseItems`;
- `allActiveItemsReleased`;
- `hasAnyReleasedItem`;
- `releaseStatus = AWAITING | PARTIAL | RELEASED | UNKNOWN`.

O Kanban não deve usar `SalesOrder.status` para essa decisão.

## 4. Classificador FIN reutilizável

Fonte:
`src/lib/finance/salesOrderItemFinancialFulfillmentClassifier.ts`.

Função:
`classifySalesOrderItemFinancialFulfillment`.

Saída canônica:

- `NOT_FULFILLED`;
- `PARTIALLY_FULFILLED`;
- `FULLY_FULFILLED`;
- `FULFILLED_WITH_CUT`;
- `CANCELED`;
- `UNKNOWN`.

Também devolve:

- quantidade pedida, atendida e restante;
- `hasFutureObligation`;
- `isCut`;
- inconsistência de quantidade;
- alerta de classificação pendente;
- motivo auditável.

Regras críticas já implementadas:

- `PENDING` e `RELEASED` ainda têm obrigação futura;
- parcial mantém residual;
- concluído, corte e cancelado zeram residual;
- diferença de quantidade sozinha não cria corte;
- flag `nomusIsCut` isolada não substitui o status oficial;
- desconhecido não zera silenciosamente o saldo.

Este classificador deve ser a base do estágio de atendimento no Kanban. Não
duplicar os códigos 1–6 em novo arquivo.

## 5. Agenda financeira efetiva

Motor:
`src/lib/finance/salesOrderPlannedReceivables.ts`.

Entradas:

- valor ativo do pedido;
- condição/parcelas do `SalesOrder.nomusRawResponse`;
- CRs reais;
- valor alocado por Documentos de Saída válidos;
- data de referência.

Precedência oficial:

`CR real ≥ Documento de Saída válido ≥ previsão do Pedido`.

Funções reutilizáveis:

- `computeSalesOrderFinancialCoverage`;
- `allocateResidualPlannedAmounts`;
- `buildSalesOrderPlannedReceivables`;
- fachada `resolveReceivablesForSalesOrder`;
- parcelas-base via `resolveSalesOrderListPaymentSummary`, exportada por
  `src/lib/salesOrderListPaymentSchedule.ts`;
- consolidação em `src/lib/sales/orderFinancialConsolidation.ts` e
  `src/lib/sales/orderFiscalFinancialMetrics.ts`.

`findCoveringRealCr` é detalhe privado do motor, não uma API para novos
consumidores.

O motor já evita somar CR e Documento da mesma cadeia. Para o Kanban, a saída
deve ser resumida em campos como `remainingPlannedValue`,
`coveredByRealReceivables`, `coveredByDocumentsWithoutRealReceivable`,
`nextDueDate` e `overdueExpected`.

Dependência FIN: o working tree local contém evolução da auditoria/consumidores
da agenda efetiva. A implementação futura deve integrar a API pública final
desse motor, sem importar artefatos de diagnóstico como fonte de domínio.

## 6. Ordens de Produção

### 6.1 Stage e vínculo

`NomusProductionOrder` é upsertado por `externalId` e normaliza:

- nome, status, tipo e prioridade;
- produto, empresa e setor;
- `quantity` e unidade;
- abertura, liberação, planejamento, entrega e encerramento;
- `rawJson`, hash, presença e timestamps de sync.

O status da OP é texto literal do Nomus, sem enum local. A API/tela atuais
obtêm os valores reais por `groupBy status`/`statusCounts`, preservam
desconhecidos e só aplicam tons visuais. Valores comprovados no repositório
incluem `Encerrada`, `Liberada`, `Planejada`, `Pendente` e `Cancelada`; a UI
também reconhece `Concluída`. Esses labels não autorizam inferir datas ou
quantidade produzida. Em particular, `dataHoraEntrega` não é encerramento.

`NomusProductionOrderSalesLink` representa a relação oficial muitos-para-muitos
OP↔Pedido/item:

- `externalSalesOrderId` ← `itensPedido[].idPedido`;
- `externalSalesOrderItemId` ← `itensPedido[].id`;
- FKs locais opcionais `salesOrderId` e `salesOrderItemId`;
- `linkedQuantity`;
- `isCurrent`, `firstSeenAt`, `lastSeenAt`, `removedAt`.

Usar somente links atuais para cobertura corrente. Links históricos continuam
úteis para auditoria.

### 6.2 Quantidade planejada e cobertura por OP

Disponível:

- `NomusProductionOrder.quantity`: quantidade da OP;
- `NomusProductionOrderSalesLink.linkedQuantity`: quantidade atribuída à linha
  do Pedido;
- `SalesOrderItem.quantity`: quantidade pedida.

Para “quantidade coberta por OP”, a fonte mais específica é a soma de
`linkedQuantity` dos links atuais da linha, limitada/contrastada com a
quantidade do item. `NomusProductionOrder.quantity` é do cabeçalho da OP e pode
atender mais de um vínculo; somá-la por item causaria dupla contagem.

Lacunas:

- não existe resolver canônico de cobertura de OP por item;
- precisa definir tratamento de `linkedQuantity = null`;
- precisa evitar dupla contagem quando uma OP tem vários links;
- precisa distinguir OP cancelada/encerrada/atual segundo o status bruto Nomus.

### 6.3 Quantidade produzida

Não há coluna `producedQuantity` em `NomusProductionOrder`.

Há dois fallbacks brutos:

- `extractNomusProductionOrders` lê
  `quantidadeProduzida | qtdProduzida | quantidadeRealizada` de OPs embutidas
  em `SalesOrder.nomusRawResponse`;
- `orderFullAuditService.ts` lê
  `qtdeProduzida | quantidadeProduzida | producedQuantity` do raw do item.

Esses fallbacks não constituem uma fonte normalizada e podem divergir do stage
de OP. Antes de implementar o card “produzido”, é necessário confirmar no
payload real de `/rest/ordens`:

- nome e unidade do campo produzido;
- se é quantidade acumulada do cabeçalho ou por vínculo/item;
- comportamento em reabertura, refugo, cancelamento e OP parcial.

Sem essa confirmação, o Kanban deve retornar `producedQuantity: null` +
qualidade da fonte, em vez de inferir pelo status da OP.

### 6.4 Item exige produção

Hoje não existe regra oficial persistida por item do Pedido.

Há:

- `Product.costingMode` (`OWN_PROCESS`, `BOM_ONLY`, `FINISHING_SERVICE`), que é
  regra de custeio e **não prova** necessidade operacional de OP;
- parâmetro opcional `requiresProduction` em
  `salesOrderLifecycleStatus.ts`/`salesOrderIntelligence.ts`, mas o loader atual
  não o alimenta;
- presença de link atual de OP, que prova produção vinculada, mas não prova que
  um item sem link não exige produção.

Portanto:

- `hasProductionOrder` pode ser calculado agora;
- `requiresProduction` permanece uma lacuna de contrato;
- não derivar automaticamente de `costingMode` sem validação do domínio Nomus.

## 7. Documentos de Saída

### 7.1 Stage

`NomusStockDocument` e `NomusStockDocumentItem` já são o master local do
resource Nomus `documentosEstoque`.

Campos relevantes do cabeçalho:

- `externalId`, `idNfe`, tipo e datas;
- número do documento;
- `statusRaw`, cancelamento e motivo;
- valor total;
- pessoa e empresa;
- condição de pagamento bruta;
- hash, presença e timestamps.

Campos de item:

- `externalItemId`, `externalProductId`;
- `quantity`, `unitValue`, `estimatedTotalValue`;
- `rawJson`.

### 7.2 Resolver canônico

Reutilizar:

- `nomusOutputDocumentResolver.ts`;
- `nomusOutputDocumentResolver.server.ts`;
- `outputDocumentAllocationProjection.ts`;
- `outputDocumentFinancialStatusResolver.ts`;
- `orderToCashAuditBuilder.ts` para matching/alocação de quantidade.

O resolver DS:

- parte sempre do stage;
- cruza NF, link Pedido→NF, Pedido, itens, O2C e CR;
- não usa fuzzy matching;
- não cria vínculo;
- não consulta Nomus HTTP;
- mantém razões e fontes da resolução.

Para “quantidade documentada”, usar a alocação item a item já produzida pelo
O2C/DS (`quantityUsedForOrder`), não a soma bruta de todos os itens do
Documento. Um Documento pode conter itens externos, excesso e relação com mais
de um pedido.

Dependência DS: o O2C é snapshot reconstruível. Uma leitura do Kanban deve
declarar a run/freshness da alocação ou compor o resolver live a partir do stage
quando o custo for aceitável.

## 8. NF-e e faturamento

Fontes:

- `SalesOrderNfeLink`: vínculo normalizado Pedido→NF-e;
- `NomusNfe`: master fiscal local;
- `salesOrderLinkedNfe.ts`: contexto canônico de NF vinculada;
- `sales-orders/salesOrderRelatedNfeResolver.server.ts`: composição server-side
  de NFs relacionadas;
- `orderFiscalFinancialMetrics.ts`: métricas fiscais/financeiras;
- `nfeStatus.ts`: status fiscal, incluindo cancelamento estrutural.

### 8.1 Quantidade faturada

Não usar `SalesOrder.totalNetValue` nem `NomusNfe.xmlVNF` para obter quantidade.

Opções atuais, em ordem de força:

1. quantidade alocada por item nos facts O2C/Documento;
2. quantidade atendida/faturada persistida no item do Pedido
   (`nomusQuantityFulfilled`), quando o contrato Nomus daquele campo estiver
   confirmado para o caso;
3. aliases brutos tratados pelos resolvers existentes, com qualidade explícita.

Existe lógica legada em `salesOrderLifecycleStatus.ts` que calcula
`invoicedQuantity` a partir do raw e do contexto de NF. Ela pode ser
reutilizada como compatibilidade, mas não deve substituir o resolver DS/O2C
quando houver alocação documental.

### 8.2 Data de envio pela NF-e

Disponível hoje:

- `NomusNfe.xmlDhEmi`: emissão fiscal;
- `NomusNfe.dataProcessamento` + `horaProcessamento`: processamento;
- `SalesOrderNfeLink.dataProcessamento`;
- `NomusStockDocument.dataDocumento` e `movementDate`: documento/movimentação.

Não foi encontrado campo normalizado `dhSaiEnt`, `dataSaida`,
`shipmentDate` ou equivalente. Logo, “data de envio pela NF-e” é uma lacuna.
Não renomear emissão ou processamento para envio.

Plano mínimo para esse dado:

1. inspecionar payload/XML real no servidor;
2. confirmar se `dhSaiEnt` ou campo Nomus equivalente existe e sua cobertura;
3. normalizar em `NomusNfe` somente após contrato;
4. manter fallback visual explícito para data do Documento, sem misturar
   semânticas.

## 9. Respostas objetivas aos estados do Kanban

### Pedido liberado

Existe parcialmente. Derivar dos status normalizados dos itens, não de
`SalesOrder.status`. É necessário publicar a regra agregada
`AWAITING | PARTIAL | RELEASED | UNKNOWN`.

### Item exige produção

Não existe como contrato oficial. Link atual prova OP existente; `costingMode`
não deve ser usado como substituto sem validação.

### Quantidade coberta por OP

Calculável pela soma auditada de `linkedQuantity` em links atuais por
`salesOrderItemId`. Falta um resolver compartilhado e regra para null/status.

### Quantidade produzida

Só disponível em raw/fallback; não normalizada no stage de OP. Requer confirmação
Nomus e eventual extensão do mapper/model.

### Quantidade documentada

Calculável pela alocação DS/O2C (`quantityUsedForOrder`) por item. Não somar
quantidade bruta do documento.

### Quantidade faturada

Existe por evidência de item/raw e alocação documental, mas não como uma coluna
fiscal única por item. Reutilizar os resolvers; expor fonte/qualidade.

### Item parcial

Existe: `PARTIAL`, classificador FIN-03 e saldo
`orderedQuantity − fulfilledQuantity`.

### Item com corte

Existe: `FULFILLED_WITH_CUT`/`nomusIsCut`. Corte só pelo status oficial; não por
shortfall isolado.

### Item cancelado

Existe: `CANCELED`/`nomusIsCanceled`; respeitar matching por linha e
`nomusIsStale`.

### Data de envio pela NF-e

Não existe normalizada. Emissão, processamento e movimentação são datas
distintas e não devem ser tratadas como envio.

## 10. APIs, services e telas reutilizáveis

### Pedido / Gestão

- `GET /api/sales-orders`;
- `GET /api/sales-orders/management`;
- `GET /api/sales-orders/:id/intelligence`;
- `GET /api/sales-orders/:salesOrderId/detail`;
- `salesOrderManagementMetrics.server.ts`;
- `salesOrderRulesAdapter.ts`;
- `salesOrderManagement.ts`;
- `salesOrderLifecycleStatus.ts`;
- `salesOrderIntelligence.ts`;
- `SalesOrderManagementPage.tsx`;
- `SalesOrdersModule.tsx`.

### Detalhe e drawers

- `SalesOrderDetailDialog.tsx` + `SalesOrderDetailView.tsx`;
- `SalesOrderQuickSummaryDrawer.tsx`;
- `SalesOrderIntelligenceDrawer.tsx`;
- `OrderStatusPedidosDrawer.tsx`;
- `OrderFullAuditDialog.tsx`;
- `ProductionOrderQuickDetailOverlay.tsx`.

O padrão mais próximo para o Kanban é:

- card/linha abre drawer por ID;
- drawer carrega detalhe sob demanda com `AbortController`;
- fecha por Escape e backdrop;
- `role="dialog"` e `aria-modal`;
- conteúdo detalhado reutiliza loaders oficiais, sem carregar raw na listagem.

Antes de criar um novo drawer, avaliar se
`SalesOrderIntelligenceDrawer` pode receber uma entrada de Kanban e uma aba de
fluxo. O `SalesOrderQuickSummaryDrawer` é útil como padrão leve, mas já existe
sobreposição funcional entre os dois.

### Ordens de Produção

- `GET /api/operations/production-orders`;
- `GET /api/operations/production-orders/:id`;
- `productionOrdersList.server.ts`;
- `productionOrdersList.ts`;
- `productionOrdersDetail.server.ts`;
- `productionOrdersDetail.ts`;
- `ProductionOrdersModule.tsx`;
- `ProductionOrderQuickDetailOverlay.tsx`.

### Documentos de Saída

- `GET /api/commercial/output-documents`;
- `GET /api/commercial/output-documents/summary`;
- `GET /api/commercial/output-documents/:id`;
- `outputDocumentsList.server.ts`;
- `outputDocumentsDetail.server.ts`;
- `nomusOutputDocumentResolver.server.ts`;
- `OutputDocumentsModule.tsx`;
- `OutputDocumentDetailOverlay.tsx`.

## 11. Paginação

Padrões reutilizáveis:

- Gestão de Pedidos: `page`, `pageSize`, `total`, `totalPages`;
- OP: mesmo contrato, `pageSize` validado e ordenação estável
  `openedAt desc nulls last, externalId desc`;
- Documentos de Saída: query tipada, filtros e paginação server-side;
- sincronizadores Nomus: `pagina`/`tamanhoPagina`, com cursores/checkpoints de
  integração — não reutilizar esse contrato diretamente na UI.

O Kanban deve ter paginação no servidor. Não carregar toda a carteira e
distribuir em colunas apenas no browser, como parte da Gestão faz para métricas
complexas. Para manter consistência:

- uma query base filtrada;
- contagens por coluna calculadas sobre o mesmo `where`;
- página por coluna ou cursor estável;
- ordenação determinística por prazo/emissão + ID;
- DTO enxuto, sem `rawJson`;
- detalhe sob demanda.

## 12. Permissões

Contrato atual:

- `commercial.sales_orders` / `sales_orders.view`;
- `commercial.sales_orders.detail` /
  `sales_orders.detail.view | sales_orders.view`;
- `commercial.sales_orders.invoice` / `sales_orders.invoice.view`;
- `commercial.output_documents` e filhos;
- recursos de OP no grupo de operações.

Enforcement:

- rotas usam `requireAppAuth` + `requireResource`;
- frontend usa o DTO de acesso efetivo;
- aliases legados permanecem para compatibilidade.

Plano mínimo:

- se o Kanban substituir/for visão da Gestão de Pedidos, reutilizar
  `commercial.sales_orders:view`;
- se for superfície independente, adicionar subrecurso canônico somente se
  houver necessidade real de autorização distinta;
- ações futuras de alteração de estágio não podem reutilizar `view`; precisam
  ação dedicada;
- dados de NF/Documento/OP dentro do drawer devem ser projetados pelo backend
  conforme o acesso do usuário, sem exigir que o frontend consulte módulos
  irmãos diretamente.

## 13. Feature flags

Não foi encontrado um framework geral e persistido de feature flags para
produto/UI.

Há flags de integração por ambiente, por exemplo:

- `NOMUS_PRODUCTION_ORDERS_AFTER_SYNC`;
- `INVENTORY_INTEGRATIONS_ENABLED`;
- opções de compatibilidade/integração específicas.

Essas flags são operacionais e não constituem rollout de feature por usuário.
Para o Kanban:

- não criar tabela de feature flags sem necessidade;
- rollout inicial pode usar env server-side com default seguro e teste;
- permissão não deve ser usada como feature flag;
- se houver necessidade de rollout por empresa/usuário, isso é uma decisão
  arquitetural separada.

## 14. Sincronizadores, jobs, IntegrationRun e locks

### Pedidos

- `scripts/nomusSalesOrdersSyncV1.ts`;
- janela/cursor em `nomusSalesOrdersSyncWindow.ts` e
  `nomusSalesOrdersPaginationCursor.ts`;
- upsert em `salesOrderNomusSync.server.ts`;
- status de itens persistido por linha;
- pós-apply chama sincronização incremental de OP.

### OP

- mapper, sync logic, repository e script dedicados;
- backfill e incremental;
- lock exclusivo em `nomusProductionOrdersSyncLock.ts`;
- detecção de PID vivo/órfão e lock global;
- auditoria em `nomusProductionOrdersSyncAudit.ts`;
- `IntegrationRun` em `nomusProductionOrdersIntegrationRun.ts`;
- execução pós-pedidos em
  `nomusProductionOrdersAfterSalesOrders.server.ts`.

### Documentos de Saída

- `scripts/nomusStockDocumentsSync.ts`;
- mapper e sync logic;
- lock, lifecycle, checkpoint e janela incremental;
- proteção contra payload parcial;
- `IntegrationRun` em `nomusStockDocumentsIntegrationRun.ts`.

### NF-e

- `scripts/nomusNfesSync.ts`;
- mapper/regras fiscais e runner;
- lock e `IntegrationRun` no padrão financeiro.

### Implicação para o Kanban

Expor freshness por fonte:

- último sync do Pedido;
- última presença/alteração da OP;
- último sync do Documento;
- última NF;
- run O2C usada, quando aplicável.

Não disparar sync Nomus durante a leitura do Kanban. O Kanban é consumidor
read-only dos stages.

## 15. Auditoria

Padrões existentes:

- `IntegrationRun` para execução de integrações;
- `firstSeenAt`, `lastSeenAt`, `lastChangedAt`, `syncedAt`, `payloadHash` e
  presença nos stages;
- facts O2C com `runId` e `auditKey`;
- auditorias de permissões com ator/motivo;
- histórico de mudança em domínios mutáveis.

O Kanban read-only não precisa de tabela de auditoria própria. Deve carregar
evidências de origem e freshness.

Se futuramente houver movimentação manual de cards:

- ela não pode sobrescrever status Nomus;
- precisa ser um workflow comercial separado e explicitamente nomeado;
- deve guardar `from`, `to`, ator, data, motivo e versão;
- deve reconciliar com o estado oficial, sem virar fonte de atendimento,
  produção, documento ou faturamento.

## 16. Lacunas confirmadas

1. Regra canônica agregada de liberação do Pedido.
2. Contrato oficial de `requiresProduction` por item.
3. Resolver de cobertura de OP por item.
4. Quantidade produzida normalizada no stage de OP.
5. Semântica/status das OPs para excluir canceladas e tratar encerradas.
6. Data fiscal/logística de envio/saída.
7. Resolver único de quantidade faturada por item com fonte e confiança.
8. Estratégia de freshness entre stages e facts O2C.
9. API paginada específica para colunas do Kanban.
10. Mecanismo geral de rollout de feature, caso seja necessário além de env.

Lacunas que exigem servidor/Nomus e não podem ser fechadas localmente:

- cobertura real dos campos de OP produzida;
- distribuição real dos status de OP;
- preenchimento de `linkedQuantity`;
- presença de `dhSaiEnt` ou equivalente;
- cobertura de Documento/NF/O2C por pedido;
- latência real entre os sincronizadores;
- casos de múltiplas OPs por item e múltiplos pedidos por OP.

## 17. Riscos de duplicação e inconsistência

- usar `SalesOrder.status` como status Nomus de liberação;
- criar novo enum com os códigos 1–6;
- calcular atendimento por SKU, ignorando linhas repetidas;
- usar OP embutida em `nomusRawResponse` quando existe stage normalizado;
- somar `NomusProductionOrder.quantity` em cada link;
- inferir produzido pelo status da OP;
- usar quantidade bruta do Documento como quantidade do Pedido;
- tratar `OrderToCashAuditFact` como dado em tempo real;
- igualar Documento, NF e CR;
- somar previsão + Documento + CR;
- usar processamento da NF como data de envio;
- duplicar `SalesOrderIntelligenceDrawer` sem avaliar extensão;
- criar um segundo loader que repita filtros/margem da Gestão;
- carregar raw JSON no grid;
- usar permissões como mecanismo de rollout.

## 18. Arquivos potencialmente afetados numa implementação futura

Somente após aprovação do desenho:

- `src/lib/sales/` — read-model/classificadores compartilhados;
- `src/lib/sales-orders/` — loader/DTO do Kanban;
- `src/lib/salesOrderIntelligenceRoutes.ts` ou rota dedicada;
- `src/components/sales/SalesOrderManagementPage.tsx`;
- `src/components/sales/SalesOrderIntelligenceDrawer.tsx`;
- novo componente de board, sem duplicar o detalhe;
- `src/lib/productionOrdersList.server.ts` ou resolver de cobertura;
- `src/lib/output-documents/nomusOutputDocumentResolver.server.ts`;
- `src/lib/finance/salesOrderPlannedReceivables.ts` somente como dependência,
  não para reimplementar;
- `src/lib/security/permissionContract/resources.ts` apenas se houver permissão
  distinta;
- `src/lib/permissionResourceSeedData.ts` e clientes de permissão apenas se o
  contrato mudar;
- testes de API, classificação, paginação, autorização e componentes.

Possíveis alterações de schema, **condicionadas à confirmação Nomus**:

- quantidade produzida normalizada em `NomusProductionOrder` ou entidade de
  apontamento, conforme granularidade real;
- data de saída/envio em `NomusNfe`, se o XML/API fornecer o campo oficial;
- nenhum model de Kanban é necessário para a primeira versão read-only.

## 19. Plano técnico mínimo

### Etapa 1 — Fechar contratos sem mudar UI

1. Publicar regra agregada de liberação a partir do classificador FIN-03.
2. Criar resolver puro de cobertura OP por item usando links atuais.
3. Publicar resolver de quantidade documentada/faturada baseado em DS/O2C com
   `source`, `confidence` e `asOf`.
4. Definir DTO único de `SalesOrderFlowItem`.
5. Retornar `unknown`/`null` para produção e envio ainda não confirmados.

### Etapa 2 — Confirmar Nomus no servidor

1. Auditar payload de `/rest/ordens` para produzido e granularidade.
2. Auditar XML/API NF-e para data de saída/envio.
3. Medir cobertura de links OP, Documento, NF e facts O2C.
4. Versionar fixtures sanitizadas e atualizar o contrato.

### Etapa 3 — Read-model do Kanban

1. Criar service server-only que componha as fontes existentes.
2. Implementar filtros e paginação estável no servidor.
3. Calcular contagens de coluna sobre o mesmo escopo.
4. Expor freshness e qualidade por dimensão.
5. Aplicar `requireResource(commercial.sales_orders, view)`.

### Etapa 4 — UI

1. Reutilizar filtros da Gestão quando semanticamente iguais.
2. Board responsivo com carregamento paginado.
3. Reutilizar/estender `SalesOrderIntelligenceDrawer`.
4. Manter detalhe completo existente como drill-down.
5. Rollout read-only; nenhuma movimentação manual na primeira versão.

### Etapa 5 — Hardening

1. Testes de itens repetidos, parcial, corte, cancelado e stale.
2. Testes de múltiplas OPs/links e `linkedQuantity = null`.
3. Testes de Documento excedente/fora e O2C defasado.
4. Testes de NF cancelada e ausência de data de envio.
5. Testes de paginação, autorização e sem dupla contagem FIN.

## 20. Decisão recomendada

Implementar o Kanban como **projeção read-only**, sem nova fonte da verdade.

O primeiro incremento deve exibir apenas estados sustentados pelas fontes
atuais:

- liberação/atendimento do item;
- OP vinculada e quantidade coberta quando `linkedQuantity` existir;
- documento/alocação;
- NF vinculada e estado fiscal;
- agenda financeira efetiva;
- parcial, corte e cancelamento;
- freshness/qualidade.

“Quantidade produzida”, “item exige produção” e “data de envio pela NF-e”
devem permanecer desconhecidos ou condicionais até o contrato Nomus ser
confirmado. Inventar esses campos agora criaria exatamente a segunda fonte da
verdade que esta auditoria busca evitar.

## 21. Referências principais

- `prisma/schema.prisma`
- `src/lib/sales/nomusSalesOrderItemStatus.ts`
- `src/lib/finance/salesOrderItemFinancialFulfillmentClassifier.ts`
- `src/lib/finance/salesOrderPlannedReceivables.ts`
- `src/lib/finance/orderReceivablesResolver.ts`
- `src/lib/salesOrderLifecycleStatus.ts`
- `src/lib/salesOrderLifecycleTimeline.ts`
- `src/lib/salesOrderIntelligence.ts`
- `src/lib/salesOrderManagementMetrics.server.ts`
- `src/lib/nomusProductionOrdersMapper.ts`
- `src/lib/nomusProductionOrdersRepository.server.ts`
- `src/lib/productionOrdersList.server.ts`
- `src/lib/productionOrdersDetail.server.ts`
- `src/lib/output-documents/nomusOutputDocumentResolver.ts`
- `src/lib/output-documents/nomusOutputDocumentResolver.server.ts`
- `src/lib/sales/orderToCashAuditBuilder.ts`
- `src/lib/finance/orderFullAuditService.ts`
- `src/lib/salesOrderLinkedNfe.ts`
- `src/lib/sales-orders/salesOrderRelatedNfeResolver.server.ts`
- `src/lib/security/permissionContract/resources.ts`
- `src/components/sales/SalesOrderManagementPage.tsx`
- `src/components/sales/SalesOrderIntelligenceDrawer.tsx`
- `src/components/sales/SalesOrderDetailDialog.tsx`
- `src/components/operations/ProductionOrdersModule.tsx`
- `src/components/operations/ProductionOrderQuickDetailOverlay.tsx`
- `docs/finance/effective-schedule-current-flow.md`
- `docs/finance/effective-schedule-policy.md`
- `docs/output-documents/code-inventory.md`
- `docs/production-orders/current-state.md`
- `docs/sales/sales-order-item-status-rules.md`
- `docs/gestao-pedidos-venda-fontes-e-layout.md`
