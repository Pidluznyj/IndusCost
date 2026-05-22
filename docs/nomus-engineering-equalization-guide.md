# Guia da Engenharia — Central de Atualização Nomus

Release **Engenharia v0.1 — Revisão e Equalização Assistida**.

Este guia ensina a operar a Central de Atualização Nomus sem precisar entender
termos técnicos. A tela é uma fila de trabalho que ajuda a Engenharia a revisar
as alterações de engenharia vindas do Nomus, produto a produto, com segurança.

> **Importante:** a Central é **somente diagnóstico**. Ela **não** altera
> ProductBOM, custo, preço, propostas ou pedidos. Toda alteração continua
> sendo feita produto a produto, com confirmação textual nas abas técnicas.

---

## 1. O que é a Central de Atualização Nomus

- É uma tela única que lista os produtos cuja engenharia (BOM) vem do Nomus.
- Para cada produto, mostra:
  - status operacional (em linguagem humana);
  - o que mudou;
  - o risco;
  - a próxima ação recomendada;
  - botões para abrir o produto na aba técnica correta.
- Tem cards de resumo, filtros, busca, paginação e botão **Carregar mais**.
- O endpoint é `GET /api/nomus/engineering-operations-cockpit` (read-only).

## 2. O que a Central NÃO faz

- **Não aplica BOM em lote.**
- **Não tem botão "Aplicar todos" nem "Aplicar selecionados".**
- **Não altera ProductBOM, Product, Material, custo, preço, proposta ou pedido.**
- **Não sincroniza nada automaticamente.**
- **Não resolve opcionais nem ambiguidades sozinha.**
- **Não remove 800.01 — Montagem nem qualquer item local.**

## 3. Significado dos status

| Status na tela | Quando aparece | Próxima ação |
|---|---|---|
| **Sem alteração** | Nomus e IndusCost já estão alinhados. | Nenhuma ação necessária. |
| **Pronto para revisar** | Diferenças simples e seguras para revisar (sem bloqueio). | Revisar o plano de aplicação antes de qualquer alteração. |
| **Precisa análise** | Diferenças que exigem decisão humana. | Abrir o produto, revisar BOM efetiva e impacto. |
| **Bloqueado** | Há pendências que impedem atualização segura. | Resolver pendências antes de tudo. |
| **Produto novo** | Existe no Nomus, ainda não existe no IndusCost. | Importar pelo fluxo controlado. |
| **Montagem local** | Produto tem linha 800.xx, que é montagem **local** do IndusCost. | Manter montagem local. Só revisar alterações Nomus. |
| **Tem item local** | Produto tem itens locais (não vindos do Nomus). | Conferir e decidir se mantém. |
| **Escolha opcional pendente** | Há opcionais Nomus a serem escolhidos antes do custo. | Ir para Opcionais de Precificação. |
| **Material faltante** | Componente Nomus não está cadastrado como Material no IndusCost. | Cadastrar/mapear o material. |
| **Produto filho faltante** | Componente é produto e ainda não foi importado. | Importar o componente dependente antes. |
| **Código ambíguo** | Mesmo código existe como Produto e como Material. | Decidir manualmente se é Produto ou Material. |

## 4. Como operar (passo a passo)

1. **Abrir a tela**
   - Menu **Manutenção Nomus → Visão Geral**.
   - Sem produto selecionado, a Central aparece automaticamente.
2. **Gerar diagnóstico**
   - Clicar em **Gerar diagnóstico**. Pode levar alguns segundos em bases grandes.
3. **Ler os cards de resumo**
   - Cards numéricos mostram o tamanho de cada pilha (prontos, bloqueados etc.).
   - **Clicar em um card aplica o filtro** correspondente — clique de novo para limpar.
4. **Filtrar e buscar**
   - Use a busca por código/descrição.
   - Combine com o filtro de status.
   - **Limpar filtros** zera tudo de uma vez.
