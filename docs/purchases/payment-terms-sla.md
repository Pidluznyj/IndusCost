# SLA de Pagamento dos Pedidos de Compra Nomus — auditoria e contrato funcional

Data: 2026-10-15 · Branch: `feat/purchases-payment-terms-sla` (de origin/main 42f4e22b).

Tela alvo: Cadeia de Suprimentos › Compras › Pedidos Nomus (`/purchases/nomus-orders`, `src/components/NomusPurchaseOrderModule.tsx`).

## 1. Auditoria da main

### 1.1 Onde estão os dados

| Informação | Onde está | Observação |
|---|---|---|
| ID oficial do pedido | `NomusPurchaseOrder.externalId` (`id` Nomus) | único |
| Número | `NomusPurchaseOrder.orderNumber` (`codigoPedido`) | ex.: `PC00612` |
| Emissão | `NomusPurchaseOrder.issuedAt` (`dataEmissao`, dd/MM/yyyy) | data de calendário |
| Entrega prevista | `NomusPurchaseOrder.expectedAt` (`dataEntregaPadrao`) | |
| Valor total | `NomusPurchaseOrder.totalAmount` | **derivado** dos itens + frete/seguro/despesas − desconto (o live não envia `valorTotal`) |
| Condição contratada (texto) | `NomusPurchaseOrder.paymentTerms` (`condicaoPagamentoTexto`) | texto livre; **frequentemente `"."`** |
| Condição contratada (id) | `rawPayload.idCondicaoPagamento` (lido por `extractPurchaseOrderHeaderFields`) | sem catálogo sincronizado |
| Parcelas: quantidade, valor, vencimento | `rawPayload.parcelas[]` (`dataVencimento`, `valorParcela`, `idFormaPagamento`, `geraAdiantamento`) | parser oficial `parsePurchaseOrderPlannedInstallments` |
| Identificador da parcela | **não existe** no payload; só a posição (`installmentIndex`) | |
| Vínculo com Contas a Pagar | `NomusPurchaseOrderPayableLink` (pedido ↔ `NomusAccountsPayable.externalId`, `installmentIndex` opcional, método/confiança, nunca por nome) | dono financeiro único por título |
| Vencimento financeiro atual | `NomusAccountsPayable.dueDate` | não há vencimento original/histórico de prorrogação |
| Comprador | `rawPayload.idPessoaComprador` | **só o id**; o grid já mostra "Comprador #id" |

### 1.2 Coletor Nomus

- `scripts/nomusPurchaseOrdersSync.ts` → `mapNomusPurchaseOrderPayload` → `applyNomusPurchaseOrderRows`.
- O `rawPayload` completo é persistido, inclusive `parcelas[]` e `idCondicaoPagamento`.
- **Não é preciso ampliar o coletor** para as parcelas.
- O catálogo de condições (`/condicoespagamento`, com dias e evento de referência) **não** é sincronizado. Buscá-lo seria uma chamada externa nova: não executada (exige autorização).
- Já existe rematerialização local a partir do `rawPayload`, sem chamar o Nomus (`rematerializeNomusPurchaseOrderFinancials`). Ela é o padrão para preencher o histórico.

### 1.3 Grid, filtros, indicadores, permissões

- **Lista:** `GET /api/nomus/purchase-orders` (`src/lib/nomusPurchaseOrderRoutes.ts`) + `enrichNomusPurchaseOrderListRows` (`nomusPurchaseOrder360.server.ts`).
  - A coluna "Financeiro" mostra `financialStatus` (Planejado/Confirmado/Pago…) do pacote financeiro canônico.
- **Filtros existentes:** busca, fase, fiscal, financeiro (`financialStatus`), abertos, atrasados, emissão/entrega de-até (API).
  - Filtros fiscal/financeiro são pós-filtro em memória (padrão existente).
- **KPIs:** `buildNomusPurchaseOrderKpis` (abertos, valor aberto, atrasados, parciais, previsões 7/30).
- **Detalhe:** `NomusPurchaseOrderDetailDialog` (abas, incluindo "Financeiro" com parcelas planejadas e títulos).
- Não existe aba "Compras › Indicadores" em Pedidos Nomus. O painel analítico existente é **Performance** (`/purchases/performance`, `SupplierPerformanceDashboardPage`).
- **Parâmetros gerenciais:** não há tabela genérica. O padrão do sistema são singletons por domínio (`FleetSettings`, `TreasuryAlertSettings`, `CommissionSettings`).
- **Permissões:** `VIEW_PERMISSIONS` das rotas Nomus de compras (somente leitura).

### 1.4 Evidência sobre a data-base

