# Inteligência Fiscal 360° — homologação, performance, reversão e índices

**Atualizado:** 2026-10-29 · **Branch:** `feat/fiscal-intelligence-360` · **Status:** pronto para revisão; **nada foi implantado**.
Todo o desenvolvimento ocorreu em ambiente local descartável. Nenhum servidor, banco operacional, `.env`, cron, timer ou integração Nomus foi tocado.

## 1. O que é aplicado (e o que NÃO é)

| Item | Aplicado automaticamente? |
|---|---|
| Migration `20261104120000_fiscal_intelligence_360` (aditiva) | **Não** — somente pelo executor de deploy, com autorização |
| Backfill histórico | **Não** — CLI manual, com `--apply --confirm-apply` |
| Worker em processo | **Não** — desligado; ligar exige `FISCAL360_WORKER_ENABLED=1` |
| Permissões `finance.fiscal360.*` nos perfis | **Não** — o catálogo registra; conceder é decisão do administrador (`permissions:seed:contract:apply` não altera grants) |

## 2. Migration — tabelas, índices e constraints

Aditiva: 15 `CREATE TABLE`, índices e FKs só entre tabelas novas, **7 `CREATE INDEX` em tabelas existentes** (sem lock longo de escrita nas bases atuais; ver §7). Nenhuma coluna alterada/removida; nenhum `DROP/UPDATE/DELETE/TRUNCATE` (teste de contrato).

| Tabela | Chave de unicidade | Índices principais | FK |
|---|---|---|---|
| `FiscalDocumentFact` | `nomusNfeId` | `(companyCnpj, competenceMonth)`, `(competenceMonth, operationClass)`, `(isOfficialBilling, competenceMonth)`, `(recipientGroupCnpj, competenceMonth)` | — (lógica) |
| `FiscalDocumentTaxFact` | `(documentFactId, taxType)` | `(companyCnpj, competenceMonth, taxType)` | → `FiscalDocumentFact` CASCADE |
| `FiscalApTitleFact` | `apExternalId` | `(classificationStatus, competenceMonth)`, `(companyCnpj, competenceMonth)`, intercompany | — |
| `FiscalPaymentFact` | `anchorKey`, `guideId`, `apExternalId` | `(companyCnpj, competenceMonth)`, `(companyCnpj, paidMonth)`, `status`, `dueDate` | — |
| `FiscalReconciliationItem` | `itemKey` (por partição) | `(companyCnpj, competenceMonth)`, `(checkType, status)` | — |
| `FiscalReconciliationDecision` | — | `(apExternalId, active)`, `(guideId, active)`, `(itemKey, active)` | — |
| `FiscalMonthlySnapshot` | `(companyCnpj, competenceMonth, taxType)` | `(competenceMonth, taxType)` | — |
| `FiscalIntercompanySnapshot` | `(issuerCnpj, recipientCnpj, competenceMonth)` | `competenceMonth` | — |
| `FiscalForecastScenario` | `systemKey` | `(kind, status)` | — |
| `FiscalForecastSnapshot` | `(scenarioId, companyCnpj, month, taxType, kind)` | `(scenarioId, month)` | → cenário CASCADE |
| `FiscalProcessingJob` | **parcial** `dedupeKey WHERE status='PENDING'` | `(status, priority, availableAt)`, `(jobType, status)`, `(sourceEntity, sourceId)` | — |
| `FiscalProcessingCheckpoint` | `key` | — | — |
| `FiscalProcessingRun` | — | `startedAt`, `status` | — |
| `FiscalDataQualityIssue` | `dedupeKey` | `(status, issueType)`, `(scopeKey, status)` | — |
| `FiscalRuleVersion` | `(ruleKey, version)` | `(ruleKey, status)` | — |

Índices em tabelas existentes (descoberta incremental por watermark): `updatedAt` em `NomusNfe`, `NomusNfeFiscalSummary`, `NomusAccountsPayable`, `FiscalApurationPeriod`, `FiscalApurationLine`, `FiscalPaymentGuide`; `uploadedAt` em `FiscalPaymentProof`. A varredura de conciliações da Tesouraria (`treasury-ap`) não tem índice de watermark (a suíte da Tesouraria fixa a contagem de migrations que a tocam): usa os índices existentes e ordena por `updatedAt` — custo desprezível no volume atual de conciliações.
**Sem FKs para espelhos Nomus** (padrão do projeto: vínculo lógico por `externalId`).
Validação offline: `prisma validate` + `prisma migrate diff` (SQL = diff do schema) + aplicação num **PostgreSQL 17 descartável** (suíte `fiscal360.pg17.integration.test.ts`).

