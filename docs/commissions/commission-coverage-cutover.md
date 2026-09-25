# Cobertura de comissão, cutover Nomus → IndusCost e pendências de períodos anteriores

Data: 2026-09-25 · Módulo: Comercial → Comissões → Fechamento do mês

Código principal:

| Arquivo | Papel |
|---|---|
| `src/lib/commissions/commissionCoverageCutover.ts` | Datas oficiais (constantes únicas) e janelas |
| `src/lib/commissions/commissionReceiptCoverage.shared.ts` | Estados, rótulos, regras de inclusão, seleção (frontend-safe) |
| `src/lib/commissions/commissionReceiptCoverage.ts` | Linhas de pendência, mescla na prévia, cobertura do fechamento, anti-duplicidade C |
| `src/lib/commissions/commissionReceiptCoverage.server.ts` | Leitura de cobertura e avaliação das pendências (motor oficial) |
| `src/lib/commissions/commissionReceiptClosing.server.ts` | Prévia / apply / cancelamento / reprocesso com cobertura |
| `src/lib/commissions/commissionLegacyCoverageImport{,.server}.ts` | Importação do relatório do Nomus |
| `src/lib/commissions/commissionCoverageAudit.server.ts` | Auditoria e bootstrap (somente leitura) |
| `src/components/commissions/CommissionsReceiptClosingCarryoverGrid.tsx` | Grid "Pendências de períodos anteriores" |

## 1. Por que existe

A competência da comissão é o dia real do recebimento (`NomusReceivableReceipt.receiptDate`).
Um recebimento pode chegar ao sistema depois que o mês dele já foi fechado (sincronização
atrasada, baixa lançada depois). Sem controle, esse recebimento:

- ficava no **limbo** — não entra no mês dele (já fechado) nem no mês atual (outra competência); ou
- corria risco de **dupla comissão** — pago no Nomus e de novo no IndusCost, ou em dois fechamentos.

A regra simplista "tem recebimento + schedule ACTIVE + não há CLOSED = pendente" é **errada**
para o histórico: a produção tem ~958 linhas de ledger em fechamentos só CANCELLED/REPROCESSED
e o Nomus foi a fonte oficial até o cutover — milhares de CRs virariam dívida falsa.

A solução é uma **camada formal de cobertura por evento de recebimento**: para qualquer
recebimento o sistema responde quando foi recebido, a competência natural, se já foi
contemplado, por quem (Nomus/IndusCost), em qual fechamento, quanto, por que não, se pode
entrar no fechamento atual, qual era a competência original e se há risco de duplicidade.

## 2. Cutover 30/09/2026 → 01/10/2026

Constantes únicas (não repetir datas no código):

```ts
COMMISSION_OFFICIAL_CUTOVER_DATE = "2026-10-01"            // IndusCost oficial a partir daqui
COMMISSION_LEGACY_RECONCILIATION_START_DATE = "2026-08-01" // início da janela de conciliação
```

- **Até 30/09/2026** o Nomus é a fonte oficial. Competências até 09/2026:
  a prévia continua idêntica (serve para comparar com o Nomus), mas **apply e reprocesso são
  bloqueados** (`COMMISSION_PERIOD_BEFORE_INDUSCOST_CUTOVER`, mensagem `COMMISSION_PRE_CUTOVER_CLOSING_BLOCKED_REASON`).
  Cancelar um fechamento antigo continua permitido.
- **A partir de 01/10/2026** o IndusCost controla integralmente: fechamento oficial,
  cobertura e pendências.

## 3. receiptDate é a competência natural

- Competência **natural** = mês de `NomusReceivableReceipt.receiptDate`. Nunca reescrito.
- Competência do **fechamento** (pagamento) = mês do fechamento CLOSED que contemplou o evento.
- `settlementDate`, `competenceDate`, `dueDate`, data de criação e baixa administrativa
  continuam só como auditoria.

No ledger (`CommissionReceiptLedgerLine`):

