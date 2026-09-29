# Homologação — revisão de carteira POL-COM-001 §11

Rotina mensal de inatividade comercial. **Não executar apply em produção nesta entrega.**

## Fonte do PV aprovado

No IndusCost não existe `approvedAt`. O equivalente operacional/jurídico de “Pedido de Venda aprovado” é:

- `SalesOrder.status = SENT_TO_NOMUS` (pedido persistido no Nomus)
- data: `SalesOrder.issueDate`
- fuso: `America/Sao_Paulo`, dias corridos
- **não** entram: `DRAFT`, `READY_TO_SEND`, `CANCELLED`, `ERROR`
- **não** entram: NF, CR, AR, faturamento, última interação de CRM

Cliente sem nenhum PV `SENT_TO_NOMUS`: `NEVER_APPROVED_SALES_ORDER` — **não remove** o responsável.

## 90 dias

`DOCUMENT_INACTIVITY_DAYS` (hoje 90). Completou 90 dias civis → entra em revisão. 89 = mantém.

## CRM válido (estruturado)

Preserva se houver:

- proposta `ANALYSIS` | `SENT` | `APPROVED`
- contato recente com fato comercial concreto (`NEGOTIATION_ADVANCED`, proposta, orçamento, etc.) e próximo passo
- próximo passo + data futura
- paralisação temporária (`NO_DEMAND_NOW` / `REQUESTS_LATER_CONTACT` / `RESUME_LATER`) com data futura

Não preserva: anotação genérica, “aguardando” sem data, registro velho (≥ 90 dias), registro criado após o gatilho só para segurar carteira.

## Comandos (ambiente local / homologação)

```bash
npm run crm:owner-inactivity:preview
```

Preview **não grava**. Conferir totais e cada linha `KEEP_OWNER` / `REMOVE_OWNER` / `REVIEW_REQUIRED`.

Apply **não deve ser rodado em produção nesta entrega**. Em homologação, só com confirmação explícita:

```bash
npm run crm:owner-inactivity:apply -- --confirm=APPLY_OWNER_INACTIVITY
```

Segunda execução deve resultar `NO_CHANGE` para quem já perdeu o responsável.

## Agenda

Job oficial: `crm-owner-inactivity-review`, `10 4 1 * *` em `America/Sao_Paulo` (04:10 do dia 1). **Desligado por padrão.** Ligar só após homologação: `CRM_OWNER_INACTIVITY_SCHEDULER_ENABLED=true`.

## O que conferir na homologação

1. Cliente com PV aprovado há 89 / 90 / 91 dias.
2. PV rascunho não zera o relógio.
3. CRM válido preserva; genérico remove.
4. Histórico do vínculo anterior permanece; cliente fica sem responsável ativo.
5. Novo PV **não** restaura o responsável automaticamente.
6. Comissão, vendedor do PV e oportunidade histórica intactos.
7. Política viva: finding `PORTFOLIO_INACTIVITY_MISMATCH` deixa de ser blocking; a 1.0 **não** fica `IN_SYNC` (outros findings continuam).
