# Central de Tesouraria — Checklist de validação funcional pós-deploy

**Audiência:** operador técnico + equipe financeira.  
**Cursor / agentes:** **não** executam este checklist em produção.  
**Pré-requisito:** deploy concluído conforme [PRODUCTION-DEPLOYMENT.md](./PRODUCTION-DEPLOYMENT.md) e smoke técnico `bash scripts/treasury/postdeploy-validation.sh` OK.

**Objetivo:** confirmar que a Central de Tesouraria está operacional após implantar em `/opt/induscost` (`main`), sem esconder falhas e sem apagar dados.

**Separação obrigatória**

| Classe | Pode escrever no banco? | Quem executa |
|--------|-------------------------|--------------|
| **A — Somente leitura** | Não | Operador técnico (sessão autenticada + SQL read-only) |
| **B — Dados de teste** | Sim (escopo controlado / empresa de homologação) | Operador técnico com aprovação |
| **C — Manual financeiro** | Sim, operação real | Equipe financeira |

Flags: ver [19-ROLLOUT.md](./19-ROLLOUT.md). Se a subflag estiver OFF, o item correspondente deve retornar bloqueio esperado (404/`API route not found` ou aba oculta) — **não** é defeito.

---

## Como registrar o resultado

Para cada item: `OK` / `FAIL` / `SKIP` (flag off ou fora de escopo) + evidência (HTTP code, requestId, print, query).  
Em `FAIL`: parar a classe B/C se houver risco; avaliar [ROLLBACK.md](./ROLLBACK.md).

Variáveis usadas abaixo (preencher no host):

```text
BASE=http://127.0.0.1:3000
COOKIE=...                 # sessão autenticada com finance.treasury*
COMPANY=...                # companyCode operacional
ACCOUNT_ID=...             # conta de teste/homolog (classe B)
```

Chamadas HTTP de exemplo assumem cookie de sessão. Ajuste headers conforme o ambiente.

---

# A — Validações somente leitura

Não criar contas, snapshots, OFX, conciliações, fechamentos nem mutar títulos.

## A1. Health e plataforma

- [ ] `GET $BASE/api/health` → sucesso.
- [ ] `GET $BASE/api/app-version` → commit/versão coerente com o deploy.
- [ ] HTML raiz serve `/assets/index-*.js` (não Vite dev).
- [ ] `GET $BASE/api/finance/treasury/health` → `200` (módulo on) **ou** `404`/`503` fail-closed (módulo off) **ou** `401`/`403` sem sessão.
- [ ] `GET $BASE/api/finance/treasury/availability` (autenticado) → `ok:true`, `enabled`, mapa `flags` completo.
- [ ] Rodar `bash scripts/treasury/postdeploy-validation.sh` e arquivar o log.

## A2. Migrations

- [ ] `cd /opt/induscost && npx prisma migrate status` → sem migrations pendentes esperadas (ou lista explícita se soft-launch parcial).
- [ ] Confirmar presença das migrations Tesouraria em `prisma/migrations/*treasury*` no código deployado.
- [ ] **Não** rodar `migrate deploy` de novo neste passo só para “testar”.

## A3. Tabelas (existência / contagens read-only)

Com cliente SQL **somente SELECT** (não editar dados):

- [ ] Existem tabelas/models críticos (nomes Prisma → tabelas físicas conforme schema), entre outros:
  - `TreasuryFinancialAccount`, `TreasuryFinancialAccountAccess`, `TreasuryBalanceSnapshot`
  - `TreasuryTitleOperationalComplement`, `TreasuryPaymentPromise`, `TreasuryCollectionAction`, `TreasuryDispute`
  - `TreasuryProjectionRun`, `TreasuryProjectionDayLine`, `TreasuryProjectionCompositionItem`, `TreasuryProjectionRecalcJob`
  - `TreasuryTransfer`, `TreasuryLedgerEntry`, `TreasuryException`, `TreasuryAlertSettings`
  - `TreasuryDailyClosing` (+ satélites de posição/pendência/ressalva/reabertura)
  - `TreasuryBankImportBatch`, `TreasuryBankMovement`
  - `TreasuryReconciliationMatch` (+ movements/allocations)
  - `TreasuryAuditLog`
- [ ] Contagens `SELECT COUNT(*)` não precisam ser > 0 no go-live (soft-launch), mas a query não pode falhar com “relation does not exist”.
- [ ] Registrar contagens baseline no ticket (antes de classe B).

## A4. Permissões e flags

