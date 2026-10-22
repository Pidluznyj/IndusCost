# Comissões › Visão 360° (camada de leitura e conciliação)

Data: 22/10/2026 · Branch `feat/commissions-360-view` · base `b290999c` (origin/main).

A Visão 360° é uma camada **somente leitura** sobre os registros oficiais de comissão.
Ela não recalcula percentual, não materializa snapshot, não cria nem regenera schedule,
não cobre recebimento, não fecha competência, não grava ledger e não paga vendedor.

## 1. Arquivos

| Camada | Arquivo |
|---|---|
| Tipos, rótulos, textos (puro, frontend) | `src/lib/commissions/commission360View.shared.ts` |
| Regras de agregação e conciliação (puro) | `src/lib/commissions/commission360View.ts` |
| Leitura Prisma (só `findMany`) | `src/lib/commissions/commission360View.server.ts` |
| Rotas (GET) | `src/lib/commissionsRoutes.ts` — `/api/commissions/visao-360` e `/api/commissions/visao-360/conciliacao.csv` |
| Tela | `src/components/commissions/pages/Commissions360ViewPage.tsx` (aba `view360`, `/commissions/visao-360`) |
| Auditoria no servidor | `scripts/auditCommission360CrReconciliation.ts` (`npm run audit:commission:360`) |
| Testes | `commission360View.test.ts`, `commission360View.server.test.ts`, `src/lib/commission360ViewUi.test.tsx` |

Permissão: a aba usa o mesmo recurso da Previsão (`comissoes.tab.relatorios`) e a API o mesmo
guard (`commercial.commissions.reports:view`) e o mesmo escopo de vendedor
(`requireCommissionDataScope`: global para admin/gestor/`commissions.seller.all`; próprio para vendedor).
Nenhuma permissão nova foi criada ou ampliada.

## 2. Fonte oficial de cada indicador

| Indicador | Natureza | Fonte | Regra | Competência | Duplicidade | Limitação |
|---|---|---|---|---|---|---|
| A. Pago efetivamente | Confirmado | `CommissionPaymentBatch` PAID + itens PAID | Σ `amountPaid` dos itens pagos | `paymentDate` do lote | dedupe por lote e por item | lote PAID sem `paymentDate` vira anomalia; não há estorno no schema |
| A'. Histórico Nomus | Legado sem confirmação | `CommissionReceiptCoverage` NOMUS_LEGACY COVERED | Σ `coveredCommissionAmount` | competência do relatório (`coveredYear/Month`) | dedupe por cobertura e por recebimento; título já pago em lote → vale o lote | o relatório não tem data de desembolso — **nunca somado ao pago** |
| B1. Realizada aguardando fechamento | Realizado | motor da Previsão (`projectCommissionPortfolioOutlookLines`) | `awaitingClosing` por título | posição atual | um schedule por título (regra do motor) | meses passados não são reconstruídos |
| B2. Liberada e não paga | Confirmado | `CommissionReceiptLedgerLine` de fechamentos **CLOSED** ≥ 10/2026 − pagamentos com evidência | liberado − pago, por vendedor × competência | competência do fechamento | REPROCESSED/CANCELLED não contam; evidência = mesmo `CommissionRecord` (linha) ou lote do vendedor com período inteiro na competência e um único fechamento no mês | lote sem evidência não abate nada; a liberada que ele poderia cobrir vira **não conciliada** (§7.2) |
| C. Prevista sobre CRs | Previsto | motor oficial da Previsão | `min(alocada × saldo/nominal, alocada − realizada)` | `dueDate` | idem motor | só títulos com schedule vigente |
| D. Potencial em PVs | Potencial | `CommissionOrderItemSnapshot` (snapshot ACTIVE) × `SalesOrderItemFlowSnapshot` × schedules ACTIVE do PV | min(Σ comissão do item × (shipTarget − faturado) / pedido, comissão do pedido − já alocada em schedules) | sem vencimento | por item; limitado ao não alocado (R1); alocação acima do pedido → não conciliado; snapshots vigentes com valores diferentes → “a conciliar” | sem fluxo do item, sem snapshot ou vendedor não resolvido → “a conciliar”, nada é estimado |