5. **Abrir o produto**
   - Clicar em **Abrir produto** leva você direto para a aba técnica correta
     (BOM efetiva, Impacto, Plano, Diagnóstico ou Importação).
6. **Revisar nas abas técnicas**
   - **BOM efetiva** — como ficaria a BOM aplicando o Nomus.
   - **Impacto de custo** — quanto mudaria o custo.
   - **Plano de aplicação** — quais linhas seriam criadas/atualizadas/removidas.
   - **Diagnóstico técnico** — visão crua para casos difíceis.
7. **Aplicar somente quando estiver seguro**
   - Toda aplicação continua sendo **produto a produto**, na aba técnica do produto.
   - Nunca há aplicação em lote pela Central.
8. **Usar o botão "Carregar mais"** quando há mais produtos no stage Nomus do que a página atual.

## 5. Regras críticas

- **Não remover 800.01 / 800.xx sem validação.** Esses itens são **montagem local**
  do IndusCost e devem ser preservados.
- **Opcionais exigem decisão.** A Central nunca escolhe opcional sozinha.
- **Ambiguidade Produto/Material exige análise.** Quando o mesmo código existe
  como Produto e Material, a decisão é manual.
- **Preço, proposta, pedido e tabela de preço não são atualizados** pela Central.
- **Material faltante / Produto filho faltante** devem ser resolvidos primeiro
  (cadastrar/importar) antes de tentar aplicar BOM.

## 6. Pilotos validados

### 611.48AA — produto com montagem local
- Possui linha local **800.01 — Montagem**.
- Quando não há alteração estrutural, **Impacto de Custo mostra delta zero**.
- O **Plano de Aplicação** mostra "Nenhuma alteração necessária" nesse caso.
- O POST de apply retorna `resultStatus = NO_CHANGES` quando não há mudanças.

### 317.02AA — acabamento / beneficiamento
- Configurável como **FINISHING_SERVICE** em `ProductCostingMode`.
- Nesse modo, o motor de custo **não soma processo próprio** do item pai
  (HH/HM próprio fica zerado), mas mantém o cálculo dos componentes filhos.
- O processo cadastrado **não é apagado** — fica preservado para histórico.
- A UI explica esse modo no painel de custo: "Processo próprio ignorado porque
  o item está configurado como Acabamento/beneficiamento."

### Como validar manualmente

1. **611.48AA**
   - Abrir produto pela Central → aba **Impacto de Custo**.
   - Esperado: `delta.totalCost = 0` quando o Plano diz "Nenhuma alteração necessária".
   - Conferir que `800.01` aparece como **item local preservado**, sem deltaCost.
2. **317.02AA**
   - Abrir produto na tela de Produtos.
   - Trocar o **Modo de custeio** para **Acabamento / beneficiamento**.
   - Salvar e reabrir — o modo deve persistir.
   - Conferir na aba de **Custo** que o processo próprio aparece como ignorado
     (com a mensagem do `ownProcessSkipReason`) e que os filhos seguem calculando.

## 7. Plano de ação do produto

A partir da release **Workflow-A**, ao expandir uma linha da Central, a Engenharia
vê automaticamente um painel **"Plano de ação deste produto"** que carrega sob
demanda e mostra de forma guiada o que precisa ser feito para aquele produto.

### O que aparece no painel

- **Status de prontidão (readiness)**: Pronto, Bloqueado, Precisa importar etc.
- **Resumo** em uma frase, em linguagem humana.
- **Próxima ação recomendada** com botão direto para a aba técnica certa.
- **Bloqueios** (quando existem) — material faltante, produto filho faltante etc.
- **Avisos**.
- **Montagem local preservada** com as linhas 800.xx identificadas, quando aplicável.
- **Modo de custeio** (FINISHING_SERVICE / BOM_ONLY) com explicação humana.
- **Etapas numeradas**: cada etapa do fluxo (Cadastro, Comparação, Opcional,
  Material, Filho, Montagem local, Impacto, Plano de aplicação) com status
  `Concluído / Pendente / Revisar / Bloqueado / Não necessário` e botão de
  atalho para a aba certa.
