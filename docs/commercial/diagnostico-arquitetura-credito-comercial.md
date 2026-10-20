# Diagnóstico — crédito comercial, CNPJ e contas a receber

Data: 2026-10-19. Base lida: `origin/main` `ca8db5d9471baec1eb7c3674c86ae06e6631ba37`.

Leitura de arquitetura. Nenhuma regra comercial nova foi implementada. Nenhum registro financeiro foi alterado e não houve deploy. Não foi criada fonte paralela de Contas a Receber, cliente ou pedido.

## Conclusão

O IndusCost já tem dois vereditos comerciais independentes. Eles não se consultam.

| Veredito | Motor | Efeito hoje |
|---|---|---|
| Score cadastral, inclusive **VENDA LIBERADA** | `calculateCommercialRiskScore` sobre o CNPJ público | Só exibição e cache. Não impede proposta nem pedido. |
| Trava **Venda bloqueada** | `assertCustomerSalesAllowed` sobre boleto vencido oficial | Impede apenas `POST /api/proposals/:id/generate-sales-order`. |

A fonte oficial de títulos é o stage Nomus: `NomusAccountsReceivable` e `NomusReceivableReceipt`. Qualquer regra futura de inadimplência, baixa ou recebimento parcial deve ler esses modelos e os classificadores já existentes.

## 1. Consulta CNPJ e inteligência comercial

Fluxo:

```text
UI (CustomerCnpjIntelligencePanel)
  → GET /api/company-intelligence/cnpj/:cnpj
  → GET /api/customers/:id/company-intelligence
  → buildCompanyIntelligencePayload (companyCnpjLookup.ts)
      → cache CustomerCnpjLookup se expiresAt > agora (TTL 24h)
      → senão aggregateCnpjIntelligence
      → calculateCommercialRiskScore + buildCommercialInsightsBundle
      → INSERT CustomerCnpjLookup
```

O browser não chama BrasilAPI nem publica.cnpj.ws. Os hosts ficam no backend.

| Peça | Arquivo |
|---|---|
| Rotas | `src/lib/companyIntelligenceRoutes.ts`, registro em `server.ts` |
| Orquestração e cache | `src/lib/companyCnpjLookup.ts` |
| Agregador | `src/lib/companyCnpjAggregator.ts` |
| Normalização | `src/lib/companyCnpjNormalize.ts` |
| Insights (porte, CNAE, UF) | `src/lib/companyCommercialInsights.ts` |
| Comparar/aplicar no cliente | `src/lib/companyCnpjCompare.ts` |
| Tag no grid | `src/lib/customerCnpjRiskSummary.ts`, `src/components/customers/CustomerCnpjRiskTag.tsx` |
| Painel e impressão | `src/components/customers/CustomerCnpjIntelligencePanel.tsx`, `CnpjCommercialIntelligencePrintReport.tsx` |
| Modelo | `CustomerCnpjLookup` (`prisma/schema.prisma`) |
| Relato anterior | `docs/generated/cnpj-multi-source-intelligence-report.md` |

`CustomerCnpjLookup` guarda `rawJson` (envelope `aggregateVersion: 1`), `normalizedSummary`, `riskScore`, `riskVerdict`, `riskDetails`, `commercialInsights`, `source`, `fetchedAt`, `expiresAt`. O vínculo com o cliente é `customerId` opcional. Sem `customerId`, a tag do grid casa pelo CNPJ normalizado de `Customer.taxId`, nunca pelo nome.

Aplicar dados públicos ao cadastro exige `customers.edit` e campos selecionados. Telefone e e-mail comerciais só entram com `confirmPublicContactOverwrite`.

## 2. Score e “VENDA LIBERADA”

Motor puro: `src/lib/companyCommercialRiskScore.ts`.

Pontos máximos: situação cadastral 40, senioridade 20, capital social 20, porte 10, estrutura societária 10. Situação diferente de ATIVA zera o bloco cadastral e limita o score a 1.

| Condição | Veredito | Nível |
|---|---|---|
| Cadastro inativo | VENDA BLOQUEADA | Crítico |
| Score &lt; 55 | APENAS PAGAMENTO ANTECIPADO | Alto |
| Score 55–81 | VENDA CONDICIONADA | Médio |
| Score ≥ 82 | VENDA LIBERADA | Baixo |

Telefone e e-mail públicos não entram no score. O grid não recalcula: mostra a última consulta persistida e marca TTL vencido sem inventar score.

