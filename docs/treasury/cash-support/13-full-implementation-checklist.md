# Checklist de cobertura das 24 etapas — Apoio ao Caixa

Estado em `71a9a80`, branch `feat/treasury-cash-support`.

**Nota sobre a classificação.** O enum pedido (CONCLUÍDA / CONCLUÍDA COM LIMITAÇÃO / FORA DO
ESCOPO / BLOQUEADA) não cobre etapas que simplesmente **ainda não foram executadas** — não estão
bloqueadas nem fora do escopo, apenas não começaram. Marcá-las como BLOQUEADA seria falso
(nada impede sua execução) e marcá-las de outra forma seria pior. Por isso uso um quinto rótulo
explícito: **NÃO INICIADA**. Toda etapa tem classificação e evidência objetiva do seu estado real.

---

## Etapa transversal — CASH-SUPPORT-P0-CONCURRENCY-001

| Campo | Conteúdo |
|---|---|
| **Status** | **CONCLUÍDA COM LIMITAÇÃO** |
| Arquivos | `services/treasuryReconciliationMatchService.server.ts`, `repositories/treasuryReconciliationMatchRepository.server.ts`, `.memory.ts`, `treasuryReconciliationConcurrency.test.ts` |
| Reutilizado | Motor `TreasuryReconciliation`, `treasuryMoney`, padrão de `$transaction` |
| Implementação | `SELECT ... FOR UPDATE` em ordem determinística de id; capacidade relida e validada dentro da transação; pernas do mesmo movimento agregadas antes de validar e gravadas uma vez |
| Testes | 6 novos (concorrência) + 20 de regressão |
| Comandos | `npx tsx --test ...Concurrency.test.ts`; `npx tsx --test` nos 3 arquivos de regressão; `npx tsc --noEmit` |
| Commit | `92f50d6` (fix), `71a9a80` (evidência) |
| Evidência | 6/6 e 20/20 passaram; zero erro de TS nos arquivos alterados; `08-p0-concurrency-fix-evidence.md` |
| **Limitação** | (a) residual do **título** ainda validado contra `openBalance` do payload, sem lock — concorrência sobre o mesmo título via movimentos diferentes pode exceder; (b) **idempotência ausente** no `accept` |
| Próxima ação | CS-000b: advisory lock por `officialTitleKey` + coluna `idempotencyKey` (migration aditiva nullable) |

---

## Etapas 1 a 24

### 1. Auditoria e decisões arquiteturais — **CONCLUÍDA**
Arquivos: `00-execution-memory.md`, `01-current-state-audit.md`, `02-architecture-decision-real-titles-only.md`.
Reutilizado: leitura de `treasuryCaixaService`, FIN-08, motor de conciliação, schema Prisma.
Implementação: auditoria completa das três fontes + ADR 001 com as três identidades.
Testes: n/a (documental). Comandos: git + buscas dirigidas. Commits: `f0821d7`, `24431e0`.
Evidência: bloqueio de identidade documentado e resolvido por redução de escopo.
Limitação: empresa e conta seguem indisponíveis no lado canônico. Próxima ação: nenhuma.

### 2. Matriz de cobertura — **CONCLUÍDA**
Arquivos: `03-existing-reconciliation-gap-matrix.md`.
Implementação: 48 requisitos classificados com evidência arquivo:linha; auditoria profunda do motor.
Commits: `24431e0`, revalidada em `da55038`.
Evidência: 25 REUTILIZAR / 14 COM ADAPTADOR / 6 LACUNA REAL / 1 FORA DO ESCOPO / 2 BLOQUEADO parcial.
Limitação: nenhuma. Próxima ação: nenhuma.

### 3. Backlog e MVP — **CONCLUÍDA**
Arquivos: `06-implementation-backlog.md`, `07-mvp-scope.md`, `05-p0-...defect.md`.
Implementação: revalidação das lacunas com termos e arquivos registrados (1 reclassificação);
21 itens em 4 trilhas com gates; seção de persistência adicional item a item.
Commit: `da55038`. Evidência: trilhas A(10) B(1) C(7) D(3); 4 persistências rejeitadas/adiadas.
Próxima ação: nenhuma.

