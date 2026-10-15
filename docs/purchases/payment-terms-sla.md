# Qualidade das Condições de Compra — PMP dos Pedidos de Compra Nomus

Data: 2026-10-15 · Branch: `feat/purchases-payment-terms-sla` (de origin/main 42f4e22b).

**Objetivo gerencial:** responder se a empresa compra com bons prazos de pagamento, quais fornecedores oferecem condições inferiores à referência e onde negociar para preservar capital de giro.

**Não é:** SLA de pagamento de títulos, aging, inadimplência ou prazo de baixa bancária. Esses temas continuam na gestão financeira.

## 1. Auditoria da main

### 1.1 Onde estão os dados

| Informação | Onde está | Observação |
|---|---|---|
| ID oficial do pedido | `NomusPurchaseOrder.externalId` (`id` Nomus) | único; o espelho não tem versões substituídas |
| Número | `orderNumber` (`codigoPedido`) | |
| Emissão | `issuedAt` (`dataEmissao` dd/MM/yyyy → meia-noite local) | data de calendário |
| Valor do pedido | `totalAmount` | derivado dos itens + frete/seguro/despesas − desconto (o live não envia `valorTotal`) |
| Condição (texto) | `paymentTerms` (`condicaoPagamentoTexto`) | texto livre, **frequentemente `"."`** |
| Condição (id) | `rawPayload.idCondicaoPagamento` | catálogo de condições **não** sincronizado |
| Parcelas planejadas | `rawPayload.parcelas[]` (`dataVencimento`, `valorParcela`, `idFormaPagamento`, `geraAdiantamento`) | parser oficial `parsePurchaseOrderPlannedInstallments` |
| Identificador da parcela | **não existe**; só a posição (`installmentIndex`) | |
| Vínculo com Contas a Pagar | `NomusPurchaseOrderPayableLink` (determinístico, nunca por nome) | não usado no PMP |
| Comprador | `rawPayload.idPessoaComprador` | **só o código**; exibido como "Comprador #id" |

### 1.2 Coletor Nomus

**Não foi alterado.** Os dados necessários já são persistidos no `rawPayload`.

Não houve nenhuma chamada nova ao Nomus nem rotina permanente nova.

### 1.3 Data-base

O payload **não** informa a data-base contratual. A decisão da diretoria (2026-10-15) foi usar a **emissão do pedido** como referência operacional, identificada como derivada:
- **Nome técnico:** "prazo médio ponderado desde a emissão".
- **Na interface:** "PMP" / "Prazo de Pagamento".
- Tooltip, detalhe e esta documentação avisam que **não é condição contratual confirmada**.

Para checar a aderência com dados reais (opcional, somente leitura), há um diagnóstico que compara emissão × entrega prevista por condição (`idCondicaoPagamento`):

```bash
npx tsx scripts/auditPurchaseOrderPaymentTermsBase.ts --out=data-base.json
```

## 2. Regras de cálculo

Motor único: `src/lib/purchasing/purchasePaymentTerms.ts`. Agregações em `purchasePaymentTermsAnalysis.ts`. O frontend só exibe.

### 2.1 PMP do pedido

```text
PMP = Σ(valor da parcela × dias) ÷ Σ(valor das parcelas)
dias = vencimento − emissão do pedido (dias corridos de calendário)
```

- As duas datas vêm do mesmo parser.
- A comparação é feita por data de calendário, então hora e fuso não alteram a contagem. Há teste com 03:00Z (meia-noite de São Paulo).
- A condição observada é formada pelos prazos reais das parcelas (ex.: `32/62/83/92`). Nunca é arredondada para 30/60/90.
- **Referência PC00632:**
  - emissão 13/10/2026; parcelas em 14/11, 14/12, 04/01 e 13/01 (32/62/83/92 dias);
  - PMP = **67,25 dias** (exibido 67);
  - o "aproximadamente 65" citado no pedido de implementação é uma estimativa; o cálculo exato é 67,25.

### 2.2 Elegibilidade e qualidade dos dados

| Situação | Comportamento |
|---|---|
| Sem parcelas | Não identificado — **nunca à vista** |
| Emissão ausente | Não identificado |
| Parcela sem vencimento / data inválida | Não identificado; não calcula parcial |
| Parcela sem valor | Não identificado |
| Parcela negativa | Não identificado |
| Parcela zero | Ignorada no cálculo, com aviso; todas zero → não identificado |
| Todas vencendo na emissão | "À vista", PMP 0 |
| Vencimento antes da emissão | Dias negativos, aviso de antecipado; faixa "À vista / antecipado" |
| `geraAdiantamento` | Aviso |
| Soma das parcelas ≠ total do pedido (> 0,5%) | Calculado pelas parcelas, aviso |
| Condição textual `"."` ou vazia | Tratada como "não informada"; o prazo vem das parcelas |
| Cancelado | Aparece no grid com o prazo, **sem comparação com a meta**; fora da carteira; contado em "Fora da carteira" |
| Recebido, faturado ou pago | **Continua** na carteira (mede-se a negociação, não o pagamento) |
| Duplicidade | Deduplicado pelo `externalId` oficial |

