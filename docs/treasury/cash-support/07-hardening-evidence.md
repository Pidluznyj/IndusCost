# Etapa 20 — Evidência de hardening

Branch `feat/treasury-cash-support-v2`, worktree isolado. Todos os comandos executados
dentro do worktree, nunca no repositório principal (uma execução acidental de
`prisma format` fora do worktree foi detectada e revertida sem produzir diff real — ver
`00-execution-memory.md`).

## 1. Auditoria de segunda fonte (grep no diff completo do Cash Support)

| Busca | Resultado |
|---|---|
| `parseFloat\|Math.round(` em arquivos `cashSupport*`/`CashSupport*` (fora de teste) | **0 ocorrências** |
| `prisma.(proposal\|salesOrder\|nfe\|invoice)` | **0 ocorrências** |
| `prisma.` em `cashSupportService.server.ts` | 1 ocorrência: `prisma.treasuryFinancialAccount.findMany` (leitura, mesmo padrão já usado em `treasuryCaixaService.server.ts` para resolver `companyCode`) |
| `Number(...)` em arquivos de produção | 4 ocorrências, todas comparações booleanas (`> 0`, `<= 0`) ou soma de verificação de paridade em teste — nenhuma é aritmética financeira autoritativa. Detalhado abaixo. |
| Referências a "Nomus" | Só em comentários, avisos de UI e nomes de campo (`nomusSide`, `nomusExternalId`) — **zero escrita** |

### Os 4 usos de `Number()` — por que nenhum viola a regra

1. `CashSupportReconcileDialog.tsx:36` — conversão para centavos da **simulação visual**
   (rotulada explicitamente "não oficial" na UI). Regra do Prompt 0 §19 permite
   simulação provisória no frontend; o backend confirma.
2. `CashSupportWorkspacePage.tsx:48` — filtro booleano (`> 0`) para decidir quais
   títulos aparecem como candidato na lista — não soma, não persiste.
3. `cashSupportCanonicalAdapter.ts:279` (`sumCashSupportCanonicalRowsByDimension`) —
   helper de **prova de paridade em teste**, documentado como tal; soma na mesma
   precisão (`number`) que a fonte canônica já usa nativamente (limitação pré-existente
   do motor de origem, não agravada aqui).
4. `cashSupportSuggestionsAdapter.ts:52` — filtro booleano (`<= 0`), mesma natureza do item 2.

Toda aritmética financeira do caminho de escrita usa `treasuryMoney.ts`
(`addTreasuryMoney`/`subtractTreasuryMoney`/`compareTreasuryMoney`) — confirmado em
CS-002 a CS-005 e nos adaptadores.

## 2. Prova de imutabilidade

- Nenhum arquivo Cash Support escreve em `TreasuryDailyClosing`, `TreasuryBankMovement`
  (exceto via `TreasuryReconciliationMatchService.accept/unmatch/reverse`, que é a
  autoridade oficial), tabelas Nomus, ou qualquer campo de baixa/vencimento oficial.
- Todas as ações de escrita (CS-011–016) chamam `POST /reconciliations`,
  `.../unmatch`, `.../reverse` — as MESMAS rotas já testadas pelo resto da Tesouraria,
  agora com a correção do P0 aplicada.
- `TREASURY_RECONCILIATION_DOES_NOT_REALIZE_OFFICIAL = true` permanece intocado.

## 3. Comandos executados e resultados

| Comando | Resultado |
|---|---|
| `npx prisma format` | Reformatação sem diff de conteúdo (só normalização de EOL, revertida) |
| `npx prisma validate` | ✅ `The schema at prisma\schema.prisma is valid` |
| `npx prisma generate` | ✅ `Generated Prisma Client (v5.22.0)` |
| `npm run check:frontend-server-imports` | ✅ `868 arquivo(s) frontend rastreado(s); nenhum caminho até Prisma/server/Node` |
| `npx tsc --noEmit` (lint) | 1334 erros pré-existentes no projeto (não relacionados); **0 nos arquivos Cash Support** |
| `npm run build` | ✅ build concluído (warning de chunk >500kB é pré-existente, não introduzido aqui) |
| `npm run check:browser-bundle` | ✅ `4 artefato(s) verificado(s); dist/ livre de Prisma` |
| `npx tsx --test` (suíte Cash Support completa) | **72/72** passaram |

## 4. Concorrência

Já coberta em detalhe em `08-p0-concurrency-fix-evidence.md`: 12 testes dedicados
(capacidade de movimento, capacidade de título, idempotência, agregação de pernas
repetidas), executados de forma determinística.

## 5. Segurança

- `viewReconciliation` / `reconciliationEnabled` aplicados nas três rotas novas
  (`GET /cash-support`, `/summary`, `/suggestions`) — nega por padrão.
- ACL por conta: `treasuryBankMovementQueryService.listMovements` já filtra por
  `resolveAuthorizedAccountIds` (anti-IDOR), reaproveitado sem alteração.
- Escritas exigem `expectedVersion` (unmatch/reverse) e `idempotencyKey` (accept).
- Nenhum dado bancário sensível além do necessário é exposto na API (mesmos DTOs já
  usados pelo resto do módulo).

## 6. Limitações conhecidas (não corrigidas nesta etapa, por decisão já registrada)

- **CS-017 (revalidação de fonte)** e **CS-018 (maker-checker)**: continuam pós-MVP,
  conforme já congelado em `06-implementation-backlog.md` antes desta etapa. Não foram
  implementados agora para evitar mecanismo ad-hoc sem padrão institucional comprovado
  (regra "não inventar" do Prompt 0).
- **Etapa 21 (E2E) tem limitação ambiental**: Postgres local indisponível
  (`localhost:5432` inatingível) — ver `09-end-to-end-validation.md`.