O payload **não informa** a partir de qual evento os dias da condição são contados (emissão, entrega, faturamento).

Exemplo sanitizado PC00612 (fixture):
- emissão 02/09/2026, entrega prevista 11/09/2026;
- parcelas 16/10, 30/10 e 09/11.

| Base | Prazos |
|---|---|
| Emissão | 44/58/68 |
| Entrega prevista | 35/49/59 |

Nenhuma das duas bases dá uma condição "redonda", e não há dado para escolher com segurança.

## 2. Contrato funcional (proposto)

**Prazo negociado:**
- Parcelas planejadas do próprio pedido (`rawPayload.parcelas[]`), que o Nomus gera a partir da condição contratada.
- Títulos de Contas a Pagar não reescrevem esse prazo.

**PMP:**
- PMP = Σ(valor da parcela × dias) / Σ(valor das parcelas).
- Dias corridos de calendário entre a **data-base** e o vencimento.
- Motor único: `src/lib/purchasing/purchasePaymentTerms.ts`.

**Regras de elegibilidade** (sempre explícitas, nunca 0 presumido):

| Situação | Comportamento |
|---|---|
| Sem parcelas | Não identificado (`NO_INSTALLMENTS`) |
| Data-base ausente | Não identificado (`MISSING_BASE_DATE`) |
| Parcela sem vencimento / data inválida | Não identificado; não calcula parcial |
| Parcela sem valor | Não identificado |
| Parcela negativa | Não identificado |
| Parcela zero | Ignorada no cálculo, com aviso; todas zero → não identificado |
| Todas vencendo na data-base | "À vista", PMP 0 (só nesse caso) |
| Vencimento antes da data-base | Calculado (dias negativos), aviso de antecipado; faixa "À vista / antecipado" |
| `geraAdiantamento` | Aviso |
| Soma das parcelas ≠ total do pedido (> 0,5%) | Calculado pelas parcelas, aviso de divergência |
| Quantidade de parcelas sem datas | Nunca gera parcelas iguais presumidas |
| Pedido cancelado | Aparece no grid; **fora** dos indicadores da carteira |
| Recebido sem faturamento / pago parcial | Prazo negociado inalterado; situação financeira à parte |
| Título prorrogado | Não altera o negociado; o "PMP financeiro atual" vem só de vínculos determinísticos (`NomusPurchaseOrderPayableLink`), mostrado separado com a diferença |

**Consolidação:**
- PMP da carteira, por comprador, por fornecedor e por mês de emissão = Σ(valor × dias) / Σ valor dos pedidos identificados. Nunca média de médias.
- Pedidos não identificados entram na **qualidade dos dados** (percentual), nunca são escondidos.

**Faixas:** À vista/antecipado, 1–29, 30–59, 60–89, ≥ 90, Não identificado (pelo PMP inteiro exibido).

**Meta:**
- Opcional, sem valor padrão.
- Sem meta configurada, nada é classificado como bom ou ruim.
- Com meta: atende = PMP ≥ meta, apenas informativo.

## 3. Decisão pendente — data-base do prazo negociado

Sem a data-base o indicador pode medir o evento errado. Opções:

1. **Medir antes (recomendado).** Rodar no servidor o diagnóstico **somente leitura**:

   ```bash
   npx tsx scripts/auditPurchaseOrderPaymentTermsBase.ts --out=data-base.json
   ```

   - Ele agrupa os pedidos pela mesma condição (`idCondicaoPagamento`) e verifica, para cada base candidata (emissão × entrega prevista), se os prazos ficam iguais entre os pedidos.
   - A base correta é a que torna os prazos constantes.
   - Não chama o Nomus e não grava nada.
2. **Emissão do pedido, rotulada como derivada.** Exibir "dias contados da emissão do pedido". É o que o pedido de implementação prefere, mas não está comprovado que seja o evento contratual.
3. **Sincronizar o catálogo de condições do Nomus** (`/condicoespagamento`). Traria a definição oficial (dias e referência), mas é chamada externa nova e mudança de contrato de integração.

Até a decisão, o motor recebe a data-base como parâmetro explícito e sempre devolve qual base usou.

## 4. Implementado até aqui (checkpoint 1)

- `src/lib/purchasing/purchasePaymentTerms.ts`: motor puro (cálculo, rótulo 30/60/90, faixas, meta, consolidação ponderada).
  - 19 testes (`purchasePaymentTerms.test.ts`): casos 1–15, faixas, meta, consolidado.
- `src/lib/purchasing/purchasePaymentTermsBaseAudit.ts` + `scripts/auditPurchaseOrderPaymentTermsBase.ts`: diagnóstico somente leitura da data-base.
  - 3 testes.