Política de prevalência de pagamento: **lote PAID com data > relatório Nomus importado > nada**.
Cobertura `INDUSCOST_CLOSING` é liberação (fechamento), não pagamento.

Não duplicação PV × CR: a parte faturada do item já virou CR (indicador C); D só usa a
quantidade ainda não faturada; a quantidade cortada/cancelada não entra em nenhum dos dois.

## 3. Conciliação inversa CR → comissão

A população parte de **todos** os `NomusAccountsReceivable` com vencimento no período
(não de `CommissionReceivableSchedule`). Para cada título, a cadeia oficial é provada elo a elo:

1. Título removido na origem (`MISSING_CONFIRMED`) ou cobrança suspensa → `FORA_UNIVERSO`.
2. Sacado do grupo → `EMPRESA_GRUPO`.
3. Com schedule: vale a linha do motor oficial da Previsão — `COBERTO_FUTURA`, `COBERTO_REALIZADA`,
   `COBERTO_ZERADA`, `CLIENTE_EXCLUIDO`, `VENDEDOR_NAO_COMISSIONAVEL` ou `DIVERGENCIA_ALOCACAO`
   (saldo não sustenta a comissão; baixa sem recebimento). Schedule só de versão substituída,
   órfão ou duplicado anulado → `SCHEDULE_INCONSISTENTE`.
4. Sem schedule: `sourceInvoiceId` vazio → `SEM_VINCULO_NFE`; NF-e sem PV → `SEM_VINCULO_PV`;
   NF-e em mais de um PV → `VINCULO_PV_AMBIGUO` (mesmo resolvedor do scheduler); PV cancelado →
   `PEDIDO_CANCELADO`; saldo zero → `SALDO_LIQUIDADO`; só snapshots substituídos →
   `SNAPSHOT_SUBSTITUIDO`; nenhum snapshot → `SEM_SNAPSHOT`; cliente em Exceções → `CLIENTE_EXCLUIDO`;
   vendedor não resolvido → `VENDEDOR_NAO_COMISSIONAVEL`; snapshot sem itens/com erro → `DADOS_INSUFICIENTES`.
5. Snapshot vigente, elegível, sem schedule → `SEM_SCHEDULE` com **comissão potencial sem cobertura
   confirmada**: o rateio do scheduler oficial (`buildCommissionReceivableScheduleDrafts`) é
   simulado em memória e proporcionalizado pelo saldo aberto. Esse valor **não entra** na previsão.

Funil: CRs operacionais (com saldo) → comissionáveis → cobertos por schedule → comissão futura;
operacionais = excluídos + cobertos + diferenças (sem cobertura + divergências).

## 4. Diagnóstico novembro/dezembro de 2026

A tela e o script mostram, por mês e total: quantidade de CRs, saldo aberto, saldo elegível,
coberto, sem schedule/cobertura, excluído, comissão alocada, futura, potencial sem cobertura e
diferenças, além da abertura por classificação. **Nenhum número de produção foi obtido nesta
missão** (sem acesso autorizado ao banco). Para obter os números reais:

```bash
npm run audit:commission:360 -- --from=2026-11 --to=2026-12
```

Rodar no servidor, com o `DATABASE_URL` da base a conferir. Somente leitura; grava apenas um CSV local.

## 5. Riscos e defeitos do motor (documentados, NÃO corrigidos)

- **R1 — Comissão do PV duplicada por NF-e (CONFIRMADO em teste; ver §7.1).** O cálculo do pedido
  não recebe a NF-e e grava o valor integral do item em cada snapshot `(salesOrderId, nfeId)`; o
  orquestrador materializa um snapshot por NF-e vinculada; o scheduler rateia cada um só entre os
  CRs da sua NF-e; o fechamento libera `scheduledCommissionAmount × recebido/nominal` por título.
  Nenhuma etapa deduplica por pedido. Efeito: PV em N NF-e com CR → até N× a comissão alocada,
  liberada e prevista; PV parcialmente faturado → 100% da comissão no CR da primeira NF-e.
