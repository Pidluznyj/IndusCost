# Simulações da Engenharia — governança de custo e fronteiras de domínio

Status: implementado na branch `feat/engineering-simulations-cost-governance` (outubro/2026), integrada à main `27ce0fca` (custo de produção como snapshot PUBLISHED completo).
Escopo: módulo **Simulações** (cenários existentes + novo produto) e sua integração com **Projetos**.
Fora de escopo: Formação de Preço oficial, publicação de custo e tabela de preço (ver seção 9).

## 1. Modelo mental

| Universo | Pergunta que responde | O que faz |
|---|---|---|
| **Simulações — cenário existente** | "E se meu custo mudar?" | Estima sobre um produto real |
| **Simulações — novo produto** | "Quanto custaria fabricar algo que ainda estou projetando?" | Estima um produto que não existe |
| **Projetos** | "Quanto esse projeto inteiro vai custar?" | Combina fontes (oficial, simulação, cotação) |
| **Formação de Preço oficial** | Preço comercial de produto real | Outro domínio; não é tocado por Simulações |

**Simulação estima. Projeto combina. Formação de Preço oficial precifica produto real.**
Os três mundos compartilham funções matemáticas puras; não compartilham persistência nem workflow.

## 2. Vocabulário de custo

| Termo | Significado | Onde vive |
|---|---|---|
| **LIVE** | Cálculo atual da engenharia (`getProductCostAnalysis`). Não publicado. | motor |
| **DRAFT de custo** | Candidato congelado à publicação | `ProductionCostTableVersion` (DRAFT) |
| **PUBLISHED** | Custo oficial vigente | `ProductionCostTableVersion/Item` |
| **SIMULATED** | Resultado de uma simulação. Nunca é oficial. | `Simulation`, `NewProductSimulation` |
| **Simulação congelada** | Snapshot de simulação imutável e reproduzível | `NewProductSimulation` (SAVED) |

"Rascunho da simulação / Simulação congelada / Arquivada" são estados **da simulação** e não se
confundem com DRAFT/PUBLISHED do custo oficial.

## 3. Base da simulação (LIVE × PUBLISHED)

`resolveProductCostBaseline()` (`src/lib/productCostBaseline.server.ts`) é o único ponto que
escolhe a fonte de custo de um produto existente para Simulações:

- `PUBLISHED` → somente `getEffectiveProductProductionCost` (custo versionado vigente);
- `LIVE` → somente `getProductCostAnalysis` (motor oficial);
- **sem fallback entre as fontes**: sem custo publicado o resultado é `NO_PUBLISHED_COST`;
- é **somente leitura** — não escreve em nenhum modelo.

A base é referência do cenário. Usar PUBLISHED = 15,00 e simular +10% de MP gera 15,80 de custo
**simulado**; o PUBLISHED continua 15,00.

Rótulos na tela: `PUBLICADO` · `LIVE — NÃO PUBLICADO` · `LEGADO — BASE NÃO REGISTRADA`.
LIVE nunca é chamado de "oficial".

## 4. Cenário de produto existente

- Criação (`POST /api/simulations`): corpo validado por lista branca; base padrão **PUBLISHED**,
  LIVE só por escolha explícita. A base (MP/HH/HM, versão/revisão ou instante do cálculo) e as
  premissas de preço vigentes são **congeladas** em `Simulation.baselineSnapshot`.
- Comparação (`GET /api/simulations/:id/compare`): sempre BASE × CENÁRIO sobre a base
  congelada — reproduzível. Devolve MP, HH, HM, processo (HH + HM) e total, com variação
  absoluta e percentual.
- Drivers (`simulateScenarioDrivers`):
  - MP, HH e HM por fator (lineares na taxa);
  - **eficiência só sobre a transformação do processo próprio**: `processo' = transformação / f + setup`.
    Setup e custo herdado de componentes filhos não mudam — igual a
    `computeStandardProcessUnitCosts`. Sem decomposição disponível, a API devolve
    `EFFICIENCY_DECOMPOSITION_UNAVAILABLE` em vez de um número.
  - margem: variação **relativa** da margem premissa (mantido por compatibilidade).