- **Impacto previsto** (delta total de custo) sem precisar abrir outra aba.

### Quando abrir cada aba

| Situação | Próxima ação |
|---|---|
| Plano diz "Nenhuma ação necessária" | Não abrir nada. O produto está alinhado. |
| BOM alterada, sem bloqueios | Abrir **Plano de aplicação** e aplicar **produto a produto**. |
| Pronto para revisão manual | Abrir **BOM efetiva** para entender o que mudou. |
| Há opcional pendente | Abrir **Opcionais** e escolher antes de aplicar. |
| Material faltante | Abrir **Diagnóstico técnico**, cadastrar/mapear o material. |
| Produto filho faltante | Abrir **Importação do produto** para o filho antes do pai. |
| Produto novo no Nomus | Abrir **Importação do produto** pelo fluxo controlado. |
| Código ambíguo / casos estranhos | Chamar a Engenharia (revisão humana). |

### O que NÃO fazer

- Não usar a Central para aplicar em lote — **a aplicação continua produto a
  produto** na aba "Plano de aplicação" do próprio produto.
- Não remover 800.01 / 800.xx — eles aparecem como **montagem local preservada**.
- Não escolher opcionais sem entender — abrir Opcionais e decidir caso a caso.
- Não trocar `costingMode` de produto sem confirmação técnica.

### Como o painel é seguro

- O painel é **read-only**: apenas chama `GET /api/nomus/engineering-equalization-action-plan`.
- Nenhuma escrita acontece quando o painel abre — nem em ProductBOM, nem em
  Product, nem em Material, nem em preço, proposta ou pedido.
- Cada aplicação efetiva continua sendo feita na aba técnica do produto,
  com pré-confirmação textual, e devolve mensagens claras
  (`APPLIED`, `NO_CHANGES`, `BLOCKED`, `FAILED`).

## 8. Carga Mestre Nomus

A Carga Mestre Nomus é o **passo anterior** à equalização de BOM. Antes de aplicar
estrutura, todos os componentes que aparecem nas BOMs do Nomus precisam existir
como **Product** ou **Material** no IndusCost. Sem isso, vários produtos ficam
bloqueados na Central com "Material faltante" ou "Produto filho faltante".

### Por que precisa existir

Sem cadastro mestre completo:

- a Central marca produtos como **Bloqueado** por "Material faltante";
- o Plano de Aplicação não consegue criar linhas de BOM;
- o Impacto de Custo não consegue calcular peças que não existem.

### Diferença entre cadastro mestre e BOM

- **Carga Mestre Nomus** cria **apenas o registro base** de Product/Material
  (sku/code, descrição, tipo, unidade padrão, categoria de importação).
- **NÃO cria ProductBOM.** A estrutura BOM continua sendo aplicada
  produto a produto, na aba técnica do produto, pelo fluxo controlado.

### O que será criado

- `Product` — quando o código aparece como `parentCode` no Nomus
  (`type=PRODUCT` quando só aparece como pai; `type=COMPONENT` quando também
  aparece como componente).
- `Material` — quando o código aparece **apenas** como componente, sem BOM
  própria. Unidade padrão `UN`, categoria `NOMUS_IMPORT` para reclassificação
  posterior, custos zerados.

### O que NÃO será criado

- ProductBOM.
- Preço, proposta, pedido, tabela de preço.
- Histórico de custo / curva de custo.
- Roteiro/processo do produto.
- `ProductCostingMode` permanece no default (`OWN_PROCESS`) — não é alterado.

### Quando um item vira Product

- Aparece como `parentCode` em alguma linha do `NomusBomComponentStage`.
- Tem descrição utilizável.
- Não é código 800.xx.
- Default `PRODUCT`; se também aparece como componente em outras BOMs, vira
  `COMPONENT`.