| Campo | Significado |
|---|---|
| `year` / `month` | competência do fechamento (relatórios, cards e PDF agrupam por ela) |
| `naturalYear` / `naturalMonth` | competência natural (mês do `receiptDate`) |
| `receiptDate` | dia civil do recebimento (o mais recente da linha) |
| `receiptExternalIds` | eventos de recebimento contemplados pela linha |
| `inclusionType` | `NORMAL`, `LATE_CARRYOVER`, `LEGACY_CARRYOVER`, `MANUAL_ADJUSTMENT` |

Exemplo: `receiptDate` 30/09/2026 sincronizado em 02/10 → natural 09/2026; se incluído no
fechamento de 10/2026: `year/month = 2026/10`, `naturalMonth = 9`, `LEGACY_CARRYOVER`.

## 4. Nomus como histórico

Para `receiptDate < 01/10/2026` a ausência de CLOSED no IndusCost **não** significa pendência:

| Situação | Estado |
|---|---|
| `receiptDate < 01/08/2026` | `LEGACY_OUTSIDE_RECONCILIATION_WINDOW` — nunca vira pendência |
| 01/08–30/09 com cobertura `NOMUS_LEGACY` | `LEGACY_COVERED` — não aparece para pagar |
| 01/08–30/09 sem cobertura | `LEGACY_PENDING_CANDIDATE` — "Não encontrado na cobertura Nomus" |
| 01/08–30/09 com associação ambígua na importação | `AMBIGUOUS` — revisão manual |

Um candidato legado **não é dívida**: só pode ser incluído num fechamento quando a cobertura do
Nomus de **todos os meses** desde a competência natural até 09/2026 foi importada (o relatório
de setembro pode ter pago um recebimento de agosto). Enquanto faltar: bloqueado com
"Falta confirmação histórica: importe a cobertura do Nomus de MM/AAAA…".

## 5. IndusCost como fonte oficial (pós-cutover)

Para `receiptDate >= 01/10/2026`: recebimento elegível + schedule válido + não coberto por
nenhum CLOSED = **pendente** (`POST_CUTOVER_PENDING`), mesmo que a competência natural seja
anterior ao fechamento aberto.

O que conta como cobertura IndusCost: **somente fechamento `CLOSED`**.

| Status do fechamento | Conta? | Motivo |
|---|---|---|
| `CLOSED` | sim | fechamento oficial vigente |
| `REPROCESSED` | não | substituído por um novo CLOSED (`supersededByClosingId`); o novo cobre |
| `CANCELLED` | não | deixa de ser pagamento oficial; ledger fica para auditoria |

Linhas que cobrem (status final): `COMMISSIONABLE`, `CUSTOMER_EXCLUDED`, `GROUP_COMPANY_EXCLUDED`,
`NO_SALES_LINK`, `ZERO_AMOUNT`. Exceções resolvíveis (`NO_SCHEDULE`, `SELLER_UNRESOLVED`,
`NO_SELLER`, `NO_RULE`, `NO_MARGIN`, `STALE_SCHEDULE`, `COMMISSION_SOURCE_MISMATCH`, `ERROR`) **não
cobrem**: o recebimento continua pendente até ser resolvido. Observação: `NO_MARGIN` é gravado no
banco como `ZERO_AMOUNT` (enum do ledger), mas a cobertura usa o status do motor — continua
pendente.

### Decisão: espelho INDUSCOST_CLOSING na tabela de cobertura

A verdade do fechamento continua sendo `CommissionMonthlyClosing` CLOSED +
`CommissionReceiptLedgerLine`. Ainda assim o apply grava, **na mesma transação**, uma linha
`CommissionReceiptCoverage` (`INDUSCOST_CLOSING`, `associationMethod = INDUSCOST_LEDGER`,
`closingId`, `ledgerLineId`) por evento contemplado. O benefício é real e não existe sem ela:
o **índice único parcial** do banco (uma cobertura `COVERED` por `receiptExternalId`) passa a valer
entre as duas fontes — o PostgreSQL recusa um recebimento pago pelo Nomus **e** pelo IndusCost, ou
por dois fechamentos, mesmo em corrida entre transações. Cancelamento e reprocesso rebaixam o espelho
para `SUPERSEDED` na mesma transação; a auditoria compara espelho × ledger CLOSED e aponta
divergência como risco de duplicidade.

