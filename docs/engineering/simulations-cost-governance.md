# Simulações da Engenharia — governança de custo e fronteiras de domínio

Status: implementado na branch `feat/engineering-simulations-cost-governance` (outubro/2026).
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
- **Projetos — total**: item vindo de simulação aparece na lista com seu custo, mas
  `resolveProjectEstimatedTotalCost` soma só estrutura, ferramental e outros custos.
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