Esse veredito **não** é a trava de venda. A trava está em `src/lib/commercial/customerSalesBlock.ts` e usa somente boleto vencido do AR oficial (`paymentMethodId = 10`, saldo &gt; 0, vencimento anterior a hoje, título elegível em `filterOfficialArOverdueTitles`). Identidade financeira inválida também bloqueia, sem afirmar dívida. Documento: `docs/commercial/customer-overdue-boleto-sales-block.md`.

## 3. BrasilAPI, publica.cnpj.ws e Banco Central

| Fonte | Cliente | Papel | HTTP na consulta CNPJ |
|---|---|---|---|
| BrasilAPI | `src/lib/companyCnpjBrasilApi.ts` — `https://brasilapi.com.br/api/cnpj/v1/{cnpj}` | Identidade, CNAE, endereço, situação | Sim, em paralelo |
| publica.cnpj.ws | `src/lib/companyCnpjPublicaWs.ts` — `https://publica.cnpj.ws/cnpj/{cnpj}` | QSA, IE, telefone, e-mail | Sim, em paralelo |
| BCB | `src/lib/companyCnpjSources.ts` | Reservada | Não. Status `not_applicable` |

Precedência em `CNPJ_FIELD_PRECEDENCE`: identidade cadastral prefere BrasilAPI; telefone, e-mail, IE e sócios preferem publica.cnpj.ws. Sócios e CNAEs secundários são união. Se uma fonte falha e a outra responde, a consulta segue com `partialSuccess`. Se as duas falham, o agregador devolve 404, 429, 504 ou 502.

`not_applicable` do BCB é decisão de escopo, não falha de rede. SELIC, IPCA e câmbio não identificam empresa. O câmbio PTAX (`src/lib/materialMarketPtax.ts`, Olinda/BCB) é outra integração e não alimenta o CNPJ.

Cache legado de fonte única continua legível: o envelope sem `aggregateVersion` é tratado como publica.cnpj.ws.

## 4. Contas a receber do Nomus

Fonte única de fato financeiro a receber:

| Modelo | Papel |
|---|---|
| `NomusAccountsReceivable` | Stage do título (`contasReceber`). `externalId` único. `personId`, `personCnpj`, valores, `dueDate`, `settlementDate`, `status` booleano, `suspendCollection`, `rawPayload`. |
| `NomusReceivableReceipt` | Evento `recebimentos`. `receiptDate` é a data de caixa. Vários recebimentos por título. |

Sync: `scripts/nomusAccountsReceivableSync.ts`, `src/lib/nomusAccountsReceivableSyncRunner.ts`, `src/lib/nomusAccountsReceivableSyncLogic.ts`, disparo em `src/lib/settingsNomusSyncRoutes.ts`. O stage é espelho. A trava comercial e os dashboards leem; não gravam baixa no Nomus.

Rotas de leitura (permissão do recurso de Contas a Receber):

- `GET /api/finance/accounts-receivable/dashboard`
- `GET /api/finance/accounts-receivable/titles`
- `GET /api/finance/accounts-receivable/overdue` e export xlsx
- `GET /api/nomus/accounts-receivable/summary` (relatórios / settings Nomus)

UI: `src/components/finance/FinanceAccountsReceivablePage.tsx`.

Classificação oficial do título (`classifyFinanceArTitle` em `src/lib/financeAccountsReceivableDashboard.ts`):

| Situação de negócio | Como o motor classifica hoje |
|---|---|
| Vencido | Aberto, `dueDate` civil anterior a hoje → `overdue`. A visão gerencial ainda exige NF (`isOfficialArOverdueTitle`). Sem NF, o vencido sai do relatório gerencial e não trava a venda. |
| Baixado / recebido | `settled` se saldo ≤ 0, **ou** `settlementDate` preenchida, **ou** `amountReceived` ≥ `amountReceivable`. `settlementDate` é baixa administrativa. Competência de comissão usa `NomusReceivableReceipt.receiptDate`, não a baixa. |
| Parcialmente recebido | Não há status próprio. Saldo &gt; 0 com `amountReceived` &gt; 0 e sem baixa permanece `open` / `overdue` / `upcoming`. A trava de boleto usa o saldo restante. O balde `partiallyReceived` existe só na auditoria `src/lib/commissions/nomusReceivableStatusAudit.ts`. |
| Suspenso | `suspendCollection` e ainda não liquidado → `suspended`. Não entra como vencido oficial. |
| Protestado | Não existe modelo, campo, classificador, rota nem teste. Busca por `protest` em `src/` e no schema não achou ocorrência. `rawPayload` pode conter o dado na origem, mas ninguém o interpreta. |

