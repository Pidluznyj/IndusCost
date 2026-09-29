# Homologação — revisão de carteira POL-COM-001 §11

Rotina mensal de inatividade comercial. **Não executar apply em produção nesta entrega.**

## Fonte temporal (regra operacional)

O relógio **não** usa `SalesOrder.status = SENT_TO_NOMUS` + `SalesOrder.issueDate`.

Compra realizada = último **Pedido de Venda com NF / Documento de Saída válido vinculado**:

- vínculo oficial: `SalesOrder` → `SalesOrderNfeLink` → `NomusNfe` (`externalId` = `nfeExternalId`)
- documento de saída: `NomusStockDocument` via `idNfe`
- NF válida: `NomusNfe.status = 4` (autorizada), sem `xmlCancelamento`, não cancelada
- DS válido: `isCancelled = false`, não devolução/transferência
- data: `xmlDhEmi` ?? `dataProcessamento` ?? `dataDocumento` (America/Sao_Paulo, dias corridos)
- faturamento **parcial** com NF válida **reinicia** o relógio
- **não** entram: DRAFT, READY_TO_SEND, SENT_TO_NOMUS sem NF válida, proposta, orçamento, AR, CR, pré-NF, NF cancelada

Cliente sem nenhuma NF/DS válida: `NEVER_INVOICED` — **não remove** o responsável.

A POL-COM-001 v1.0 ainda descreve “90 dias sem PV aprovado”. Finding `PORTFOLIO_INACTIVITY_MISMATCH` permanece **blocking** (`POLICY_VERSION_REQUIRED`) até nova versão publicada. **Não** marcar IN_SYNC.

Colunas existentes de `CrmCustomerPortfolioReview` (`lastApprovedSalesOrder*`) recebem o PV faturado e a data da NF; o `payload` JSON guarda os nomes corretos (`lastValidInvoiceDate`, `lastValidInvoiceId`, `lastInvoicedSalesOrderId`, `daysSinceLastValidInvoice`). Sem migration nova.

## 90 dias

`DOCUMENT_INACTIVITY_DAYS` (hoje 90). Completou 90 dias civis desde a última NF válida → entra em revisão. 89 = mantém.

## CRM válido (estruturado)

Preserva se houver:

- proposta `ANALYSIS` | `SENT` | `APPROVED` com `expectedCloseDate` ou `nextActionAt` futuro
- contato recente com fato comercial concreto e próximo passo
- próximo passo + data futura
- paralisação temporária (`NO_DEMAND_NOW` / `REQUESTS_LATER_CONTACT` / `RESUME_LATER`) com data futura

Não preserva: `Proposal.updatedAt` técnico sozinho, anotação genérica, “aguardando” sem data, registro velho (≥ 90 dias), registro criado após o gatilho só para segurar carteira.

## Comandos (ambiente local / homologação)

```bash
npm run crm:owner-inactivity:preview
```

Preview **não grava**. Conferir totais:

- abaixo de 90 dias por NF válida
- em revisão
- preservados por CRM
- elegíveis para remoção
- never invoiced

Apply **não deve ser rodado em produção nesta entrega**. Em homologação, só com confirmação explícita:

```bash
npm run crm:owner-inactivity:apply -- --confirm=APPLY_OWNER_INACTIVITY
```

Segunda execução deve resultar `NO_CHANGE` para quem já perdeu o responsável.

## Agenda

Job oficial: `crm-owner-inactivity-review`, `10 4 1 * *` em `America/Sao_Paulo` (04:10 do dia 1). **Desligado por padrão.** Ligar só após homologação: `CRM_OWNER_INACTIVITY_SCHEDULER_ENABLED=true`.

## O que conferir na homologação

1. Cliente com NF válida há 89 / 90 / 91 dias.
2. PV `SENT_TO_NOMUS` sem NF válida não zera o relógio (`NEVER_INVOICED` se nunca faturou).
3. NF cancelada não conta; NF válida antiga prevalece sobre PV recente sem NF.
4. CRM válido preserva; `updatedAt` técnico não preserva.
5. Histórico do vínculo anterior permanece; cliente fica sem responsável ativo.
6. Novo PV **não** restaura o responsável automaticamente (`blockAutoAssignUntilManual`).
7. Comissão, vendedor do PV, SalesOrder e Documento de Saída intactos.
8. Política viva: `PORTFOLIO_INACTIVITY_MISMATCH` blocking até republicar a §11.