## 6. Pendências de períodos anteriores (carryover)

Na tela **Fechamento por recebimento**, na prévia de competência oficial (>= 10/2026) e sem
CLOSED, aparece acima do detalhamento o grid **"Pendências de períodos anteriores"** (só quando há
registros): "Recebimentos elegíveis de competências anteriores que ainda não foram contemplados
por uma fonte oficial de comissão."

- Candidatos: eventos entre 01/08/2026 e o 1º dia do mês do fechamento sem cobertura `COVERED`.
- Avaliação: o **mesmo motor** da prévia (`loadCommissionReceiptPreview`) na competência natural,
  restrito aos eventos pendentes (`receiptScope.includeReceiptExternalIds`) — sem motor paralelo;
  schedule, vendedor, exclusões, regras e juros/multa ignorados valem igual.
- Uma linha por título (CR) e competência natural. Não comissionável por regra (cliente excluído,
  empresa do grupo, sem vínculo de venda, comissão zero) não vira pendência.
- Colunas: Competência, NF, CR, Pedido, Cliente, Vendedor, Parcela, Recebido em, Valor real, Base
  comissão, Comissão, Origem (Pré-cutover / Nomus · IndusCost), Situação, Ação.
- Situação: "Recebimento sincronizado após fechamento", "Não contemplado no fechamento de MM/AAAA",
  "Pendência de período anterior (MM/AAAA sem fechamento)", "Não encontrado na cobertura Nomus",
  "Associação histórica ambígua", + motivo do bloqueio quando houver.
- Resumo: pendências elegíveis, valor recebido, base, comissão potencial, incluídas, ambíguas
  (cobertas pelo Nomus não entram).
- Ações: checkbox por linha, **Selecionar elegíveis**, **Incluir selecionados**, **Incluir neste
  fechamento** e **Remover**. O filtro "Por vendedor" também filtra o grid (só visual).

Inclusão:

1. O navegador envia **só IDs de recebimento** (`carryoverReceiptIds`, na query da prévia e no body
   do apply). Valor, comissão, vendedor e competência nunca são aceitos do navegador.
2. A prévia recalcula tudo no servidor e mostra a composição:
   **Comissão da competência + Pendências anteriores incluídas = Total do fechamento** (cards
   "Composição da comissão"; o total bate com "Comissão final a pagar").
3. Prévia, exportação, filtro e visualização **não** gravam nada.
4. No apply o servidor recarrega recebimentos, materializa schedules, recalcula, revalida cutover,
   estado, status e cobertura — e grava as linhas de pendência no **mesmo** fechamento
   (`year/month` = fechamento, `natural*` = original, chave de ledger com discriminador de pendência).
5. A cobertura só vira definitiva quando o fechamento é `CLOSED`.

Detalhamento: a linha incluída ganha a etiqueta "Retroativa MM/AAAA" na célula da NF (sem coluna
nova; Parcela n/total e Status em bolinha preservados). XLSX (aba Analítico), colunas novas no fim:
Competência original, Incluído no fechamento, Tipo de inclusão, Origem da cobertura, Pendência
retroativa?.

Reprocessamento: as pendências que o fechamento atual já pagou são **carregadas** para o novo
cálculo (nunca liberadas para pagar de novo); o espelho antigo vira `SUPERSEDED` antes de gravar o
novo, na mesma transação. Reprocessar o mês natural depois que a pendência entrou em outro
fechamento **não** a traz de volta (eventos cobertos por outro fechamento ficam fora das linhas
normais).

## 7. Recebimentos parciais (1:N)

A identidade é o **evento** (`NomusReceivableReceipt.externalId`), com o CR ao lado. Exemplo
CR 30000 (R$ 1.000): recebimento A (R$ 400) coberto pelo Nomus e B (R$ 600) não → só B aparece e
só B pode entrar. A linha do grid agrega apenas os eventos pendentes do título naquela competência;
a seleção é sempre da linha inteira. A comissão coberta por evento é rateada pelo valor recebido
(resto no último — soma exata).