- Premissas impossíveis (divisor ≤ 0) devolvem `pricingIssue`; nunca preço 0.
- Registros antigos (sem base gravada) abrem como `LEGACY_LIVE`, com o cálculo histórico e aviso.
- "Excluir" um cenário **arquiva** (`archivedAt/By`); o registro é preservado.

## 5. Simular novo produto

O modelo da tela foi preservado (linhas de composição, componentes simulados, materiais de
catálogo/manuais, processo padrão). O que mudou:

- **Servidor como autoridade**: o cliente envia *inputs*; `computeNewProductSimulationSnapshot`
  valida, resolve cadastro e custos, calcula e monta o snapshot (`schemaVersion: 2`). Snapshot
  montado no navegador é recusado.
- Componente existente: base por linha (padrão **LIVE**, como sempre foi; PUBLISHED opcional),
  registrada no snapshot com versão/revisão ou instante do cálculo. Sem fallback "tudo em MP".
- Componente simulado: taxas HH/h e HM/h usadas, transformação, setup e netPph ficam gravados.
- Material: custo do cadastro no momento, custo efetivo, frete, perda e **flag de override**
  quando o usuário digitou custo diferente do catálogo.
- Autoria e datas vêm da sessão e do relógio do servidor.
- Rascunho é editável de verdade; congelar transforma o próprio rascunho (linhagem
  `sourceSimulationId` preservada). Simulação congelada não é alterada in-place.
- Análise econômica: sem premissas comerciais → **análise industrial preliminar** (MP + HH + HM
  e margem industrial). Com premissas da simulação → **preço simulado**. Não existe mais
  "Viável/Inviável" nem "Preço sugerido"; snapshots legados mostram a classificação antiga só
  como registro.
- Excluir: só rascunho. Congelada é **arquivada**.

## 6. Projetos

`NewProductSimulation` congelada → `snapshot.result.costBase` → `ProjectSimulatedItem`.

- O projeto **copia** o valor; não há referência viva nem recálculo posterior.
- `canBecomeOfficial = false` sempre (inclusive em edição).
- Origem registrada em colunas: `sourceSimulationId`, `sourceSimulationName`,
  `sourceSimulationSnapshotHash`, `sourceSimulationCostBase`, `sourceSimulationCopiedAt`
  (o marcador em `notes` é mantido por compatibilidade e não pode ser apagado na edição).
- A lista de itens do projeto mostra a origem ("Simulações · S1 · snapshot 2026-10-05").
- O item entra no **total do projeto** exatamente uma vez, pelo custo copiado (seção 14).

## 7. Integrações permitidas e proibidas

Permitidas:
- Simulações **lê** produto, material, regra fiscal, premissas vigentes e custo LIVE/PUBLISHED;
- Simulações → Projetos por cópia de snapshot congelado;
- uso das bibliotecas puras `pricing/commercialPriceFormula.ts`, `materialEffectiveCost.ts` e
  `computeStandardProcessUnitCosts`.

Proibidas (cobertas por `src/lib/simulationsDomainBoundary.test.ts`):
- Simulação → custo PUBLISHED; Simulação → `ProductPricing`; Simulação → tabela de preço;
- chamar `publishProductionCostVersionFromDraft` a partir de Simulações;
- escrever em qualquer modelo que não seja `Simulation` / `NewProductSimulation`.

## 8. Promoção futura de uma simulação

```
Simulação → Projeto → decisão humana → cadastro do Produto → BOM real → processo real
        → motor oficial (LIVE) → DRAFT oficial → publicação oficial → Formação de Preço
```
Nunca `Simulation.costBase → PUBLISHED` nem `Simulation.price → tabela de preço`.
Não há workflow de promoção implementado nesta entrega.

## 9. Achados fora de escopo (não corrigidos nesta branch)

### PRICING_OUT_OF_SCOPE_FINDINGS

