# Inteligência Fiscal 360° — auditoria, arquitetura e plano de dados

**Atualizado:** 2026-10-29
**Branch:** `feat/fiscal-intelligence-360` (base `origin/main` fc354038)
**Escopo:** Financeiro › Tributos › Inteligência Fiscal 360°
**Complementa:** [tax-source-of-truth.md](./tax-source-of-truth.md), [tax-data-target-model.md](./tax-data-target-model.md), [tax-data-t05-settlements.md](./tax-data-t05-settlements.md), [tax-data-t07-intelligence-report.md](./tax-data-t07-intelligence-report.md)
**Documentos irmãos:** [conciliação](./fiscal-intelligence-360-reconciliation.md) · [projeções](./fiscal-intelligence-360-forecast.md) · [homologação, performance e reversão](./fiscal-intelligence-360-homologation.md) · [protótipo × interface](./fiscal-intelligence-360-prototype-comparison.md)

---

## 0. Estado da `main` e frentes que podem conflitar

| Item | Situação em `origin/main` fc354038 | Impacto nesta missão |
|---|---|---|
| Última migration | `20261103120000_boa_vista_define_limite` | Próximo slot sintético: `20261104120000` |
| Tributos (`/taxes`) | 3 abas: Apuração e guias (T05), Inteligência fiscal (T07), Regras de precificação | Nova aba **Inteligência Fiscal 360°**; abas existentes preservadas |
| Exposure / Proposta×Pedido / LIKE SERASA / executor de deploy | Pushed, não implantados | Sem interseção de arquivos (só `server.ts`, `schema.prisma` — trechos distintos) |
| Worktrees locais | Várias frentes em `C:/Dev/induscost-*` | Desenvolvimento isolado em `C:/Dev/induscost-fiscal-360`; nenhuma outra worktree tocada |

## 1. Inventário das fontes

| Domínio | Fonte real | Arquivo(s) | Observação |
|---|---|---|---|
| NF-e (cabeçalho, status, classificação) | `NomusNfe` (espelho Nomus, `xmlRaw`, `payloadHash`) | `scripts/nomusNfesSync.ts`, `src/lib/nomusNfeMapper.ts`, `src/lib/nomusNfeClassification.ts` | Status 4 = autorizada, 7 = cancelada. Sem id de empresa: emitente por `cnpjEmitente`. |
| Tributo documental (A) | `NomusNfeFiscalSummary` + `NomusNfeTaxLine` (HEADER/ITEM) | `src/lib/nfeFiscalXmlParser.ts` (`nfe-xml-fiscal-v1`), `src/lib/nfeFiscalPersist.ts` | Parse já persistido e idempotente por `xmlHash+parserVersion`. IBS/CBS/IS em `extensibleTotals`. |
| Faturamento oficial | Predicado `fiscalNfeWhereSql()` + `nfeCompetenceDateSql()` | `src/lib/financeBillingNfeDashboard.ts` | Status 4 + `isMarketSale` + `MARKET_REVENUE` + competência + `valorLiquido`. Consumido por DRE, metas e faturamento. |
| Grupo econômico | `FINANCE_INTERNAL_GROUP_COMPANIES` | `src/lib/financeInternalGroupExclusions.ts` | Fonte única dos 3 CNPJs; `isIntercompanyPayable`, aliases de nome. |
| Apuração (B) | `FiscalApurationPeriod` + `FiscalApurationLine` | `src/lib/finance/fiscalSettlementService.server.ts` | Cadastro manual (MANUAL/IMPORT). Empresa só por `companyName`. |
| Guias (C) | `FiscalPaymentGuide` + `FiscalPaymentProof` | idem + `fiscalSettlementRoutes.ts` | `accountsPayableExternalId` = vínculo lógico ao AP; `dedupeKey` único. |
| Alocação gerencial (D) | `FiscalAllocation` | idem | Sempre `isManagerialOnly`. |
| Contas a pagar | `NomusAccountsPayable` | `scripts/nomusAccountsPayableSync.ts`, `src/lib/nomusAccountsPayableMapper.ts`, `src/lib/financeAccountsPayableRules.ts` | Full refresh + upsert por `payloadHash`. Ciclo de vida `sourcePresenceStatus`. |
| Tesouraria | `TreasuryReconciliationMatch` / `…Allocation` (`nomusSide=AP`, `nomusExternalId`) / `…MatchMovement` → `TreasuryBankMovement` | `src/lib/treasury/**` | Única evidência de **data bancária** de pagamento de título AP. |
| Auditoria fiscal | `FiscalSettlementAuditLog` | `fiscalSettlementService.server.ts` | Reutilizado para decisões manuais, reprocessamentos e mudanças de regra. |
| Permissões | Contrato `finance.taxes` / `finance.tax_apuration` | `src/lib/security/permissionContract/resources.ts`, `src/lib/permissionCatalog.ts` | `requireResource(resourceKey, action)`. |
| Exportação | `xlsx` (SheetJS) | `src/lib/finance/fiscalTaxIntelligenceExport.ts` | Buffer síncrono; sem `exceljs`. |
| Filas existentes | `TreasuryProjectionRecalcJob`, `MaterialStockSpreadsheetOutbox` | `treasuryProjectionRecalcJobRepository.server.ts` | Padrão `FOR UPDATE SKIP LOCKED` + `leaseToken` reutilizado como referência. |
| NFS-e | **Inexistente** | — | Nenhum endpoint/tabela. Suporte arquitetural apenas (`documentKind`). |

