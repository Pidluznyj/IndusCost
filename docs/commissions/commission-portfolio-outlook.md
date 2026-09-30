# Comissões › Previsão — regra da comissão ainda a receber

Correção de 30/09/2026. A tela responde a uma pergunta: **quanto de comissão o vendedor ainda tem
vinculada aos CRs que continuam em aberto?** Ela não recalcula percentual, não fecha competência, não
cobre recebimento e não paga. O fechamento por recebimento (validado contra o Nomus) não foi alterado.

## O que estava errado

A previsão era `comissão atribuída ao CR − comissão realizada pelos eventos de recebimento`, e o card
"Total esperado" somava realizado + previsto. Três defeitos inflavam o número:

1. **Versões substituídas do pedido.** O loader não aplicava `commissionActiveSnapshotWhere()`. Quando
   um pedido é rematerializado, o snapshot antigo vira `SUPERSEDED`, mas os schedules dele continuam
   `ACTIVE`; a previsão somava a comissão do mesmo título uma vez por versão. O fechamento já descartava
   essas versões (`commissionScheduleVigency.ts`).
2. **Saldo do título ignorado.** `NomusAccountsReceivable.balanceReceivable` era carregado, mas não
   entrava na conta. Título quitado com desconto, baixado sem evento de recebimento ou com evento
   faltando em `NomusReceivableReceipt` continuava com "previsto".
3. **Título cancelado ou com cobrança suspensa.** O fechamento os deixa de fora
   (`status = false`, `suspendCollection = true`); a previsão os contava.
4. **Exceções por cliente e empresas do grupo.** A previsão só olhava o status do schedule. Um schedule
   materializado antes da regra de Exceções continuava `ACTIVE` e gerava previsão; o fechamento aplica a
   regra viva. Agora o loader aplica as regras ativas na data da venda (mesma aplicação da Provisão por
   pedido: `resolveCustomerExclusionForSale`) e o teste de empresa do grupo
   (`isCommissionInternalGroupReceivable`).

## Regra atual

Por título (CR), na versão vigente do pedido:

```
saldo em aberto   = balanceReceivable da origem (sem ele: original − recebido), entre 0 e o nominal
futura pelo saldo = comissão atribuída × saldo em aberto / nominal
comissão futura   = min(futura pelo saldo, comissão atribuída − comissão realizada)
```

- É a mesma proporção pelo principal usada na liberação (`computeCommissionReleasedFromReceivablePrincipal`)
  e o mesmo saldo de `resolveOpenReceivableBalance` / `forecastCommissionFromMaterializedSchedule` do
  motor; os testes fixam a equivalência.
- **Quitado** (saldo 0): futura = 0. **Integralmente em aberto**: futura = atribuída. **Parcial**:
  proporcional ao saldo.
- **Juros e multa** não aumentam comissão: o saldo é limitado ao nominal e o recebido acima do original
  é excedente.
- **Desconto / abatimento**: o título quitado por menos não deixa comissão futura; a parte da comissão
  sobre o desconto nunca é liberada (regra já existente do fechamento).
- **Baixa sem evento de recebimento**: não inventa recebimento nem comissão futura; a linha fica como
  "Baixa sem recebimento".
- **Título não encontrado ou removido na origem** (`MISSING_CONFIRMED`): futura = 0, com o motivo na linha.
- **Um schedule por título**: havendo mais de um vigente, vale o mais recente `ACTIVE`, a mesma escolha
  de `pickMaterializedScheduleForReceivable`.
- A diferença entre o que os eventos deixam por realizar e o que o saldo sustenta aparece na linha como
  `unreconciledCommission` ("fora da previsão") e no aviso da tela. Não entra em nenhum total.

Invariantes (`outlookInvariantsHold`): `0 ≤ futura ≤ atribuída`, `realizada + futura + fora da previsão ≤
atribuída`, e sem saldo em aberto não existe comissão futura.

## Tela

- **Comissão ainda a receber** (destaque): só a comissão futura. Ao lado, **A vencer** e **Vencida e não
  recebida** (que fazem parte dela).
- **Comissão já realizada**, em bloco separado e nunca somada à futura: **Realizada aguardando
  fechamento**, **Liberada e ainda não paga**, **Paga**. O "Realizado no período" é uma linha de histórico.
- Não existe mais "Total esperado" (realizado + previsto) no payload nem na tela.
- A timeline mostra "Ainda a receber" por mês de vencimento e "Já realizado (histórico)" por mês de
  recebimento, sem coluna de soma.
- O período continua começando em 09/2026 (ver `commission-coverage-cutover.md`). Título em aberto que
  venceu antes de 09/2026 continua fora do período da tela; a auditoria informa esse valor.

## Auditoria read-only

`scripts/auditCommissionOutlookOpenBalance.ts` compara, CR a CR, a regra antiga com a nova, sem gravar
nada no banco (só `findMany`; escreve um CSV local):

```
npx tsx scripts/auditCommissionOutlookOpenBalance.ts [--seller=<id Nomus ou parte do nome>] [--from=2026-09] [--to=AAAA-MM] [--top=30] [--csv=arquivo.csv]
```

Mostra a previsão pela regra antiga, a recalculada, a diferença por causa (versão substituída,
duplicidade, falta de receipt, desconto, cancelado, baixa sem receipt…), por vendedor e os CRs que mais
pesam. O cálculo fica em `commissionPortfolioOutlookAudit.ts` e é coberto por teste.

## Fora do escopo desta correção

- O fechamento, o ledger, a cobertura, os pagamentos, os percentuais e o cutover não mudaram.
- Schedule `ACTIVE` zerado: o fechamento substitui pelo valor do snapshot
  (`resolveEffectiveScheduledCommissionAmount`); a previsão continua usando `scheduledCommissionAmount`.
- Schedules de títulos cancelados/renegociados continuam `ACTIVE` no banco até um novo rebuild; a
  previsão só deixa de contá-los na leitura.
