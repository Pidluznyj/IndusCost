# IndusCost — Auditoria de risco e qualidade

> Auditoria técnica e funcional gerada na fase
> **INDUSCOST-SYSTEM-AUDIT-AND-ACTION-PLAN-A**. Não corrigi nada nesta
> rodada (todos os achados foram **diagnósticos**; correções entram em
> fase separada com plano definido).

## 1. Resumo da avaliação

| Eixo | Saúde | Comentário |
|---|---|---|
| Login + UI base | 🟢 | Funcionando, sem regressão. |
| Engenharia Nomus | 🟢 | Endurecida nas últimas fases. Smokes cobrindo FK e snapshot. |
| Cadastro mestre Product/Material | 🟢 | CRUD, importer e auditoria OK. |
| Motor de custos | 🟡 | Cobertura de teste boa em libs puras; há divergência conhecida grid×modal a confirmar no servidor. |
| Pricing | 🟡 | Há rota mutativa em lote sem confirmação textual. |
| Propostas/Pedidos | 🟡 | OK funcional, sem smoke específico, sem auditoria automatizada. |
| CRM | 🟡 | Dashboards muito grandes (queries pesadas), sem smoke. |
| Permissões | 🟢 | RBAC granular, `requireBootstrapForGlobalParamMutation` em parâmetros globais. |
| Banco | 🟡 | 9 tabelas de backup persistidas no schema; falta consolidação. |
| Server.ts | 🟡 | Monolítico (~13 500 linhas) — refactor recomendado em médio prazo. |
| Frontend bundle | 🟡 | Acima de 500 kB gzipado, sem lazy-loading de módulos. |

> 🟢 saudável · 🟡 aceitável com dívida · 🟠 atenção · 🔴 risco imediato.

## 2. Classificação de riscos

### 🔴 P0 — risco imediato ou impeditivo

Nenhum P0 ativo no momento (todos os bloqueios anteriores foram
resolvidos).

### 🟠 P1 — importante antes de liberar Engenharia ampla

#### P1.1 — `POST /api/pricing/apply-batch` sem confirmação textual
- **Evidência**: `server.ts:6362` aplica margens em lote a partir de
  payload sem exigir frase de confirmação.
- **Impacto**: alterações de margem podem ser feitas em vários produtos
  sem o pedágio de confirmação que protege os outros fluxos sensíveis
  (Igualar Bases, Aplicar BOM, Carga Mestre).
- **Ação recomendada**: adicionar parâmetro `confirmationText` esperado
  como `APLICAR PRECO LOTE` (ou similar) e abortar com 400 quando ausente
  ou diferente. Mensagem clara para a UI. Próxima fase
  `INDUSCOST-PRICING-APPLY-GUARDRAIL-A`.

#### P1.2 — Carga Mestre Nomus apply real **não grava** `EngineeringChangeLog`
- **Evidência**: `applyNomusMasterDataImport` em
  `src/lib/nomusMasterDataImport.ts:639` cria Products/Materials mas só
  registra entries no relatório de retorno. Histórico retroativo só é
  registrado pelo Igualar Bases (`ensureNomusImportHistoryForProduct`)
  ou pelo `master-data-history-backfill` (já implementado).
- **Impacto**: Items criados pela Carga Mestre não aparecem na aba
  Histórico do produto até alguém rodar o backfill ou o Igualar Bases
  tocar neles.
- **Mitigação atual**: existe `npm run sync:nomus:master-data-history-backfill -- --confirm="BACKFILL HISTORICO NOMUS"`.
- **Ação recomendada**: integrar `recordEngineeringChange` direto no
  apply da Carga Mestre, criando um `EngineeringSyncRun` próprio com
  `summaryJson.origin="MASTER_DATA_IMPORT"`. Próxima fase
  `INDUSCOST-MASTER-DATA-IMPORT-HISTORY-A`.

#### P1.3 — `server.ts` monolítico (~13 500 linhas, 176 endpoints)
- **Evidência**: 1 arquivo concentra todas as rotas, com mistura
  de domínios (auth, products, pricing, CRM, maintenance, etc).