**Cap incremental da pendência (ordem de pagamento).** Avaliada na competência natural, a pendência
trata como "anteriores" os recebimentos do mesmo título **já pagos** por uma fonte oficial — do mesmo
mês ou de meses posteriores (`receiptScope.alreadyCoveredReceiptExternalIds`). Assim ela libera só o
incremento que falta até a comissão do título, exatamente como a liberação incremental normal
("mês seguinte de um recebimento parcial libera só o saldo"). Exemplo: CR de R$ 10.000 (comissão
R$ 300); R$ 8.000 recebidos em agosto e pagos (R$ 240); R$ 4.000 de julho chegam depois → a pendência
libera R$ 60, nunca R$ 120. Sem pendência, a regra do motor não muda.

## 8. Anti-duplicidade

Aplicação (antes e **dentro** da transação do apply):

- **A** — cobertura `COVERED` (`NOMUS_LEGACY` ou `INDUSCOST_CLOSING`) → bloqueia
  (`RECEIPT_ALREADY_COVERED`).
- **B** — linha de ledger de fechamento `CLOSED` que já contém o recebimento → bloqueia
  (defesa em profundidade).
- **C** — o mesmo recebimento em duas linhas (âncoras) do mesmo fechamento → bloqueia
  (`RECEIPT_DUPLICATED_IN_CLOSING`).
- **D** — associação ambígua, candidato legado sem importação, vendedor não resolvido, sem schedule
  ou status não comissionável → não entra (`CARRYOVER_NOT_ALLOWED`, com o motivo por recebimento).

Banco:

```sql
CREATE UNIQUE INDEX "CommissionReceiptCoverage_receipt_covered_key"
  ON "CommissionReceiptCoverage"("receiptExternalId")
  WHERE "coverageStatus" = 'COVERED' AND "receiptExternalId" IS NOT NULL;
```

Corrida entre a prévia e o apply: a revalidação dentro da transação e, em último caso, o índice
(P2002 → mensagem determinística "Duplicidade bloqueada pelo banco…") abortam tudo — nada parcial.
Continua valendo o índice de um CLOSED por (ano, mês, fonte).

## 9. Bootstrap

Estratégia para entrar em operação em 01/10/2026 sem poluir o sistema:

1. antes de 01/08/2026 → `LEGACY_OUTSIDE_RECONCILIATION_WINDOW` (regra de código, sem dados);
2. 01/08–30/09/2026 → importar os relatórios do Nomus de 08/2026 e 09/2026;
3. a partir de 01/10/2026 → IndusCost integral.

Diagnóstico somente leitura:

```bash
npm run commission:coverage:bootstrap:preview
```

Mostra pré-01/08 ignorados, candidatos de ago/26 e set/26, cobertos pela importação, não cobertos,
ambíguos, se cada mês foi importado e o pós-cutover.

**Não existe `bootstrap:apply`**: não é necessário. A janela é regra de código; a cobertura legada
entra só pela importação auditada do relatório do Nomus; os fechamentos existentes (CANCELLED/
REPROCESSED) não contam como cobertura e não precisam de backfill. Nenhum dado é criado
automaticamente.

## 10. Importação da cobertura do Nomus

```bash
# prévia (somente leitura — padrão)
npm run commission:coverage:legacy-import -- --file=relatorio-nomus-2026-09.xlsx --year=2026 --month=9
# gravar (exige confirmação)
npm run commission:coverage:legacy-import -- --file=relatorio-nomus-2026-09.xlsx --year=2026 --month=9 --apply --confirm="IMPORTAR COBERTURA NOMUS" --user=<usuario>
```

- Formatos: **XLSX ou CSV** (primeira aba). PDF não é lido (sem OCR frágil).
- Cabeçalho procurado nas 30 primeiras linhas; exige CR **ou** NF, e Valor. Sinônimos
  normalizados (sem acento/caixa): CR, Conta a receber, Código da conta a receber, ID CR · NF,
  NF-e, Nota · Valor, Valor Duplicata, Valor recebido · Comissão, Comissão calculada · opcionais:
  Cliente, Competência, Vendedor, Parcela, Data.
