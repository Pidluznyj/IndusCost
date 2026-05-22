# IndusCost — Plano de ação e roadmap

> Plano derivado da auditoria
> [`induscost-risk-and-quality-audit.md`](./induscost-risk-and-quality-audit.md).
> Cada linha tem prioridade, evidência, impacto, esforço, risco e ordem
> de execução. Nada aqui foi alterado em código — esta fase só **planeja**.

## 1. Prioridades

- **P0** — bloqueia produção / risco de dado.
- **P1** — importante antes de liberar Engenharia ampla.
- **P2** — melhoria operacional.
- **P3** — futuro / qualidade.

## 2. Plano consolidado

| Ord | Prioridade | Módulo | Problema | Evidência no código | Impacto | Ação recomendada | Esforço | Risco | Fase sugerida |
|---|---|---|---|---|---|---|---|---|---|
| 1 | P1 | Pricing | `POST /api/pricing/apply-batch` sem confirmação textual | `server.ts:6362` | Mutação em lote sem pedágio | Adicionar `confirmationText` esperado (`APLICAR PRECO LOTE`), validar antes de mutar, retornar 400 se ausente. Atualizar UI para coletar a frase. | S | Baixo | `INDUSCOST-PRICING-APPLY-GUARDRAIL-A` |
| 2 | P1 | Nomus / Carga Mestre | Apply não grava `EngineeringChangeLog` | `nomusMasterDataImport.ts:639` | Items criados não aparecem na aba Histórico até o backfill rodar | Criar `EngineeringSyncRun` (origin=`MASTER_DATA_IMPORT`) e chamar `recordEngineeringChange` para cada criação. Idempotente. | S | Baixo | `INDUSCOST-MASTER-DATA-IMPORT-HISTORY-A` |
| 3 | P1 | Backend | `server.ts` monolítico (~13 500 linhas, 176 endpoints) | `server.ts` | Velocidade de PR/review cai | Extrair rotas para `routes/{auth,products,materials,pricing,proposals,nomus,...}.ts` via `express.Router()`. Refactor mecânico, sem mudar lógica. | M | Médio | `INDUSCOST-SERVER-ROUTES-SPLIT-A` |
| 4 | P1 | DB | 9 modelos `*_backup_*_20260413` no `schema.prisma` | `prisma/schema.prisma:841-950` | Schema poluído; migrations futuras precisam ignorar manualmente | Confirmar `pg_dump` arquivado, criar migration de DROP TABLE controlada, remover modelos do schema. **Exige aprovação explícita por mutação destrutiva.** | M | Médio | `INDUSCOST-LEGACY-BACKUP-CLEANUP-A` |
| 5 | P2 | Frontend | Bundle > 500 kB gzipado | warning Vite | TTI alto, principalmente no `/login` | `React.lazy` em `App.tsx` para ProductModule, CrmModule, PricingModule, MaintenanceModule, SalesOrdersModule, ReportsModule. | S | Baixo | `INDUSCOST-FRONTEND-LAZY-LOAD-A` |
| 6 | P2 | Pricing / Proposal / CRM / Maintenance | Sem smoke read-only dedicado | `scripts/` cobre só Nomus | Regressões silenciosas | Criar `test:induscost:{pricing,proposal,crm,maintenance}-smoke` mínimos validando endpoints principais + FK. | M | Baixo | `INDUSCOST-CROSS-MODULE-SMOKES-A` |
| 7 | P2 | Cost | Divergência grid × modal a confirmar | comentários antigos + `costAnalysisPartial.ts` | Custo divergente assustaria comercial | Rodar piloto: comparar `GET /api/products/:id/cost-analysis` com lista; abrir hotfix se confirmar. | S | Médio | `INDUSCOST-COST-GRID-MODAL-CHECK-A` |
| 8 | P2 | Nomus / dashboards | Indicadores agregados de aplicação de BOM | já mencionada | Visibilidade gerencial baixa | Painel "Histórico de aplicações" reaproveitando `EngineeringSyncRun` recentes (já há endpoint). | S | Baixo | `NOMUS-ENGINEERING-RELEASE-INDICATORS-A` |
| 9 | P2 | Backend qualidade | Sem validação zod/io-ts nos payloads | rotas `server.ts` | Inputs malformados quebram com mensagem feia | Adicionar zod em `/api/products`, `/api/proposals`, `/api/pricing` (camada fina). | M | Baixo | `INDUSCOST-API-INPUT-VALIDATION-A` |
| 10 | P2 | Nomus | `confirmationTextFor` usa sku normalizado — exige texto exato | `nomusBomControlledApply.ts:124` | Operador pode digitar errado | UI já exibe a frase canônica; manter monitoramento, opcional aceitar variações de espaço. | S | Baixo | (sem fase) |
| 11 | P2 | Simulation legado | `Simulation` (modelo antigo) pode estar inativo | `schema.prisma:239` | Confusão futura | Confirmar uso real; marcar `@deprecated` no JSDoc das libs. Não remover sem decisão. | S | Baixo | `INDUSCOST-SIMULATION-LEGACY-AUDIT-A` |
| 12 | P3 | Backend qualidade | `apply-api-permission-guards.mjs` no scripts | `scripts/apply-api-permission-guards.mjs` | Risco se executado por engano | Mover para `scripts/legacy/` ou converter em gerador declarativo derivado de `permissionCatalog.ts`. | S | Baixo | `INDUSCOST-LEGACY-SCRIPTS-MOVE-A` |
| 13 | P3 | Documentação | `SystemGuideModule.tsx` desatualizada | `src/components/SystemGuideModule.tsx` | Onboarding lento | Trazer trechos chave de `nomus-engineering-equalization-guide.md` para a aba "Guia" do sistema. | M | Baixo | `INDUSCOST-INAPP-GUIDE-REFRESH-A` |
| 14 | P3 | Nomus | Status atual do `IntegrationRun` | `schema.prisma:731` (modelo existe) | Modelo pode estar parcialmente usado | Auditar `IntegrationRun` (quem grava, quem lê) e documentar ou remover. | M | Baixo | `INDUSCOST-INTEGRATION-RUN-AUDIT-A` |