### 2.3 Carteira, fornecedores e compradores

- **População:** pedidos emitidos no período (data civil de emissão), exceto cancelados.
- **PMP da carteira, por fornecedor, por comprador e por mês** = Σ(valor × dias) ÷ Σ valor das parcelas dos pedidos identificados. **Nunca média de médias.**
- **Valor comprado:** total do pedido; sem total, a soma das parcelas.
- **Cobertura:** % do valor comprado (e da quantidade de pedidos) com PMP identificado. Não identificados aparecem com o motivo.
- **Período anterior:** mesma quantidade de dias, imediatamente antes.
- **Faixas:** À vista/antecipado, 1–29, 30–59, 60–89, ≥ 90, Não identificado (pelo PMP inteiro exibido).

### 2.4 Meta, gap e oportunidade

**Meta:**
- `PurchasePaymentTermsSettings.targetPmpDays`: 0–365, opcional, sem valor padrão.
- Histórico em `PurchasePaymentTermsSettingsHistory`: antes, depois, autor e data.
- Edição exige `operations.purchases` + `approve`.
- Sem meta, nada é classificado; a meta não bloqueia compras.

**Gap** = PMP (dias inteiros) − meta. Negativo = abaixo do objetivo.

**% abaixo da meta** = valor dos pedidos identificados com PMP < meta ÷ valor identificado.

**Capital de giro potencial (estimativa):**

```text
compras mensais de referência = valor identificado do fornecedor ÷ max(1, dias do período ÷ 30,4375)
dias adicionais = max(0, meta − PMP)
capital potencial = compras mensais × dias adicionais ÷ 30
```

- **Exemplo:** R$ 200.000/mês, PMP 28 dias, meta 60 → **R$ 213.333**.
- **Confiabilidade:**
  - **Baixa:** período < 2 meses, menos de 2 meses com compra ou menos de 3 pedidos.
  - **Não calculável:** sem meta ou sem prazo identificado.
- Período parcial (< 1 mês) nunca é extrapolado.
- Não é economia realizada, saldo de caixa, lucro nem garantia de negociação.
- **Ranking:** maior oportunidade → gap mais severo → maior volume. Não há prioridade Alta/Média/Baixa (limites não aprovados).

## 3. Onde aparece

### 3.1 Pedidos Nomus (`/purchases/nomus-orders`)

- A coluna **Financeiro** foi substituída por **Prazo de Pagamento**:
  - linha 1: condição observada;
  - linha 2: "PMP: N dias".
  - Com meta, aparece um texto discreto: "−32 d da meta" / "na meta".
  - Tooltip com a data-base e o método.
- Ordenação pelo PMP: clique no cabeçalho; não identificados ficam no fim.
- Filtros novos: "Prazo de pagamento" (faixa) e "Meta de PMP" (este só com meta configurada).
- Os filtros Fase, Fiscal, **Financeiro**, abertos e atrasados foram preservados. A situação financeira continua no detalhe.

### 3.2 Detalhe › Financeiro

- Bloco **Condição de Pagamento da Compra**: PMP desde a emissão, condição observada, data-base usada, meta/gap, condição textual do Nomus, confiabilidade e avisos.
- A tabela de parcelas existente ganhou a coluna "Dias desde a emissão".
- O painel de Contas a Pagar e seus vínculos não foram alterados.

### 3.3 Compras › Performance › **Condições de compra** (`?view=payment-terms`)

Nova sub-aba no painel existente, com:
- **KPIs:** PMP (com período anterior), meta, gap, % abaixo da meta, valor identificado, cobertura, capital potencial, cancelados.
- **Seções:**
  - fornecedores prioritários, com drill-down "por que está na lista" (pedidos, parcelas, vencimentos, dias, evolução);
  - evolução mensal;
  - faixas;
  - PMP por comprador (sem classificação individual);
  - pedidos do período, com filtros de faixa, identificação e meta, e link para o pedido.
- **Filtros:** período por emissão (mês corrente padrão, 30/90 dias, ano corrente, personalizado), fornecedor e comprador. O editor da meta aparece só para quem pode alterar.

