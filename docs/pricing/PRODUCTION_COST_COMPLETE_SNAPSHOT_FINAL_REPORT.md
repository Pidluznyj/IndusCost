# PRODUCTION_COST_COMPLETE_SNAPSHOT_FINAL_REPORT

**Veredito: READY_FOR_HOMOLOGATION**  
**Não:** READY_FOR_PRODUCTION · push · merge · deploy produção  

| Campo | Valor |
|---|---|
| Branch | `feat/production-cost-complete-snapshot-materialize` |
| HEAD (commit) | `2f700a0a21ca15c411f7b13106b3b528f97f77d2` |
| Relação com `origin/main` | HEAD **igual** a `origin/main` (`2f700a0`) — feature ainda **não commitada** (working tree + untracked) |
| Data do relatório | 2026-10-05 |

---

## 1. Resumo executivo

A publicação unitária/bulk de custo de produção deixava a última `ProductionCostTableVersion` **PUBLISHED parcial** (1 item). O consumidor comercial (`priceTableProductionCostResolver`) lê **somente** itens dessa versão → 1 custo encontrado e centenas `SEM_CUSTO`.

A correção é na **origem**: materializar snapshot **completo** (oficial vigente + patch aprovado) antes do publish oficial. Formação de Preço / resolver comercial **não** mudam de regra. Gates T3–T10 (materialize, unitário, bulk, legado, contrato comercial, concorrência, auditoria, runbook) passaram. Estado atual: código pronto para **homologação humana**; ainda falta commit/revisão de PR — **não** produção.

---

## 2. Problema original

- Última PUBLISHED com **1 item** (SKU publicado).
- `resolvePublishedProductionCostTableVersionForDate` + `buildProductionCostItemsByProductId` → mapa com 1 produto.
- Geração de tabela comercial: 1 encontrado / ~888 sem custo.
- População “normal” (~889) só existia no catálogo efetivo histórico, não na última PUBLISHED.

---

## 3. Causa raiz

Publicação unitária (e chunks de bulk mal interpretados como “publicação”) promoviam o **DRAFT candidato parcial** (ou equivalente) a PUBLISHED, **sem** reconstituir a população completa. O comercial está correto ao ler a última PUBLISHED; a origem entregava snapshot incompleto.

---

## 4. Decisão arquitetural

| Decisão | Detalhe |
|---|---|
| Corrigir na origem | Materializar DRAFT **completa** → publicar via serviço oficial |
| Não refatorar Pricing | `priceTableProductionCostResolver` intocado |
| Carry-forward | `getEffectiveProductProductionCosts` (histórico), **nunca** `latestPublished.items` como catálogo |
| LIVE | Nunca entra sem DRAFT/patch aprovado |
| HTTP chunk ≠ publish | `phase=validate` vs `phase=finalize` |
| Sem migration | Marcador em `notes` (`COMPLETE_SNAPSHOT_MATERIALIZATION`) |
| Sem distributed lock | CAS + optimistic base + retry controlado |

---

## 5. DRAFT parcial vs PUBLISHED completo

| Artefato | Papel |
|---|---|
| DRAFT candidato (unitário/bulk item) | 1+ SKUs aprovados; **nunca** vira PUBLISHED sozinho no fluxo novo |
| DRAFT completa (materializada) | População ACTIVE completa; origem do publish |
| PUBLISHED | Sempre snapshot completo moderno (marcador `COMPLETE_MODERN`) |
| Link | `UNITARY_CANDIDATE_MATERIALIZED_INTO completeVersionId=…` em notes do candidato |

---

## 6. Algoritmo carry-forward

1. População = produtos/componentes ACTIVE (`FULL_ACTIVE_PRODUCT_AND_COMPONENT`).
2. Patch = itens dos DRAFTs candidatos (`changedProductIds`).
3. Oficial = `getEffectiveProductProductionCosts` por productId/data.
4. Plan puro: CHANGED ← patch; CARRIED_FORWARD ← oficial; MISSING ← sem oficial e fora do patch (não inventa custo).
5. Persistência em nova DRAFT (`create` + `createMany` / upsert), depois publish oficial.

