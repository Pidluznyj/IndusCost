# CASH-SUPPORT-P0-CONCURRENCY-001 — evidência da correção

- **Commit:** `92f50d61bbeedf48f25d2e6c8fb67a7971d37e22`
- **Branch:** `feat/treasury-cash-support`
- **Migration:** nenhuma
- **Status:** **CORRIGIDO** — gate de escrita liberado

---

## 1. Causa

`accept()` lia a capacidade livre do movimento **antes** de abrir a transação
(`sumActiveAllocatedByMovementIds` + `assertTreasuryReconciliationMovementCapacity`) e
reaproveitava esse valor **dentro** dela. Duas requisições concorrentes liam a mesma capacidade,
cada uma se validava isoladamente e ambas gravavam.

**Segundo vetor encontrado durante a correção** (não previsto no diagnóstico inicial): quando o
mesmo `bankMovementId` aparecia em mais de uma perna da mesma requisição, cada perna era validada
contra a mesma base e o laço de gravação **sobrescrevia** `reconciledAmount` em vez de acumular —
duas pernas de 600 sobre um movimento de 1.000 passavam, e o movimento ficava marcado com 600
tendo 1.200 alocados.

## 2. Solução

Tudo dentro do motor oficial `TreasuryReconciliation`. Nenhum serviço novo, nenhuma tabela nova,
nenhuma migration.

| Item | Implementação |
|---|---|
| **Lock** | `lockMovementsForUpdate` — `SELECT id FROM "TreasuryBankMovement" WHERE id IN (...) ORDER BY id FOR UPDATE` |
| **Ordem** | Ids deduplicados e **ordenados** antes do lock → sem deadlock entre requisições que disputam o mesmo conjunto |
| **Transação** | Lock, releitura da capacidade, todas as validações e as gravações na **mesma** `$transaction` |
| **Agregação** | `requestedByMovement` soma as pernas por movimento antes de validar; gravação uma vez por movimento |
| **Idempotência** | **Não implementada** — ver §6 |
| **Retry** | Não adicionado; a serialização por `FOR UPDATE` faz a segunda requisição **esperar** e então falhar na validação, sem deadlock a recuperar |
| **Invariante** | `alreadyReconciledActive + Σ pernas ≤ movement.amount`, verificada após o lock e antes de gravar |

### Arquivos

- `src/lib/treasury/repositories/treasuryReconciliationMatchRepository.server.ts` — novo `lockMovementsForUpdate`
- `src/lib/treasury/repositories/treasuryReconciliationMatchRepository.memory.ts` — no-op equivalente
- `src/lib/treasury/services/treasuryReconciliationMatchService.server.ts` — validação movida para dentro da transação + agregação
- `src/lib/treasury/treasuryReconciliationConcurrency.test.ts` — novo

## 3. Como o teste prova a correção sem Postgres

`runTransaction` é um **mutex** — exatamente a serialização que `FOR UPDATE` garante no banco — e
cede o event loop dentro da região crítica.

Isso torna o teste **discriminante**: com o código antigo ele falha mesmo com o mutex, porque a
leitura da capacidade acontecia **fora** da região crítica e ambas as requisições liam `0.00`
antes de qualquer transação começar. Com a correção, a segunda requisição relê a capacidade já
consumida e é rejeitada.

## 4. Testes e resultados

```
npx tsx --test src/lib/treasury/treasuryReconciliationConcurrency.test.ts
```

| Cenário | Resultado |
|---|---|
| 7.000 + 6.000 concorrentes sobre movimento de 10.000 | ✔ um vence, outro rejeitado com `TreasuryDomainError`; total gravado 7.000 |
| 10 rodadas repetidas | ✔ determinístico, nunca excede |
| 3 aceites concorrentes de 600 sobre 1.000 | ✔ só um cabe |
| Sequenciais 400 + 600 → esgota; terceiro de 0,01 | ✔ `MATCHED`, terceiro rejeitado |
| Mesmo movimento repetido (600 + 600 sobre 1.000) | ✔ rejeitado; nada gravado |
| Falha de validação | ✔ zero gravação parcial |

**6 testes, 6 passaram.**

### Regressão

```
npx tsx --test src/lib/treasury/treasuryReconciliationMatch.integration.test.ts \
                src/lib/treasury/treasuryReconciliationReverseApi.test.ts \
                src/lib/treasury/domain/treasuryReconciliationMatchRules.test.ts
```

**20 testes, 20 passaram** — 1:1, 1:N, N:1, parcial, tarifa/juros/desconto/diferença/
unidentified/transferência/manual ledger, unmatch, reverse, permissões.

### Typecheck

`npx tsc --noEmit`: **zero erros** nos arquivos alterados. O projeto tem 1.380 erros
pré-existentes (majoritariamente em `scripts/`), não relacionados a esta mudança.

## 5. Critérios de aceite

| # | Critério | Situação |
|---|---|---|
| 1 | Capacidade verificada dentro da transação | ✔ |
| 2 | Recurso correto protegido por lock | ✔ `FOR UPDATE` no movimento |
| 3 | Concorrentes não excedem capacidade do movimento | ✔ testado |
| 3b | Concorrentes não excedem residual do título | ⚠ **ver §6** |
| 4 | Residual nunca negativo | ✔ |
| 5 | Allocations agregadas ≤ movimento | ✔ |
| 6 | Allocations + ajustes ≤ cobertura do título | ⚠ **ver §6** |
| 7 | `Idempotency-Key` impede repetição | ✘ **não implementado** |
| 8 | Conflito retorna erro controlado | ✔ `TreasuryDomainError` |
| 9 | Retry para deadlock | n/a — ordem determinística evita deadlock |
| 10 | Auditoria só do resultado confirmado | ✔ dentro da transação |
| 11 | Nomus inalterado | ✔ nenhuma escrita fora de `TreasuryReconciliation*` |
| 12 | Testes determinísticos repetidos | ✔ 10 rodadas |

## 6. Riscos restantes — o gate de escrita ainda não está totalmente fechado

**(a) Residual do título não é protegido por lock.**
`assertTreasuryReconciliationTitleOpenBalances` valida contra o `openBalance` **enviado no
payload**, não contra um saldo relido do banco sob lock. Dois aceites concorrentes sobre o
**mesmo título** com movimentos **diferentes** não disputam o mesmo lock e podem, juntos,
exceder o saldo aberto do título. O título é oficial do Nomus e não tem linha local a bloquear —
fechar isso exige decisão de modelo (ex.: lock por `officialTitleKey` via advisory lock).

**Impacto:** cenário 2 do plano de testes do P0 (concorrência sobre o mesmo título) **não está
coberto**. Deve ser tratado antes de liberar conciliação manual múltipla em produção.

**(b) Idempotência ausente.**
Duplo clique ainda cria dois matches. A correção exige coluna nova em
`TreasuryReconciliationMatch` — deliberadamente adiada porque `prisma/schema.prisma` está com
alterações não commitadas de outro trabalho, e gerar migration agora contaminaria aquele trabalho.

## 7. Rollback

Correção puramente comportamental, sem migration. Rollback = `git revert 92f50d6`.
