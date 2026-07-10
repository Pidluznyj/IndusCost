# Auditoria: origem dos valores oficiais HH / HM no Simulador de Custo de Injeção

Data: 2026-07-10  
Escopo: somente leitura — sem alteração de cálculo, BOM, produto ou configuração.

## Resumo

| Pergunta | Resposta |
|---|---|
| De onde vêm? | **Configurações Gerais** → tabela `IndirectCost` (`category = GLOBAL_PARAM`) |
| HH default | Campo `HH_VALUE_OVERRIDE.monthlyValue` (se > 0) **ou** folha ÷ `FACTORY_HOURS_MONTHLY` |
| HM default | **Calculado:** `ENERGY_COST.monthlyValue ÷ WORKING_HOURS.monthlyValue` |
| Custo hora injeção default | **Calculado no backend:** `HH default + HM default` (não é campo cadastrado) |
| Usados no custo oficial? | **Sim**, como taxa horária base do **Processo Padrão** (`STANDARD_PROCESS`) |
| Simulação altera oficial? | **Não** (manual, CC e histórico salvo são isolados) |

Valores observados na UI (ambiente do usuário):

- HH default: **R$ 38,86/h**
- HM default: **R$ 13,354701/h**
- Custo hora injeção: **R$ 52,214701/h** (= 38,86 + 13,354701)

## Fluxo completo

```
Tela Engenharia > Simulador de Custo de Injeção
  → TransformationCostSimulatorModule
  → GET /api/transformation-simulator/official-reference-costs
  → initAnalysisCache()  [productCostAnalysisEngine.server.ts]
  → buildOfficialDefaultIndustrialCostsReference(cache)  [componentStandardProcessCost.ts]
  → IndirectCost GLOBAL_PARAM + (opcional) Employee/Role para HH AUTO
  → motor oficial getProductCostAnalysis usa o mesmo cache
```

## Frontend

**Arquivo:** `src/components/TransformationCostSimulatorModule.tsx`

- Bloco: “Referência oficial do sistema”
- Estado: `officialReference` tipado como `OfficialDefaultIndustrialCostsReference`
- API: `GET /api/transformation-simulator/official-reference-costs`
- Exibição:
  - `officialReference.hhDefault`
  - `officialReference.hmDefault`
  - `officialReference.injectionHourlyCostDefault`
- Formatação: `formatOfficialHourlyRate` → `formatCurrency` (`src/lib/utils.ts`)
  - `minimumFractionDigits: 2`, `maximumFractionDigits: 6`
  - Por isso HH “redondo” (38,86) aparece com 2 casas e HM (13,354701) com até 6
- **Não** recalcula HH+HM no frontend para o bloco oficial; usa o valor já somado pelo backend
- Sem fallback hardcoded de taxa no frontend (só mensagem de erro se API falhar)

## Backend / API

**Endpoint:** `GET /api/transformation-simulator/official-reference-costs` (`server.ts`)

1. `initAnalysisCache()`
2. `buildOfficialDefaultIndustrialCostsReference(cache)`
3. Se `available === false` → HTTP 503 + mensagem pedindo Configurações Gerais

**Helpers:**

- `resolveDefaultProcessHourCostsFromAnalysisCache`
- `buildOfficialDefaultIndustrialCostsReference`  
  em `src/lib/componentStandardProcessCost.ts`

**Regra exata:**

```
hhDefault     = cache.globalHhCost
hmDefault     = cache.energyCost / cache.workingHours
injectionHourlyCostDefault = hhDefault + hmDefault
```

Não há outro fator (eficiência, cavidades, ciclo) nesse bloco de referência horária.

## Banco / Prisma

**Tabela:** `IndirectCost`  
**Model:** `prisma/schema.prisma` → `IndirectCost`

| description | Uso | Campo |
|---|---|---|
| `HH_VALUE_OVERRIDE` | HH manual (R$/h) se `monthlyValue > 0` | `monthlyValue` |
| `ENERGY_COST` | Energia mensal (R$) | `monthlyValue` |
| `WORKING_HOURS` | Horas máquina disponíveis / mês | `monthlyValue` |
| `FACTORY_HOURS_MONTHLY` | Denominador do HH automático (folha) | `monthlyValue` |

Filtro: `category = "GLOBAL_PARAM"` e `status = "ACTIVE"` (cache carrega ACTIVE).

**Cadastro UI:** Configurações Gerais → Parâmetros Globais (`SettingsModule.tsx` + `GET/PUT` via `/api/settings/globals` e `/api/indirect-costs`).

**Não existe** campo próprio “custo hora de injeção default” no banco.

### Inferência dos valores exibidos (sem query local)

Ambiente local desta auditoria **não tinha** `.env` / `DATABASE_URL` para consultar o banco ao vivo.  
Com base nos números da UI e nos testes do projeto:

- `38,86` é compatível com **override manual** `HH_VALUE_OVERRIDE = 38.86`
- `13,354701` ≈ `25000 / 1872` (padrão usado em testes: energia 25000, horas 1872)
- Soma exata: `38.86 + 13.354701 = 52.214701`

Confirmar no banco (produção/staging):

```sql
SELECT description, "monthlyValue", status
FROM "IndirectCost"
WHERE category = 'GLOBAL_PARAM'
  AND description IN (
    'HH_VALUE_OVERRIDE',
    'ENERGY_COST',
    'WORKING_HOURS',
    'FACTORY_HOURS_MONTHLY'
  );
```