- **Impacto**: PRs maiores ficam difíceis de revisar, risco de conflitos
  em git e regressões silenciosas.
- **Ação recomendada**: extrair rotas por domínio para `routes/*.ts`
  via `Router()` do Express, sem alterar lógica. Próxima fase
  `INDUSCOST-SERVER-ROUTES-SPLIT-A` (refactor mecânico).

#### P1.4 — Tabelas `*_backup_*_20260413` persistidas no schema
- **Evidência**: 9 modelos em `prisma/schema.prisma` linhas 841–950.
- **Impacto**: schema mais pesado, deploy reflete entidades obsoletas,
  qualquer migration futura precisa considerá-las.
- **Mitigação**: dados de backup já viraram dump físico (mencionado em
  rotinas anteriores).
- **Ação recomendada**: confirmar backup externo (`pg_dump` arquivado),
  remover modelos do `schema.prisma`, gerar migration de DROP TABLE
  (planejada e aprovada). Próxima fase `INDUSCOST-LEGACY-BACKUP-CLEANUP-A`.

### 🟡 P2 — melhoria operacional

#### P2.1 — Bundle frontend acima de 500 kB gzipado
- **Evidência**: warning persistente do Vite em todos os builds.
- **Impacto**: TTI alto no `/login`, especialmente fora da fábrica.
- **Ação recomendada**: `React.lazy(() => import(...))` por módulo
  (Product, CRM, Pricing, Maintenance, etc) no `App.tsx`. Estimativa
  de redução: 30–40 % no chunk inicial.

#### P2.2 — Falta smoke read-only para Pricing, Proposal, CRM, Maintenance
- **Impacto**: regressões nesses módulos não são pegas por nenhum smoke.
- **Ação recomendada**: criar
  `test:induscost:{pricing,proposal,crm,maintenance}-smoke` simples
  que valida endpoints principais sem mutation.

#### P2.3 — Divergência grid × modal de custo (a confirmar)
- **Evidência indireta**: comentários em commits antigos (`994606d`
  "correção custo apresentado", `234aff8` "correção totais") e em libs
  `costAnalysisPartial` indicam histórico de divergência.
- **Impacto**: produto pode aparecer com custo X na lista e Y no modal
  em casos de partial.
- **Ação recomendada**: rodar `npm run sync:nomus:effective-bom-cost-impact`
  para um conjunto de pilotos e comparar com `GET /api/products/:id/cost-analysis`.
  Se confirmar divergência, abrir fase de hotfix.

#### P2.4 — `Simulation` (modelo legado) sem usuários ativos
- **Evidência**: `Simulation` (`schema.prisma:239`) tem só ajustes
  incrementais (`materialAdj`, `laborAdj`...). `NewProductSimulation`
  (com snapshot) é o que está sendo usado.
- **Ação recomendada**: confirmar uso real; se de fato deprecated,
  adicionar `@deprecated` no JSDoc e planejar migração para
  `NewProductSimulation`.

#### P2.5 — `apply-api-permission-guards.mjs` é script utilitário
- **Evidência**: existe `scripts/apply-api-permission-guards.mjs` que
  parece ter sido usado pontualmente para batch-edit de `server.ts`.
- **Risco**: rodar de novo sem revisar pode reescrever rotas
  silenciosamente.
- **Ação recomendada**: documentar o script ou movê-lo para
  `scripts/legacy/` e impedir execução acidental.

### 🟢 P3 — melhoria futura

#### P3.1 — Indicadores agregados de aplicação de BOM
- Já mencionados como próxima fase recomendada (`NOMUS-ENGINEERING-RELEASE-INDICATORS-A`).

#### P3.2 — Documentação interativa por módulo
- `SystemGuideModule.tsx` existe; pode receber as docs criadas aqui.

#### P3.3 — Substituir `apply-api-permission-guards.mjs` por gerador
  declarativo
- Mapeamento permissão↔endpoint pode vir de
  `permissionCatalog.ts` em vez de patch.

