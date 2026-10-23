# Comissões — plano de implantação do pagamento por direito (N:N)

Situação em 23/10/2026, branch `feat/commission-nn-cardinality` (sem commit). Documento separado, como pedido no
gate de homologação: a integração do pagamento com o direito econômico **não está completa**.

## 1. Como é hoje

```
Pedido → NF-e → título → recebimento → direito (schedule) → linha do ledger (CLOSED) → valor a pagar do vendedor
                                                                                       ╳  (sem elo)
CommissionRecord (cálculo por item, legado) → CommissionPaymentBatchItem → CommissionPaymentBatch (PAID)
```

- O fechamento oficial (por recebimento) grava **linhas de ledger por (recebimento, pedido)**, com pedido, schedule,
  snapshot, vendedor canônico e valor liberado. O "valor a pagar" do mês sai daí
  (`getMonthlyPayableFromClosedReceiptLedger`).
- O lote de pagamento paga **`CommissionRecord`** (`releasedAmount − paidAmount`), produzido pelo cálculo legado por
  item/NF-e. Ele não conhece o direito do fechamento: não sabe da retenção R1, da alocação B5, nem de qual vendedor é
  cada pedido de um título compartilhado.

Riscos que isso abria (todos reproduzidos em teste):

| Risco | Exemplo |
|---|---|
| Pagar o integral de pedido retido/parcial | pedido em 3 NF-e: 3 registros de R$ 1.200 contra R$ 800 liberados |
| Pagar duas vezes a mesma comissão | segundo registro do mesmo pedido em outro lote |
| Pagar ao vendedor errado | registro do pedido de A no lote de B, em título compartilhado |
| Pagar competência ainda não fechada | lote de período sem fechamento CLOSED |

## 2. O que já foi feito (controle provisório, nesta branch)

Guarda `assertCommissionPaymentWithinOfficialClosing` (`commissionPaymentClosingGuard*.ts`), chamada na criação e
de novo no pagamento do lote, dentro da transação:

- toda competência do período do lote precisa ter fechamento **CLOSED**;
- por (vendedor, pedido): `comprometido em outros lotes ativos + solicitado ≤ Σ liberado nas linhas COMMISSIONABLE
  dos fechamentos CLOSED até o fim do período`;
- registro sem pedido é recusado (não rastreável ao direito).

Flag `COMMISSION_PAYMENT_CLOSING_GUARD_ENABLED` (padrão ligada; `false` volta ao comportamento anterior). Testes:
6 unitários e 4 de ponta a ponta no PostgreSQL 17 (rastreio pedido → … → lote; recusa de R1, duplicata, vendedor
errado e mês aberto).

**Limite do controle provisório:** o teto é por (vendedor, pedido), não por linha de ledger. Não diz *qual*
recebimento foi pago e não impede um registro legado de um pedido consumir o liberado de outro título do mesmo
pedido. Por isso a integração não é declarada completa.

## 3. Alvo

```
linha do ledger CLOSED (direito liberado) ──1:N──▶ CommissionPaymentBatchItem (receiptLedgerLineId) ──▶ lote
Σ itens ativos por linha ≤ releasedCommissionAmount da linha
```

- O item do lote referencia a **linha do ledger** (direito de um pedido num recebimento, competência fechada).
- Valor a pagar = liberado da linha − Σ itens ativos (pago ou a pagar) daquela linha.
- Lista de "a pagar" vem do ledger (mesma fonte do valor a pagar do mês), por vendedor, competência, pedido e título.
- `CommissionRecord` continua existindo para o histórico; deixa de ser fonte de pagamento em competência oficial.

## 4. Implantação proposta (para aprovação separada)

| Etapa | Conteúdo | Banco |
|---|---|---|
| P1 | Migration aditiva: `CommissionPaymentBatchItem.receiptLedgerLineId UUID NULL` + FK para `CommissionReceiptLedgerLine` (ON DELETE RESTRICT) + índice; `commissionRecordId` passa a NULL-able. Sem backfill: lotes existentes continuam ligados a `CommissionRecord`. | sim |
| P2 | Serviço novo `listPayableLedgerLines` / `createPaymentBatchFromLedger`: só linhas COMMISSIONABLE de fechamentos CLOSED do vendedor; trava `SELECT … FOR UPDATE` nas linhas escolhidas; valida `Σ ≤ liberado` dentro da transação. | não |
| P3 | Trigger de integridade (mesmo padrão da cobertura): recusa item que faça `Σ itens ativos da linha > releasedCommissionAmount`, com `pg_advisory_xact_lock` por linha — protege contra dois processos pagando a mesma linha. | sim |
| P4 | Tela de pagamentos lista linhas do ledger (pedido, NF-e, título, recebimento, vendedor); lote legado continua visível só leitura. Flag `COMMISSION_PAYMENT_BY_LEDGER_ENABLED`. | não |
| P5 | Conciliação: relatório por vendedor/competência `liberado no ledger × pago por linha × pago por registro legado` (somente leitura) para fechar a transição. | não |

Testes obrigatórios (mesma infraestrutura PostgreSQL 17 descartável): N pedidos e vendedores no mesmo título;
pagamento parcial em dois lotes; dois processos pagando a mesma linha (um recusado pela trava); cancelamento do lote
devolve o saldo da linha; competência CLOSED reprocessada (linha substituída não pode ser paga); rollback.

Rollback: desligar a flag (volta ao lote por `CommissionRecord` + guarda provisória); a coluna nova é nula nos lotes
antigos, então o `DROP` da coluna/trigger é seguro enquanto nenhum lote por linha tiver sido criado (checagem SQL antes).

## 5. Decisões pendentes

- Pagamento de competência reprocessada depois de paga (linha CLOSED substituída): estorno, ajuste ou bloqueio.
- Pagamento parcial de uma linha: permitido (como hoje no registro) ou só integral.
- Desligar de vez o pagamento por `CommissionRecord` em competência oficial (sugestão: depois de P5 conciliado).
