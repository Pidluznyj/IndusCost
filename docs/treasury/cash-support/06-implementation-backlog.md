# Backlog executável — Apoio ao Caixa

Base: ADR 001 (`02`), matriz (`03`), read model (`04`), defeito P0 (`05`).

---

## Parte A — Revalidação das lacunas (Etapa 3)

Termos pesquisados e arquivos examinados por lacuna. Resultado: **1 reclassificação**.

### #4 — Correções OFX · mantém LACUNA REAL
- Termos: `supersede`, `correctedBy`, `replacedBy`, `voided`, `estorno`, `movementCorrection`.
- Examinados: `schema.prisma` (`TreasuryBankMovement`), `treasuryBankImportOfxApplyService.server.ts`, `contracts/treasuryDto.ts`.
- Nenhum campo de correção/estorno/supersede. Adaptador não resolve: o dado **não existe**.
- Exige: documentação + warning estruturado. Fechar exigiria alterar o importador — **proibido**.
- Risco: médio. Dependência: dono do importador OFX.

### #6 — Saldo *available* · mantém LACUNA REAL
- Termos: `AVAILBAL`, `availBal`, `availableBalance`, `LEDGERBAL`.
- Examinados: [treasuryOfxParser.ts:318-333](src/lib/treasury/ofx/treasuryOfxParser.ts:318), `treasuryReconciledBalanceRepository.server.ts`.
- **Evidência:** o parser extrai **apenas** `ledgerBalance` (`BALAMT` + `DTASOF`). `AVAILBAL` nunca é lido.
- Adaptador não resolve: o dado não chega ao consumidor. Fechar exige alterar o parser — **proibido**.
- Exige: warning. Não comparar saldo disponível.

### #8 — Cobertura de extrato · mantém LACUNA REAL (com nuance importante)
- Termos: `DTSTART`, `DTEND`, `statementCoverage`, `coveragePeriod`.
- Examinados: `treasuryOfxParser.ts`, `ofx/fixtures/sample-ofx1.ofx`.
- **Evidência nova:** o arquivo OFX **contém** o período (`DTSTART`/`DTEND`, fixture linhas 37-38), mas o parser **não o extrai** e nada é persistido.
- Ou seja: o dado existe na fonte e seria derivável **sem inventar nada** — mas só alterando o parser/`summaryJson`, o que está proibido.
- Exige: warning `STATEMENT_COVERAGE_UNKNOWN` agora; decisão do dono do importador depois. **Sem tabela nova.**

### #27 — Rejeição de sugestão · mantém LACUNA REAL (provável solução sem persistência)
- Termos: `reject`, `dismiss`, `discard` em `treasuryReconciliationSuggestions.server.ts`.
- Resultado: **nenhuma ocorrência**. Sugestões não são persistidas (motor puro, em memória).
- Como não há sugestão persistida, "rejeitar" pode ser **estado de sessão/UI**, sem banco.
- Exige: decisão na Etapa 11/12. **Persistir rejeição não está justificado hoje.**

### #30 — Capacidade fora da transação · mantém LACUNA REAL → **defeito P0**
- Termos: `FOR UPDATE`, `queryRaw`, `pg_advisory`.
- Examinados: `treasuryReconciliationMatchService.server.ts`, `treasuryDailyClosingRepository.server.ts`, `domain/treasuryProjectionLock.ts`.
- **Evidência favorável:** o projeto **já usa advisory lock** (`pg_try_advisory_lock`, fechamento diário). O mecanismo de correção é **reuso**, não invenção.
- Ver `05-p0-reconciliation-concurrency-defect.md`.

### #31 — Idempotência · **RECLASSIFICADO → REUTILIZAR COM ADAPTADOR**
- Termos: `Idempotency-Key`, `idempotencyKey`.
- Examinados: [treasuryConstants.ts:177](src/lib/treasury/contracts/treasuryConstants.ts:177), `treasuryBalanceController.ts`, `contracts/treasurySchemas.ts`, `TreasuryBalanceSnapshot`.
- **Evidência:** `idempotencyKey` é **padrão institucional** da Tesouraria (limite 128, unicidade em snapshot). Não é lacuna de infraestrutura — é **falta de aplicação** ao `accept`.
- Exige: aplicar o padrão existente (coluna aditiva nullable + unique). Risco: baixo.

