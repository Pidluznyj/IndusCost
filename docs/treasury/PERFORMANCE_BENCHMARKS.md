# Tesouraria — benchmarks de performance (Prompt 58)

Volume representativo usado nos testes (`treasuryPerformanceRules.test.ts`):

| Dimensão | Volume |
|----------|--------|
| Títulos CR/CP | 3.000 (lista) / 1.600 (projeção) |
| Movimentos OFX | 2.000 |
| Contas | 60 (posição) / 2–8 (projeção) |
| Horizonte projeção | 90 dias |
| Status abertos de exceção | N statuses em 1 query |

## Antes × depois (orçamento de round-trips)

| Cenário | Antes | Depois | Δ queries |
|---------|-------|--------|-----------|
| Posição/dashboard (ACL + saldos), 60 contas | `3 + 60×2 = 123` | `5` | ≈ −96% |
| OFX apply insert, 2.000 movimentos | `2000` creates | `2` (createMany + findMany) | ≈ −99% |
| Exception engine open-list | N lists (1/status) | `1` (`status IN`) | ≥ −50% |
| Lista CR/CP | 1 findMany com `rawPayload` de todos | findMany leve + hydrate só da página | memória ↓ |

## Otimizações aplicadas (sem mudar regras)

1. Batch `listAccessForUser` + `findLatestByAccountIds` (posição, movimentos, relatórios, programação CP)
2. OFX `createMany({ skipDuplicates })` em lote
3. Engine de exceções: uma listagem com `statuses`
4. CR/CP: adia carga de `rawPayload` para a página
5. Índices aditivos (migration `20260820120000_treasury_perf_indexes`)

## Como reproduzir

```bash
npm run test:treasury -- --test-name-pattern="treasuryPerformance"
```

O runner imprime JSON `[treasury-perf-benchmark]` com `before`/`after` por cenário.