| # | Arquivo / função | Comportamento | Risco | Recomendação |
|---|---|---|---|---|
| 1 | `server.ts` — `GET /api/pricing`, `GET /api/pricing/:productId/:taxRuleId/calculate`, `POST /api/pricing/simulate-unit`, `POST /api/pricing/simulate-batch`, `GET /api/products/:id/pricing-snapshot`, dashboard, `reportsDataService.ts` | Calculam preço sobre custo **LIVE** (`getProductCostAnalysis`), enquanto `docs/architecture/versioned-cost-price-margin.md` diz que preço comercial lê custo publicado | Decisão comercial sobre custo não publicado | Projeto próprio: definir fonte por fluxo e rotular LIVE como simulação |
| 2 | Fórmula `(custo + frete)/(1 − deduções − margem)` | 7 cópias inline com tratamentos diferentes para divisor ≤ 0 (0, null, 400) | Drift e preço 0 silencioso | Migrar para `commercialPriceFormula.ts` com testes de equivalência |
| 3 | `priceTablePublication.server.ts` × `productionCostTables.server.ts` | Geração de tabela usa "a versão publicada mais recente"; pedidos/propostas usam o melhor item por produto. Divergem quando há versões `AUTO-` de um produto só | Produtos sem custo na geração de tabela | Unificar o resolver |
| 4 | `ProposalModule.tsx` | Custo do item vem de `pricing-snapshot` (LIVE) mesmo com tabela selecionada | Custo de proposta ≠ custo publicado | Avaliar junto com o item 1 |
| 5 | `docs/products/PRODUCT_FINAL_COST_SOURCE.md` | Desatualizado em relação à arquitetura versionada | Documentação contraditória | Revisar |
| 6 | Markup | Razão `preço/custo` em pricing × percentual em `projectsCalculations.ts` (cujo comentário diz o contrário) | Leitura errada | Padronizar nomes `markupFactor` / `markupPct` |

### Outros achados
- **Projetos — perda de BOM**: `q × u × (1 + perda)` (projetos) × `q / (1 − perda)` (motor).
  Não alterado porque mudaria custos persistidos; caracterizado em `materialEffectiveCost.test.ts`.
- **Projetos — custo persistido da versão**: `ProjectVersion.unitCost/totalEstimatedCost/suggestedPrice`
  continuam derivados só da estrutura; o total exibido já inclui o item de simulação (seção 14).
- **Express 4 + async**: outras rotas do `server.ts` sem try/catch podem gerar rejeição não
  tratada; aqui só as de Simulações foram blindadas (`asyncRoute`).
- **`settingsApplyHhHmSimulation`** altera `HH_VALUE_OVERRIDE`/`ENERGY_COST` e muda o LIVE de
  todos os produtos; simulações novas registram as taxas usadas, as antigas não.
- **`POST` do histórico do simulador de transformação** protegido só por permissão de leitura.
- **`GET /api/materials`** sem guarda para perda ≥ 100%.
- Modelo `ProductionHourCostSimulation` sem nenhuma referência em código.

## 10. Rollout

1. Aplicar as migrations `20261005120000_new_product_simulation_status_archived` e
   `20261006120000_simulations_cost_governance` (aditivas, sem backfill) **antes** do código.
2. Rodar `npm run permissions:seed:contract:apply` — novas ações `update` (arquivar/restaurar,
   chave `simulations.edit`) e `delete` (chave `simulations.delete`). Até lá, quem só tinha
   `create` não consegue mais arquivar/excluir.
3. Cenários novos sobre PUBLISHED exigem custo publicado do produto; sem ele a tela oferece a
   engenharia atual de forma explícita.

## 11. Diagrama de fronteira

```
                 ┌───────────────────────────────┐
   lê (somente)  │          SIMULAÇÕES           │
 ┌──────────────▶│  cenário existente            │
 │               │  novo produto                 │
 │               │  escreve SÓ em Simulation e   │
 │               │  NewProductSimulation         │
 │               └───────────────┬───────────────┘
 │                               │ cópia do snapshot congelado
 │                               ▼ (custo, id, nome, hash, data)
 │               ┌───────────────────────────────┐
 │               │           PROJETOS            │
 │               │ oficial + simulado + cotação  │
 │               │ + ferramental + outros custos │
 │               └───────────────────────────────┘
 │
 │  Produto · Material · Regra fiscal · premissas vigentes (ProductPricing, leitura)
 │  custo LIVE (getProductCostAnalysis) · custo PUBLISHED (getEffectiveProductProductionCost)
 │
 └── UNIVERSO OFICIAL (não é escrito por Simulações nem por Projetos via simulação)
     Produto real → Engenharia LIVE → DRAFT (pode ser parcial) → PUBLISHED (snapshot completo)
                 → Formação de Preço oficial → Tabela de preço
```

Não existe seta `Simulação → custo publicado` nem `Simulação → Formação de Preço`.