### 1.1 Limitações reais das fontes (verificadas no código)

1. **AP do Nomus não traz CNPJ do favorecido, data de baixa, data de pagamento nem centro de custo** na resposta real (`docs/generated/nomus-accounts-payable-api-diagnostic.md`). Os campos `personCnpj`, `settlementDate` e `paymentDate` existem no schema, mas costumam ser nulos.
2. **Não há histórico de baixas por título AP** (só AR tem `NomusReceivableReceipt`). O motor usa os valores agregados (`amountPaid`, `balancePayable`) e **não inventa granularidade**: um pagamento parcial aparece como um único fato com saldo.
3. **Data efetiva do pagamento**: prioridade (1) data bancária da conciliação de Tesouraria (`matchedCivilDate` de match `MATCHED`), (2) `paymentDate`/`settlementDate` do AP quando o Nomus enviar, (3) `paidAt` da guia. Sem nenhuma delas o fato fica **sem data de caixa** e não entra na visão por data de pagamento (contado à parte).
4. **Empresa da guia**: `FiscalPaymentGuide` não tem CNPJ. Resolução: período de apuração (`companyName`) → AP vinculado (`companyName`) → decisão manual. Sem resolução = pendência `GUIDE_COMPANY_UNKNOWN`.
5. **NFS-e** não tem fonte operacional — lacuna declarada, nenhum documento é criado.
6. O relatório T07 atual (`fiscalTaxIntelligenceService.server.ts`) lê tabelas operacionais na requisição com `take: 5000` (limite silencioso) e usa `vProd − vDesc` de **todas** as NF-e não canceladas como receita. Permanece como está (não removido); a 360° não o reutiliza para receita.

## 2. Matriz de entidades e relacionamentos

```
NomusNfe 1─1 NomusNfeFiscalSummary 1─N NomusNfeTaxLine          (camada A, existente)
   │
   └─1─1 FiscalDocumentFact 1─N FiscalDocumentTaxFact            (novo: fato normalizado por documento/tributo)

NomusAccountsPayable 1─1 FiscalApTitleFact                       (novo: classificação tributária + intercompany + evidência de Tesouraria)
FiscalPaymentGuide  ──(accountsPayableExternalId)── NomusAccountsPayable
FiscalPaymentGuide 1─N FiscalPaymentProof

FiscalPaymentFact  = 1 obrigação de pagamento, ancorada em
     • GUIDE  (FiscalPaymentGuide.id)            — evidências: AP vinculado, comprovantes, Tesouraria
     • AP_TITLE (NomusAccountsPayable.externalId) — título tributário sem guia
   únicos: anchorKey, guideId, apExternalId  → um título AP nunca vira dois pagamentos

FiscalApurationPeriod/Line (B) ──▶ FiscalMonthlySnapshot (apurado/créditos/devido)
FiscalReconciliationItem   (resultado das checagens por partição empresa×competência)
FiscalReconciliationDecision (revisão manual; nunca altera Nomus)
FiscalMonthlySnapshot      (empresa × competência × tributo; '*' = totais do documento/receita)
FiscalIntercompanySnapshot (emitente × destinatário × competência)
FiscalForecastScenario 1─N FiscalForecastSnapshot
FiscalProcessingJob / FiscalProcessingCheckpoint / FiscalProcessingRun
FiscalDataQualityIssue
FiscalRuleVersion          (regras versionadas: classificador AP, parâmetros tributários, reforma)
```

