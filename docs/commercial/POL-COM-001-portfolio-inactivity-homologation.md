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

## Dois relógios (desde 2026-10-02)

Todo cliente com Responsável Comercial ativo está sujeito aos 90 dias. O relógio depende do histórico de faturamento:

| Situação | `inactivityClockSource` | Início da contagem |
| --- | --- | --- |
| Já teve NF / DS válido | `LAST_VALID_INVOICE` | data da última NF / DS válido |
| Nunca teve NF / DS válido | `ASSIGNMENT_START` | `CrmCustomerCommercialOwner.assignmentStartedAt` |
| NF autorizada sem data utilizável | — (`DATA_ANOMALY`) | não conta; **não remove** |

- **A NF sempre tem prioridade.** Se existe faturamento válido, a data em que o responsável assumiu **não** reinicia o prazo: NF há 120 dias + responsável atribuído há 10 dias = revisão agora, pela NF.
- **Cliente nunca faturado** deixou de ser “nunca remove”. Conta do início da atribuição do responsável atual:
  - `NEVER_INVOICED_WITHIN_GRACE` — menos de 90 dias: mantém (`NO_CHANGE`);
  - `NEVER_INVOICED_REVIEW_DUE` — 90 dias ou mais: entra na mesma revisão dos demais (CRM válido preserva; sem CRM válido, remove).
- `DATA_ANOMALY` continua sendo proteção: NF problemática nunca é tratada como “nunca faturou”.

### `assignmentStartedAt`

Data em que o responsável **atualmente ativo** iniciou o ciclo. Migration `20261002120000_crm_owner_assignment_started_at` (aditiva; registros existentes recebem `createdAt`, o melhor dado determinístico — o `CommercialAuditLog` guarda só rótulos de exibição e não permite reconstruir a última troca sem heurística; `updatedAt` não serve porque muda com notas).

| Evento | `assignmentStartedAt` |
| --- | --- |
| Nova atribuição manual (sem responsável → X) | agora |
| Reativação manual (inativo → ativo) | agora, e `blockAutoAssignUntilManual = false` |
| Troca real (X ativo → Y ativo) | agora |
| Autoatribuição válida pelo vendedor do PV | agora |
| Salvar de novo o mesmo responsável / editar notas / atualização técnica | **não muda** |

“Mesmo responsável” = mesma identidade consolidada da carteira (`sellerIdentityKey` ou IDs/aliases Nomus em comum), a mesma regra de `assignmentMatchesCommercialOwnerPortfolio`.

Reatribuição manual de cliente que já faturou: `assignmentStartedAt` vira agora, mas o relógio continua sendo a última NF.

O DOCX original da POL-COM-001 v1.0 descrevia “90 dias sem PV aprovado”. Em 2026-09-30 a Seção 11 da candidata v1.0 (ainda não publicada) foi reescrita para descrever esta rotina — o sistema é a fonte da verdade — e a auditoria passa a emitir `PORTFOLIO_INACTIVITY_ALIGNED` (informativo). O alinhamento é conferido por comparação do texto com a rotina (`readDocumentInactivityRule`): um texto que volte a falar em “PV aprovado” gera de novo `PORTFOLIO_INACTIVITY_MISMATCH` (**blocking**). Em 2026-10-02 a rotina passou a remover também o cliente nunca faturado e a §11 da candidata foi atualizada junto: um texto que ainda diga que cliente sem histórico de faturamento “não será desvinculado”, ou que não cite o início da atribuição do Responsável Comercial atual, gera `PORTFOLIO_INACTIVITY_MISMATCH`. O snapshot normativo passou a `inactivityClock = LAST_VALID_INVOICE_OR_ASSIGNMENT_START` e `neverInvoicedRemoved = true`; uma versão já publicada com o snapshot anterior aparece como divergente do sistema e exige nova publicação (o registro publicado não é reescrito).

Colunas existentes de `CrmCustomerPortfolioReview` (`lastApprovedSalesOrder*`, `daysSinceLastApprovedOrder`) recebem o PV faturado e a data da NF — ficam **nulas** quando o relógio é a atribuição; `ownerStartedAt` recebe `assignmentStartedAt`. O `payload` JSON guarda os nomes corretos (`lastValidInvoiceDate`, `lastValidInvoiceId`, `lastInvoicedSalesOrderId`, `daysSinceLastValidInvoice`, `invoiceDateSource`) e o relógio usado: `inactivityClockSource`, `inactivityClockDate`, `daysSinceInactivityClock`, `assignmentStartedAt`, `neverInvoiced` e `inactivityBasis` (`NO_VALID_INVOICE_SINCE_LAST_VALID_INVOICE` × `NO_FIRST_VALID_INVOICE_SINCE_ASSIGNMENT_START`). O motivo da baixa segue `INACTIVITY_90_DAYS` nos dois casos.

Dívida técnica (não nesta execução): `lastApprovedSalesOrderId` → `lastInvoicedSalesOrderId`; `lastApprovedIssueDate` → `lastValidInvoiceAt`.

## Data canônica da compra

Contrato fiscal já usado em Faturamento (`COALESCE(xmlDhEmi, dataProcessamento)`):

