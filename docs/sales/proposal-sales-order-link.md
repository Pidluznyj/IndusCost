# Vínculo Proposta × Pedido de Venda (Nomus → IndusCost)

Atualizado em 28/10/2026 — branch `fix/proposal-sales-order-link`.

## 1. Diagnóstico

O IndusCost **não recebe do Nomus nenhuma referência explícita** entre pedido e proposta. Os campos lidos hoje
(`scripts/nomusSalesOrdersSyncV1.ts` e `scripts/nomusProposalsSyncV1.ts`) não incluem esse dado, e a API REST do Nomus
não tem documentação pública da relação. O vínculo `SalesOrder.proposalId` sempre foi **deduzido** por cliente + produto.
Pedidos ficavam sem proposta por estes motivos (todos comprovados no código e reproduzidos na auditoria):

| # | Causa | Efeito |
|---|-------|--------|
| 1 | O sync de pedidos regravava `proposalId` a cada execução, inclusive com `null` | vínculo existente sumia quando a dedução ficava ambígua ou a proposta passava a ter "concorrente" |
| 2 | Vaga 1:1 (`proposalId` único): proposta já usada por outro pedido descartava o vínculo em silêncio | pedidos parciais/repetidos da mesma proposta ficavam sem vínculo, sem registro |
| 3 | Dedução por `idProduto` do Nomus | propostas criadas no IndusCost (itens sem `externalProductId`) nunca eram encontradas |
| 4 | Sync de propostas descartava a proposta inteira se UM SKU estivesse inativo no Nomus | proposta inexistente no IndusCost → pedido sem candidato |
| 5 | Sync de propostas bloqueava proposta com cliente/SKU não resolvido, sem registro persistente | idem, sem rastreio |
| 6 | Ponte de clientes das propostas comparava CPF/CNPJ como texto exato (máscara × dígitos) | proposta não importada para clientes cadastrados com máscara |
| 7 | Ponte de clientes dos pedidos: "último vence" entre clientes duplicados com o mesmo documento | pedido e proposta podiam cair em clientes diferentes |

## 2. Política oficial (implementada)

Módulo: `src/lib/sales/proposalSalesOrderLinkPolicy.ts` (função pura) + `proposalSalesOrderLinkWriter.server.ts` (gravação).

Prioridade:
1. **Referência explícita do Nomus** com o mesmo cliente → `CONFIRMED / NOMUS_REFERENCE`. Lista de campos confirmados:
   `src/lib/nomus/nomusProposalOrderReference.ts` — **vazia** até a auditoria (A9) comprovar a chave com dados reais.
2. **Vínculo existente** (manual, gerado pelo IndusCost, Nomus, inferido ou legado) é **preservado**.
3. **Inferência** só quando exatamente uma proposta do mesmo cliente, emitida até a data do pedido (+1 dia de
   tolerância), cobre todas as linhas que encontraram alguma proposta (por **produto local**), e a vaga 1:1 está livre.
4. Caso contrário: sem vínculo, com situação e motivo gravados.

Regras garantidas (testadas): nunca apaga vínculo; nunca troca vínculo (divergência vira `CONFLICT` com
`candidateProposalId`); nunca vincula proposta de outro cliente; cliente + produto nunca é `CONFIRMED`; vínculos
anteriores a esta versão são `LEGACY` (nunca confirmados); idempotente (evento só quando algo muda); concorrência com
lock consultivo por pedido e por proposta (ordem fixa, sem deadlock) e nova tentativa em P2002.

Cardinalidade: `SalesOrder.proposalId` continua 1:1 (a UI depende de `proposal.salesOrder`). Evidência de 1→N fica
registrada como `CONFLICT / PROPOSAL_ALREADY_LINKED_TO_OTHER_ORDER`; de N→1 como
`AMBIGUOUS / LINES_POINT_TO_DIFFERENT_PROPOSALS`. A auditoria (A5/A6) quantifica os dois cenários; mudar a
cardinalidade só com essa evidência e decisão de negócio.