## 3. Bugs/inconsistências prováveis (não confirmados em runtime)

| # | Evidência | Verificar |
|---|---|---|
| 1 | `apply-batch` sem confirmação | passar payload válido e ver se aplica direto |
| 2 | Endpoint `master-data-import/apply-safe` retorna `report` longo se houver muito item | conferir UX em produção (paginação?) |
| 3 | `confirmationTextFor` em `nomusBomControlledApply.ts:123` usa `normalizeSku(parentCode)` — operadores devem digitar exatamente o sku já normalizado | confirmar no smoke (já validado) |
| 4 | `summaryJson` do `EngineeringSyncRun` é tipado como `any never` em alguns pontos — eventualmente perdemos tipos | manter como JSON livre, mas considerar zod schema |
| 5 | `IntegrationRun` existe em schema mas pouco usado | confirmar se está no fluxo atual ou se ficou de iteração antiga |

## 4. Dívidas técnicas

| Dívida | Tamanho | Impacto se ignorar |
|---|---|---|
| `server.ts` monolítico | grande | velocidade de evolução cai |
| Falta de zod/io-ts nos payloads de rotas | médio | inputs malformados chegam ao Prisma e quebram com mensagem feia |
| `as never` em `summaryJson` | pequeno | `tsc` aceita, mas perde safety |
| Mistura frontend/server-side em `src/lib/` (com guardrail protegendo o frontend) | médio | trabalha bem hoje; pode confundir contribuidores novos |
| 9 modelos backup `_20260413` no schema | médio | qualquer migration futura precisa ignorar manualmente |
| Falta de lazy-loading | médio | TTI |
| Falta de testes integração modal | médio | regressões UX |
| Logs do servidor não centralizados (`console.error` em vários lugares) | pequeno | difícil análise |

## 5. Performance — pontos sensíveis

| Endpoint / função | Observação |
|---|---|
| `/api/crm/seller-dashboard` (~5500 linhas em torno) | múltiplas agregações; rodar com `EXPLAIN ANALYZE` em produção. |
| `/api/crm/management-dashboard` | idem. |
| `/api/products/:id/cost-analysis` | recursivo por childProductId — possui cache local? confirmar. |
| `buildNomusMasterDataImportDiagnostic` | varre todo o stage em batches de 2000 + lookup em Product/Material; **OK** mas vai ficar mais lento à medida que o stage crescer. |
| `buildNomusMasterDataEqualizePreview` | itera múltiplas páginas de `buildNomusMasterDataImportDiagnostic`. Está limitado a `MAX_LIMIT` por página, mas com base muito grande pode levar dezenas de segundos. |
| `buildControlledApplyPreview` | chama `buildEffectivePricingBomForParentCode` + `buildNomusEffectiveBomCostImpact` — pesado por produto, sem cache. |
| `/api/products/material-demand/*` | reports compostos — confirmar perf real. |

## 6. Segurança & permissões

### Pontos saudáveis
- Todos os endpoints autenticados via `requireAppAuth`/`requireBootstrap*`.
- `requireBootstrapForGlobalParamMutation` protege parâmetros globais.
- Frontend bloqueado de importar Prisma por guardrail
  (`npm run check:frontend-imports`) — 108 arquivos varridos, 0 violações.
- Confirmação textual em todas as mutations Nomus pesadas.

### Pontos para revisar
- `POST /api/pricing/apply-batch` permissão `pricing.simulate` (não
  `pricing.publish_tables`) — talvez seja a permissão certa, mas merece
  validação com o time. Junto com **P1.1** (falta de confirmação textual).
- `POST /api/proposals/:id/generate-sales-order` exige `proposals.edit` —
  confirmar se há permissão dedicada para criação de pedido.
- `DELETE /api/products/:id` exige `products.delete` — confirmar que o
  produto não tem dependências (proposta/pedido com `onDelete: NoAction`
  já protege via FK, mas mensagem ao usuário pode ser confusa).
- `POST /api/admin/users/bootstrap-super-admin` — checar se tem rate
  limit/lockout.