### Leituras permitidas
`Product`, `Material`, `TaxRule/TaxComponent`, `ProductPricing` (apenas `findUnique`, premissas
de referência do cenário), parâmetros globais de HH/HM (via cache do motor), custo LIVE e custo
PUBLISHED.

### Escritas proibidas
`ProductionCostTableVersion`, `ProductionCostTableItem`, `ProductPricing`, `PriceTable*`,
qualquer chamada a publicação de custo (unitária, em lote, snapshot completo) ou de tabela de preço.

## 12. Fonte exata das bases

**PUBLISHED** — `getEffectiveProductProductionCost(db, productId, referenceDate)` em
`src/lib/productionCostTables.server.ts`, chamada só por `resolveProductCostBaseline`
(`src/lib/productCostBaseline.server.ts`). É o leitor oficial de **custo efetivo por produto e
data** — o mesmo usado por margem de pedido, margem de proposta, comissões e CMV da DRE:

- considera versões `PUBLISHED` e `SUPERSEDED` com `effectiveDate ≤ data de referência`;
- escolhe, **por produto**, o melhor item (vigência mais recente, depois status, publicação, revisão);
- ignora item com custo ≤ 0; sem item válido devolve `SEM_CUSTO` → `NO_PUBLISHED_COST`;
- nunca lê DRAFT, nunca lê LIVE.

Por ser por produto, funciona tanto com o snapshot completo atual (commit `27ce0fca`) quanto com
as versões publicadas parciais do legado: o simulador **não** assume que "a última versão
publicada global" contém todos os produtos. A data de referência é o instante da criação do
cenário (ou do cálculo do novo produto) e fica gravada junto com `versionId`, código, revisão e
vigência.

O resolvedor comercial de tabela de preço (`priceTableProductionCostResolver`) é outro caminho,
de versão única, e **não** é usado nem alterado aqui.

**LIVE** — `getProductCostAnalysis(productId, cache, true)` do motor oficial
(`productCostAnalysisEngine.server.ts`), com `initAnalysisCache()` novo a cada chamada (sem
catálogo de MP versionado: custo vivo de material). Fica gravado o instante do cálculo.

## 13. Semântica de eficiência

`processo' = transformação própria / f + setup próprio + HH/HM dos filhos`, com `f = 1 + ajuste/100`.

Exemplo (teste "eficiência — exemplo numérico explícito"):

| Parcela | Base | Eficiência +25% |
|---|---|---|
| Material (X) | 10,00 | 10,00 |
| Mão de obra própria — transformação (Y) | 2,00 | 1,60 |
| Máquina própria — transformação (Z) | 3,00 | 2,40 |
| Setup (S) | 0,50 + 0,50 | 0,50 + 0,50 |
| Filhos (F) | 1,00 + 1,50 | 1,00 + 1,50 |
| **Total** | **18,50** | **17,50** |

A decomposição transformação × setup vem do detalhe do motor (LIVE). Sobre PUBLISHED ela só é
usada quando HH e HM vivos coincidem com os publicados (processo inalterado desde a publicação);
caso contrário a API recusa o ajuste de eficiência (`EFFICIENCY_DECOMPOSITION_UNAVAILABLE`).

## 14. Regra do total do Projeto

`total = custo unitário + investimento inicial + outros custos do projeto`, onde

`custo unitário = estrutura (costBreakdown.unitCost) + itens vindos de simulação`.

- O item vindo de simulação é um produto do projeto e, como o produto oficial, compõe o custo
  unitário — pelo valor **copiado e congelado** no próprio `ProjectSimulatedItem`
  (`quotedUnitCost ?? estimatedUnitCost`, a mesma leitura da lista de itens).
- Entra **exatamente uma vez**: se uma linha de estrutura já aponta para o item
  (`simulatedItemId`), o custo já está na estrutura e não é somado de novo.
- O cálculo é puro (`resolveProjectEstimatedTotalCost` em `src/lib/projectsGuidedFlow.ts`): não
  consulta a Simulation, o custo LIVE nem o custo publicado.
- `ProjectSimulatedItem` não tem quantidade própria: conta como 1 produto. Custo zero/ausente soma zero.
- Componentes/matérias-primas criados no projeto continuam entrando só quando usados na
  estrutura (regra anterior, inalterada).