`NomusAccountsReceivable.status` (booleano Nomus) não é o status do dashboard. A auditoria `nomusReceivableStatusAudit.ts` só descreve o que o booleano parece significar; não é regra de negócio.

## 5. Propostas, pedidos e aprovação

| Peça | Onde |
|---|---|
| `Proposal` / `ProposalStatus` | `DRAFT`, `ANALYSIS`, `SENT`, `APPROVED`, `REJECTED`, `EXPIRED`, `CANCELED` |
| `SalesOrder` / `SalesOrderStatus` | `DRAFT`, `READY_TO_SEND`, `SENT_TO_NOMUS`, `CANCELLED`, `ERROR` — não há status “aprovado” no pedido |
| Rotas | `server.ts`: `/api/proposals`, `PATCH /api/proposals/:id/status`, `POST /api/proposals/:id/generate-sales-order`, `/api/sales-orders` |
| UI | `src/components/ProposalModule.tsx` |

Proposta oficial entra pelo Nomus. Criar, alterar, excluir ou mudar status na mão exige `SUPER_ADMIN` (`requireProposalManualWrite`). O `PATCH` de status aceita qualquer valor do enum: não há máquina de estados nem checagem de score.

Gerar pedido local exige proposta `APPROVED`, itens com produto, quantidade e preço, e `assertCustomerSalesAllowed`. O pedido nasce `READY_TO_SEND`, 1:1 com a proposta (`proposalId` único). Pedido já existente devolve 200. Sync inbound do Nomus não passa pela trava.

Não há workflow de aprovação de crédito separado da troca de status da proposta.

## 6. Cliente por CNPJ e vínculos societários

Identidade oficial do cliente: `Customer.taxId` único (CNPJ ou CPF). Pessoa física pode ter `personId`. Pessoa jurídica não usa esse vínculo como identidade da empresa.

Identidade financeira da trava: `Customer.nomusExternalPersonId` (Nomus `idPessoa`), escrito pelo sync de clientes. `SalesOrder.externalCustomerId` só denuncia conflito. AR é lido por `personId`, não por nome. Dois homônimos não compartilham dívida.

Ponte Nomus → cliente (`src/lib/nomusCustomerBridgeResolution.ts`): pedido já ligado ao mesmo `Customer.id`; senão CNPJ/CPF em `/pessoas`; depois `Customer.taxId`. Conflito não escolhe um lado.

QSA chega como lista `{ name, role }` dentro do JSON da consulta. Não há CPF/CNPJ do sócio, grafo de empresas ligadas, nem match entre clientes pelo quadro societário. Raiz do CNPJ (oito primeiros dígitos) não é entidade.

`groupCompanyCustomer.ts` é lista fixa de CNPJs do grupo econômico para excluir intercompany. Não é grupo de crédito de cliente.

## 7. Permissões

| Ação | Permissão |
|---|---|
| Ver consulta CNPJ | `customers.view` ou `crm.view` ou `crm.customer_cockpit.view` |
| Atualizar consulta do cliente | `customers.view` |
| Aplicar no cadastro | `customers.edit` |
| Criar cliente a partir da consulta | `customers.create` |
| Ver valores da trava | `finance.accountsReceivable.view` |
| Contas a receber | recurso `accountsReceivable`: view / export; sync `finance.accountsReceivable.sync` |
| Propostas | recurso `commercial.proposals`: `proposals.view/create/edit/delete/print` |
| Pedidos | recurso `commercial.sales_orders` e `sales_orders.view` |

Catálogo: `src/lib/permissionCatalog.ts`, `src/lib/security/permissionContract/resources.ts`.

## 8. Testes já existentes

| Tema | Arquivos |
|---|---|
| Agregador e BrasilAPI | `src/lib/companyCnpjAggregator.test.ts`, `companyCnpjBrasilApi.test.ts` |
| Score, insights, apply | `src/lib/companyIntelligence.test.ts` |
| Tag e vínculo por CNPJ | `src/lib/customerCnpjRiskSummary.test.ts`, `src/components/customers/CustomerCnpjRiskTag.test.tsx` |
| Trava de boleto | `src/lib/commercial/customerSalesBlock.test.ts`, `.server.test.ts`, `customerSalesBlockUi.test.tsx` |
| Classificação AR | `src/lib/financeAccountsReceivableDashboard.test.ts`, `financeAccountsReceivableRulesEngine.test.ts` |
| Sync Nomus | `src/lib/nomusAccountsReceivable.test.ts` |