Chave de partição: `(companyCnpj, competenceMonth)` com `companyCnpj` = 14 dígitos de uma empresa do grupo ou `UNKNOWN`.

## 3. Regras de negócio já existentes (reutilizadas, não duplicadas)

| Regra | Onde | Uso na 360° |
|---|---|---|
| Faturamento oficial | `fiscalNfeWhereSql("emissao")` | Calculado **no SQL de carga** do fato (`isOfficialBilling`) — mesma expressão da DRE/Faturamento. |
| Competência da NF | `nfeCompetenceDateSql("emissao")` | `competenceMonth` do fato. |
| Classificação MARKET/INTERCOMPANY/LOGISTICS | `classifyNomusNfeBilling`, coluna `billingClassification` | Lida da coluna, não recalculada. |
| Grupo econômico | `FINANCE_INTERNAL_GROUP_COMPANIES`, `isIntercompanyPayable` | Empresa do fato, destinatário interno, AP intercompany. |
| Status AP (cancelado, baixa sem numerário) | `normalizeAccountsPayableTitle` | Situação do título no fato AP. |
| Pago oficial da guia vinculada | T05: AP é a fonte do pago quando há vínculo | Mantido: guia com AP usa `amountPaid` do AP. |
| Status de guia | `FiscalGuideStatus` (CANCELLED/REVERSED fora do pago) | Mantido. |

## 4. Lacunas identificadas

| # | Lacuna | Tratamento |
|---|---|---|
| L1 | Nenhuma materialização: tudo recalculado na requisição | Fatos + snapshots persistidos, fila incremental |
| L2 | AP tributário não identificado | Classificador determinístico versionado + pendência de classificação + revisão manual |
| L3 | Dupla contagem guia × AP × Tesouraria | `FiscalPaymentFact` com âncora única e evidências complementares |
| L4 | Receita do T07 ≠ faturamento oficial | Receita só de `isOfficialBilling` |
| L5 | Sem CNPJ na guia/apuração | Resolução por nome canônico + decisão manual + pendência |
| L6 | Sem data de baixa no AP | Tesouraria → AP → guia; senão “sem data de caixa” |
| L7 | Sem histórico de baixas | Documentado; fato agregado |
| L8 | NFS-e indisponível | `documentKind` previsto; lacuna exibida |
| L9 | Sem parâmetros tributários por CNPJ (regime/alíquotas) | Projeção por razão histórica observada; parâmetros opcionais versionados (`FiscalRuleVersion`) |
| L10 | Carteira de pedidos não integrada à projeção | Fora da v1 — projeção usa histórico de faturamento oficial (declarado na UI) |

## 5. Arquitetura proposta

### 5.1 Princípios

