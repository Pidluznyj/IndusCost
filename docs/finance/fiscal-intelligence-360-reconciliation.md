# Inteligência Fiscal 360° — conciliação fiscal

**Atualizado:** 2026-10-29 · **Código:** `src/lib/finance/fiscal360/` · **Arquitetura:** [fiscal-intelligence-360-architecture.md](./fiscal-intelligence-360-architecture.md)

## 1. Princípio: evidências complementares, não impostos distintos

Uma mesma obrigação aparece no XML (destacado), na apuração, na guia, no contas a pagar (AP), na baixa e na Tesouraria.
Cada fonte é uma **evidência** da obrigação — nunca um imposto adicional. O pagamento é contado **uma única vez**, de **uma única fonte**.

| Camada | Fonte | Papel na conciliação | Pode ser somada ao "pago"? |
|---|---|---|---|
| A | `NomusNfeTaxLine` HEADER / `NomusNfeFiscalSummary` | Tributo destacado | Não — documental |
| B | `FiscalApurationLine` | Apurado / devido / créditos | Não |
| C | `FiscalPaymentGuide` | Obrigação (devido, vencimento, código) | Só o `amountPaid` **declarado**, se não houver AP vinculado |
| C | `NomusAccountsPayable` | Baixa financeira | Sim — fonte do pago quando vinculado à guia |
| C | `FiscalPaymentProof` | Comprovante documental | Não — eleva o nível de evidência |
| C | Tesouraria (`TreasuryReconciliationMatch` MATCHED, alocação AP) | Data bancária e comprovação | Não — eleva a evidência e fornece a data de caixa |
| D | `FiscalAllocation` | Rateio gerencial | Nunca — gerencial |

### Regras de contagem do pago
* **Baixa sem numerário / forçada** nunca conta como pago (mesmo com valor baixado): `amountPaid = 0`, sinalizada `SETTLED_WITHOUT_CASH`.
* **Conciliação bancária parcial** (soma conciliada < valor pago) **não** comprova: o pagamento fica `ERP_SETTLEMENT`, sinalizado `PARTIAL_BANK_MATCH`.
* **Data do pagamento da guia** (timestamp) é convertida para data civil em America/Sao_Paulo antes de definir o mês de caixa.
* **Revisão de duplicidade** é decidida na partição de competência do fato; ao mudar, o mês de caixa afetado é reenfileirado, e a rematerialização do fato **não** reabre a contagem decidida. Devido e saldo de obrigações em revisão não são repetidos.

### Fonte única do valor pago (`FiscalPaymentFact`)
1. **Guia com AP vinculado** → `amountPaid` do AP (`paidSource = AP_LINK`).
2. **Guia sem AP** → valor declarado na guia (`GUIDE_MANUAL`) — nível `MANUAL_DECLARED`, nunca "comprovado".
3. **Título AP tributário sem guia** → o próprio AP (`AP_TITLE`), âncora `AP:<externalId>`.

Âncoras são únicas (`anchorKey`, `guideId`, `apExternalId` com índice único): um título AP **não** vira duas obrigações.

### Conciliação por lote
Na aba Conciliação fiscal, a fila e os títulos do AP pendentes têm pesquisa por texto e por faixa de valor (na fila, a faixa vale para a diferença em valor absoluto, e itens sem diferença calculada saem do resultado). As linhas marcadas recebem uma decisão comum: aceitar a divergência, confirmar como tributo ou marcar como não tributário. Vale o mesmo motivo, com as mesmas permissões da decisão individual, até 500 itens por lote.

* Cada item vira uma decisão própria, na própria transação, com trilha e revogação individuais. O `batchId` fica em `evidence`. Falha em um item não desfaz os demais.
* O servidor confere cada item de novo e devolve o que ignorou e por quê: item conciliado ou aceito, título que saiu de pendente, título sem sugestão de tributo e nenhum tributo escolhido, ou decisão ativa existente. O lote nunca substitui uma decisão ativa; para mudar, use a decisão individual ou revogue.
* Mudar um filtro limpa a marcação, para nenhum item fora da vista receber a decisão.

