# Etapa 21 — Validação end-to-end

## Limitação ambiental (honesta, não contornada)

`npx prisma migrate status` → `P1001: Can't reach database server at localhost:5432`.

O Postgres local está indisponível nesta máquina durante toda a execução deste
trabalho. Por regra do Prompt 0 (§27: "use apenas banco local ou ambiente de teste",
§9: "não conectar em banco de produção"), **não tentei subir, reiniciar ou contornar**
o serviço de banco — isso está fora do escopo desta tarefa e seria uma ação sobre o
ambiente do usuário sem autorização explícita.

**Consequência:** os 20 cenários (A–T) do Prompt 0 §27 não foram executados contra um
Postgres real com dados persistidos de verdade. O que foi validado é descrito abaixo —
é uma prova forte de correção lógica, mas não substitui um teste de integração com
banco real antes de produção.

## O que FOI validado (72 testes, determinísticos, com o motor real e não mockado)

O harness usa o repositório real (`treasuryReconciliationMatchRepository.server.ts`) com
`runTransaction` substituído por um mutex que replica a serialização de
`SELECT ... FOR UPDATE`/`pg_advisory_xact_lock` — não é um mock da lógica de negócio,
é o mesmo código de domínio e de serviço rodando com um adaptador de transação
determinístico.

| Cenário do Prompt 0 §27 | Coberto por |
|---|---|
| A. Movimento não conciliado afeta banco | `cashSupportBankAdapter.test.ts` (IGNORED/PENDING continuam aparecendo) |
| B/D. CR/CP real + recebimento completo | `treasuryReconciliationMatch.integration.test.ts` (1:1) |
| C/E. CR/CP parcial | idem (parcial) + `cashSupportReconciliationAdapter.test.ts` |
| F. Tarifa | `cashSupportReconciliationAdapter.test.ts` (10.000 título + 50 FEE = 10.050 banco) |
| G. Desconto | idem (10.000 título coberto por 9.950 banco + 50 DISCOUNT) |
| H. Diferença | `treasuryReconciliationMatch.integration.test.ts` |
| I. Transferência | não recriada — delega à tela oficial de Transferências, já com sua própria suíte |
| J. Unidentified | `cashSupportReconciliationAdapter.test.ts` |
| K. Previsão visível e não conciliável | `cashSupportContracts.test.ts`, `cashSupportReadModel.test.ts`, `CashSupportPanel.test.tsx` |
| L. Um para muitos (1:N) | `treasuryReconciliationMatch.integration.test.ts` + `treasuryReconciliationConcurrency.test.ts` (residual do título) |
| M. Muitos para um (N:1) | idem |
| N. Reversão | `treasuryReconciliationMatch.integration.test.ts` |
| O. Conflito de versão | `assertTreasuryReconciliationMatchVersion` testado no motor |
| P. Idempotência | `treasuryReconciliationConcurrency.test.ts` (3 cenários dedicados) |
| Q. ACL | `treasuryBankMovementQueryService` reaproveitado (ACL já testada na suíte existente); `cashSupportController.test.ts` (401/403) |
| R. Mudança de fonte | **não coberto** — CS-017 pós-MVP (ver `07-hardening-evidence.md` §6) |
| S. Exportação | **não implementado** nesta rodada (ver limitações da revisão final) |
| T. Totais diário/mensal | `cashSupportCanonicalAdapter.test.ts` (paridade no centavo com `buildTreasuryCaixaCanonicalDays`) |
| U. Duas requisições concorrentes | `treasuryReconciliationConcurrency.test.ts` (8 cenários) |
| V. Nomus inalterado | grep de auditoria em `07-hardening-evidence.md` §1–2: zero escrita fora do motor oficial |

## Como fechar esta lacuna quando o Postgres estiver disponível

1. `docker compose up` (ou o serviço local equivalente) para levantar o Postgres.
2. `npx prisma migrate deploy` (aplica a migration `20260905120000_treasury_reconciliation_idempotency`).
3. Rodar os 20 cenários manualmente ou via `scripts/runTreasuryTests.mjs` (se cobrir
   integração com banco real).
4. Confirmar que os totais da tela batem com consultas diretas ao banco.

Nenhuma dessas ações foi executada aqui — ficam registradas como próximo passo,
não como "concluído".
