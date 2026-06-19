# Planilha modelo — Ficha de Abertura de Projeto

Versão do schema: **1.0**  
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
| `03_Itens` | Produto, componentes, MP, serviços |
| `04_Composicao_BOM` | Composição preliminar / BOM |
| `05_Processos_HH` | Processos e horas-homem |
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

| Coluna | Descrição |
|--------|-----------|
| `tipo_item` | Produto, Componente, Matéria-prima, Serviço, Embalagem, Outro |
| `codigo_existente` | Código no sistema, se houver |
| `descricao` | Descrição do item |
| `produto_base` | Produto oficial base para copiar |
| `unidade` | UN, KG, etc. |
| `quantidade` | Quantidade |
| `custo_estimado_unitario` | Custo unitário estimado |
| `origem` | Comprado, fabricado, terceiro |
| `observacao` | Notas |

### 04_Composicao_BOM

| Coluna | Descrição |
|--------|-----------|
| `nivel` | Nível na estrutura (1, 2, …) |
| `tipo` | MP, Componente, Serviço, etc. |
| `codigo` | Código |
| `descricao` | Descrição |
| `quantidade` | Quantidade por unidade do produto |
| `unidade` | Unidade |
| `perda_percentual` | Perda % |
| `custo_unitario_estimado` | Custo unitário |
| `origem` | Origem do item |
| `observacao` | Notas |

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