- Associação, em ordem de confiabilidade: id do recebimento (se houver) → CR explícito →
  NF + valor + cliente. Só recebimentos até o fim da competência do relatório e antes do cutover.
  Com vários recebimentos no título, só associa quando o valor determina (valor exato de um evento,
  soma dos eventos da competência ou soma total). Senão **AMBIGUOUS — não cobre**.
- Idempotente: mesmo arquivo (hash SHA-256 por fonte) não gera nova importação; recebimento já
  coberto vira `ALREADY_COVERED`; o índice único impede cobertura dupla.
- Tudo numa transação: `CommissionLegacyCoverageImport` (contagens + resultado por linha em
  `resultRowsJson`) e as linhas `NOMUS_LEGACY` (`coveredYear/Month` = competência do relatório).
- Competências a partir de 10/2026 são recusadas.

## 11. Estados e status

| Estado | Pendente? | Pode entrar? |
|---|---|---|
| `LEGACY_OUTSIDE_RECONCILIATION_WINDOW` | não | não |
| `LEGACY_COVERED` | não | não |
| `LEGACY_UNMATCHED` (linha do relatório sem recebimento) | — | — (auditoria da importação) |
| `LEGACY_PENDING_CANDIDATE` | candidato | só com a cobertura Nomus importada |
| `AMBIGUOUS` | revisão | não |
| `POST_CUTOVER_PENDING` | sim | sim, se comissionável, com schedule e vendedor |
| `INDUSCOST_COVERED` | não | não |

Tabelas novas: `CommissionReceiptCoverage` (fonte, status `COVERED/PENDING/IGNORED/SUPERSEDED`,
competência natural e de cobertura, fechamento, linha do ledger, importação, valores, método de
associação, notas, autor) e `CommissionLegacyCoverageImport`. Migration aditiva
`20260926120000_commission_receipt_coverage_cutover` (enums, colunas novas do ledger com default,
tabelas, índices, FKs `SET NULL` e o índice único parcial). Nenhum dado existente é alterado.

## 12. Auditoria e troubleshooting

```bash
npm run audit:commission:coverage -- --ids 19236,19413
npm run audit:commission:coverage -- --year=2026 --month=10 --seller="GISLENE" --json
```

Somente leitura. Colunas: CR, NF, receiptId, receiptDate, settlementDate, naturalCompetence,
coverageSource, coverageStatus, coveredYear, coveredMonth, closingId, schedule, commissionAmount,
reason. Totais: cobertos Nomus / IndusCost, pendentes, ambíguos, fora da janela, recebimentos sem
schedule, schedules sem recebimento (com `--ids`), riscos de duplicidade e linhas do relatório do
Nomus que não viraram cobertura.

| Sintoma | Causa / ação |
|---|---|
| Fechar 09/2026 ou antes: "Competências até 09/2026 têm o Nomus como fonte oficial…" | esperado — use o Nomus; o IndusCost fecha a partir de 10/2026 |
| Pendência legada bloqueada "Falta confirmação histórica…" | importe os relatórios do Nomus dos meses indicados |
| "Associação histórica ambígua" | informe o CR (ou id do recebimento) no relatório e reimporte o arquivo corrigido |
| `CARRYOVER_NOT_ALLOWED` no apply | a seleção mudou (já coberto, vendedor/schedule pendente); gere a prévia de novo |
| `RECEIPT_ALREADY_COVERED` / "Duplicidade bloqueada pelo banco" | outro fechamento/importação cobriu o recebimento; atualize a prévia |
| `RECEIPT_EVENT_NOT_FOUND` | recebimento sumiu da origem entre prévia e apply; sincronize e gere a prévia |
| Recebimento com exceção (sem schedule, vendedor) segue pendente após fechar | correto — resolva a exceção; ele aparece no grid do próximo fechamento |
| Precisa desfazer um fechamento | cancelar (cobertura vira SUPERSEDED e os recebimentos voltam a ser pendência) |
| Auditoria mostra "RISCO DE DUPLICIDADE" | recebimento em mais de um CLOSED ou coberto pelo Nomus e por CLOSED — investigar antes de pagar |