## 3. Processamento incremental

Jobs (`FiscalProcessingJob`): `MATERIALIZE_DOCUMENT`, `MATERIALIZE_AP_TITLE`, `MATERIALIZE_GUIDE`, `REBUILD_PARTITION` (empresa × competência), `REBUILD_FORECAST`.
Cada job tem id, tipo, entidade/id de origem, `sourceHash`, `ruleVersion`, status, tentativas (máx. 5, backoff exponencial 30 s…30 min), último erro (sem credenciais), datas, competências afetadas e metadados de auditoria.
Concorrência: `FOR UPDATE SKIP LOCKED` + `leaseToken` + lease (`leaseUntil`; worker morto → job retomado); índice parcial único evita jobs PENDING duplicados; advisory locks transacionais por entidade, partição e projeção.

### Execução (somente com autorização)
```bash
npm run fiscal360:status                                   # somente leitura
npm run fiscal360:process -- --apply --confirm-apply       # ciclo incremental
npm run fiscal360:backfill -- --apply --confirm-apply      # histórico em lotes, retomável
npm run fiscal360:verify                                   # equivalência materializado × fonte oficial (leitura)
```
Opções: `--max-jobs`, `--time-budget-min`, `--batch`, `--max-batches`, `--resume`. Ctrl+C: termina o job em curso; fila e watermarks persistem; basta rodar de novo.
Cron sugerido (após validar): `*/10 * * * * npm run fiscal360:process -- --apply --confirm-apply` — ou `FISCAL360_WORKER_ENABLED=1` (intervalo `FISCAL360_WORKER_INTERVAL_MS`, mín. 60 s).

## 4. Relatório de performance

Medido em PostgreSQL 17 descartável (Windows, máquina de desenvolvimento) com dataset sintético por `generate_series`; script reproduzível: `scripts/testing/fiscal360PerfBenchmark.ts`.

**Dataset:** 30.000 NF-e (+30.000 resumos fiscais), 9.000 títulos AP, 600 guias; 3 empresas; ~34 meses; ~5% canceladas, 5% intercompany, 2,5% logística.
Materializado: 30.000 fatos de documento · 9.000 fatos de título · 1.350 obrigações · 583 linhas de snapshot · 2.410 itens de conciliação.

| Medição | Resultado | Meta |
|---|---|---|
| **Backfill completo** (descoberta + 39.732 jobs: documentos, AP, guias, 130 partições, projeções) | **274 s** (≈ 109 NF-e/s incluindo AP e guias) | retomável, em lotes |
| Estimativa de backfill em volume maior | ≈ 100 mil NF-e + 30 mil AP ≈ 20–25 min (linear) | — |
| Reprocesso sem mudança na fonte | **0 jobs** (a varredura logo após o backfill levou 31 s porque todas as linhas estão na janela de sobreposição de 10 min; em regime só as alteradas são examinadas) | idempotente |

| Endpoint (40 iterações, ms) | p50 | **p95** | max | Meta |
|---|---|---|---|---|
| Dashboard consolidado (visão executiva) | 22,2 | **24,5** | 25,8 | ≤ 1000 |
| Tributos pagos (página) | 4,5 | **6,2** | 11,6 | ≤ 2000 |
| Conciliação (página) | 2,6 | **3,0** | 3,1 | ≤ 2000 |
| Documentos (página) | 14,4 | **15,6** | 17,2 | ≤ 2000 |
| Operações do grupo | 9,8 | **15,8** | 21,6 | ≤ 2000 |
| Projeções | 2,6 | **2,9** | 2,9 | ≤ 1000 |
| Processamento | 79,8 | **89,2** | 119,6 | ≤ 1000 |
| *Antes:* relatório T07 (lê NF-e/guias na requisição, `take: 5000`) | 209,8 | **258,8** | 258,8 | — |
| *Referência:* agregação direta com o predicado oficial (sem materialização) | 23,5 | 24,6 | 24,6 | — |