---

## 7. Tratamento de LIVE não aprovado

LIVE divergente **não** entra no snapshot. Só PATCH (DRAFT aprovado) altera SKU. Cenário B do runbook: alterar LIVE de B sem DRAFT B → após publish de A, B permanece no custo oficial antigo.

---

## 8. Fluxo unitário

1. Revalidar candidato (`revalidateUnitaryDraftForPublish`).
2. Se link aponta PUBLISHED → idempotente.
3. Se link `ready_to_publish` com base vigente → reutilizar; senão rematerializar.
4. `materializeCompleteProductionCostSnapshot` (OFFICIAL + PATCH A).
5. Link candidato → complete.
6. `publishProductionCostVersionFromDraft`.
7. `archiveObsoleteProductDraftsAfterPublication`.
8. Em `STALE_BASE`: 1 rematerialize + retry.

---

## 9. Fluxo bulk

1. Preview (read-only).
2. `phase=validate` (chunks HTTP): revalida LIVE/elegibilidade; **não** publica.
3. `phase=finalize`: materializa **um** snapshot com todos os patches aceitos → **um** publish → archive.
4. Retry `STALE_BASE` uma vez no finalize.

---

## 10. Chunking

- Chunk HTTP limita timeout (ex. validate ≤ 25).
- Chunk **não** cria PUBLISHED.
- Finalize agrega `draftVersionIdsByProduct` / productIds aceitos em um materialize.

---

## 11. Histórico legado

- PUBLISHED/SUPERSEDED parciais **preservados** (sem reescrita).
- Carry de legado usa resolver histórico (produto pode estar em SUPERSEDED antiga).
- Marcador `COMPLETE_MODERN` distingue moderno vs parcial sem migration.

---

## 12. População oficial

Fonte: ACTIVE PRODUCT + COMPONENT.  
Meta em notes: `populationSource`, `totalItems`, `changedCount`, `carriedForwardCount`, `missingCount`, `changedProductIds`, `baseResolver=getEffectiveProductProductionCosts`.

---

## 13. Atomicidade

Publish em `$transaction`:

1. Optimistic check: `supersedes` == PUBLISHED vigente (ou legado sem supersedes adopta vigente).
2. `updateMany` DRAFT→PUBLISHED (claim).
3. `updateMany` vigente→SUPERSEDED (claim).
4. Falha → rollback (sem dual-PUBLISHED).

DRE dirty e archive ficam **após** a tx de publish (best-effort / soft-fail já existente).

---

## 14. Concorrência

| Risco | Mitigação |
|---|---|
| Dois publishes (bases iguais) | CAS — um vence |
| Snapshot com base antiga | `STALE_BASE` + rematerialize |
| Colisão `(code, revision)` | retry controlado no materialize |
| Sem distributed lock | proposital |

---

## 15. Idempotência

- Candidato já ligado a PUBLISHED → `alreadyPublished` / sucesso sem republish.
- Publish da mesma versão completa já PUBLISHED → erro imutável tratado como já publicado quando aplicável.
- Retry pós-timeout: reutiliza complete DRAFT se base ainda vigente.

---

## 16. Provenance / audit

- `createdBy` na materialização; `publishedBy` no publish.
- Notes: meta COMPLETE + audit de publicação + link candidato.
- `source` oficial de publicação de custo preservado (`PRODUCTION_COST_PUBLICATION_SOURCE` / audit unitary/bulk).

---

## 17. Formação comercial

- Resolver **inalterado**: última PUBLISHED + items.
- Com snapshot completo, população volta ao normal.
- Teste de contrato A/B/C: A antigo, B novo, C antigo após publish unitário de B.

---

## 18. DRE