### 3.4 Endpoints (somente leitura, exceto a meta)

| Método | Rota | Guard |
|---|---|---|
| GET | `/api/purchases/performance/payment-terms?from&to&supplier&buyer` | `operations.purchases` view |
| GET | `/api/purchases/performance/payment-terms/suppliers/:id?from&to` | view |
| GET | `/api/purchases/performance/payment-terms/settings` | view |
| PUT | `/api/purchases/performance/payment-terms/settings` (`{ targetPmpDays }`) | `operations.purchases` approve |
| GET | `/api/nomus/purchase-orders` (+ `paymentTermsBucket`, `paymentTermsTarget`, `sort=pmp_asc\|pmp_desc`) | existente |
| GET | `/api/nomus/purchase-orders/:id` (+ `paymentTerms`) | existente |

## 4. Performance

- **Análise:** uma consulta por período, projetando só `rawPayload->'parcelas'` e o comprador (sem carregar o payload inteiro).
  - Nomes de fornecedor em lote (mesma resolução da listagem).
  - Sem N+1 e sem chamadas ao Nomus.
- **Grid:**
  - Sem filtro/ordenação de PMP: inalterado (página paginada + célula calculada a partir do `rawPayload` já selecionado).
  - Com filtro/ordenação de PMP: calcula só a célula dos candidatos e enriquece apenas a página final.
- Sem colunas materializadas e sem rematerialização: uma mudança de regra vale na hora, sem backfill.

## 5. Limitações e riscos

- A data-base é a **emissão** (decisão gerencial), não a referência contratual do Nomus. O diagnóstico somente leitura (item 1.3) mede a aderência.
- O comprador aparece só pelo código Nomus (não há espelho de pessoas com nome).
- As parcelas planejadas refletem o pedido no momento da sincronização.
  - Se o Nomus alterar as parcelas de um pedido, o PMP acompanha a última versão sincronizada.
  - O espelho não guarda o histórico de versões do pedido.
- **Integridade:** nenhuma escrita no Nomus, em pedidos, em parcelas, em vencimentos ou em Contas a Pagar; verificado no teste com PostgreSQL. A única escrita nova é a meta e o seu histórico.

## 6. Validação

- **Testes novos:** 44 testes em 4 arquivos.
  - `purchasePaymentTerms.test.ts` (19), `purchasePaymentTermsBaseAudit.test.ts` (3), `purchasePaymentTermsAnalysis.test.ts` (15), `purchasePaymentTermsList.test.ts` (7).
  - Registrados em `scripts/unit-test-files.txt`.
- **Regressão contra a main** (449 arquivos: lista unitária + Compras/Nomus/Performance): base 5728 testes / 6 falhas → agora 5772 / 6, **0 regressões**.
  - Falhas pré-existentes, inalteradas: `customerCnpjRiskSummary` (1), `permissionContract` (1), `permissionConsistency` (2), `nomusSourceLifecycleContract` (1), `supplyChainParallelWorkflow.e2e` (1).
- **Typecheck:** 1370 erros, igual à base. **Build:** OK.
- **PostgreSQL descartável (PGlite) com rotas e Prisma reais:** 25/25.
  - Grid, ordenação e filtros, incluindo o filtro financeiro existente.
  - Meta com histórico; análise ponderada, cancelados, cobertura, período anterior.
  - Ranking, drill-down, filtro por comprador, detalhe.
  - Contas a Pagar e pedido intocados.
- **Migration:** CHECKs (meta 0–365, singleton); `migrate diff` vazio.
- **Validação visual** (Vite + Chrome headless, dados do teste com PostgreSQL): grid (desktop e 390 px sem overflow), detalhe › Financeiro, Condições de compra com e sem meta, drill-down. Sem erros de console.

## 7. Roteiro de homologação

1. Aplicar a migration `20261010120000_purchase_payment_terms_settings` **antes** do código.
2. Pedidos Nomus:
   - conferir a coluna Prazo de Pagamento em pedidos conhecidos (ex.: PC00632 → `32/62/83/92`, PMP 67);
   - ordenar pelo cabeçalho;
   - filtrar "Não identificado".
3. Abrir um pedido › Financeiro: conferir a coluna "Dias desde a emissão" contra o Nomus.
4. Compras › Performance › Condições de compra:
   - sem meta: KPIs de gap/oportunidade "Indisponível";
   - com um usuário com `approve`, gravar uma meta de teste, conferir o histórico e removê-la (deixar vazio).
5. Escolher um fornecedor do topo e validar o drill-down com os pedidos no Nomus.
6. (Opcional) Rodar o diagnóstico da data-base (item 1.3) e registrar o resultado para a diretoria.