- [ ] Usuário **sem** `finance.treasury` não acessa nav/API (403/deny).
- [ ] Usuário com `finance.treasury` `view` acessa availability.
- [ ] Recurso fino: dashboard / accounts / receivables / payables / reports / closing / reconciliation / audit — deny quando bag ausente.
- [ ] Subflag OFF → aba oculta na UI e endpoint correspondente 404 fail-closed.
- [ ] Bags irmãs `finance.view` **não** abrem Tesouraria sozinhas.
- [ ] Leituras CR/CP Tesouraria também exigem `finance.accounts_receivable|payable` `view` quando aplicável.

## A5. Contas (leitura)

- [ ] `GET /api/finance/treasury/accounts` lista (ou vazio legítimo).
- [ ] `GET /api/finance/treasury/accounts/:id` com id autorizado.
- [ ] Tentativa de id de outra empresa/usuário sem ACL → deny (anti-IDOR).
- [ ] UI `/finance/treasury/accounts` carrega estados vazio/loading/erro corretamente.

## A6. Saldos / posição (leitura)

- [ ] `GET .../accounts/:id/balances` e `.../balances/latest`.
- [ ] `GET .../accounts/:id/balance-position` retorna observado/calculado/conciliado/divergência sem ocultar ausência.
- [ ] UI de saldo (se flag balances on) abre sem crash.

## A7. Dashboard

- [ ] `GET /api/finance/treasury/dashboard?date=YYYY-MM-DD` (flag dashboard).
- [ ] Cards de saldo / previsto×realizado / contas / alertas renderizam.
- [ ] `GET /forecast-vs-actual` e `GET /alerts` respondem.
- [ ] Freshness/stale aparece quando fontes atrasadas (não precisa forçar stale).

## A8. AR (contas a receber) — leitura

- [ ] `GET /receivables` com paginação/filtros básicos.
- [ ] Abrir um título existente (se houver) no drawer — sem mutar.
- [ ] `GET .../customer-summary` quando houver título.
- [ ] Conferir que `dueDate` oficial **não** é substituído por expectativa na UI.

## A9. AP (contas a pagar) — leitura

- [ ] `GET /payables` + detalhe.
- [ ] `GET /payment-schedule` (flag programação) — só leitura.
- [ ] UI `/payables` e atalho de programação coerentes com flags.

## A10. Projeção / agenda — leitura

- [ ] `GET /projections/latest` e/ou `GET /projections/compare`.
- [ ] `GET /agenda` para horizonte curto (ex.: 7 dias).
- [ ] UI agenda + comparação de cenários carregam.
- [ ] **Não** chamar `POST /projections/calculate` nesta classe.

## A11. Exceções — leitura

- [ ] `GET /exceptions` lista/filtra.
- [ ] UI `/exceptions` e deep-links não quebram.
- [ ] `GET /alert-settings` (leitura).

## A12. Fechamento — leitura

- [ ] `GET /daily-closing` histórico.
- [ ] `GET /daily-closing/preview?date=...&companyCode=...` (não fecha).
- [ ] UI `/closing` mostra preview/checklist sem confirmar close.

## A13. OFX / movimentos — leitura

- [ ] `GET /bank-imports` e `GET /bank-movements` (flag reconciliation).
- [ ] UI `/bank-movements` e alias `/ofx` abrem.
- [ ] **Não** fazer upload/preview/apply nesta classe.

## A14. Conciliação — leitura

- [ ] `GET /reconcile/workspace`.
- [ ] `GET /reconciliations?bankMovementId=...` se houver movimento.
- [ ] UI `/reconcile` carrega sem auto-match.

## A15. Relatórios — leitura

- [ ] `GET /reports/:reportKey` para ao menos 2 keys (ex.: posição e planned-vs-actual).
- [ ] UI `/reports` seleciona período e renderiza.
- [ ] Export CSV/XLSX/PDF: se testar download, preferir relatório pequeno; ainda é leitura do ponto de vista de domínio (gera arquivo, não muta Tesouraria).

## A16. Logs

- [ ] `tail -n 100 /tmp/induscost-server.log` — sem stack trace contínuo pós-smoke.
- [ ] Logs de pré/pós deploy em `/tmp/induscost-treasury-deploy/` arquivados.
- [ ] Confirmar ausência de secrets (senha/DATABASE_URL) impressos em claro nos logs recentes.

## A17. Jobs

- [ ] Catálogo de jobs Tesouraria presente no código (`listTreasuryJobs` / docs 18).
- [ ] Confirmar se workers/recalc estão habilitados neste ambiente (ou documentar SKIP se soft-launch sem worker).
- [ ] Inspecionar fila `TreasuryProjectionRecalcJob` (contagens por status) — **SELECT only**.
- [ ] Nenhum job “explodindo” em loop de erro no log.

## A18. Performance (leitura / observação)