`markFinanceDreSnapshotsDirtySafe` permanece em `publishProductionCostVersionFromDraft` após publish bem-sucedido (soft-fail se markDirty falhar).

---

## 19. Histórico / immutability

- Sem UPDATE manual de status para PUBLISHED fora do serviço.
- PUBLISHED não é editado; vira SUPERSEDED via claim.
- Candidatos: DRAFT/ARCHIVED; histórico parcial legado intacto.

---

## 20. Arquivos alterados

### Novos (untracked)

| Arquivo | Papel |
|---|---|
| `src/lib/productionCostCompleteSnapshot.ts` | Plan puro + meta + evaluate STALE_BASE |
| `src/lib/productionCostCompleteSnapshot.server.ts` | Materialize |
| `src/lib/productionCostCompleteSnapshot.test.ts` | CASOS 1–10 + legado |
| `src/lib/productionCostCompleteSnapshotCommercialContract.test.ts` | Contrato comercial |
| `src/lib/productionCostCompleteSnapshotConcurrency.test.ts` | Concorrência/CAS |
| `docs/pricing/HOMOLOGATION_RUNBOOK.md` | Roteiro humano |

### Modificados (working tree vs HEAD)

| Arquivo | Papel |
|---|---|
| `src/lib/productionCostTables.server.ts` | Publish atômico + STALE_BASE |
| `src/lib/pricing/unitaryFormationProductionCost.server.ts` | Materialize → publish + retry |
| `src/lib/pricing/unitaryFormationProductionCost.ts` | Tipos/`CONFLICT_STALE_BASE` |
| `src/lib/productionCostBulkPublish.server.ts` | validate/finalize + retry |
| `src/lib/productionCostBulkPublish.ts` | phase / contratos |
| `src/lib/productionCostBulkPublishChunkedRun.ts` | phases no client |
| `server.ts` | `phase` no body bulk |
| `src/components/ProductModule.tsx` | passa `phase` |
| `*.test.ts` relacionados | mocks updateMany + regressões |

---

## 21. Migrations

**Nenhuma.** Sem alteração Prisma/SQL schema. Marcadores em `notes` apenas.

---

## 22. Testes (último gate completo)

| suite | pass | fail | duration_ms |
|---|---:|---:|---:|
| complete-snapshot | 18 | 0 | 308 |
| commercial-contract | 3 | 0 | 728 |
| concurrency | 11 | 0 | 684 |
| unitary-publish | 22 | 0 | 813 |
| unitary-pure | 16 | 0 | 294 |
| bulk-publish (+ chunked) | 32 | 0 | 301 |
| tables-server | 7 | 0 | 231 |
| publication-validation | 7 | 0 | 238 |
| price-table-publication | 98 | 0 | 558 |
| cost-price-margin-flow | 7 | 0 | 861 |
| cost-price-margin-audit | 10 | 0 | 233 |
| **TOTAL** | **231** | **0** | — |

---

## 23. Typecheck

| Métrica | Valor |
|---|---|
| BASE_ERRORS | ~1408 (baseline repo: scripts/audit etc.) |
| FEATURE_ERRORS | **0** |
| NEW_ERRORS | **0** |

---

## 24. Performance

- Materialize batch (createMany) medido em teste: n=100/500/1000 sem N+1 de resolver por item no loop de persistência.
- Carry-forward em batch via `getEffectiveProductProductionCosts`.
- Chunk validate evita 524; finalize único evita multi-PUBLISHED por chunk.
- Residual: rematerialize em STALE_BASE custa 1× população completa (aceitável).

---

## 25. Riscos residuais

1. Archive pós-publish fora da tx → possíveis DRAFTs órfãos; oficial OK.  
2. Link em notes best-effort.  
3. Dois retries STALE_BASE simultâneos → um vence no CAS; outro CONFLICT.  
4. Trabalho ainda **não commitado** — risco operacional de perda local / PR incompleto.  
5. Homologação humana ainda não executada (runbook pronto).