Não há teste de protesto. Não há teste que faça o score CNPJ bloquear a geração do pedido — porque o código não faz isso.

## Plano para os próximos prompts

Não criar ledger, cliente ou pedido paralelo. Não escrever em `NomusAccountsReceivable`, custo, preço ou Contas a Pagar.

### Dependências que já bastam

- Fatos de título: `NomusAccountsReceivable` + `NomusReceivableReceipt`.
- Vencido gerencial: `filterOfficialArOverdueTitles`.
- Trava de venda: `assertCustomerSalesAllowed`.
- Cadastro público e score: `CustomerCnpjLookup` + `calculateCommercialRiskScore`.
- Identidade: `Customer.taxId` e `Customer.nomusExternalPersonId`.

### Lacunas reais (ainda sem código)

1. **Protesto** — falta fonte interpretada. Antes de coluna ou regra, um script somente leitura tem de mostrar o campo no `rawPayload` (ou a ausência dele). Sem isso, protesto não entra no classificador.
2. **Parcial** — o saldo restante já conta como aberto. Se a regra nova precisar do rótulo “parcialmente recebido”, a função pura deve ficar ao lado de `classifyFinanceArTitle`, sem novo status no Nomus.
3. **Score como política de venda** — se “VENDA LIBERADA” passar a condicionar pedido, a composição entra em `assertCustomerSalesAllowed`. Não criar segunda trava nem gravar o veredito em `Customer.status`.
4. **Vínculo societário** — só se o próximo prompt pedir. Read model sobre o QSA já salvo e `Customer.id` / `taxId`. Sem cadastro paralelo de empresa ou sócio.
5. **BCB** — permanece `not_applicable` até existir endpoint cadastral no escopo. Não reutilizar PTAX como se fosse ficha de CNPJ.

### Sequência sugerida

1. Confirmar, em leitura, se o payload Nomus traz protesto.
2. Especificar a regra comercial em função pura, com testes, reusando os classificadores.
3. Só então ligar a regra no único hard block (`generate-sales-order`) e na UI que já mostra `salesBlock` e a tag de score.
4. Migration apenas se o passo 1 provar um fato que o JSON atual não preserva com segurança. Aditiva. Sem backfill em produção neste ambiente.

### Riscos

- Tratar “VENDA LIBERADA” como liberação financeira. Hoje ela ignora boleto, atraso e protesto.
- Tratar `settlementDate` como recebimento de caixa. Caixa é `receiptDate`.
- Cruzar dívida por nome ou por rótulo “boleto”. A trava usa `personId` e `paymentMethodId = 10`.
- Cache de 24h: a tag pode mostrar score vencido até o refresh.
- `PATCH` de status da proposta não valida crédito.
- Vencido sem NF não bloqueia venda. É regra atual do motor gerencial, não omissão acidental desta leitura.
- Contrato visual do grid (`customerCnpjRiskSummary.test.ts`) já falha em `origin/main`: o teste espera 6 `<col>` e o `CustomerModule` tem 7. Fora deste escopo; não foi alterado.

## Preparação de código

Nenhum stub, flag ou tabela nova. Os motores, rotas, permissões e testes desta arquitetura já existem. Código novo só se justifica quando a regra comercial do próximo prompt estiver definida.

## Verificação desta leitura

Comando (sem banco e sem escrita):

```text
node --import tsx --test
  src/lib/companyCnpjAggregator.test.ts
  src/lib/companyCnpjBrasilApi.test.ts
  src/lib/companyIntelligence.test.ts
  src/lib/customerCnpjRiskSummary.test.ts
  src/lib/commercial/customerSalesBlock.test.ts
  src/lib/financeAccountsReceivableDashboard.test.ts
  src/lib/financeAccountsReceivableRulesEngine.test.ts
  src/lib/nomusAccountsReceivable.test.ts
```

Resultado: 174 passaram, 1 falhou. A falha é o contrato de colunas do grid citado acima. Os testes de agregador, score, BCB `not_applicable` (dentro do agregador), trava de boleto, vencido/baixado e sync Nomus passaram.

Não foi executado `prisma migrate`, sync Nomus, typecheck completo nem build. O lint do repositório já falha por script avulso pré-existente, fora deste diagnóstico.