1. `NomusNfe.xmlDhEmi` → `NFE_XML_DH_EMI`
2. `NomusNfe.dataProcessamento` (campo Nomus da NF, **não** `syncedAt`) → `NFE_PROCESSING_DATE`
3. `NomusStockDocument.dataDocumento` de DS **VALID** → `STOCK_DOCUMENT_DATE`
4. nenhuma data utilizável (inclui epoch 1970) → `MISSING` / `DATA_ANOMALY` — **não remove**

NF AUTHORIZED sem Documento de Saída: **COUNTED** (`nfeValidityAdvancesKanban` avança só com AUTHORIZED).

## 90 dias

`DOCUMENT_INACTIVITY_DAYS` (hoje 90), em dias civis de America/Sao_Paulo, para os dois relógios:

- 89 dias = mantém;
- 90 dias = entra em revisão;
- 91 dias = em revisão.

O prazo só é verificado na rotina do dia 01. Exemplo (nunca faturado): responsável assumiu em 10/10 → rotinas de 01/11 (22 dias), 01/12 (52) e 01/01 (83) mantêm; a de 01/02 (114) revisa e, sem CRM válido, remove.

## Baixa e autoatribuição

Remoção: `isActive = false`, `blockAutoAssignUntilManual = true`, `endedAt` = data da execução, `endReason = INACTIVITY_90_DAYS`. Novo PV **não** devolve o cliente ao responsável anterior; só uma nova atribuição manual (supervisor / super admin) reativa, libera o bloqueio e inicia novo ciclo. A autoatribuição nunca substitui responsável ativo nem contorna o bloqueio.

## CRM válido (estruturado)

Preserva se houver:

- proposta `ANALYSIS` | `SENT` | `APPROVED` com `expectedCloseDate` ou `nextActionAt` futuro
- contato recente com fato comercial concreto e próximo passo
- próximo passo + data futura
- paralisação temporária (`NO_DEMAND_NOW` / `REQUESTS_LATER_CONTACT` / `RESUME_LATER`) com data futura

Não preserva: `Proposal.updatedAt` técnico sozinho, anotação genérica, “aguardando” sem data, registro velho (≥ 90 dias), registro criado após o gatilho só para segurar carteira.

Os critérios são os mesmos para os dois relógios. Preservado = `PORTFOLIO_REVIEW_PRESERVED`, revisto de novo no mês seguinte.

## Comandos (ambiente local / homologação)

```bash
npm run crm:owner-inactivity:preview
```

Preview **não grava**. Conferir totais:

- abaixo de 90 dias por NF válida
- nunca faturados dentro da carência
- nunca faturados vencidos (em revisão)
- em revisão
- preservados por CRM
- elegíveis para remoção
- never invoiced (total: carência + vencidos)
- data anomaly
- já sem responsável

Cada linha mostra o relógio: `clockSource=LAST_VALID_INVOICE | clockDate=2026-06-15 | dias=108` ou `clockSource=ASSIGNMENT_START | clockDate=2026-10-10 | dias=114`.

**Primeira execução após esta entrega:** todo cliente nunca faturado cujo responsável está atribuído há 90 dias ou mais (pelo `createdAt` do backfill) e sem CRM válido aparece como elegível de uma vez. Conferir o preview antes de ligar o agendador ou rodar o apply.

Apply **não deve ser rodado em produção nesta entrega**. Em homologação, só com confirmação explícita:

```bash
npm run crm:owner-inactivity:apply -- --confirm=APPLY_OWNER_INACTIVITY
```

Segunda execução deve resultar `NO_CHANGE` para quem já perdeu o responsável.

## Agenda

Job oficial: `crm-owner-inactivity-review`, `10 4 1 * *` em `America/Sao_Paulo` (04:10 do dia 1). **Desligado por padrão.** Ligar só após homologação: `CRM_OWNER_INACTIVITY_SCHEDULER_ENABLED=true`.

## O que conferir na homologação

1. Cliente com NF válida há 89 / 90 / 91 dias.
2. PV `SENT_TO_NOMUS` sem NF válida não zera o relógio (se nunca faturou, conta do início da atribuição: 89 / 90 / 91 dias).
2a. Cliente com NF antiga e responsável recém-atribuído entra em revisão pela NF.
2b. Nunca faturado: troca real de responsável reinicia o prazo; salvar o mesmo responsável ou editar notas não.
3. NF cancelada não conta; NF válida antiga prevalece sobre PV recente sem NF.
4. CRM válido preserva; `updatedAt` técnico não preserva.
5. Histórico do vínculo anterior permanece; cliente fica sem responsável ativo.
6. Novo PV **não** restaura o responsável automaticamente (`blockAutoAssignUntilManual`).
7. Comissão, vendedor do PV, SalesOrder e Documento de Saída intactos.
8. Política viva: com a §11 da candidata v1.0 alinhada, o painel mostra `PORTFOLIO_INACTIVITY_ALIGNED`; `PORTFOLIO_INACTIVITY_MISMATCH` só reaparece se texto e rotina voltarem a divergir.