Leitura: o dashboard lê o mesmo volume em ~24 ms **e** sem os limites silenciosos do relatório anterior; a vantagem da materialização cresce com o histórico (a agregação direta é linear no volume de NF-e; os agregados materializados são limitados a empresa × mês × tributo). Resultados obtidos em máquina de desenvolvimento com PostgreSQL 17 local — **validar em homologação com o dataset real** (critério do roteiro, §5).

Garantias estruturais (testes): nenhuma consulta de tela toca `NomusNfe`, `NomusAccountsPayable`, guias ou apuração (modelo-guarda sobre 11 consultas); nenhum parse de XML no GET; sem `take` silencioso em totais (totais por `aggregate`/`groupBy`); exportação acima de 50 mil linhas recusa em vez de truncar.
Não sacrifica correção: receita vem da mesma expressão SQL do Faturamento/DRE (`fiscalNfeWhereSql`).

## 5. Roteiro de homologação (servidor-01 — a ser executado por quem tem autorização)

1. **Pré-checagem**: `git fetch`; executor de deploy v4 com `--dry-run`; backup lógico do banco (`pg_dump -Fc teste_bi_homolog`) fora do repositório.
2. **Deploy da migration** pelo executor (migration antes do código). Confirmar as 15 tabelas e os 7 índices; `\d+ "FiscalProcessingJob"` mostra o índice parcial.
3. **Código**, sem ligar worker. Confirmar `GET /api/finance/fiscal-360/overview` com 403 para quem não tem `finance.fiscal360.view`, e 200 vazio ("Nenhuma materialização") para quem tem.
4. **Permissões**: conceder `finance.fiscal360.view` a um perfil de teste; as demais por necessidade (conciliar/reclassificar/premissas/reprocessar/jobs).
5. **Backfill supervisionado**: `npm run fiscal360:status` → `npm run fiscal360:backfill -- --apply --confirm-apply --time-budget-min 60` (repetir com `--resume` até a fila zerar). Acompanhar a aba **Processamento**.
6. **Validação de totais**: `npm run fiscal360:verify` (esperado: 0 divergências de receita oficial e destacados de mercado). Conferir manualmente: faturamento externo do ano na 360° = DRE/Faturamento do mesmo CNPJ e competência.
7. **Conferência por amostra**: 10 guias pagas — abrir a trilha de evidências, validar vínculo, baixa e comprovante contra o Nomus e o extrato; 5 títulos AP "pendentes" — decidir (confirmar/rejeitar) e conferir a trilha de auditoria.
8. **Comparativo visual** protótipo × interface (desktop 1280, tablet 768, celular 375) — ver [prototype-comparison](./fiscal-intelligence-360-prototype-comparison.md).
9. **Incremental**: após uma sincronização Nomus normal, `fiscal360:process` deve processar só o que mudou (conferir "documentos novos/alterados" em Processamento).
10. **Critérios de aceite**: dashboard p95 ≤ 1 s e drilldown p95 ≤ 2 s medidos no dataset real; 0 divergência no `verify`; nenhuma NF-e intercompany no faturamento externo; pago não supera as baixas do AP.

## 6. Procedimento de reversão (não destrutivo)

| Situação | Ação | Efeito |
|---|---|---|
| Problema na tela | Remover a permissão `finance.fiscal360.view` dos perfis | A aba some; dados permanecem |
| Processamento indesejado | Desligar worker/cron (`FISCAL360_WORKER_ENABLED` ausente) | Nada novo é materializado; leituras continuam |
| Dado materializado errado | **Reprocessar** (aba Processamento → reprocessamento seletivo, com motivo) ou `fiscal360:backfill` | Fatos são derivados e reconstruíveis; fontes intocadas |
| Regra do classificador/projeção errada | Aposentar a versão (`/rules/:id/retire`) | O processador reavalia só os títulos/projeções dependentes |
| Reversão total do módulo | Reverter o código (deploy anterior). **As tabelas `Fiscal*` novas podem permanecer** (não são referenciadas por código antigo) | Sem perda; reversão do schema é opcional |
| Remoção das tabelas (somente se pedido) | `DROP TABLE` das 15 tabelas e `DROP INDEX` dos 7 índices em janela autorizada | Fora do escopo automático |

Nenhuma tabela existente teve dado alterado, então reverter o código restaura 100% o comportamento anterior. As abas "Apuração e guias", "Inteligência fiscal" (T07) e "Regras de precificação" continuam intactas.