## Uso no custo oficial do produto

**Motor:** `createProductCostAnalysisEngine` → `getProductCostAnalysis`  
(`src/lib/productCostAnalysisEngine.server.ts`)

### Quando usa HH/HM default globais

No caminho **Processo Padrão** (`STANDARD_PROCESS`):

- `globalHhCostPerHour = cache.globalHhCost` (mesmo HH default)
- `machineHourCostPerHour = energyCost / workingHours` (mesmo HM default)
- `cellHourCost = HH + HM`
- Custo unitário de transformação = `cellHourCost / netPph` (+ setup rateado)

Ou seja: a **taxa horária** oficial default entra no custo; o valor **por peça** depende ainda de ciclo, cavidades, eficiência, setup e lote do produto/componente.

### Quando NÃO usa o HH default global

No caminho **Roteiro** (`ProductRouting`):

- HH da operação vem do **cargo/role** da etapa: `(salário + encargos) / monthlyHours do role`
- HM continua `energyCost / workingHours` (global)

### Prioridade (resumo)

1. `costingMode` BOM_ONLY / FINISHING_SERVICE → ignora processo próprio neste nível  
2. PRODUCT com ciclo padrão → prefere STANDARD_PROCESS (usa HH/HM default)  
3. Senão, se há roteiro → ROUTING (HH por role; HM global)  
4. Senão → STANDARD_PROCESS se houver ciclo  
5. Simulações (manual / CC / histórico) **nunca** entram neste motor

Publicação de custo / precificação oficial consome o resultado desse motor (ou snapshots derivados), **não** o formulário do simulador.

## Diferença entre as quatro “fontes” de HH/HM

| Fonte | O que é | Persiste? | Entra no custo oficial? |
|---|---|---|---|
| Referência oficial (bloco da tela) | Defaults de Configurações Gerais | Sim (IndirectCost) | Sim, como taxa base do processo padrão |
| Simulação manual | Folha/pessoas/horas/eficiência + energia/máquinas digitados na tela | Só se usuário clicar “Salvar” → histórico `TransformationHhHmCostSimulation` tipo `CUSTO_MANUAL` | Não |
| Simulação por centro de custo | Médias AP (vencimento) + pessoas/máquinas | Histórico tipo `CUSTO_CC` se salvar | Não |
| Custo oficial do produto | Motor `getProductCostAnalysis` + dados do produto (ciclo/BOM/roteiro) | Custo publicado / análise | Sim |

## Arredondamento

- Backend **não** arredonda HH/HM antes de devolver a referência.
- Frontend usa `formatCurrency` com até 6 casas.
- HH 38,86: valor já “curto” na origem (override tipicamente com 2 casas).
- HM 13,354701: divisão energia÷horas com mais casas; UI mostra até 6.
- Injeção = soma exata dos dois; bate com a UI.

## Riscos / inconsistências (somente relato)

1. **Texto da UI impreciso:** “Custo hora máquina **cadastrado**” — HM **não** é campo cadastrado; é energia ÷ horas.  
2. **Fallback só na tela de Settings:** `buildSettingsGlobalsPayload` usa defaults UI `workingHours: 176`, `factoryHours: 8448` se faltarem registros; o motor oficial **lança erro** (`CONFIG_MISSING`) em vez de usar esses fallbacks.  
3. **Duplicidade aparente de endpoints:**  
   - `/api/transformation-simulator/official-reference-costs`  
   - `/api/simulations/default-process-hour-costs`  
   Ambos usam `initAnalysisCache` + `resolveDefaultProcessHourCostsFromAnalysisCache` (mesma fonte).  
4. **Dois significados de “HH”:** taxa R$/h (referência) vs R$/peça (resultado do processo).  
5. **Roteiro vs default:** produto com roteiro pode usar HH de cargo diferente do HH default exibido no simulador — risco de confusão operacional.  
6. **Sem `.env` local nesta auditoria:** valores atuais do banco não foram lidos aqui; números da UI foram reconciliados por cálculo.

## Recomendações futuras (não implementadas)

1. Tooltip no bloco oficial: HH = override ou folha; HM = energia ÷ horas; injeção = soma.  
2. Padronizar label: “HM calculado (energia / horas)” em vez de “cadastrado”.  
3. Exibir `hhSource` (AUTO/MANUAL) no bloco de referência.  
4. Opcional: alinhar casas decimais de exibição (ex.: sempre 2 ou sempre 4) para HH e HM.  
5. Manter aviso explícito de que simulações salvas não alteram custo oficial (já existe no grid de histórico).

## Arquivos analisados

- `src/components/TransformationCostSimulatorModule.tsx`
- `src/lib/componentStandardProcessCost.ts`
- `src/lib/componentStandardProcessCost.test.ts`
- `src/lib/productCostAnalysisEngine.server.ts`
- `src/lib/settingsGlobalsRoutes.ts`
- `src/components/SettingsModule.tsx`
- `src/lib/utils.ts` (`formatCurrency`)
- `server.ts` (rota official-reference-costs)
- `prisma/schema.prisma` (`IndirectCost`)
- `src/lib/transformationCostSimulator.ts`
- `src/lib/transformationHhHmSimulationHistory*.ts`
- `src/components/product/ComponentInjectionCalculationBreakdown.tsx`