- **R2 — Filtro `status null|true` no motor de recebimento** (`commissionReceiptEngine.server.ts`),
  já registrado: `status` do Nomus é baixa, não cancelamento. Não alterado.
- **R3 — Pagamento × fechamento sem vínculo por linha (CONFIRMADO; ver §7.2).** Linhas de fechamento
  vindas de schedule têm `commissionRecordId` nulo; lotes apontam `CommissionRecord`. B2 só aceita
  evidência explícita; o restante fica "não conciliado".
- **R4 — Histórico legado sem data de desembolso.** Mostrado à parte; não há como afirmar pagamento.
- **R5 — Carteira de PV depende do fluxo materializado** (`SalesOrderItemFlowSnapshot`); pedido sem
  fluxo recalculado fica fora do potencial.
- **R6 — Volume.** A conciliação carrega todos os CRs do período (consultas em lote, sem N+1);
  o período é limitado a 36 meses. Nenhum índice novo foi necessário (usa `dueDate`,
  `sourceInvoiceId`, `nfeExternalId`, `receivableId`, `salesOrderId` já indexados).

## 6. Homologação (roteiro)

1. Abrir Comissões › Visão 360° como administrador; conferir que as abas existentes continuam iguais.
2. **Pago**: comparar "Pago efetivamente" do mês com os lotes pagos (data de pagamento) e o histórico
   legado com os relatórios Nomus importados de 08 e 09/2026.
3. **Realizado não pago**: B1 deve bater com "Realizada aguardando fechamento" da aba Previsão para
   o mesmo período; B2 com o fechamento CLOSED de 10/2026 menos os lotes pagos.
4. **Previsão sobre CRs**: o card deve ser igual ao "Comissão ainda a receber" da aba Previsão no
   mesmo período e vendedor.
5. **Potencial de PVs**: escolher 3 PVs (aberto, parcial, faturado) e conferir item a item a
   quantidade pendente com o Fluxo do pedido e a comissão do item na Provisão por pedido.
6. **CRs sem schedule**: rodar o script como em §7.3, abrir o CSV e conferir os 10 maiores títulos
   sem cobertura na origem (NF-e → PV → snapshot) e os PVs com excesso de alocação (R1).
7. **Por vendedor**: entrar como vendedor (escopo próprio) e confirmar que só aparecem os seus dados,
   mesmo informando outro `sellerId` na URL.
8. **Compatibilidade**: rodar a Previsão, o Fechamento do mês (prévia) e os Relatórios antes e depois
   da implantação e comparar os totais (devem ser idênticos — a mudança não toca o motor).

## 7. Revisão financeira adversarial (22/10/2026)

### 7.1 R1 — PV com mais de uma NF-e

Teste reproduzível: `src/lib/commissions/commission360MultiNfeDuplication.test.ts`, só com funções
oficiais (nenhuma alterada). Cenário: PV de 1.000 un × R$ 12 (Varejo 1 = 2%) → comissão R$ 240;
NF-e A com 400 un (CR R$ 4.800), NF-e B com 600 un (CR R$ 7.200).

| Etapa oficial | Resultado |
|---|---|
| `calculateCommissionForSalesOrderItems` (sem NF-e na entrada) + `buildCommissionOrderSnapshotDraft` | 2 snapshots, R$ 240 cada, `soldAmount` = R$ 12.000 |
| `persistCommissionOrderMaterialization` (identidade = pedido + NF-e) | os 2 ficam ACTIVE |
| `buildCommissionReceivableScheduleDrafts` por NF-e | R$ 240 no CR A + R$ 240 no CR B = **R$ 480** |
| `pickMaterializedScheduleForReceivable` + `releaseCommissionFromMaterializedSchedule` | fechamento libera **R$ 480** |
| `projectCommissionPortfolioOutlookLines` | previsão de **R$ 480** |
| Só a NF-e A emitida | 100% da comissão (R$ 240) liberada ao receber 40% do pedido |