## 7. Riscos operacionais da migration
* `CREATE INDEX` (sem `CONCURRENTLY`) em 7 tabelas existentes: lock de escrita durante a criação. Em `NomusNfe`/`NomusAccountsPayable` o volume é moderado; executar fora de janela de sync Nomus. Se preferir, criar `CONCURRENTLY` manualmente antes e marcar a migration como aplicada.
* Backfill grava somente nas tabelas novas; carga de leitura sobre as fontes é em lotes de 500 por `updatedAt`.

## 8. Revisão adversarial (independente) — achados e tratamento

Revisão feita por um agente independente apenas com o código e a lista de riscos (sem as conclusões do autor). Achados confirmados e corrigidos (todos com teste de regressão em `fiscal360.review.test.ts` e/ou na suíte PostgreSQL 17):

| # | Achado | Tratamento |
|---|---|---|
| F1 | Visão de caixa contava em dobro um pagamento que a competência colocou em revisão (corrida entre partições) | Mudança de revisão reenfileira o mês de caixa; rematerializar o fato não reabre a contagem; teste real na PG17 |
| F2 | Duplicidade só era buscada dentro de uma competência | Universo ±1 mês + mesmo mês de caixa, tolerância de 3% (juros/multa), mesma empresa/tributo |
| F3 | Devido/saldo/vencido/projeção repetiam obrigações em revisão | Contagem de devido e saldo só para obrigações contadas; consultas filtram `countsInPaidTotals` |
| F4 | "Baixa sem numerário" com valor baixado contava como pago | `amountPaid = 0` + sinalização |
| F5 | Conciliação bancária parcial comprovava o valor inteiro | Comprovação exige soma conciliada ≥ valor pago |
| F6 | Título intercompany com "DARF 2089" virava pagamento tributário | Pendente (`INTERCOMPANY_TITLE`) até decisão manual |
| F7 | NF-e de entrada de empresa A recebida por B ia para A | Empresa do documento de entrada = destinatário do grupo |
| F8 | Mês de pagamento da guia em UTC | Data civil America/Sao_Paulo |
| F9 | Projeção: atrasos misturados a devidos futuros; tributo trimestral subestimado | Atrasos separados (desembolso, não "devidos"); janela usa receita realizada |
| — | Lease vencido era reivindicado sem limite de tentativas; lote maior que o lease | Reaper (`FAILED` ao esgotar); lease renovado antes de cada job |
| — | Cancelar job de entidade perdia a mudança descoberta | Só jobs de partição/projeção podem ser cancelados |

Também surgiram, nos testes reais em PostgreSQL 17, e foram corrigidos: colisão de `itemKey` ao mudar a empresa de uma obrigação (chave agora por partição); atalho "hash igual" do título AP que pulava a obrigação ancorada após desfazer vínculo; dois rebuilds de projeção simultâneos colidindo (serializados por lock); comparação `now()` dependente do fuso do servidor de banco (relógio UTC explícito); reenfileiramento de linhas já tratadas dentro da janela de sobreposição (mapa de tratadas).

### Riscos residuais (declarados)
1. **Backfill**: ~109 NF-e/s na máquina de desenvolvimento (documentos processados um a um); volumes muito grandes levam dezenas de minutos — por isso é retomável e fora do startup. Otimização futura: materializar documentos em lote por transação.
2. **Empresa não identificada**: documentos/obrigações sem CNPJ do grupo ficam em "UNKNOWN" e **fora** das visões por padrão (sinalizados em Auditoria); a receita da 360° pode ficar abaixo do Faturamento quando `cnpjEmitente` não resolve para uma empresa do grupo.
3. **Dados do AP**: a API do Nomus não envia CNPJ do favorecido, data de baixa, centro de custo nem histórico de baixas por parcela — a data de caixa depende da Tesouraria; pagamento sem data fica "sem data de caixa".
4. **NFS-e** sem fonte operacional: serviços entre Lazarios e Koppetel não aparecem; sem eliminação automática de serviços capitalizados.
5. **Projeção v1** usa o histórico de faturamento oficial; carteira de pedidos e compras projetadas ficam como contrato de integração futuro; créditos só via parâmetros explícitos.
6. **Pareamento de duplicidade** é guloso e determinístico por `anchorKey`; em casos raros com vários candidatos idênticos pode escolher outro par — resultado sempre "uma contagem" e revisável.
7. A varredura de conciliações da Tesouraria usa os índices existentes (sem índice de watermark novo).