Situações (`SalesOrder.proposalLinkStatus`): `CONFIRMED`, `INFERRED`, `AMBIGUOUS`, `NO_EVIDENCE`, `CONFLICT`.
Origens (`proposalLinkSource`): `NOMUS_REFERENCE`, `MANUAL`, `INDUSCOST_GENERATED`, `INFERRED_ITEMS`, `LEGACY`.
Histórico: `SalesOrderProposalLinkEvent` (só acrescenta). Evidência da última decisão: `proposalLinkEvidence`.

### Clientes (ambos os syncs)
`src/lib/nomus/customerIdentityByDocument.ts` + `src/lib/nomusCustomerBridgeResolution.ts`: histórico de pedidos →
`Customer.nomusExternalPersonId` → CPF/CNPJ **por dígitos**. Mais de um cliente equivalente = conflito, nenhum escolhido:
pedido existente mantém o cliente gravado; pedido novo fica bloqueado (`CUSTOMER_IDENTITY_CONFLICT`); proposta fica
pendente. Nenhum cliente é criado. Só resoluções positivas ficam em cache de memória.

### Propostas
- SKU inativo no Nomus com produto no IndusCost: item importado e marcado (`ProposalItem.nomusProductInactive`).
- SKU sem cadastro local / cliente não resolvido / conflito: proposta não é importada pela metade; pendência em
  `NomusProposalImportIssue` (motivos, SKUs, ocorrências, `resolvedAt` quando for importada). Proposta inexistente é
  candidata em toda execução, então a pendência é reavaliada sozinha.
- Nenhum identificador externo é inventado para produto local.

### Itens do pedido
`SalesOrderItem.proposalItemId` já gravado é preservado (`buildNomusSyncItemWritePlan`).

### Pedido gerado no IndusCost
`POST /api/proposals/:id/generate-sales-order`: trava a vaga da proposta, grava `INDUSCOST_GENERATED / CONFIRMED` e
evento; geração concorrente devolve o pedido já existente.

## 3. Auditoria somente leitura

Arquivo: `scripts/audit-proposal-sales-order-link.sql` — `BEGIN … READ ONLY`, `statement_timeout` 120 s,
`lock_timeout` 3 s, só `SELECT`, PostgreSQL 12 e 17, **roda antes da migration**. Saída sem nome de cliente e com
documento mascarado; payloads só com nomes de chaves.

Seções: A0 alvo (banco/versão) · A1 totais e % vinculados · A2 pedidos sem vínculo por motivo · A3 vínculos
potencialmente incorretos · A4 vínculos desaparecidos · A5 propostas com vários pedidos candidatos · A6 pedidos com
várias propostas candidatas · A7 propostas descartadas por motivo · A8 clientes com documento equivalente ·
A9 chaves candidatas a referência explícita nos payloads.

> Produção AWS = PostgreSQL 17, banco `teste_bi`. **Não confundir** com o PostgreSQL 12 legado do servidor-01.
> Conferir a seção A0 (banco e versão) antes de ler os resultados.

Produção (AWS, PostgreSQL 17, `teste_bi`, somente leitura — usuário/host de leitura da operação):

```bash
PGOPTIONS='-c default_transaction_read_only=on' psql "host=<HOST_RDS> port=5432 dbname=teste_bi user=<USUARIO_LEITURA> sslmode=require" -X -v ON_ERROR_STOP=1 -f scripts/audit-proposal-sales-order-link.sql > auditoria-vinculo-proposta-prod.txt
```

Homologação (PostgreSQL 17, porta 5433, `teste_bi_homolog`, usuário local `pg17homolog`, socket `/run/induscost-pg17`):

```bash
PGOPTIONS='-c default_transaction_read_only=on' psql -h /run/induscost-pg17 -p 5433 -U pg17homolog -d teste_bi_homolog -X -v ON_ERROR_STOP=1 -f scripts/audit-proposal-sales-order-link.sql > auditoria-vinculo-proposta-homolog.txt
```