### 4. Contratos — **NÃO INICIADA**
Item de backlog: CS-001. Arquivos previstos: `src/lib/treasury/contracts/cashSupport*.ts`.
A reutilizar: `treasuryMoney`, `treasuryDto`, `treasuryPagination`, `treasuryTimestamp`.
Evidência do estado: nenhum arquivo `cashSupport*` existe no repositório.
Bloqueio: nenhum — pode iniciar imediatamente. Próxima ação: executar CS-001.

### 5. Adaptador do Caixa canônico — **NÃO INICIADA**
CS-002. Previsto: `adapters/cashSupportCanonical*.ts`. Reutiliza `treasuryCaixaService.getBoard`.
Evidência: inexistente. Depende de CS-001. Próxima ação: após CS-001.

### 6. Adaptador bancário e OFX — **NÃO INICIADA**
CS-003. Reutiliza `treasuryBankMovementQueryService`, `treasuryReconciledBalanceRepository`.
Evidência: inexistente. Limitação conhecida: `AVAILBAL` e `DTSTART/DTEND` não são extraídos pelo
parser (lacunas #6 e #8) → warnings. Próxima ação: após CS-001.

### 7. Adaptador do TreasuryReconciliation — **NÃO INICIADA**
CS-004. Reutiliza `treasuryReconciliationMatchService` (leitura). Evidência: inexistente.
Próxima ação: após CS-001.

### 8. Read model unificado — **NÃO INICIADA**
CS-005. Desenho pronto em `04-proposed-read-model.md`; implementação inexistente.
Depende de CS-002/003/004. Próxima ação: após os adaptadores.

### 9. API read-only — **NÃO INICIADA**
CS-006. Reutiliza `requireAppAuth`, `requireResource`, ACL, feature flag.
Evidência: nenhuma rota `cash-support` em `treasuryRoutes.ts`. Próxima ação: após CS-005.

### 10. Workspace read-only — **NÃO INICIADA**
CS-007. Evidência: nenhum componente `CashSupport*` em `src/components/finance/treasury/`.
Próxima ação: após CS-006.

### 11. Sugestões — **NÃO INICIADA**
CS-008. Motor existe (`treasuryReconciliationSuggestionEngine.ts`) e será reutilizado sem
algoritmo novo. Evidência: nenhuma exposição no Apoio ao Caixa. Próxima ação: após CS-007.

### 12. Aceite e rejeição — **BLOQUEADA**
CS-011. **Bloqueio:** gate de escrita aberto — resíduos (a) e (b) do P0.
Evidência: `08-p0-concurrency-fix-evidence.md` §6. Próxima ação: concluir CS-000b.

### 13. Conciliação manual, parcial e múltipla — **BLOQUEADA**
CS-012/CS-013. Mesmo bloqueio. O risco é direto: 1:N e N:1 são exatamente os cenários que o
resíduo (a) não cobre. Próxima ação: CS-000b.

### 14. Tarifas, juros, descontos, abatimentos e diferenças — **BLOQUEADA**
CS-014. Mesmo bloqueio (dependem de `accept`). Kinds já existem no motor. Próxima ação: CS-000b.

### 15. Transferências — **BLOQUEADA**
CS-015. Mesmo bloqueio. `TreasuryTransfer` e alloc `TRANSFER` já existem. Próxima ação: CS-000b.

### 16. Investigação, auditoria e reversão — **BLOQUEADA**
CS-016. Mesmo bloqueio. `reverse` + frase forte + `TreasuryException` a avaliar antes de
qualquer tabela nova. Próxima ação: CS-000b.

### 17. Revalidação das fontes — **NÃO INICIADA**
CS-017. Reutilizar `treasuryProjectionSourceHash`, `version`, `fingerprint`.
Evidência: inexistente. Não bloqueada na parte de leitura. Próxima ação: após CS-005.

### 18. Maker-checker e revisão de período — **NÃO INICIADA**
CS-018/CS-019. Confirmado na Etapa 3 que **não existe** padrão de dual-control na Tesouraria
(lacuna #32); único hit foi `TREASURY_SCHEDULE_STATUSES.APPROVED`, que não é maker-checker.
Classificado como pós-MVP. Próxima ação: decisão de escopo sua.

### 19. Exportação e observabilidade — **NÃO INICIADA**
CS-009/CS-010. Reutiliza `treasuryReportRepository` (CSV/XLSX/PDF) e correlation id.
Evidência: inexistente. Próxima ação: após CS-006.

### 20. Hardening, segurança e imutabilidade do Nomus — **CONCLUÍDA COM LIMITAÇÃO**
Parte executada: correção do P0 com testes de concorrência e regressão; confirmação de que
nenhuma escrita ocorre fora de `TreasuryReconciliation*`; `TREASURY_RECONCILIATION_DOES_NOT_REALIZE_OFFICIAL`
preservado. Commit `92f50d6`.
**Limitação:** varredura de diff completa (float/parseFloat/consultas a Proposal/SalesOrder/DS/NF-e),
testes formais de imutabilidade do Nomus e auditoria de RBAC/ACL do novo módulo **não foram
feitos** — dependem de existir código do Apoio ao Caixa. Próxima ação: ao fim do Grupo E.

### 21. Validação funcional e end-to-end — **NÃO INICIADA**
Documento `09-end-to-end-validation.md` não existe. Depende de API + UI.
Próxima ação: após Grupo D.

### 22. Revisão final da arquitetura — **NÃO INICIADA**
`10-final-architecture-review.md` não existe. Não pode ser APROVADO enquanto o gate de escrita
estiver aberto (regra §29). Próxima ação: após Grupo E.

### 23. Pull request e handoff — **NÃO INICIADA**
`11-pull-request-handoff.md` não existe. Branch já publicada em `origin/feat/treasury-cash-support`.
Próxima ação: após etapa 22.

### 24. Plano de deploy e rollback — **NÃO INICIADA**
`12-production-deployment-plan.md` não existe. Documental, sem execução.
Próxima ação: após etapa 23.

---

## Resumo

| Métrica | Valor |
|---|---|
| Total de etapas | 24 (+1 transversal P0) |
| CONCLUÍDA | **3** (1, 2, 3) |
| CONCLUÍDA COM LIMITAÇÃO | **2** (20 + P0 transversal) |
| FORA DO ESCOPO | 0 |
| BLOQUEADA | **5** (12, 13, 14, 15, 16) |
| NÃO INICIADA | **14** (4–11, 17, 18, 19, 21, 22, 23, 24) |
| **Sem evidência** | **0** |

**Cobertura efetiva: 3 de 24 concluídas, 2 com limitação.** A funcionalidade **não está concluída**.

---

## Bloqueio único que trava 5 etapas

**CASH-SUPPORT-P0-CONCURRENCY-001, resíduos (a) e (b).**

- **(a) Residual do título sem lock** — `assertTreasuryReconciliationTitleOpenBalances` valida
  contra o `openBalance` recebido no payload, não contra saldo relido sob lock. Dois aceites
  concorrentes sobre o **mesmo título** com **movimentos diferentes** não disputam o mesmo lock.
  Exige decisão de modelo: o título é oficial do Nomus e não tem linha local a bloquear — a saída
  natural é advisory lock por `officialTitleKey`, seguindo `treasuryDailyClosingLock.ts`.
- **(b) Idempotência** — exige coluna `idempotencyKey` em `TreasuryReconciliationMatch`
  (migration aditiva e nullable). Impedimento anterior (schema com alterações não commitadas)
  **já não existe**: o working tree está limpo desde `d0d5a45`.

**Próximo comando seguro:** executar CS-000b. Arquivos:
`treasuryReconciliationMatchService.server.ts`, `treasuryReconciliationMatchRepository.server.ts`,
`prisma/schema.prisma` + migration oficial.

Em paralelo, a **Trilha A (etapas 4–11, 17, 19)** está livre e pode começar por CS-001 — não
depende do P0.

---

## Grupos (§35)

| Grupo | Conteúdo | Status |
|---|---|---|
| **A** | documentação, backlog, P0 | **CONCLUÍDO COM LIMITAÇÃO** — P0 com 2 resíduos |
| **B** | contratos, adaptadores, read model | não iniciado |
| **C** | API, workspace read-only, sugestões | não iniciado |
| **D** | ações de escrita, ajustes, transferências, reversões | bloqueado pelo P0 |
| **E** | segurança, exportação, observabilidade, testes | não iniciado |
| **F** | revisão final, handoff, plano de deploy | não iniciado |

**Continuar de:** Grupo A (fechar CS-000b) **ou** Grupo B (CS-001, contratos).