Conclusão: a duplicação é **efetiva** — não há teto por pedido no scheduler, no fechamento nem na
previsão (a escolha de schedule e a auditoria de consistência são por título/por snapshot).
Impacto potencial: para cada PV com k NF-e que geram CR, a comissão alocada/liberada/prevista é
k × a comissão do pedido; em PV parcialmente faturado, a comissão inteira é antecipada. O tamanho
real depende de quantos PVs têm mais de um snapshot ACTIVE com schedule — o script (§7.3) lista
esses PVs e o excesso. Correção do motor não feita (fora do escopo autorizado).

Correção na camada gerencial: o potencial do PV agora é limitado à comissão do pedido ainda não
alocada em schedules, e o excesso alocado aparece como **não conciliado** (por PV, uma vez) no
potencial, na conciliação de CRs e no diagnóstico de novembro/dezembro. A previsão oficial (C) não
é alterada: continua mostrando o valor do motor, com a parcela em PVs sobrealocados destacada.

### 7.2 B2 — liberada × pagamentos

Evidência de vínculo encontrada no código: linhas de fechamento vindas de schedule têm
`commissionRecordId = null` (`commissionReceiptEngine.ts:1231` e `:1272`); itens de lote apontam
`CommissionRecord`; o lote tem só vendedor e período. A regra anterior ("primeira competência que o
período do lote cobre") era atribuição arbitrária e foi removida. Regra atual:

1. **LINHA** — item do lote com o mesmo `CommissionRecord` de uma linha do fechamento.
2. **COMPETÊNCIA EXATA** — lote do mesmo vendedor com período inteiro num único mês, e esse mês
   com exatamente um fechamento CLOSED do vendedor.
3. Sem evidência → lote em "pagamentos sem vínculo" (não abate nada) e a liberada do vendedor nas
   competências cobertas pelo lote fica **NAO_CONCILIADO** (não é chamada de "não paga").

Cenários testados: pagamento parcial; lote de competência anterior ao cutover; reprocessamento
(só o CLOSED novo conta e recebe o pagamento); vários lotes na mesma competência; competências
diferentes do mesmo vendedor; lote cobrindo dois meses; vínculo por linha com período amplo;
pagamento acima do liberado; lote de outro vendedor; dois fechamentos CLOSED no mesmo mês.

### 7.3 Script de conciliação — revisão e execução em homologação

Correções feitas no script e na camada (nenhuma no motor):
- **Trava no processo** (`commission360ReadOnlyGuard.ts`): PrismaClient envolvido por um Proxy que
  só aceita leituras de modelo e `$connect/$disconnect`; instalado em `globalThis.prisma` antes de
  importar os loaders (que reusam esse singleton). Qualquer escrita, `$transaction`, `$executeRaw`
  ou `$queryRaw` falha antes de chegar ao banco. Os loaders reais rodam por trás dela nos testes.
- **Conferência de ambiente**: `--target-db` obrigatório e igual a `current_database()`; mostra
  host/porta/banco/usuário (nunca a senha), versão do PostgreSQL, `transaction_read_only` e se o
  papel tem INSERT/UPDATE/DELETE/TRUNCATE nas tabelas de comissão e CR; `--require-readonly-role`
  aborta se tiver; `--check-only` só confere e sai.
- **Limites**: até 24 meses por execução, `--top` entre 1 e 500, pool de 3 conexões
  (`connection_limit=3`), sessão identificada como `induscost-audit-commission-360`; consultas em
  lotes de 2.000 ids (bem abaixo do limite de 32.767 parâmetros do PostgreSQL).
- **CSV**: não sobrescreve sem `--overwrite`; BOM UTF-8, separador `;`; texto da origem iniciado
  por `= + - @` vira texto (sem fórmula); nova coluna de excesso de alocação do PV (R1).
- **Saldos**: mesma regra da Previsão (`balanceReceivable`; sem ele, original − recebido; nunca
  negativo; título removido na origem = fora do universo). O saldo exibido pode incluir juros;
  comissão potencial usa no máximo o nominal.
- Saída: 0 ok · 1 erro (ex.: banco inacessível) · 3 recusado. Não definir `INDUSCOST_PERF_BASELINE=1`
  (a instrumentação usa `$use` e é bloqueada pela trava).

PostgreSQL 17: o script usa só SELECTs gerados pelo Prisma 5.22 (o mesmo cliente da aplicação, que
já opera nessa base) e um SELECT com `current_database()`, `current_setting()`,
`has_table_privilege()`, `pg_class`/`pg_namespace` e `= ANY(array)`, todos disponíveis no 17.
Não foi executado contra PostgreSQL 17 nesta máquina (não há banco aqui).

Comandos para homologação (preparados, **não executados**). No servidor, na pasta da aplicação
de homologação, com o `DATABASE_URL` da homologação no ambiente:

```bash
npx tsx scripts/auditCommission360CrReconciliation.ts --target-db=<banco_de_homologacao> --check-only
```

```bash
npx tsx scripts/auditCommission360CrReconciliation.ts --target-db=<banco_de_homologacao> --from=2026-11 --to=2026-12 --top=30 --csv=/tmp/comissao-360-nov-dez-2026.csv
```

Opcional, mais forte: rodar com um papel só de leitura (criação a cargo do DBA; não feito aqui):

```sql
CREATE ROLE induscost_audit_ro LOGIN PASSWORD '<definir>';
GRANT CONNECT ON DATABASE <banco_de_homologacao> TO induscost_audit_ro;
GRANT USAGE ON SCHEMA public TO induscost_audit_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO induscost_audit_ro;
ALTER ROLE induscost_audit_ro SET default_transaction_read_only = on;
```

e então acrescentar `--require-readonly-role` ao comando.

## 8. Auditoria R1 por pedido (exposição financeira) — preparada, não executada

Arquivos: `scripts/auditCommissionR1Duplication.ts` (`npm run audit:commission:r1`), regras puras
`src/lib/commissions/commissionR1Audit.ts`, leitura `commissionR1Audit.server.ts`, execução segura
`commission360ReadOnlyGuard.ts`. Testes: `commissionR1Audit.test.ts` (cenários 1–11) e
`commission360ReadOnlyGuard.test.ts` (trava, conferência de ambiente, transação READ ONLY, scripts).

### 8.1 O que é medido, por pedido

População: PVs com ao menos um schedule ACTIVE de snapshot ACTIVE. Para cada PV: id, código,
situação, vendedor, cliente, mês da venda, NF-e (e canceladas, status Nomus 7 — mesma regra do
motor), snapshots ativos e substituídos, percentuais distintos, itens atendidos por estoque.

| Campo | Fonte / regra |
|---|---|
| Comissão original | comissão final de cada item nos snapshots ACTIVE, cada item **uma** vez (substituídos nunca somam; valores diferentes entre snapshots ⇒ desconhecida ⇒ suspeita) |
| Σ snapshots ativos | soma dos snapshots ACTIVE — só para mostrar a duplicação |
| Atribuível ao faturado | Σ por item: comissão × min(faturado, pedido) / pedido (`SalesOrderItemFlowSnapshot`) |
| Alocado | comissão alocada nos schedules válidos segundo o motor da Previsão (versão vigente, um por título; excluído/sem vendedor = 0) |
| Realizado | motor da Previsão (eventos de recebimento) |
| Liberado | linhas de fechamentos **CLOSED** do título |
| Pago comprovado | só itens PAID de lote PAID ligados ao título (`CommissionPaymentSchedule.nomusReceivableId`) ou ao mesmo `CommissionRecord` da linha do fechamento |
| Excesso de alocação (confirmado) | alocado − comissão original |
| Antecipação (faturamento parcial) | min(alocado, original) − atribuível ao faturado — fica separada, não é "confirmado" |
| Excesso realizado/liberado/pago | por título: valor da etapa × (alocado − atribuível do título) / alocado; atribuível do título = atribuível do PV × nominal do título / nominal dos títulos válidos |
| Pagamento não atribuível ao PV | título liberado sem pagamento comprovado, com lote PAID do vendedor no período da competência — **sem valor estimado** |

Classificação: SOBREALOCACAO_CONFIRMADA · ANTECIPACAO_FATURAMENTO_PARCIAL · SUSPEITA (snapshots
divergentes, schedule válido em NF-e cancelada, sem snapshot vigente, sem fluxo do item) ·
SEM_EXCESSO. Revisar = tudo que não é SEM_EXCESSO ou tem pagamento não atribuível.

Saídas (diretório novo): `resumo.txt` (tabela consolidada da missão + por vendedor + por mês),
`pedidos.csv`, `titulos.csv` (alocação por título), `itens.csv` (comissão, percentual, margem e
faturado por item), `por-vendedor.csv`, `por-mes.csv`, `parametros.json` (parâmetros, destino sem
senha, sessão do banco, leituras feitas, operações bloqueadas, SHA-256 dos fontes usados).

### 8.2 Garantias de execução (ambos os scripts)

1. `--target-db` e `--target-port` obrigatórios no R1 e iguais ao `DATABASE_URL`; depois, SELECT
   de catálogo confere `current_database()`, `inet_server_port()`, versão e privilégios do papel.
2. Leituras numa transação `REPEATABLE READ, READ ONLY` (primeira instrução da transação); se
   `transaction_read_only` ≠ on, recusa sem ler nada.
3. Trava no processo sobre o cliente da transação (só leituras de modelo).
4. Pool de 3 conexões, lotes de pedidos (`--chunk`, padrão 300), ids em lotes de 2.000,
   `--max-orders` para execução parcial explícita, `--timeout-min` (padrão 30).
5. Nenhuma chamada ao Nomus, sincronização, materialização, scheduler, fechamento ou pagamento.
6. Arquivos só num diretório novo; nunca sobrescreve sem `--overwrite`; CSV com BOM, `;` e
   proteção contra fórmula.

### 8.3 Como levar ao servidor sem instalar a Visão 360°

O código está só neste worktree (sem commit/push). Levar um pacote para uma pasta **isolada**;
a aplicação de homologação, o serviço e o banco não são tocados.

No computador de desenvolvimento (Git Bash), dentro do worktree:

```bash
git ls-files -co --exclude-standard -z | tar --force-local --null -T - -czf ../induscost-audit-r1-20261022.tgz
```

```bash
sha256sum ../induscost-audit-r1-20261022.tgz
```

```bash
scp ../induscost-audit-r1-20261022.tgz servidor-01:/tmp/
```

No `servidor-01` (pasta isolada; `npm ci` instala as dependências e roda só `prisma generate`):

```bash
mkdir -p ~/induscost-audit-r1-20261022 && tar -xzf /tmp/induscost-audit-r1-20261022.tgz -C ~/induscost-audit-r1-20261022
```

```bash
cd ~/induscost-audit-r1-20261022 && npm ci --no-audit --no-fund
```

### 8.4 Execução em homologação (PostgreSQL 17, banco `teste_bi_homolog`, porta 5433)

Ainda **não executar** — aguarda autorização. Informar a URL sem gravá-la no histórico do shell
(ajuste host/usuário; se o PostgreSQL estiver no próprio servidor, `127.0.0.1`):

```bash
read -rs -p "DATABASE_URL de homologação: " DATABASE_URL && export DATABASE_URL && echo
```

Conferência (não lê dados de negócio):

```bash
npx tsx scripts/auditCommissionR1Duplication.ts --target-db=teste_bi_homolog --target-port=5433 --check-only
```

Auditoria completa (somente leitura, arquivos em diretório novo):

```bash
npx tsx scripts/auditCommissionR1Duplication.ts --target-db=teste_bi_homolog --target-port=5433 --out-dir=$HOME/r1-audit-teste_bi_homolog-20261022 --timeout-min=30
```

Conciliação de CRs de nov/dez (mesmas garantias):

```bash
npx tsx scripts/auditCommission360CrReconciliation.ts --target-db=teste_bi_homolog --target-port=5433 --from=2026-11 --to=2026-12 --csv=$HOME/r1-audit-teste_bi_homolog-20261022/conciliacao-nov-dez-2026.csv
```

Ao terminar:

```bash
unset DATABASE_URL
```

Mais forte (opcional, pelo DBA, antes da execução): papel só de leitura e `--require-readonly-role`.

```sql
CREATE ROLE induscost_audit_ro LOGIN PASSWORD '<definir>';
GRANT CONNECT ON DATABASE teste_bi_homolog TO induscost_audit_ro;
GRANT USAGE ON SCHEMA public TO induscost_audit_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO induscost_audit_ro;
ALTER ROLE induscost_audit_ro SET default_transaction_read_only = on;
```

### 8.5 Rollback

Nada é gravado no banco; o rollback é só remover arquivos:

```bash
rm -rf ~/induscost-audit-r1-20261022 ~/r1-audit-teste_bi_homolog-20261022 /tmp/induscost-audit-r1-20261022.tgz
```

Se o papel opcional foi criado, o DBA o remove com `DROP ROLE induscost_audit_ro;`. A aplicação de
homologação não muda em nenhum momento (nenhum arquivo dela é tocado, nenhum serviço reiniciado).

## 9. Corte temporal oficial da série principal (correção de 22/10/2026)

Regra de negócio: até 30/09/2026 o Nomus é a fonte (espelho técnico); a partir de 01/10/2026 vale o
fechamento oficial do IndusCost; 09/2026 é o marco da **previsão**, não dos fechamentos. A série
principal (gráfico, cards, tabela por vendedor e detalhe) mostra **só o motor oficial**; o resto vai
para a seção **Histórico legado / Ajustes retroativos** (`legacySection` no payload).

Regras reaproveitadas de `commissionCoverageCutover.ts`: `resolveReceiptCutoverPeriod`,
`isCompetenceOfficialInIndusCost`, `COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH` e o primeiro mês da
Previsão (`COMMISSION_PORTFOLIO_OUTLOOK_FIRST_MONTH`). Nada no motor, no fechamento ou nos registros
foi alterado: o corte é aplicado só na composição dos indicadores.

| Série / indicador | Entra na série principal | Vai para legado / ajustes |
|---|---|---|
| Realizado | recebimento com `receiptDate` ≥ 01/10/2026 e sem cobertura `NOMUS_LEGACY`/ajuste manual, no mês do `receiptDate` | `receiptDate` < 01/10/2026 (inclusive fechado depois como `LEGACY_CARRYOVER`) ou coberto pelo Nomus |
| Aguardando fechamento | parte não coberta dos recebimentos oficiais | recebimentos legados sem cobertura (pendência antiga) |
| Pago | parte **operacional** de lote PAID com período inteiro ≥ 10/2026, no mês do `paymentDate` | lote de competência ≤ 09/2026 ou que atravessa o corte, mesmo pago depois; parte do lote que paga ajuste retroativo; valor misto sem vínculo para separar |
| Liberada não paga | linhas `NORMAL`/`LATE_CARRYOVER` com competência natural ≥ 10/2026 | `LEGACY_CARRYOVER`, `MANUAL_ADJUSTMENT` ou natural < 10/2026 (pagamento parcial sobre as duas partes = não conciliado) |
| Previsto | vencimento ≥ 09/2026 | títulos em aberto vencidos antes de 09/2026 |
| Histórico Nomus | nunca | sempre (competência do relatório) |

Lote com valor misto: só é dividido com evidência exata (mesmo `CommissionRecord` da linha; fechamento sem ajuste retroativo; ou um único lote quitando o fechamento inteiro). Pagamento parcial, vários lotes no mesmo fechamento misto ou lote de vários meses com ajuste retroativo ficam inteiros fora da série ("valor misto"), na seção legado.

O eixo do gráfico começa em max(início do filtro, 09/2026); pago e realizado são `null` antes de
10/2026 (sem barra; o tooltip diz "fora da série oficial"). `settlementDate` nunca desloca valores.
Testes: `src/lib/commissions/commission360OfficialCutover.test.ts`.