### Quando um item vira Material

- Aparece apenas como `componentCode` em BOMs Nomus.
- Sem BOM própria no stage.
- Descrição compatível com matéria-prima/insumo.
- Não é código 800.xx.

### Quando fica bloqueado

- `BLOCKED_LOCAL_PROCESS_CODE` — código 800.xx (montagem local do IndusCost).
- `BLOCKED_MISSING_DESCRIPTION` — descrição vazia.
- `BLOCKED_INVALID_CODE` — código inválido (vazio ou > 64 caracteres).
- `EXISTING_BOTH_AMBIGUOUS` — código existe simultaneamente em Product e Material.
- `AMBIGUOUS_REVIEW` — sinais contraditórios; revisão manual obrigatória.

### Como rodar (UI)

1. Manutenção Nomus → Visão Geral (sem produto selecionado).
2. Painel **"Carga Mestre Nomus"** no topo.
3. Clicar **Diagnosticar cadastro base**.
4. Conferir totais (faltantes, seguros como Produto, seguros como Material,
   bloqueados/ambíguos).
5. Filtrar e revisar (use "Precisa revisão" para ambíguos).
6. Clicar **Importar itens seguros** e digitar a frase exata
   `IMPORTAR CADASTRO MESTRE NOMUS` para confirmar.
7. Após apply, o resultado aparece no topo do painel
   (criados, ignorados, bloqueados, erros).

### Como rodar (CLI)

```bash
npm run sync:nomus:master-data-diagnostic
npm run sync:nomus:master-data-preview
npm run sync:nomus:master-data-apply-safe -- --confirm="IMPORTAR CADASTRO MESTRE NOMUS"
```

Sem `--confirm`, o `apply-safe` roda em **dry-run** (não escreve nada). Para
limitar a um subconjunto, passe `--codes=110.03--,210.05--`.

### Como reprocessar a Central depois

Após o apply, voltar à Central de Atualização Nomus e **Gerar diagnóstico** —
produtos que antes apareciam como "Material faltante" ou "Produto filho faltante"
devem deixar de aparecer com esse bloqueio. A aplicação real da BOM continua
sendo feita produto a produto na aba técnica do produto.

### Por que 800.xx não é importado automaticamente

Códigos `800.xx` representam **montagem local** do IndusCost — eles não vêm do
Nomus. A Central os preserva como exceção local. Tentar importar `800.xx` como
Material ou Product automaticamente quebraria a regra de montagem local. Por isso
esses códigos aparecem como `BLOCKED_LOCAL_PROCESS_CODE` no diagnóstico — se for
necessário cadastrar, é decisão manual.

## 9. Scripts úteis (para o time técnico)

- `npm run check:frontend-imports` — guardrail que impede Prisma/lib server-side
  no bundle React.
- `npm run test:nomus:engineering-cockpit-smoke` — smoke read-only da Central.
- `npm run test:nomus:engineering-release-check` — checagem combinada (Cockpit
  + 611.48AA + 317.02AA), totalmente read-only.
- `npm run test:nomus:engineering-action-plan` — smoke read-only do Plano de
  Ação de Equalização para os pilotos e para um produto da fila do Cockpit.
- `npm run sync:nomus:master-data-diagnostic` — diagnóstico read-only da
  Carga Mestre Nomus (lista códigos faltantes + classificação).
- `npm run sync:nomus:master-data-preview` — preview read-only do que seria
  criado pela importação segura.
- `npm run sync:nomus:master-data-apply-safe -- --confirm="IMPORTAR CADASTRO MESTRE NOMUS"`
  — importação segura de cadastro base (Product/Material).
- `npm run test:nomus:master-data-import` — smoke read-only da Carga Mestre
  Nomus (valida diagnóstico, preview e bloqueio do apply sem confirmação).

Esses scripts devem ser rodados no servidor (precisam de `DATABASE_URL`).