1. **Leitura nunca processa fonte bruta**: os GETs da 360° só leem `Fiscal*Fact`, `Fiscal*Snapshot`, `FiscalProcessing*` e `FiscalDataQualityIssue`. Nenhum parse de XML, nenhuma varredura de `NomusNfe`/`NomusAccountsPayable` no GET (teste de contrato garante).
2. **Processamento fora do HTTP**: `scripts/fiscal360Process.ts` (CLI, para cron autorizado) e worker opcional em processo (`FISCAL360_WORKER_ENABLED=1`, desligado por padrão). O botão **Atualizar** só relê o estado.
3. **Incremental por watermark + hash**: descoberta por `updatedAt` (com sobreposição de 10 min) e comparação de `sourceHash` + `ruleVersion` com o fato persistido. Só o que mudou vira job.
4. **Idempotência**: jobs com `dedupeKey` e índice único parcial `WHERE status = 'PENDING'`; fatos com chave única por origem; reaplicar o mesmo job não muda nada.
5. **Concorrência**: claim com `FOR UPDATE SKIP LOCKED` + `leaseToken` + `leaseUntil` (jobs órfãos voltam à fila); rebuild de partição sob `pg_advisory_xact_lock(namespace, hash(partição))`.
6. **Publicação consistente**: cada partição é reconstruída numa transação (delete + insert); leitores veem a versão anterior ou a nova inteira. `snapshotVersion` por linha.
7. **Invalidação seletiva**: mudança num fato marca apenas as partições antigas **e** novas afetadas (mudança de competência invalida as duas).
8. **Sem infraestrutura nova**: PostgreSQL apenas (sem Redis/Kafka).

### 5.2 Pipeline

```
Descoberta (watermark)            Jobs de entidade                 Jobs de partição            Projeção
NomusNfe/Summary.updatedAt  ──▶  MATERIALIZE_DOCUMENT  ─┐
NomusAccountsPayable.updatedAt ▶ MATERIALIZE_AP_TITLE ─┼──▶ REBUILD_PARTITION(cnpj, mês) ──▶ REBUILD_FORECAST
FiscalPaymentGuide/Proof/…   ──▶ MATERIALIZE_GUIDE    ─┤      1. conciliação da partição
Treasury match (AP)          ──▶ (AP title re-hash)   ─┤      2. pendências de qualidade
FiscalApuration*.updatedAt   ──▶ ─────────────────────┘      3. snapshot mensal + intercompany
FiscalReconciliationDecision ──▶ MATERIALIZE_GUIDE/AP_TITLE
FiscalRuleVersion (mudança)  ──▶ reclassificação AP ou só REBUILD_FORECAST (parâmetros)
```

Prioridades: entidade 10 → partição 50 → projeção 80. Tentativas: 5, backoff exponencial (30 s × 2ⁿ). Falha definitiva = `FAILED` (visível no painel, reprocessável).

### 5.3 Versões de regra

| Chave | Versão inicial | Invalida |
|---|---|---|
| `fiscal360.document` | `2026-10-29.1` | fatos de documento |
| `fiscal360.ap-classifier` | `2026-10-29.1` + regras configuráveis (`FiscalRuleVersion`) | fatos AP + partições |
| `fiscal360.payment` | `2026-10-29.1` | fatos de pagamento |
| `fiscal360.snapshot` | `2026-10-29.1` | partições |
| `fiscal360.forecast` | `2026-10-29.1` | projeções (nunca documentos) |

## 6. Plano de migrations

Migration única e aditiva `20261104120000_fiscal_intelligence_360`:

- 15 tabelas novas (`FiscalDocumentFact`, `FiscalDocumentTaxFact`, `FiscalApTitleFact`, `FiscalPaymentFact`, `FiscalReconciliationItem`, `FiscalReconciliationDecision`, `FiscalMonthlySnapshot`, `FiscalIntercompanySnapshot`, `FiscalForecastScenario`, `FiscalForecastSnapshot`, `FiscalProcessingJob`, `FiscalProcessingCheckpoint`, `FiscalProcessingRun`, `FiscalDataQualityIssue`, `FiscalRuleVersion`).
- Índices `updatedAt` novos em tabelas existentes para a descoberta: `NomusNfe`, `NomusNfeFiscalSummary`, `NomusAccountsPayable`, `FiscalPaymentGuide`, `FiscalApurationPeriod`, `FiscalApurationLine`. Nenhuma coluna alterada ou removida.
- Índice único parcial escrito à mão: `FiscalProcessingJob_pending_dedupe_key` (`dedupeKey`) `WHERE status = 'PENDING'`.
- Sem FKs para tabelas espelho do Nomus (padrão do projeto: vínculo lógico por `externalId`); FKs apenas entre tabelas novas (`FiscalDocumentTaxFact → FiscalDocumentFact`, `FiscalForecastSnapshot → FiscalForecastScenario`) com `ON DELETE CASCADE`.
- Detalhes de índices/constraints: §6 de [fiscal-intelligence-360-homologation.md](./fiscal-intelligence-360-homologation.md).