## 13. Exemplos reais: CR 19236 e CR 19413

| | CR 19236 | CR 19413 |
|---|---|---|
| NF | 7704 | 7752 |
| Cliente | ACQUAPER BEBEDOUROS E EQUIPAMENTOS LTDA | ADNUSIA NOGUEIRA DE SOUZA NASCIMENTO |
| Valor original | R$ 499,35 | R$ 365,30 |
| receiptDate | 26/08/2026 | 31/08/2026 |
| settlementDate | 10/09/2026 | 02/09/2026 |
| Schedule | ACTIVE, parcela 1, R$ 17,20 | ACTIVE, parcela 1, R$ 10,00 |

Recebidos em agosto e baixados em setembro: competência natural **08/2026** (a baixa não muda a
competência), pré-cutover, dentro da janela de conciliação. **Não são dívida automática.**

- Relatório do Nomus de setembro importado contemplando os dois → `LEGACY_COVERED`
  (`coveredMonth = 9`); não aparecem nas pendências de outubro.
- Sem cobertura importada → `LEGACY_PENDING_CANDIDATE`, aparecem no grid/auditoria com
  "Não encontrado na cobertura Nomus" e "Falta confirmação histórica: importe a cobertura do
  Nomus de 08/2026, 09/2026" — inclusão bloqueada até a importação.

## 14. Autoridade dos relatórios (documento oficial × espelho técnico)

| Competência | Fonte oficial do relatório de comissão | O que o IndusCost gera |
|---|---|---|
| até 09/2026 (até 30/09/2026) | **Nomus** | **Espelho técnico** — reconstrução para consulta/auditoria, NÃO oficial |
| a partir de 10/2026 (desde 01/10/2026) | **IndusCost** | Fechamento, relatório e pagamento oficiais |

Helper central (único ponto de decisão; nenhuma tela compara datas):
`getCommissionReportingAuthority(year, month)` → `{ source: "NOMUS" | "INDUSCOST", officialInIndusCost,
isLegacyPeriod, cutoverDate: "2026-10-01", documentType: "LEGACY_TECHNICAL_MIRROR" | "INDUSCOST_OFFICIAL" }`
e `getCommissionReportingAuthorityForRange(from, to)` para relatórios de vários meses (`MIXED` quando cruza o
cutover — documento não oficial). O servidor devolve `reportingAuthority` no payload do fechamento, dos
Relatórios e de cada item de Fechamentos; o frontend só consome.

Conceitos que não se confundem:

- **Relatório oficial** — o documento que determinou o pagamento: Nomus até 09/2026, fechamento CLOSED do
  IndusCost a partir de 10/2026.
- **Reconstrução técnica (espelho técnico)** — o que o IndusCost calcula para uma competência do Nomus. Útil para
  auditoria, conciliação e diagnóstico; pode divergir do relatório oficial (receiptDate × baixa, sincronização
  tardia, regras históricas). Exemplo: CR 19236/NF 7704 e CR 19413/NF 7752 aparecem na reconstrução de agosto pelo
  `receiptDate`, mas isso não prova que foram (ou não) pagos no relatório do Nomus de agosto.
- **Cobertura** — quem PAGOU um recebimento (seções 5–8). Um recebimento de 08/2026 pode estar coberto pelo Nomus
  em 09/2026; a reconstrução de agosto continua não oficial. Na tela, a linha mostra
  "Contemplado: Nomus 09/2026" (detalhe: "Competência natural: 08/2026 · Fonte oficial: Nomus · Contemplado em:
  09/2026 (Nomus)").
- **Competência natural** — mês do `receiptDate`. **Competência de pagamento** — mês do fechamento que contemplou.

Tela (pré-cutover), sem remover o acesso histórico:

- Banner obrigatório "HISTÓRICO PRÉ-INDUSCOST — NÃO OFICIAL" + texto da reconstrução técnica + "Fonte oficial deste
  período: Nomus" + "Consulta histórica — fonte oficial Nomus · Valor reconstruído pelo IndusCost" (texto explícito,
  não só cor) no Fechamento do mês, em Relatórios (quando a seleção inclui meses do Nomus) e nos detalhes de
  Fechamentos. Inclui a situação do relatório oficial do Nomus: registrado (arquivo, data, conciliação) ou "O
  relatório oficial deste período ainda não foi arquivado no IndusCost".