- [ ] Tempo de `GET /dashboard` aceitável em horário representativo (anotar p50/p95 subjetivos ou curl `-w`).
- [ ] Tempo de `GET /agenda` / `GET /receivables` página 1.
- [ ] Sem timeout 60s em listagens padrão.
- [ ] Comparar com [PERFORMANCE_BENCHMARKS.md](./PERFORMANCE_BENCHMARKS.md) se houver baseline.

## A19. Ausência de duplicidades (leitura)

- [ ] Relatório/consulta: não somar pedido+NF+título na mesma composição (amostra visual).
- [ ] `GET /forecast-vs-actual` com `doesNotSumForecastAndActual` (quando exposto).
- [ ] Movimentos bancários: fingerprints únicos por conta — `SELECT` de duplicatas `(accountId, fingerprint)` deve retornar 0 linhas.
- [ ] Complementos: unicidade `(titleType, officialTitleId)` — sem duplicata ativa.
- [ ] Transferências: consolidado neutro na amostra (UI/dashboard) quando houver transferências.

---

# B — Validações que criam dados de teste

**Somente** com aprovação, preferencialmente `companyCode` / conta de **homologação**.  
Usar prefixos claros (`TEST-TREASURY-YYYYMMDD`).  
Ao final: desativar conta de teste ou deixar documentada — **não** `DELETE` físico de histórico.

## B1. Conta + ACL

- [ ] `POST /accounts` cria conta TEST.
- [ ] `PUT /accounts/:id/access` concede/revoga acesso de usuário de teste.
- [ ] Releitura lista a conta; máscaras respeitadas para quem não pode revelar.

## B2. Saldo

- [ ] `POST .../balance-snapshots` com `Idempotency-Key` → cria snapshot.
- [ ] Repetir mesma key → não duplica efeito.
- [ ] `balance-position` reflete observado.

## B3. Dashboard / projeção (escrita controlada)

- [ ] `POST /projections/calculate` horizonte curto (ex.: 7 dias) na empresa de teste.
- [ ] `GET /projections/latest` e `compare` após calculate.
- [ ] Dashboard do dia da conta TEST mostra saldos coerentes.

## B4. AR operacional (overlays) — sem mutar Nomus

Usar título oficial **já existente** (read Nomus) + complemento:

- [ ] `PUT .../expectation` com motivo (não altera `dueDate` oficial).
- [ ] `POST .../promises` parcial; listar; cancelar promessa de teste.
- [ ] `POST .../collection-actions` append-only; cancel lógico.
- [ ] Contestação de teste (`disputes`) sem zerar saldo oficial.

## B5. AP programação

- [ ] `POST .../program-payment` em título de teste/homolog.
- [ ] Impacto de caixa/alerta negativo aparece quando aplicável.
- [ ] Cancelar programação de teste.

## B6. Exceções

- [ ] Após B2–B5, `GET /exceptions` mostra itens pertinentes (ou gera via fluxo conhecido).
- [ ] Ack/assign/resolve **somente** em exceção de teste.

## B7. Fechamento (cuidado)

Preferir data civil **sem** impacto operacional real (empresa TEST):

- [ ] Preview → close com ressalvas se necessário → get → **reopen** (não deixar CLOSED indevido em empresa produtiva).
- [ ] Se não houver empresa TEST: **SKIP** e mover close real para classe C.

## B8. OFX em ambiente seguro

Regras:

- Arquivo OFX **sintético/fixture** (não extrato real de cliente).
- Conta TEST.
- Flags `ofxImport` + `reconciliation` ON.

Passos:

- [ ] `POST /bank-imports/ofx/preview` (multipart) → classifica NEW/DUPLICATE/INVALID.
- [ ] Conferir que **não** persistiu movimentos antes do apply.
- [ ] `POST /bank-imports/ofx/apply` com token do preview.
- [ ] Reaplicar mesmo arquivo → anti-duplicidade (DUPLICATE / idempotência por `fileSha256`).
- [ ] Listar movimentos/lote criados.

## B9. Conciliação (teste)

- [ ] Aceitar match 1:1 em movimento TEST + título/abertura de teste (sem baixa Nomus).
- [ ] `unmatch` ou `reverse` com frase `REVERTER` + justificativa.
- [ ] Movimento volta a estado conciliável; audit REVERSE presente.

## B10. Relatórios / audit / ledger teste

- [ ] Lançamento manual TEST + reverse.
- [ ] `GET /audit` contém CREATE/UPDATE/IMPORT/REVERSE da sessão B.
- [ ] Relatório inclui linha da conta TEST no período.

## B11. Duplicidades após escrita