### #32 — Maker-checker · mantém LACUNA REAL
- Termos: `makerChecker`, `approvedBy`, `approverUserId`, `dualControl`, `segregation`.
- Examinados: todo `src/lib/treasury`. Único hit: `TREASURY_SCHEDULE_STATUSES` com `"APPROVED"` — status de programação, **não** dual-control.
- Nenhum padrão de segregação criador/aprovador existe na Tesouraria.
- Exige: decisão de escopo na Etapa 18. **Pós-MVP.**

### Totais revisados

| Status | Antes | Agora |
|---|---|---|
| REUTILIZAR | 25 | 25 |
| REUTILIZAR COM ADAPTADOR | 13 | **14** |
| LACUNA REAL | 7 | **6** |
| FORA DO ESCOPO | 1 | 1 |
| BLOQUEADO parcial | 2 | 2 |

---

## Parte B — Revalidação dos bloqueios parciais

### #41 — Empresa
- **Disponível:** `companyCode` no lado bancário (movimento, batch, match, conta).
- **Ausente:** o board Caixa não recebe `companyId`; usa `companyAccounts[0].companyCode`.
- **Entregável agora:** MVP monoempresa, com `companyContext` explícito no lado bancário e warning quando o lado canônico não puder confirmar a empresa.
- **Permanece bloqueado:** filtro multiempresa da Linha do tempo.
- **Decisão necessária:** se a operação é de fato monoempresa hoje. **Pertence ao MVP** como warning, não como filtro.

### #42 — Conta
- **Disponível:** `accountId` obrigatório no movimento bancário; ACL por conta pronta.
- **Ausente:** o título canônico traz apenas `bankAccountName` (texto livre), sem `accountId`.
- **Entregável agora:** `accountContext` preenchido no lado bancário; **`null` + warning** no lado canônico.
- **Permanece bloqueado:** filtrar títulos por conta; conferência de saldo por conta que dependa do título.
- **Proibido:** casar título↔conta por semelhança de nome. **Não inventar.**

---

## Parte C — Backlog

Legenda: **RO** = read-only · **W** = write-enabled · **P0?** = bloqueado por CASH-SUPPORT-P0-CONCURRENCY-001.