### Botões / actions com confirmação textual
| Onde | Frase exata |
|---|---|
| Carga Mestre Nomus apply | `IMPORTAR CADASTRO MESTRE NOMUS` |
| Igualar Bases Nomus apply | `IGUALAR BASES NOMUS` |
| Aplicar BOM Nomus (UI + CLI) | `APLICAR BOM NOMUS <PARENTCODE_NORMALIZADO>` |
| Backfill histórico Nomus (CLI) | `BACKFILL HISTORICO NOMUS` |

### Botões / actions **sem** confirmação textual mas com impacto
- `POST /api/pricing/apply-batch` (margens em lote) — **P1.1**.
- `POST /api/pricing/bulk-delete` (deleta ProductPricing em lote) — não
  destrutivo para Product/Material, mas deleta configuração de pricing.
- `POST /api/products/bulk-delete` (delete em lote de produtos) — verificar
  se UI tem modal exigindo confirmação visual.

## 7. UX operacional — pontos de atenção

| Sintoma | Origem | Sugestão |
|---|---|---|
| Operador "se perde" entre as muitas abas técnicas Nomus | NomusMaintenanceOverviewPanel + 7 abas | Painel Status Board + Checklist (já entregue na fase anterior). |
| Mensagens de erro genéricas em alguns endpoints | ex.: `apply-preview` retorna 500 com `error: ...` simples | Padronizar erro com `{error, message, ...}` em todos. |
| Falta de loading skeleton em consultas longas (dashboards CRM) | `Crm*Dashboard*.tsx` | Adicionar `Loader2` no topo durante fetch. |
| Sem indicação visual de "última atualização" em vários painéis | Pricing/Proposal | Mostrar `Atualizado em <data>`. |
| `confirmationRequiredText` é técnico para o usuário casual | Apply BOM | Já segue padrão consistente — manter. |

## 8. Pontos do banco

### Decimal
- Padrão (20,6) para valores monetários e (10,6) para percentuais — coerente.
- Atenção em `quantity` de `ProductBOM` e `ProposalItem`: usar sempre
  `Decimal` no backend (não converter para `Number` antes de calcular).

### FKs críticas
- `EngineeringChangeLog.runId → EngineeringSyncRun.id`
  (`onDelete: SetNull`) — protegida por smoke.
- `ProductBOM.productId → Product.id` (`Cascade`) — deleção de produto
  apaga BOM associada. Confirmar se algum produto com proposta ativa
  pode ser deletado por engano.
- `Proposal.customerId → Customer.id` (`NoAction`) — bom, evita perda.
- `ProposalItem.proposalId → Proposal.id` (`Cascade`) — coerente.

### Constraints úteis
- `Material.code @unique`, `Product.sku @unique`, `Customer.taxId @unique`.
- `@@unique([productId, taxRuleId])` em `ProductPricing` — bom.
- `Proposal.number @unique @default(autoincrement())` — bom.

## 9. Erros que **não** apareceram mas merecem revisão proativa

- **Frontend importando lib server-side**: 0 violações (guardrail OK).
- **FK órfã em EngineeringChangeLog.runId**: smoke ativo, sem pendência.
- **Build de Prisma no bundle**: 0 ocorrência de `index-browser`.
- **Lint TypeScript**: limpo.
- **Duplicate key em `package.json`**: corrigido na fase anterior.

## 10. Resumo executivo da auditoria

- **Saúde geral**: 🟢 sistema está em estado bom para liberação à
  Engenharia, com o caveat de finalizar **P1.1 (apply-batch)** e
  **P1.2 (histórico Carga Mestre)** antes do uso intensivo em produção.
- **Riscos imediatos (P0)**: nenhum.
- **Riscos importantes (P1)**: 4 itens listados, todos com ação curta
  e isolada.
- **Backbones funcionais**: Engenharia Nomus, Custos, Cadastros base,
  Permissões — todos verdes.
- **Pontos de monitoramento**: bundle, performance dos dashboards CRM,
  divergência grid×modal a confirmar empiricamente.