## 2. Níveis de evidência e situação

`evidenceLevel`: `NONE` → `MANUAL_DECLARED` → `ERP_SETTLEMENT` (baixa no AP) → `DOCUMENTARY_PROOF` (comprovante) → `BANK_MATCH` (Tesouraria).
Comprovado = `DOCUMENTARY_PROOF` ou `BANK_MATCH`.

Situação persistida (`status`): `OPEN`, `PARTIAL`, `PAID_ERP`, `PAID_PROVEN`, `PAID_DECLARED`, `REVERSED`, `CANCELLED`, `INSUFFICIENT_DATA`.
**Vencida** (`OVERDUE`) é derivada na leitura (`effectiveFiscal360PaymentStatus`) a partir do vencimento — o snapshot não envelhece com o passar dos dias.

| Cenário exigido | Tratamento |
|---|---|
| Título identificado | `FiscalApTitleFact.classificationStatus = TAX` |
| Guia identificada | `FiscalPaymentFact` âncora `GUIDE` |
| Guia vinculada ao AP | `linkState = GUIDE_WITH_AP`, `apLinkSource = FK \| DECISION` |
| Pagamento parcial | `PARTIAL`, saldo = devido − pago |
| Baixa registrada | `PAID_ERP` (sem comprovação) |
| Pagamento comprovado | `PAID_PROVEN` |
| Pagamento estornado | guia `REVERSED` → pago = 0, saldo volta; a operação original **não** é contada de novo |
| Guia cancelada | `CANCELLED`, fora de devido e pago |
| Obrigação em aberto / vencida | `OPEN` / `OVERDUE` (derivado) |
| Dados insuficientes | `INSUFFICIENT_DATA` (sem valor e sem vencimento) — nunca zero |

## 3. Classificação determinística de títulos do AP

`classifyFiscal360ApTitle` (versão `fiscal360.ap-classifier`). Ordem de precedência:

1. **Decisão manual** ativa (confirmar / rejeitar) — prevalece.
2. **Vínculo com guia** (FK da guia ou decisão `LINK_GUIDE_AP`).
3. **Regra configurada** (`FiscalRuleVersion` `fiscal360.ap-classification-rules`, status `ACTIVE`).
4. **Código de receita DARF conhecido** + (órgão arrecadador, tributo coerente no texto ou "DARF") — confiança alta.
5. **Órgão arrecadador** (Receita Federal, SEFAZ, Prefeitura…) + **exatamente um** tributo citado — confiança alta.
6. Tributo citado na classificação Nomus, sem órgão/código → **pendente (MEDIUM)**, só sugestão.
7. Tributo no texto, ambíguo ou só órgão → **pendente (LOW)**.
8. Palavra genérica (`imposto`, `tributo`, `DARF`, `guia de recolhimento`) sem evidência → **pendente (LOW)**.
9. Nada → `NOT_TAX`.

Somente confiança **HIGH** vira `TAX`. Título **entre empresas do grupo** (reembolso/repasse) nunca vira pagamento tributário por inferência: fica pendente (`INTERCOMPANY_TITLE`) até decisão manual ou vínculo explícito com guia. Pendente **nunca** entra no total pago; gera `FiscalDataQualityIssue` e aparece na fila de revisão.
Regras configuráveis rejeitam termos genéricos isolados (`validateFiscal360RuleParameters`).

Limitação da fonte (verificada em `docs/generated/nomus-accounts-payable-api-diagnostic.md`): a API de AP do Nomus **não envia CNPJ do favorecido, data de baixa nem centro de custo**. O CNPJ é usado quando existir; a data de caixa vem da Tesouraria quando houver conciliação, senão do AP, senão da guia — senão o pagamento fica **sem data de caixa** (contado à parte na visão de caixa, sinalizado `NO_CASH_DATE`).
Também **não há histórico de baixas por parcela** no AP: o motor usa os valores agregados e não inventa granularidade.

## 4. Checagens por partição (empresa × competência)

Reconstruídas em transação única por `FiscalReconciliationItem` (`itemKey` único por partição):

