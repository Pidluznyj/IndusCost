# Planilha modelo — Ficha de Abertura de Projeto

Versão do schema: **1.2**  
Arquivo gerado: `modelo-projeto-induscost.xlsx`

## Objetivo

A planilha modelo permite preencher dados de abertura e estimativa de projeto **offline**, em reunião ou com o cliente, para futura **importação no IndusCost**.

Nesta fase, apenas o **download** e o **schema** estão implementados. A importação completa será desenvolvida em versão futura.

## Como baixar

No módulo **Projetos**, use o botão **Baixar planilha modelo** (cabeçalho do projeto ou aba Documentos).

Implementação: `src/lib/projectsIntakeSpreadsheet.ts` — geração client-side com biblioteca `xlsx` já existente no projeto.

## Abas

| Aba | Finalidade |
|-----|------------|
| `01_Projeto` | Dados gerais do projeto |
| `02_Entregaveis` | Entregáveis esperados (marcar X) |
| `03_Itens` | Produtos / entregáveis raiz (ficha rápida 5.1) |
| `04_Composicao_BOM` | Estrutura preliminar / BOM com item pai (ficha rápida 5.2) |
| `05_Processos_HH` | Processos e horas-homem (ficha completa; na ficha rápida serviços vão na composição) |
| `06_Moldes_Ferramentas` | Moldes e ferramentas |
| `07_Custos_Extras` | Custos adicionais |
| `08_Pendencias` | Pendências e bloqueios |

## Colunas por aba

### 01_Projeto

| Coluna | Obrigatório na importação futura | Descrição |
|--------|----------------------------------|-----------|
| `nome_projeto` | Sim | Nome/título do projeto |
| `cliente` | Sim | Cliente |
| `tipo_projeto` | Sim | Tipo (ex.: Produto novo, Molde novo) |
| `prioridade` | Não | Baixa, Média, Alta, Urgente |
| `responsavel_comercial` | Sim | Responsável comercial |
| `responsavel_tecnico` | Não | Responsável técnico |
| `prazo_desejado` | Não | Data ou texto de prazo |
| `volume_mensal` | Não | Volume mensal estimado |
| `volume_anual` | Não | Volume anual estimado |
| `preco_alvo` | Não | Preço alvo do cliente |
| `margem_desejada` | Não | Margem desejada (%) |
| `observacoes` | Não | Observações gerais |

### 02_Entregaveis

| Coluna | Descrição |
|--------|-----------|
| `entregavel` | Nome do entregável (linhas pré-preenchidas) |
| `marcar_x` | Marcar com `X` ou `S` para selecionado |
| `observacao` | Notas |

### 03_Itens

Produtos e entregáveis raiz do projeto — corresponde à seção **5.1** da ficha rápida.

| Coluna | Descrição |
|--------|-----------|
| `item` | Número sequencial (1, 2, 3…) |
| `codigo_sku` | Código/SKU do produto ou entregável, se existir |
| `produto_entregavel` | Nome do produto/entregável |
| `tipo` | Produto novo, Componente novo, Produto alterado, etc. |
| `unidade` | UN, PC, KG, etc. |
| `quantidade_prevista` | Quantidade prevista do entregável |
| `observacao` | Notas |

### 04_Composicao_BOM

Estrutura preliminar tipo BOM — corresponde à seção **5.2** da ficha rápida. Permite múltiplos produtos, níveis hierárquicos, **item pai** e serviços com horas.

| Coluna | Descrição |
|--------|-----------|
| `produto_entregavel` | SKU ou nome do produto/entregável raiz (ex.: `610.51AA`) |
| `nivel` | `0` = produto raiz, `1` = componente direto, `2+` = MP/serviço/subcomponente |
| `item_pai` | Código ou descrição do item pai (`—` no produto raiz) |
| `tipo` | Produto, Componente, MP, Serviço, Embalagem, Molde/Ferramenta, Outro |
| `codigo` | Código do item |
| `descricao` | Descrição livre |
| `um` | UN, PC, KG, H, etc. |
| `quantidade_por_unidade` | Consumo técnico por unidade do pai (ex.: `0,002900` KG) |
| `horas_quantidade_servico` | Horas ou quantidade do serviço (ex.: `20` para usinagem) |
| `custo_estimado` | Opcional na ficha rápida |
| `observacao` | Notas |

#### Produto/Entregável vs Item pai

- **`produto_entregavel`:** identifica a qual produto raiz do projeto a linha pertence (ex.: `610.51AA`, `Torneira Iris`).
- **`item_pai`:** identifica o item imediatamente acima na hierarquia (ex.: MP `115.01--` com pai `306.02AA` Porca Grossa).

#### Níveis da BOM

- **Nível 0:** produto/entregável raiz.
- **Nível 1:** componentes diretos do produto.
- **Nível 2+:** MPs, serviços ou subcomponentes abaixo do componente pai.