- [ ] Reconsultar fingerprints duplicados → 0.
- [ ] Idempotency de snapshot/OFX não gerou linhas extras.
- [ ] Transferência TEST (se feita): consolidado permanece neutro.

## B12. Limpeza responsável

- [ ] Desativar conta TEST (`deactivate`) em vez de delete.
- [ ] Documentar IDs criados no ticket.
- [ ] **Proibido:** `TRUNCATE`/`DELETE` em massa em tabelas Treasury*.

---

# C — Validações manuais (equipe financeira)

Executar em horário combinado, com usuário real e dados reais (ou cópia acordada). Técnico apenas apoia.

## C1. Abertura do dia

- [ ] Seguir [manuals/GUIDE-DAY-OPENING.md](./manuals/GUIDE-DAY-OPENING.md).
- [ ] Conferir saldos observados das contas operacionais.
- [ ] Dashboard do dia reflete a realidade do caixa.

## C2. Contas e saldos operacionais

- [ ] Contas ativas corretas (instituição, liquidez, consolidado, saldo mínimo).
- [ ] Atualização de saldo do dia (se processo manual) com responsável certo.
- [ ] Divergência observado×calculado entendida (não “zerar” para esconder).

## C3. Cobrança / AR

- [ ] Seguir [manuals/GUIDE-COLLECTION.md](./manuals/GUIDE-COLLECTION.md).
- [ ] Amostra de títulos em atraso: expectativa/promessa/cobrança fazem sentido de negócio.
- [ ] Vencimento oficial intacto após overlays.
- [ ] Resumo do cliente útil para cobrança.

## C4. Contas a pagar / programação

- [ ] Programação da semana alinhada ao caixa.
- [ ] Holds/liberações conforme política interna.
- [ ] Agenda/payment-schedule batem com a operação.

## C5. Projeção e decisões

- [ ] Cenários contratual / provável / confirmado compreensíveis.
- [ ] Primeira data de saldo negativo (se houver) é acionável.
- [ ] Transferências planejadas não “inventam” caixa consolidado.

## C6. Exceções e alertas

- [ ] Fila de exceções priorizadas é trabalhável.
- [ ] Alertas do dashboard não são ruído inútil (ajustar settings se preciso).

## C7. Conciliação bancária real

- [ ] Seguir [manuals/GUIDE-RECONCILIATION.md](./manuals/GUIDE-RECONCILIATION.md).
- [ ] Importar OFX **real** apenas após B8 OK em conta correta.
- [ ] Conferir duplicatas de arquivo/fingerprint.
- [ ] Conciliar amostra do dia; reverso só com justificativa forte.

## C8. Fechamento do dia

- [ ] Seguir [manuals/GUIDE-DAY-CLOSING.md](./manuals/GUIDE-DAY-CLOSING.md).
- [ ] Preview → checklist → ressalvas → close.
- [ ] Reabertura só com processo formal (não “por teste”).

## C9. Relatórios gerenciais

- [ ] Relatórios do dia/semana batem com expectativa da tesouraria.
- [ ] Export CSV/XLSX/PDF utilizável para arquivo/controladoria.
- [ ] Ausência de dupla contagem óbvia (pedido vs título vs baixa).

## C10. Aceite soft-launch

- [ ] Flags do escopo homologado permanecem ON; demais OFF até aceite.
- [ ] Problemas abertos listados com severidade (P1 bloqueia go-live amplo).
- [ ] Assinatura/aceite da equipe financeira + TI no ticket.

---

## Ordem recomendada de execução

1. Classe **A** completa (e `postdeploy-validation.sh`).  
2. Classe **B** em empresa/conta TEST (se autorizada).  
3. Classe **C** com financeiro.  
4. Ampliar subflags conforme [19-ROLLOUT.md](./19-ROLLOUT.md).

## Critérios de “pós-deploy funcional OK”

- A1–A4 + A16 sem FAIL.
- Itens das áreas com flag ON em A5–A15/A17–A19 sem FAIL (SKIP só por flag off documentada).
- Se B autorizada: B8 (OFX seguro) + B9 (conciliação teste) + B11 OK.
- C10 aceite registrado.

## Referências

- [PRODUCTION-DEPLOYMENT.md](./PRODUCTION-DEPLOYMENT.md)
- [ROLLBACK.md](./ROLLBACK.md)
- [14-PERMISSIONS-AND-FEATURE-FLAGS.md](./14-PERMISSIONS-AND-FEATURE-FLAGS.md)
- [13-APIS.md](./13-APIS.md)
- [REQUIREMENTS-TRACEABILITY.md](./REQUIREMENTS-TRACEABILITY.md)
- [manuals/USER-MANUAL.md](./manuals/USER-MANUAL.md)