- Vale para: aba Custos, tela inicial do projeto, relatório executivo, snapshot de custo e valor
  estimado na listagem/dashboard de projetos.
- **Não alterado:** os campos persistidos `ProjectVersion.unitCost / totalEstimatedCost /
  suggestedPrice`, que continuam derivados só da estrutura; precificação e amortização do projeto
  já tratavam o item de simulação individualmente e não mudaram.

## 15. Permissões

Recurso `engineering.simulations`.

| Operação | Ação canônica | Chave legada |
|---|---|---|
| Visualizar cenários, simulações e relatórios | `view` | `simulations.view` |
| Criar cenário · salvar rascunho · editar rascunho · congelar · clonar · prévia | `create` | `simulations.create` |
| Arquivar / restaurar simulação congelada · restaurar cenário | `update` | `simulations.edit` |
| Arquivar cenário · excluir rascunho de novo produto | `delete` | `simulations.delete` |

- Exclusão definitiva existe **só** para rascunho de novo produto. Cenário e simulação congelada
  são arquivados.
- Simulação congelada não tem rota de alteração; tentar salvar por cima devolve 409.
- `SUPER_ADMIN` pode tudo; somente-leitura só vê; quem tem só `create` não arquiva nem exclui.
- Papéis com `canManage` recebem `update`/`delete` pelo baseline. Perfis existentes que tinham
  só `simulations.create` **deixam de arquivar/excluir** até receberem as chaves novas — por
  desenho; as permissões não foram alargadas para evitar o 403.

## 16. Migrations — revisão

| Item | `20261005120000` (enum) | `20261006120000` (colunas) |
|---|---|---|
| SQL | `ALTER TYPE … ADD VALUE IF NOT EXISTS 'ARCHIVED'` | `ADD COLUMN IF NOT EXISTS` (22 colunas) + `CREATE INDEX IF NOT EXISTS` |
| Nullability / default | — | todas anuláveis, sem default |
| NOT NULL / backfill | não | não |
| Foreign keys | não | não (ids em colunas UUID simples, padrão do repositório) |
| Lock esperado | catálogo do tipo, instantâneo | `ACCESS EXCLUSIVE` breve por tabela (só metadados); o índice faz `SHARE` em `ProjectSimulatedItem` durante a criação — tabela pequena |
| Dados existentes | intactos | intactos (colunas novas nulas) |
| Idempotência | sim | sim |
| Rollback conceitual | valor de enum permanece (inofensivo) | colunas podem permanecer; nenhum DROP é necessário |

- O valor de enum fica em migration própria porque não pode ser usado na transação em que é criado.
- `Simulation` não tem migration de criação no histórico; por isso `ALTER TABLE IF EXISTS`.

**Ordem obrigatória: migration primeiro, código depois.**

- *Código antigo com migration aplicada:* funciona. O client antigo não conhece as colunas novas
  e ninguém grava `ARCHIVED`.
- *Código novo sem migration:* **quebra** — o client novo seleciona as colunas novas em
  `Simulation`, `NewProductSimulation` **e `ProjectSimulatedItem`**, então as telas de
  Simulações e de Projetos falhariam.
- *Rollback de código depois de arquivar algo:* o client antigo não conhece `ARCHIVED` e falharia
  ao ler essas linhas. Antes de voltar o código, restaurar pela tela (ou tratar essas linhas).

## 17. Compatibilidade com o snapshot completo de custo (main `27ce0fca`)

- A feature não altera `productionCostCompleteSnapshot*`, `productionCostBulkPublish*`,
  `unitaryFormationProductionCost*`, `productionCostTables.server.ts`,
  `priceTableProductionCostResolver` nem `priceTablePublication*`.
- A única dependência do domínio oficial é o leitor `getEffectiveProductProductionCost`, cujo
  comportamento não mudou no commit `27ce0fca`.
- Com o exemplo oficial (publicado A=10, B=20, C=30; LIVE B=22, C=45), um cenário sobre
  PUBLISHED de C usa 30 e um cenário sobre LIVE usa 45 — e nenhum dos dois publica nada.

## 18. Riscos residuais

- Validado com testes (Prisma em memória) e tela em ambiente simulado; **não** com PostgreSQL
  nem em homologação — é o objetivo do runbook abaixo.