| ID | Título | Matriz | Reutiliza | Lacuna | Arquivos prováveis | Banco | API | UI | Testes | Depende | Risco | Aceite | RO/W | P0? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **CS-000** | **Corrigir P0 de concorrência** | #30 | advisory lock do fechamento; `idempotencyKey` | Defeito | `treasuryReconciliationMatchService.server.ts`, `treasuryReconciliationMatchRepository.server.ts` | talvez coluna aditiva | não | não | concorrência real | — | **Alto** | 12 critérios do doc `05` | W | **é o P0** |
| CS-001 | Contratos do read model | #47,#48 | `treasuryMoney`, `treasuryDto`, `treasuryPagination` | — | `contracts/cashSupport*.ts` | não | não | não | contrato | — | Baixo | Previsão não conciliável por tipo | RO | não |
| CS-002 | Adaptador canônico | #9,#10,#11,#48 | `treasuryCaixaService.getBoard` | `lineKind` descartado | `adapters/cashSupportCanonical*.ts` | não | não | não | paridade centavo | CS-001 | Médio | Totais fecham com a Linha do tempo | RO | não |
| CS-003 | Adaptador bancário | #1,#2,#3,#5,#45 | `bankMovementQueryService`, `reconciledBalanceRepository` | #4,#6,#8 viram warning | `adapters/cashSupportBank*.ts` | não | não | não | sinal, conta, bankDate | CS-001 | Médio | Movimento sem match afeta posição | RO | não |
| CS-004 | Adaptador de conciliação | #12-#23 | `reconciliationMatchService` (leitura) | — | `adapters/cashSupportReconciliation*.ts` | não | não | não | 1:1, 1:N, N:1, parcial | CS-001 | Médio | Residual vem do motor | RO | não |
| CS-005 | Read model unificado | #47 | os três adaptadores | — | `services/cashSupportReadModel.server.ts` | não | não | não | anti-dupla-contagem | CS-002/3/4 | **Alto** | Título coberto não soma 2x | RO | não |
| CS-006 | API read-only | #38,#39,#40 | `requireResource`, ACL, flag | — | `controllers/cashSupportController.ts`, `treasuryRoutes.ts` | não | sim | não | authz, ACL, IDOR | CS-005 | Médio | Conta não autorizada nega | RO | não |
| CS-007 | Workspace read-only | — | padrões de grid/drawer | — | `components/finance/treasury/CashSupport*.tsx` | não | não | sim | render, empty, error | CS-006 | Baixo | Previsão sem botão conciliar | RO | não |
| CS-008 | Sugestões (visualização) | #25 | motor de sugestões | — | adapter + UI | não | sim | sim | score, sem gravação | CS-007 | Baixo | Nenhuma escrita ocorre | RO | não |
| CS-009 | Exportação | #35 | report exports | — | `repositories/treasuryReportRepository.server.ts` | não | sim | sim | export == tela | CS-006 | Baixo | Sem recálculo na exportação | RO | não |
| CS-010 | Observabilidade de leitura | — | logs/correlation id | — | controller/service | não | não | não | log sem segredo | CS-006 | Baixo | Sem credencial em log | RO | não |
| CS-011 | Aceite / rejeição | #26,#27 | `accept` corrigido | #27 provável sem persistência | delega ao serviço oficial | não | sim | sim | idempotência, conflito | **CS-000** | Alto | Repetição não duplica | W | **sim** |
| CS-012 | Conciliação manual 1:1 | #12 | `accept` | — | delega | não | sim | sim | validações | CS-011 | Alto | Direção/conta validadas | W | **sim** |
| CS-013 | Parcial e múltipla (1:N, N:1) | #13,#14,#15 | `accept` | — | delega | não | sim | sim | excesso rejeitado | CS-012 | Alto | Soma nunca excede | W | **sim** |
| CS-014 | Ajustes e classificações | #16-#20,#22 | allocation kinds | catálogo de `differenceCode` | delega | não | sim | sim | tarifa, desconto | CS-013 | Alto | Desconto cobre sem criar dinheiro | W | **sim** |
| CS-015 | Transferências | #21 | `TreasuryTransfer` | — | delega | não | sim | sim | consolidado zero | CS-013 | Médio | Consolidado = 0 | W | **sim** |
| CS-016 | Investigação e reversão | #23,#24 | `reverse`, `TreasuryException` | avaliar antes de tabela | delega | **avaliar** | sim | sim | residual recomposto | CS-013 | Alto | Auditoria preservada | W | **sim** |
| CS-017 | Source revalidation | — | `treasuryProjectionSourceHash` | avaliar | a definir | avaliar | não | sim | fonte alterada | CS-005 | Médio | Conciliação não apagada | RO/W | parcial |
| CS-018 | Maker-checker | #32 | — | **LACUNA REAL** | a definir | provável | sim | sim | maker ≠ checker | CS-016 | Alto | Criador não aprova | W | **sim** |
| CS-019 | Fechamento / revisão de período | #33,#34 | `TreasuryDailyClosing` | — | leitura + adaptador | não | sim | sim | reabertura | CS-016 | Médio | Período incompleto não conferido | W | **sim** |
| CS-020 | Hardening e E2E | — | suites existentes | — | testes | não | não | não | tudo | CS-019 | Médio | Nomus inalterado | — | — |

---

## Parte D — Trilhas

**TRILHA A — READ-ONLY SEGURA** (pode avançar antes do P0): CS-001 … CS-010 → **10 itens**

**TRILHA B — CORREÇÃO DO MOTOR OFICIAL** (obrigatória antes de qualquer escrita): CS-000 → **1 item**

