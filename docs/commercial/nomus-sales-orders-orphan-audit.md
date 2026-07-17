# Auditoria de pedidos órfãos Nomus (OP-81)

## Problema confirmado

O pedido **PD 02739** (`externalSalesOrderId` **2737**) foi removido no Nomus, mas permanece ativo no PostgreSQL como `SalesOrder` com `sourceSystem=NOMUS`.

A consulta direcionada existente (`audit:nomus-sales-order-sync-drift --orderCode=…`) já reportava *pedido não encontrado no Nomus*. O sincronizador oficial (`scripts/nomusSalesOrdersSyncV1.ts`) faz **upsert** dos pedidos presentes na origem — ele **não** reconcilia ausências. Pedidos que desaparecem do Nomus nunca são arquivados, desativados ou removidos pelo sync.

## Ausente × excluído

Esta auditoria observa **ausência na origem** (pedido local que não aparece no payload completo do Nomus e, quando confirmado, na consulta direcionada).

Não usar a palavra **excluído** só porque o pedido faltou no payload: a origem pode filtrar, paginar de forma incompleta ou falhar temporariamente. “Excluído” só faria sentido com evidência operacional explícita fora deste escopo.

## Por que o auditor mensal anterior não bastava

`audit-nomus-sales-orders-month-reconciliation` analisa sobretudo o universo **local** (totais, drift cabeçalho×itens, gaps de sequência PD). Gaps numéricos **não** provam ausência no Nomus. Este auditor OP-81 compara:

| Universo | Conteúdo |
| --- | --- |
| **A — Local** | `SalesOrder` com `sourceSystem=NOMUS`, `externalSalesOrderId` não nulo, filtrado pelo período de emissão |
| **B — Nomus** | `/pedidos` oficial com paginação completa (full-reconciliation) no mesmo período |

Comparação prioritária por `externalSalesOrderId`; código canônico (`PD 02739` / `PD02739` / …) só como diagnóstico complementar. **Não** classificar órfão por buraco de sequência.

## Prova de completude

Antes de declarar candidato a órfão, a coleta Nomus precisa ser **COMPLETE**:

- `startPage === 1`
- parada por página vazia **ou** metadata sem próxima página
- sem erro HTTP, payload inválido, interrupção ou `maxPages`

Caso contrário o status é **`INCONCLUSIVE_FETCH`** e **nenhum** pedido é classificado como órfão confirmado.

Metadados registrados: estratégia, período, página inicial/última, page size, total lido, motivos de parada, HTTP 429, retries, erros.

## Classificação

| Classe | Significado |
| --- | --- |
| `MATCHED` | Existe local e no Nomus |
| `LOCAL_ONLY_CANDIDATE` | Local e ausente no payload completo |
| `NOMUS_ONLY` | Só no Nomus |
| `IDENTITY_MISMATCH` | Mesmo código com ID diferente (ou vice-versa) |
| `INCONCLUSIVE_FETCH` | Coleta incompleta / linha não reconciliável |
| `CONFIRMED_MISSING_IN_NOMUS` | Ausente no payload completo **e** na consulta direcionada |
| `CANDIDATE_MISSING_IN_NOMUS` | Ausente no payload; confirmação direcionada indisponível/inconclusiva |

Com `--confirm-candidates`, cada `LOCAL_ONLY_CANDIDATE` (até `--max-confirmations`) é revalidado via lookup por código no mesmo período.

## Impacto local (somente leitura)

Para candidatos/confirmados a auditoria lista vínculos:

- **Oficiais:** NF-es (`SalesOrderNfeLink`), OPs (`NomusProductionOrderSalesLink`), snapshots/schedules de comissão, fluxo do pedido
- **Derivados:** fatos OrderToCash, fatos de carteira/portfólio (incl. indício de documento de saída), `CommissionRecord`
- **Textual (informativo):** CR cuja descrição/comentário contém o código — **nunca** tratado como vínculo oficial

Pedidos com NF, documento de saída derivado, CR rateado em comissão ou comissão paga/confirmada recebem **risco alto** para qualquer futura ação automática (não implementada aqui).

## Parser monetário

O auditor mensal antigo usava `Number("117.000,00")` → `0`. Passa a usar `parseNomusPtBrNumber` (`scripts/nomusNumberParser.ts`). O sincronizador oficial já usava o parser correto; a correção limita-se à auditoria.

## Comando de produção

```bash
npm run audit:nomus:sales-orders:orphans -- \
  --from=2026-07-01 \
  --to=2026-07-31 \
  --confirm-candidates
```

Opções:

- `--orderCode="PD 02739"` — restringe o universo local
- `--json` — relatório completo no stdout
- `--csv` — também grava CSV em `tmp/audits/`
- `--confirm-candidates` — lookup direcionado dos candidatos
- `--lifecycle-preview` — plano SYNC-04 (presença) sem gravar
- `--lifecycle-apply` — grava só lifecycle (`MISSING_*` / presença); exige flag env + coleta COMPLETE; **não** usa `--apply`
- `--max-confirmations=N` — teto de lookups (default 50)

Saída resumida: `localCount`, `nomusCount`, `matchedCount`, `localOnlyCandidateCount`, `confirmedMissingCount`, `nomusOnlyCount`, `identityMismatchCount`, `inconclusiveCount`, `totalValueConfirmedMissing`, `fetchCompleteness`, `durationMs`, `http429Count`, `errors`.

Arquivos opcionais em `tmp/audits/` (gitignored). **Não grava no banco.**

### Exemplo PD 02739

Se o pedido existir localmente em julho/2026, a coleta Nomus do mês for `COMPLETE` e a consulta direcionada não o encontrar:

→ `CONFIRMED_MISSING_IN_NOMUS` (ausente na origem), com impacto local listado para decisão humana.

## Interpretação

1. Se `fetchCompleteness !== COMPLETE`, ignore candidatos a órfão e reexecute.
2. Trate `IDENTITY_MISMATCH` antes de qualquer ação futura.
3. `CONFIRMED_MISSING_IN_NOMUS` com risco alto exige revisão manual (NF / comissão / CR).
4. Upsert diário **não** resolve esses casos.

## Próximos passos possíveis (não implementados)

- Política de arquivamento / soft-delete / flag `absentInSource`
- Alerta operacional periódico
- Reconciliação automática com aprovação humana

Esta etapa permanece **estritamente read-only**.