Tamanho aproximado:
- **S (small)** — 0,5 a 1 dia.
- **M (medium)** — 2 a 4 dias.
- **L (large)** — 1 a 2 semanas.

## 3. Caminho recomendado por janela temporal

### Janela 1 — antes de liberar Engenharia ampla (urgente)

Ordem prática (executar nessa sequência):

1. **Validar smokes no servidor** (não é fase nova — só rodar):
   - `npm run test:nomus:engineering-release-ready`
   - `npm run test:nomus:bom-apply-after-master-data`
   - `npm run test:nomus:master-data-equalize`
   - `psql` da FK órfã em `EngineeringChangeLog`.
2. **P1.2** — `INDUSCOST-MASTER-DATA-IMPORT-HISTORY-A` (gravar
   histórico Nomus já no apply de Carga Mestre).
3. **P1.1** — `INDUSCOST-PRICING-APPLY-GUARDRAIL-A` (confirmação textual
   no `apply-batch`).
4. Apply real piloto **611.48AA** e **304.02AA**:
   `npm run sync:nomus:bom-apply-one -- --parentCode=611.48AA --confirm="APLICAR BOM NOMUS 611.48AA"`.

### Janela 2 — curto prazo (1–2 semanas após release)

5. **P2.1** — Lazy-load (`INDUSCOST-FRONTEND-LAZY-LOAD-A`).
6. **P2.2** — Smokes cross-module (`INDUSCOST-CROSS-MODULE-SMOKES-A`).
7. **P2.3** — Audit grid × modal de custo
   (`INDUSCOST-COST-GRID-MODAL-CHECK-A`).
8. **P2.5** — Indicadores de aplicação de BOM
   (`NOMUS-ENGINEERING-RELEASE-INDICATORS-A`).