- Perfis sem as chaves novas perdem arquivar/excluir até o ajuste de permissões.
- Eficiência sobre base publicada depende de o processo vivo coincidir com o publicado.
- `ProjectVersion.unitCost` persistido não inclui o item de simulação (ver seção 14).
- Cenário legado continua calculando sobre a engenharia atual no momento da consulta.

## 19. Runbook de homologação

Pré-requisitos: aplicar as duas migrations, publicar o código, rodar
`npm run permissions:seed:contract:dry` e depois `:apply`.

**Antes de começar — contagens de controle (somente leitura):**
```sql
SELECT 'ProductionCostTableVersion' t, count(*), max("updatedAt") FROM "ProductionCostTableVersion"
UNION ALL SELECT 'ProductionCostTableItem', count(*), max("updatedAt") FROM "ProductionCostTableItem"
UNION ALL SELECT 'ProductPricing', count(*), max("updatedAt") FROM "ProductPricing"
UNION ALL SELECT 'PriceTableVersion', count(*), max("updatedAt") FROM "PriceTableVersion"
UNION ALL SELECT 'PriceTableItem', count(*), max("updatedAt") FROM "PriceTableItem";
```
Guardar o resultado.

**Caso A — produto com PUBLISHED ≠ LIVE.** Criar cenário com base "Custo publicado": base =
valor oficial, com versão/revisão/vigência. Criar outro com "Engenharia atual": base = valor
atual, selo `LIVE — NÃO PUBLICADO`. Conferir os dois valores contra
`GET /api/production-cost-tables/effective-cost?productId=…` e contra a aba de custo do produto.

**Caso B — produto sem PUBLISHED.** A tela mostra "Este produto não possui custo oficial
publicado" e o botão de criar fica desabilitado até escolher "Usar Engenharia atual". Não há
troca automática.

**Caso C — drivers.** Num produto com setup > 0, sobre LIVE: MP +10% muda só MP; HH +8% só HH;
HM +15% só HM; eficiência ±: muda HH/HM, MP igual, e a variação é menor que a de dividir o
processo inteiro. Sobre PUBLISHED com processo alterado desde a publicação: eficiência é recusada
com mensagem.

**Caso D — novo produto.** Compor com item real (base LIVE e depois PUBLISHED), componente
simulado com ciclo/cavidades/eficiência/setup/lote, material de catálogo com custo sobrescrito e
material manual. Verificar: linha em branco ignorada, quantidade zero aceita, quantidade negativa
recusada, salvar sem nome usa "Produto simulado". Salvar rascunho, reabrir, congelar. Reabrir a
congelada: mesmos números; relatório igual à tela; taxas HH/HM e origem dos custos no relatório.

**Caso E — Projetos.** Adicionar a simulação congelada a um projeto que já tenha item oficial.
Conferir: origem ("Simulações · nome · snapshot data"), custo copiado, e **total do projeto =
oficial + simulado (+ ferramental + outros)**. Depois arquivar a simulação e clonar/alterar o
clone: o projeto não muda.
```sql
SELECT id, description, "estimatedUnitCost", "quotedUnitCost", "canBecomeOfficial",
       "sourceSimulationId", "sourceSimulationName", "sourceSimulationCostBase",
       "sourceSimulationSnapshotHash", "sourceSimulationCopiedAt"
FROM "ProjectSimulatedItem" WHERE "sourceSimulationId" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 10;
```
Esperado: `canBecomeOfficial = false` e hash igual ao `snapshotHash` da simulação.

**Caso F — segurança.** Somente-leitura: vê, sem botões de criar/salvar/arquivar; API devolve
403. Só criar: cria, congela, clona; não arquiva nem exclui. Com `simulations.edit`: arquiva e
restaura. Com `simulations.delete`: exclui rascunho e arquiva cenário. Tentar salvar por cima de
congelada → 409. UUID inválido → 400 (servidor continua de pé).

**Caso G — banco.** Repetir a consulta de controle do início: contagens e datas máximas das cinco
tabelas oficiais devem estar **idênticas**. Conferir o que a feature gravou:
```sql
SELECT status, count(*) FROM "NewProductSimulation" GROUP BY status;
SELECT "baselineSource", count(*) FROM "Simulation" GROUP BY "baselineSource";
```