#### Componente com MPs

Exemplo (produto `610.51AA`):

| produto_entregavel | nivel | item_pai | tipo | codigo | descricao | um | quantidade_por_unidade |
|--------------------|------:|----------|------|--------|-----------|-----|------------------------|
| 610.51AA | 0 | — | Produto | 610.51AA | Torneira Longa Branca | UN | 1 |
| 610.51AA | 1 | 610.51AA | Componente | 306.02AA | Porca Grossa Branca | PC | 1 |
| 610.51AA | 2 | 306.02AA | MP | 115.01-- | PP Polipropileno H 503 | KG | 0,002900 |
| 610.51AA | 2 | 306.02AA | MP | 121.16-- | MasterBatch Branco | KG | 0,000087 |

#### Múltiplos produtos

Repita o bloco acaixo para cada produto/entregável, mantendo `produto_entregavel` consistente em todas as linhas do grupo.

#### Serviços e horas

Serviços entram nesta aba com `tipo` = **Serviço**:

- Preencher `horas_quantidade_servico` (ex.: `20`) e `um` = **H** para usinagem/erosão.
- Exemplo: CNC 15 h → `horas_quantidade_servico` = 15, `um` = H, `item_pai` = componente relacionado.
- **Não é necessário** preencher valor hora; o sistema calcula depois.
- Na ficha rápida, não há seção separada Processos/HH.

#### Regra de custo

O custo estimado e valor hora são opcionais na ficha rápida/offline. O IndusCost calculará valor hora e custos quando a estrutura for importada ou montada no projeto.

### 05_Processos_HH

| Coluna | Descrição |
|--------|-----------|
| `processo` | Nome do processo |
| `interno_externo` | Interno ou Externo |
| `setor_maquina` | Setor ou máquina |
| `tempo_hh` | Tempo em HH |
| `valor_hora` | Valor hora |
| `custo_estimado` | Custo total estimado |
| `observacao` | Notas |

### 06_Moldes_Ferramentas

| Coluna | Descrição |
|--------|-----------|
| `tipo` | Molde, postiço, dispositivo, etc. |
| `descricao` | Descrição |
| `cavidades` | Número de cavidades |
| `material` | Material previsto |
| `fornecedor` | Fornecedor/ferramenteiro |
| `custo_estimado` | Custo total |
| `amortizar_sim_nao` | S ou N |
| `quantidade_amortizacao` | Peças para amortização |
| `observacao` | Notas |

### 07_Custos_Extras

| Coluna | Descrição |
|--------|-----------|
| `categoria` | Protótipo, Teste, Frete, etc. |
| `descricao` | Descrição |
| `valor_estimado` | Valor |
| `amortizar_sim_nao` | S ou N |
| `observacao` | Notas |

### 08_Pendencias

| Coluna | Descrição |
|--------|-----------|
| `pendencia` | Descrição da pendência |
| `responsavel` | Responsável |
| `prioridade` | Prioridade |
| `prazo` | Prazo |
| `status` | Aberta, resolvida, etc. |
| `observacao` | Notas |

## Importação futura (planejada)

1. Upload da planilha preenchida no módulo Projetos.
2. Validação de abas e colunas contra `PROJECT_INTAKE_SPREADSHEET_SCHEMA` em `src/lib/projectsIntakeSpreadsheet.ts`.
3. Mapeamento para entidades existentes: `Project`, `ProjectSimulatedProduct`, `ProjectSimulatedItem`, `ProjectStructureLine`, `ProjectMold`, etc.
4. Campos obrigatórios mínimos: `nome_projeto`, `cliente`, `tipo_projeto`, `responsavel_comercial`.
5. Valores numéricos: aceitar formato BR (vírgula) e normalizar para número.
6. Checkboxes (`marcar_x`, `amortizar_sim_nao`): aceitar `X`, `x`, `S`, `s`, `1`.

## Validações esperadas

- Rejeitar arquivo sem as 8 abas.
- Rejeitar colunas renomeadas ou ausentes.
- Ignorar linhas totalmente vazias em abas de lista.
- Não criar produto oficial automaticamente na importação.
- Não alterar cálculo de custo existente sem revisão do usuário.

## Relação com a Ficha Rápida

A **Ficha Rápida de Estimativa** (`/projects/:id/intake-form`) é a experiência principal para impressão em reunião. A planilha complementa o preenchimento estruturado para importação posterior.

A **Ficha Completa** (`/projects/:id/intake-form/full`) permanece como dossiê detalhado para revisão formal.

## Código de referência

- Schema e geração: `src/lib/projectsIntakeSpreadsheet.ts`
- Ficha rápida: `src/lib/projectsIntakeQuickForm.ts`
- Ficha completa: `src/lib/projectsIntakeForm.ts`
- Testes: `src/lib/projectsIntakeSpreadsheet.test.ts`, `src/lib/projectsIntakeForm.test.ts`