- Nomenclatura: "Espelho técnico de comissões" / "Reconstrução técnica — período Nomus"; cards "Comissão
  reconstruída" (nunca "Comissão final a pagar"); "a pagar" some das linhas do histórico nos Relatórios.
- Botões "Exportar espelho técnico" / "Imprimir espelho técnico" com tooltip; cada clique pede "TENHO CIÊNCIA"
  (não fica lembrado). "Fechar comissão" e "Recalcular/Reprocessar" não aparecem.
- Relatórios e Fechamentos: painel "HISTÓRICO OFICIAL NOMUS — Até setembro/2026" (competências do ano, relatório
  do Nomus registrado ou não, "Consultar reconstrução técnica") ao lado de "RELATÓRIOS OFICIAIS INDUSCOST — A partir
  de outubro/2026"; a lista de fechamentos mostra "Fonte oficial: Nomus/IndusCost" por linha e um registro
  pré-cutover aparece como "Registro técnico — não oficial (período Nomus)".

Documentos (a autoridade é calculada pela competência dentro do builder — chamada direta também sai marcada):

- XLSX do fechamento, dos Relatórios e por vendedor: 1ª aba começa com "ESPELHO TÉCNICO DE COMISSÕES — NÃO
  OFICIAL", "RELATÓRIO NÃO OFICIAL", fonte oficial NOMUS, período consultado, aviso, natureza (reconstrução
  técnica), tipo ESPELHO TÉCNICO, gerado por INDUSCOST e cutover 01/10/2026; as demais abas começam com "Documento
  não oficial — fonte oficial: Nomus". Nome: `espelho-tecnico-comissoes-AAAA-MM[-...]-induscost.xlsx`.
- CSV: mesmas linhas de aviso no início e nome de espelho técnico.
- PDF/impressão: faixa fixa "NÃO OFICIAL — PERÍODO NOMUS" no topo e no rodapé (repetida em toda página) + avisos na
  primeira página ("Fonte oficial do período: Nomus", "Reconstrução técnica gerada pelo IndusCost", "NÃO utilizar
  como comprovante oficial de comissão.").
- A partir de 10/2026 os documentos seguem exatamente o padrão oficial anterior (sem aviso histórico).

Backend (vale para requisição manual; a UI só espelha):

- `COMMISSION_PERIOD_BEFORE_INDUSCOST_CUTOVER` + "Este período pertence ao histórico oficial do Nomus. O IndusCost
  passou a ser a fonte oficial de fechamento em outubro/2026." em: aplicar fechamento e reprocessar (API — antes de
  qualquer prévia/materialização — e serviço de fechamento), criar/aprovar/pagar lote de pagamento de comissão
  (`periodStart` antes do cutover).
- Não bloqueados, de propósito: cancelar um registro antigo (reduz oficialidade), recálculos técnicos
  (`/recalculate`, `/audit/rerun`, reprocesso de materialização de pedidos) — não geram documento oficial nem
  pagamento. Nenhum perfil (inclusive SUPER_ADMIN) transforma competência pré-cutover em fechamento oficial;
  permissões existentes não mudaram.

Coberto pelos testes `commissionReceiptCoverage.test.ts` (CASOS 1–25, reprocesso, CR 19236/19413),
`commissionLegacyCoverageImport.test.ts` `commissionReceiptClosingCarryoverGrid.test.tsx`, `commissionReportingAuthority.test.ts` e `commissionLegacyReportingUi.test.tsx`.