| Checagem | Resultado |
|---|---|
| `APURATION_VS_GUIDE` | OK / DIVERGENT / MISSING (tolerância R$ 1,00) |
| `GUIDE_VS_AP` / `GUIDE_WITHOUT_AP` | guia com / sem título AP |
| `AP_TAX_WITHOUT_GUIDE` | título tributário (HIGH) sem guia → REVIEW |
| `AP_VS_SETTLEMENT` | baixa total / parcial / ausente |
| `SETTLEMENT_VS_PROOF` | comprovado × só baixa |
| `POSSIBLE_DUPLICATE` | guia sem AP e título sem guia, **mesma empresa e tributo**, competências a até 1 mês (ou mesmo mês de caixa) e valor equivalente (±3%, por juros/multa) → conta **uma** vez; o item pertence à partição de competência do fato em revisão |
| `DUPLICATE_AP_LINK` | título vinculado a duas guias → a mais antiga ganha |
| `COMPETENCE_WITHOUT_CLOSING` | guia sem apuração fechada |
| `CREDITS_UNRECONCILED` | créditos da apuração × créditos documentais de entradas (creditabilidade **não** presumida) |
| `PENDING_CLASSIFICATION` | títulos pendentes |

### Duplicidade provável nunca vira pagamento duplo
`detectFiscal360PossibleDuplicates` escolhe a evidência mais forte (comprovante/banco › baixa ERP › declarado) para **contar**; a outra recebe `countsInPaidTotals = false` e vai para "Em revisão (fora do total)". O usuário resolve com *Obrigações distintas* ou vinculando.

## 5. Revisão manual autorizada

`FiscalReconciliationDecision` (nunca altera o Nomus; revogável; auditada em `FiscalSettlementAuditLog`):

| Decisão | Permissão | Efeito |
|---|---|---|
| `AP_CONFIRM_TAX` / `AP_REJECT_TAX` | `finance.fiscal360.reclassify` | classificação do título (tributo, código, competência) |
| `LINK_GUIDE_AP` | `finance.fiscal360.reconcile` | vínculo guia ↔ AP sem editar a guia |
| `MARK_DISTINCT` | `reconcile` | desfaz a suspeita de duplicidade |
| `ASSIGN_GUIDE_COMPANY` | `reconcile` | empresa (CNPJ do grupo) da guia sem empresa |
| `ACCEPT_DIVERGENCE` | `reconcile` | divergência justificada |

Todas exigem **motivo ≥ 10 caracteres**, registram usuário/data e enfileiram apenas os jobs afetados. Uma decisão nova no mesmo alvo revoga a anterior com trilha.

## 6. Operações entre empresas do grupo

* Fonte canônica dos CNPJs: `FINANCE_INTERNAL_GROUP_COMPANIES`.
* NF-e `INTERCOMPANY` autorizadas ficam em `FiscalDocumentFact` (`operationClass = INTERCOMPANY`), **fora** do faturamento externo (`isOfficialBilling = false`), mas seus tributos destacados permanecem por CNPJ (`highlightedIntercompanyAmount`) — nenhuma eliminação de tributo efetivo.
* AP intercompany = pagador **e** credor do grupo (`isIntercompanyPayable`). Custos de terceiros não são eliminados.
* `FiscalIntercompanySnapshot`: par emitente → destinatário por competência (receita individual, despesa individual via AP, pago, divergência indicativa).
* **Lacuna declarada:** serviços Lazarios ↔ Koppetel (NFS-e) — sem fonte operacional; a interface informa e **não cria documento**. Serviços internos capitalizados em estoque/ativo exigem tratamento contábil específico (sem eliminação automática).

## 7. Mudança de competência, cancelamento e estorno
* Correção de NF-e/guia/pagamento invalida **somente** as partições afetadas (a antiga e a nova): o fato guarda `competenceMonth`/`paidMonth` anteriores e o job enfileira ambas.
* Documento cancelado mantém os tributos rastreáveis, mas `highlightedTaxTotal = 0` e fica fora do destacado efetivo.