## 7. Plano de processamento incremental e backfill

- **Backfill histórico** = a mesma descoberta com checkpoint zerado, em lotes (`--batch 500`), por fonte, com cursor `(updatedAt, id)` persistido em `FiscalProcessingCheckpoint` a cada lote. Interrompível (Ctrl+C / `--max-batches`), reiniciável do cursor, idempotente.
- **Somente leitura** das fontes operacionais; escrita exclusivamente nas tabelas `Fiscal*` novas (+ `FiscalSettlementAuditLog` para trilha).
- **Validação de totais**: `--verify` compara, por mês e empresa, a receita oficial materializada com a soma direta via `fiscalNfeWhereSql` e o destacado materializado com a soma das linhas HEADER, gravando divergências em `FiscalDataQualityIssue`.
- Nada roda no startup. Nada roda automaticamente em homologação/produção.

## 8. Validação e rollback não destrutivo

- Gates: testes unitários e de integração (fakes em memória + PostgreSQL 17 descartável quando `COMMISSION_PG17_BIN` estiver disponível), `tsc` sem novos erros, build, `check:frontend-server-imports`, `check:browser-bundle`.
- Rollback: desligar o worker (`FISCAL360_WORKER_ENABLED` ausente) e retirar a permissão `finance.fiscal360.view` dos perfis (a aba só aparece com ela) — tabelas novas podem ficar; nenhuma tabela existente teve dado alterado. Roteiro completo em [fiscal-intelligence-360-homologation.md](./fiscal-intelligence-360-homologation.md).

## 9. Matriz de rastreabilidade (indicador → fonte)

| Indicador | Camada | Tabela materializada | Fonte original | Regra |
|---|---|---|---|---|
| Tributos documentais destacados | A | `FiscalDocumentTaxFact` → snapshot `highlightedAmount` | `NomusNfeTaxLine` HEADER | NF-e autorizada (status 4); cancelada fora; ICMS-ST/desonerado/FCP/IBS/CBS em colunas separadas |
| Faturamento externo | — | `FiscalDocumentFact.isOfficialBilling` → `officialRevenue` | `NomusNfe.valorLiquido` | `fiscalNfeWhereSql("emissao")` |
| Faturamento interno (eliminável) | — | `intercompanyRevenue` | `NomusNfe` com `billingClassification=INTERCOMPANY` autorizada | não entra no externo |
| Tributos apurados / créditos / devidos | B | snapshot `assessed/credits/amountDue` | `FiscalApurationLine` (período não cancelado) | sem fabricar apuração a partir de NF |
| Impostos efetivamente pagos | C | `FiscalPaymentFact.paidAmount` (contado uma vez) | AP vinculado (`amountPaid`) › guia (`amountPaid`) | possível duplicidade fica **em revisão**, fora do total |
| Pagamentos comprovados | C | `paidProvenAmount` | `FiscalPaymentProof` ou conciliação bancária de Tesouraria | evidência documental/bancária |
| Baixas sem comprovação | C | `paidUnprovenAmount` | AP com baixa sem comprovante/banco | — |
| Saldo a pagar / vencido | C | `openBalance`, `overdueAmount` | `balanceDue` da guia, `balancePayable` do AP | vencido = `dueDate < hoje` |
| Carga tributária efetiva de caixa | A+C | calculada na leitura sobre snapshot | pago por competência ÷ faturamento externo | `null` + “Dados insuficientes” sem pagamentos/receita |
| % conciliado | C | `FiscalReconciliationItem` | checagens da partição | itens OK ÷ itens totais |
| Pendências de classificação | C | `FiscalApTitleFact.classificationStatus=PENDING` | AP | confiança insuficiente |
| Última atualização | — | `FiscalProcessingRun`, `FiscalProcessingCheckpoint` | — | — |
