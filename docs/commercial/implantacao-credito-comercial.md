# Implantação controlada — crédito comercial

Branch de referência: `feat/analise-inadimplencia-comercial`.
Nenhuma migration desta entrega foi aplicada. Não fazer deploy em produção nesta etapa.

## O que entra

O motor único `decideCommercialCredit` lê Contas a Receber já sincronizadas do Nomus, ocorrências de crédito, protesto externo e vínculo societário. A venda a prazo é barrada em:

- `POST /api/proposals/:id/generate-sales-order`
- `POST /api/proposals` quando nasce aprovada
- `PUT /api/proposals/:id` ao aprovar, trocar prazo ou trocar cliente de proposta aprovada
- `PATCH /api/proposals/:id/status` ao aprovar

O espelho de pedido vindo do Nomus só cria pedido com documento externo (`assertExistingNomusObligationMirror`). Consultar crédito não altera pedido e não envia notificação.

## Migrations, nesta ordem

Aplicar só em homologação, com backup:

1. `20261022120000_commercial_credit_decision`
2. `20261022130000_commercial_credit_occurrence`
3. `20261022140000_external_protest_consultation`
4. `20261022150000_commercial_corporate_membership`
5. `20261022160000_commercial_credit_evaluation`

São aditivas: criam tabela e índice. Não alteram `NomusAccountsReceivable`, pedido, proposta nem saldo.

```bash
npx prisma migrate deploy
```

Sem essas tabelas, a decisão de prazo pode falhar ao ler ocorrência, vínculo ou histórico. O histórico de avaliação, se a tabela ainda não existir, não impede a decisão: a gravação é engolida e a recusa continua valendo.

## Protesto externo

Permanece desligado. `EXTERNAL_PROTEST_ENABLED` não deve ser `true` sem contrato, credencial de homologação e especificação oficial. Consulta desligada ou falha não significa “sem protesto”.

## Permissões

Ver crédito: `customers.view`, `crm.view` ou `crm.customer_cockpit.view`.
Ver valor vencido: permissão de Contas a Receber.
Conceder exceção ou registrar ocorrência: `commercial.credit.exception.grant` ou `commercial.credit.exception.grant.board`, atribuídas de fato. O papel SUPER_ADMIN sozinho não concede.

## Rollback

1. Reverter o deploy da aplicação para o release anterior.
2. Não apagar as tabelas novas no primeiro rollback: elas não são lidas pelo release antigo.
3. Se for necessário remover a estrutura, fazer em janela própria, com backup, e somente destas tabelas: `CommercialCreditEvaluation`, `CommercialCorporateMembership`, `CommercialExternalProtestConsultation`, `CommercialCreditOccurrenceEvidence`, `CommercialCreditOccurrence`, `CommercialExternalProtest`, `CustomerCorporateLink`, `CommercialCreditException`.
4. Não reverter sync do Nomus nem títulos oficiais. Esta entrega não os altera.

## Conferência depois da migration

- Cliente regular com prazo segue.
- Cliente com boleto em aberto no D+1 não gera pedido a prazo.
- Protesto confirmado pendente fica `BLOQUEIO_CRITICO` mesmo com score cadastral alto.
- À vista não é tratado como prazo.
- Usuário comercial sem a chave de exceção recebe recusa.
- Filtros da carteira: crédito bloqueado, protesto pendente, restrição em análise.