**TRILHA C — OPERAÇÕES DE ESCRITA** (bloqueada até B aprovada): CS-011 … CS-016, CS-019 → **7 itens**

**TRILHA D — PÓS-MVP**: CS-017, CS-018, CS-020 → **3 itens**

---

## Parte E — Dependências e gates

| Etapa | Depende de | Pode iniciar? | Pode fazer merge? | Pode ir a produção? | Gate |
|---|---|---|---|---|---|
| CS-001…CS-010 (A) | — | **Sim** | Sim | Sim, com flag | Revisão normal |
| CS-000 (B) | — | **Sim, a qualquer momento** | Sim | Sim | **Testes concorrentes + revisão independente** |
| CS-011…CS-016, CS-019 (C) | CS-000 aprovado | **Não** | Não | Não | Aprovação explícita do P0 |
| CS-017, CS-018, CS-020 (D) | C | Não | Não | Não | Decisão de escopo |

**Regras invioláveis**
1. Read-only pode ser desenvolvido antes da correção P0.
2. Nenhuma ação de escrita pode ser habilitada, exposta na UI, liberada por feature flag ou aprovada para produção enquanto CASH-SUPPORT-P0-CONCURRENCY-001 não estiver resolvido.
3. Preferência explícita: **não implementar** telas de escrita antes da correção. Se implementadas, permanecem inacessíveis até aprovação.
4. A correção P0 exige testes unitários, integração, **concorrência real**, idempotência, regressão e revisão independente.

---

## Parte F — Persistência adicional

| Proposta | Necessidade | Por que o existente não atende | Alternativa sem persistência | Risco de duplicar autoridade | Decisão |
|---|---|---|---|---|---|
| `idempotencyKey` em `TreasuryReconciliationMatch` | Impedir duplo aceite (CS-000/CS-011) | Match não tem o campo; padrão existe em snapshot | Nenhuma confiável para escrita | Baixo — mesmo padrão institucional | **APROVADA em princípio**, na etapa CS-000. Migration **aditiva e nullable** |
| Tabela de cobertura de extrato (#8) | Saber se o extrato cobre o período | Dado existe no OFX mas o parser não extrai | Warning `STATEMENT_COVERAGE_UNKNOWN` | Alto — segunda autoridade sobre OFX | **REJEITADA no MVP** |
| Tabela de rejeição de sugestão (#27) | Não repetir sugestão descartada | Sugestão não é persistida | Estado de sessão/UI | Médio | **REJEITADA** — reavaliar em CS-011 |
| Tabela de investigação (#24) | Marcar movimento sob investigação | `TreasuryException` pode atender | Reusar `TreasuryException` | Alto | **ADIADA** — decidir em CS-016 |
| Estado de conciliação próprio | Apresentação | Motor já é autoridade | Derivar no read model | **Muito alto** | **REJEITADA — proibida pela ADR 001** |

Nenhuma persistência é aprovada apenas para facilitar a UI.

---

## Parte G — Sequência recomendada

1. CS-001 contratos · 2. CS-002 adaptador canônico · 3. CS-003 adaptador bancário ·
4. CS-004 adaptador de conciliação · 5. CS-005 read model · 6. CS-006 API read-only ·
7. CS-007 workspace read-only · 8. CS-008 sugestões read-only ·
**9. CS-000 correção P0** · 10. validação concorrente independente ·
11. CS-011 aceite/rejeição · 12. CS-012 manual · 13. CS-013 parcial/múltipla ·
14. CS-014 ajustes · 15. CS-015 transferências · 16. CS-016 investigação/reversão ·
17. CS-017 source revalidation · 18. CS-018 maker-checker · 19. CS-019 fechamento ·
20. CS-020 hardening · 21. E2E · 22. revisão final.

**Desvio autorizado:** CS-000 pode ser antecipado a qualquer momento — é independente da Trilha A
e corrige defeito que já afeta produção. Recomenda-se antecipá-lo se houver capacidade paralela.