O que habilita a referência explícita: se A9 mostrar, no pedido ou no item do pedido, uma chave numérica/texto que
identifique a proposta (e a conferência de 5 a 10 pedidos no Nomus confirmar o valor), acrescentar o campo em
`NOMUS_CONFIRMED_PROPOSAL_REFERENCE_FIELDS` com teste de contrato usando payload real anonimizado. Se a chave estiver
no payload da **proposta** apontando para o pedido, é preciso implementar o leitor reverso. Sem isso, a inferência
conservadora é o limite do que o sistema pode afirmar.

## 4. Reconciliação

`scripts/reconcileProposalSalesOrderLinks.ts` (exige a migration aplicada):

```bash
npx tsx scripts/reconcileProposalSalesOrderLinks.ts
```

DRY-RUN (padrão): grava `tmp/proposal-link-reconcile/dry-run-<data>.json|.csv` com pedido, proposta atual, candidata,
evidência (linhas casadas/sem casamento, nº de candidatas), situação, motivo e ação; totais de novos vínculos
aplicáveis, preservados, conflitos e inconclusivos; `planHash`.

APPLY (autorização explícita; nunca em produção/homologação sem aprovação):

```bash
npx tsx scripts/reconcileProposalSalesOrderLinks.ts --apply --confirm=<planHash> --authorized-by=<nome> [--manual=revisao.json]
```

Aplica só `APPLY_EXPLICIT` (referência explícita, mesmo cliente, vaga livre) e `MANUAL` (arquivo revisado:
`[{ "salesOrderId", "proposalId", "reviewer", "note"?, "replaceExisting"? }]`). Recalcula o plano e recusa se o hash
mudou; uma transação por pedido, com os mesmos locks do sync; eventos com `runId`. Inferências nunca são aplicadas
pela reconciliação.

Reversão:

```bash
npx tsx scripts/reconcileProposalSalesOrderLinks.ts --revert=<runId> --authorized-by=<nome>
```

Restaura cada pedido do APPLY só se o vínculo ainda estiver como o APPLY deixou; grava evento `REVERTED`.

## 5. Implantação (quando autorizada)

1. Rodar a auditoria (seção 3) em homologação e produção e guardar a saída.
2. Aplicar a migration `20261102120000_proposal_sales_order_link_traceability` **antes** do código (colunas novas
   anuláveis/default; `ADD COLUMN … DEFAULT false` é só metadado no PostgreSQL 11+).
3. Implantar o código. O primeiro sync de pedidos classifica os pedidos tocados (vínculos existentes → `LEGACY`).
4. Rodar o DRY-RUN da reconciliação em homologação e revisar `REVIEW_CONFLICT` / `REVIEW_AMBIGUOUS`.

## 6. Rollback

1. Voltar o código anterior.
2. (Opcional) Desfazer vínculos criados pela nova política: APPLY da reconciliação via `--revert=<runId>`; vínculos
   inferidos pelo sync podem ser listados por
   `SELECT "salesOrderId", "newProposalId" FROM "SalesOrderProposalLinkEvent" WHERE kind = 'LINKED' AND actor = 'nomus-sales-orders-sync'`
   e revertidos com autorização (o código anterior também infere, então em geral não é necessário).
3. `docs/sales/proposal-sales-order-link.rollback.sql` e remover a linha da migration em `_prisma_migrations`.
   Testado em PostgreSQL 17 com dados: rollback + reaplicação reconstroem o schema idêntico e preservam os vínculos.

## 7. Riscos residuais

- Sem referência explícita comprovada, pedidos com várias propostas possíveis ficam `AMBIGUOUS` (não há como decidir sem
  o dado do Nomus ou revisão manual).
- `SalesOrderItem.proposalItemId` de linhas novas segue a dedução por linha anterior (cliente + `idProduto`), mesmo quando
  o cabeçalho fica ambíguo; foi mantido para não alterar margens calculadas por item. Valores existentes não mudam mais.
- O sync de propostas continua recriando itens de propostas sem pedido vinculado (ids de `ProposalItem` mudam nesses
  casos), comportamento anterior.
- Proposta com SKU sem cadastro local continua fora do IndusCost (agora registrada em `NomusProposalImportIssue`).
- Pedido novo de cliente com cadastro duplicado (mesmo documento) fica bloqueado até o cadastro ser saneado.