---

## 26. Git status

```
## feat/production-cost-complete-snapshot-materialize
 M server.ts
 M src/components/ProductModule.tsx
 M src/lib/costPriceMarginFlow.server.test.ts
 M src/lib/pricing/commercialPublishedPricesRoutes.test.ts
 M src/lib/pricing/unitaryFormationProductionCost.server.ts
 M src/lib/pricing/unitaryFormationProductionCost.ts
 M src/lib/pricing/unitaryFormationProductionCostPublish.test.ts
 M src/lib/productionCostBulkPublish.server.ts
 M src/lib/productionCostBulkPublish.test.ts
 M src/lib/productionCostBulkPublish.ts
 M src/lib/productionCostBulkPublishChunkedRun.test.ts
 M src/lib/productionCostBulkPublishChunkedRun.ts
 M src/lib/productionCostPublicationValidation.test.ts
 M src/lib/productionCostTables.server.test.ts
 M src/lib/productionCostTables.server.ts
?? docs/pricing/HOMOLOGATION_RUNBOOK.md
?? src/lib/productionCostCompleteSnapshot.server.ts
?? src/lib/productionCostCompleteSnapshot.test.ts
?? src/lib/productionCostCompleteSnapshot.ts
?? src/lib/productionCostCompleteSnapshotCommercialContract.test.ts
?? src/lib/productionCostCompleteSnapshotConcurrency.test.ts
```

HEAD = `2f700a0` (mesmo que `origin/main`). Feature = working tree + untracked.

---

## 27. `git log origin/main..HEAD`

```
(vazio)
```

Nenhum commit da feature ainda. `origin/main..HEAD` está vazio porque HEAD ≡ `origin/main`.

---

## 28. `git diff --stat origin/main...HEAD`

```
(vazio — três dots, commits divergentes: nenhum)
```

Diff **working tree** vs `origin/main` / HEAD (tracked only):

```
15 files changed, 1847 insertions(+), 292 deletions(-)
```

(+ 6 arquivos untracked: snapshot core/tests + runbook.)

---

## 29. Itens explicitamente NÃO alterados

- `priceTableProductionCostResolver.ts` e fórmulas de Formação de Preço  
- ProductPricing / PriceTable publication engines (regra)  
- Comissão, Propostas, SalesOrder, Nomus, Inventory, Treasury, RH, Simulações, Projetos  
- Migrations Prisma  
- Deploy / cron / infra  
- Sem force-push / merge / produção  

---

## 30. Roteiro de homologação

[`docs/pricing/HOMOLOGATION_RUNBOOK.md`](./HOMOLOGATION_RUNBOOK.md)

Cenários A (unitário), B (LIVE B protegido), C (SQL diff CHANGED/UNCHANGED), D (comercial), E (bulk validate/finalize).

---

## 31. Passos para produção (conceitual — **não executar agora**)

1. Commit focado + PR (sem `git add -A` cego).  
2. Homologação humana completa (runbook) com evidências.  
3. Review + CI verde.  
4. Merge apenas após PASS homologação.  
5. Deploy controlado (janela) — **fora deste relatório**.  
6. Smoke pós-deploy: 1 publish unitário + SELECT itemsCount + 1 preview comercial.  

**Este relatório não autoriza produção.**

---

## 32. Rollback conceitual

- **Código:** reverter PR / commit da feature; fluxos voltam a publicar parcial (sintoma comercial retorna).  
- **Dados:** PUBLISHED completas já criadas permanecem (histórico aditivo); não há migration a reverter.  
- **Operacional:** se snapshot completo indesejado, republish consciente a partir de base conhecida — sem DELETE de PUBLISHED.  

---

## 33. Veredito

# READY_FOR_HOMOLOGATION

Não `READY_FOR_PRODUCTION`.  
Não push. Não merge. Não deploy produção.