### Janela 3 — médio prazo

9. **P1.3** — Split de `server.ts` (`INDUSCOST-SERVER-ROUTES-SPLIT-A`).
10. **P1.4** — Cleanup das tabelas backup
    (`INDUSCOST-LEGACY-BACKUP-CLEANUP-A`).
11. **P2.9** — Zod nos payloads (`INDUSCOST-API-INPUT-VALIDATION-A`).
12. **P2.11** — Audit `Simulation` legado
    (`INDUSCOST-SIMULATION-LEGACY-AUDIT-A`).

### Janela 4 — futuro

13. **P3.12** — Legacy scripts (`INDUSCOST-LEGACY-SCRIPTS-MOVE-A`).
14. **P3.13** — In-app guide refresh.
15. **P3.14** — `IntegrationRun` audit.

## 4. Sugestão de prompts para cada fase

Para iniciar cada fase futura, o template base pode ser:

```
Você vai atuar no projeto real IndusCost/Nomus.

Use Opus 4.7 em MAX Mode.
Agent Mode.
Trabalhe com profundidade, critério e cautela.
Responda sempre em português do Brasil.

============================================================
FASE
============================================================

Nome da fase:
<NOME-DA-FASE-A>

Objetivo:
<descrição curta>

Contexto:
<linkar para docs/induscost-action-plan-roadmap.md item N>

Regras:
- Não fazer mudanças destrutivas sem confirmação.
- Não mexer em ProductBOM/Material/Product/preço/proposta/pedido sem o escopo da fase.
- Não criar migration sem autorização explícita do usuário.
- Reaproveitar libs/UX existentes.
- Sempre rodar npm run check:frontend-imports + lint + build no final.
- Sempre criar smoke se a fase introduzir nova mutation.

Entregáveis:
<lista clara>

Validações obrigatórias:
<lista>

Git:
- commit + push apenas se tudo passar.
```

## 5. Critérios de pronto para Engenharia

A versão está liberável para a Engenharia trabalhar quando:

- [ ] Smokes principais OK no servidor (ver janela 1).
- [ ] Apply piloto de **611.48AA** e **304.02AA** rodou e gerou histórico.
- [ ] Aba **Histórico** do produto mostra entries `IMPORTED` e `EQUALIZED`.
- [ ] Painel "Central de Engenharia Nomus — Resumo" carrega.
- [ ] Checklist de Liberação aparece quando um produto é aberto.
- [ ] **P1.1** (apply-batch) implementado **ou** documentado para o time
      de pricing como bloqueio temporário.
- [ ] **P1.2** (histórico Carga Mestre) implementado **ou** o backfill
      foi rodado pelo menos uma vez no servidor após cada Carga Mestre.

## 6. Riscos remanescentes (mesmo depois de tudo)

Por ordem decrescente de probabilidade × impacto:

1. **Performance dos dashboards CRM** em base com muitos clientes — só
   se vê com carga real; recomendar `EXPLAIN ANALYZE` periódico.
2. **Mudança de regra de custo** sem nota — anotar sempre em
   `EngineeringChangeLog` (já feito para ProductBOM).
3. **Operador digitar errado a confirmação** — a frase é canônica e
   exibida; mas alguém com fé cega no copy/paste pode burlar com
   atalhos. Considerar logging das tentativas falhas.
4. **Falhas de rede pontuais durante `apply`** — todos os applies são
   transacionais no Prisma; abort seguro. Operador precisa retry.

## 7. Métricas para acompanhar pós-release

- nº de produtos com `EngineeringChangeLog` no último mês
- nº de `EngineeringSyncRun` por `summaryJson.origin`
- nº de aplies bloqueados por confirmação errada
- nº de aplies com `status=FAILED`
- tempo médio de geração de preview do Cockpit
- tamanho do bundle inicial (post lazy-load)
- erros de console no `/login` (monitorar via Sentry/log futuro)
