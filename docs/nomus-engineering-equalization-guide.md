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

## 9. Igualar bases

O botão **Igualar bases** vai além da Carga Mestre. Enquanto a Carga Mestre apenas
**cria** itens faltantes, o Igualar bases **mantém os cadastros mestre Nomus
alinhados ao longo do tempo**:

- Cria itens novos que apareceram no Nomus (mesmas regras seguras da Carga Mestre).
- **Atualiza** Products e Materials **controlados pelo Nomus** quando o nome ou
  a descrição divergiu do stage Nomus.
- **Inativa** (status = `INACTIVE`) itens que estavam marcados como Nomus mas
  sumiram do stage Nomus. **Nunca deleta fisicamente.**
- **Preserva** todos os itens locais/manuais do IndusCost: nada que não esteja
  marcado como Nomus é alterado.
- Registra **histórico completo** de cada alteração em `EngineeringChangeLog`.

### Diferença entre os três fluxos

| Fluxo | O que faz | O que NÃO faz |
|---|---|---|
| **Carga Mestre Nomus** | Cria Products/Materials que ainda não existem. | Não atualiza, não inativa, não cria BOM. |
| **Igualar bases** | Cria + atualiza + inativa itens **controlados pelo Nomus**. Registra histórico. | Não cria BOM, não mexe em custos, preços, propostas, pedidos, roteiro, costingMode. |
| **Aplicar BOM** (fase futura) | Aplica a estrutura BOM produto a produto, com pré-confirmação. | Não roda em lote sem revisão. |

### Por que dados locais são preservados

A regra de ouro: **Nomus é fonte de engenharia; IndusCost é fonte de processo
local, custo, roteiro, preço e decisão comercial.** Itens criados manualmente
no IndusCost (sem `isNomusControlled=true` e sem `sourceSystem="NOMUS"`) **nunca**
são tocados pelo Igualar bases.

### Por que itens 800.xx são preservados

Códigos `800.xx` são montagem local do IndusCost — eles não existem no Nomus
oficial. O Igualar bases **nunca** importa, atualiza ou inativa esses códigos
automaticamente. Eles aparecem no preview marcados como
`BLOCKED_LOCAL_PROCESS_CODE`.

### Como ler o preview

1. Na Visão Geral da Manutenção Nomus, painel **Carga Mestre Nomus**, clique em
   **Preview igualar bases**.
2. O painel mostra contagens:
   - **Criar Produtos / Materiais** — novos cadastros seguros.
   - **Atualizar Produtos / Materiais (Nomus)** — campos divergentes em itens
     já controlados pelo Nomus.
   - **Inativar Produtos / Materiais** — itens Nomus que sumiram do stage.
   - **Preservar locais** — não serão tocados.
   - **Ambíguos / Bloqueados** — exigem revisão manual.
   - **Já alinhados (Nomus)** — sem divergência, nada a fazer.
3. Apenas as linhas com ação são aplicadas.

### Como executar com confirmação

- **UI**: clique **Igualar bases**, digite exatamente
  `IGUALAR BASES NOMUS` no modal e confirme.
- **CLI**:
  ```bash
  npm run sync:nomus:master-data-equalize-preview
  npm run sync:nomus:master-data-equalize-apply   # dry-run (sem --confirm)
  npm run sync:nomus:master-data-equalize-apply -- --confirm="IGUALAR BASES NOMUS"
  ```
- O apply retorna `APPLIED`, `NO_CHANGES`, `BLOCKED` ou `FAILED` com mensagem
  clara e um `runId` para rastrear.

### O que significa cada outcome

- **Criado** — Product/Material novo registrado.
- **Atualizado** — campos `name`/`description`/`sourceSystem`/`isNomusControlled`
  ajustados em item controlado pelo Nomus.
- **Inativado** — item controlado pelo Nomus marcado como `INACTIVE` (nunca
  apagado).
- **Preservado** — item local do IndusCost — nada feito.
- **Bloqueado** — descrição vazia, código 800.xx, ou outro impedimento.
- **Ignorado** — payload incompatível ou nada para atualizar (idempotência).

### Como consultar histórico no cadastro do produto

Abra um produto na tela de **Produtos** e selecione a aba **Histórico**.
A timeline mostra:

- Data e hora de cada alteração.
- Origem: **Nomus**, **usuário** ou **sistema**.
- Ação: Criado / Importado / Igualado / Atualizado / Inativado / Bloqueado /
  Ignorado.
- Resumo humano da alteração.
- Detalhes expansíveis: campo, valor anterior, valor novo, `runId`, `planHash`.

Se ainda não houver registros, o painel mostra:
"Nenhum histórico registrado para este produto ainda."

> **Nota técnica**: o histórico usa a tabela `EngineeringChangeLog` já existente.
> Itens criados anteriormente pela Carga Mestre Nomus que ainda não tinham
> entrada de auditoria recebem um registro retroativo `IMPORTED` na primeira vez
> que forem tocados pelo Igualar bases.

## 10. Aplicar BOM Nomus por produto

Depois que o cadastro mestre estiver completo (Carga Mestre + Igualar bases),
a Engenharia pode aplicar a **BOM efetiva Nomus** no IndusCost **produto a
produto**, com pré-confirmação textual e histórico completo.

### Diferença entre os três fluxos

| Fluxo | O que faz | Confirmação |
|---|---|---|
| **Carga Mestre Nomus** | Cria Products/Materials seguros que ainda não existem. | `IMPORTAR CADASTRO MESTRE NOMUS` |
| **Igualar bases** | Cria + atualiza + inativa cadastro mestre controlado pelo Nomus. Histórico. | `IGUALAR BASES NOMUS` |
| **Aplicar BOM Nomus (este)** | Aplica a estrutura `ProductBOM` para **um** produto, com preview + planHash + gates. | `APLICAR BOM NOMUS <PARENTCODE>` |

### Quando aplicar

- Cadastro mestre já está em paz (sem `BLOCKED_MISSING_NOMUS_COMPONENT`).
- O Plano de Ação do produto está em `READY_FOR_CONTROLLED_APPLY` ou
  `READY_FOR_MANUAL_REVIEW`.
- O Impacto de Custo bate com o Plano de Aplicação (`hasStructuralChanges` e
  delta coerentes).

### Quando NÃO aplicar

- Há opcionais pendentes → resolver Opcionais primeiro.
- Há material faltante / produto filho faltante → resolver via Carga Mestre.
- Há revisão de linha local pendente → decidir manualmente antes.
- Produto está como `FINISHING_SERVICE` e o preview marca como ambíguo —
  rever no produto antes (o preview já bloqueia esses casos).

### Como interpretar bloqueios

Cada `blockingDetail` traz `code`, `componentCode`, `reason` e `suggestedFix`.
A UI mostra esses itens em vermelho no painel de apply, com botão para
abrir a aba técnica correspondente (Opcionais, Diagnóstico, etc.).

### Como funcionam os opcionais

Componentes Nomus marcados como **opcional** ou **alternativo**:

- Nunca entram automaticamente na BOM.
- Aparecem no preview como `SKIP_UNRESOLVED` ou `BLOCKED` quando influenciam o plano.
- Só passam a integrar a BOM após o operador resolver pela aba **Opcionais de
  Precificação** com decisão explícita.

### Como linhas locais 800.xx são preservadas

Linhas com `componentCode.startsWith("800.")` representam **montagem local**.
O preview gera ações `KEEP_PRODUCT_BOM_LINE` (preservar) — nunca `REMOVE`. O
apply respeita: linhas locais ficam intactas e aparecem no histórico como
*"linha local preservada"*.

### Onde ver histórico

- No cadastro do produto, aba **Histórico** (`GET /api/products/:id/change-history`).
- Cada apply de BOM gera:
  - 1 `NomusBomApplyRun` técnico (linhas before/after por componente).
  - 1 `EngineeringSyncRun` (`mode=ONE_PRODUCT`, `summaryJson.origin="BOM_APPLY_AFTER_MASTER_DATA"`).
  - N `EngineeringChangeLog` com `entityType="PRODUCT_BOM"` e `changeOrigin="NOMUS_ENGINEERING_APPLY"` (1 por ação aplicada).
- A aba Histórico exibe esses logs com linguagem humana: linha adicionada,
  linha removida, quantidade alterada, linha local preservada etc.

### Como reverter

Não há reverter automático nesta fase. Caminhos manuais seguros:

1. **Backup**: rodar `pg_dump` antes do apply real (recomendado em produção).
2. **`NomusBomApplyRun.beforeBomJson`**: contém a BOM antes do apply, em JSON.
   Pode ser usado para reconstruir manualmente via SQL/admin a estrutura
   anterior se necessário.
3. **`EngineeringChangeLog`** da aba Histórico documenta cada ação para
   auditoria.

### Como rodar (UI)

1. Abrir o produto na **Manutenção Nomus**.
2. Painel **Aplicar BOM Nomus**: revisar bloqueios, ações e impacto.
3. Digitar exatamente `APLICAR BOM NOMUS <CÓDIGO>` no campo de confirmação.
4. Clicar em **Aplicar**.
5. Após sucesso, a BOM efetiva, o Impacto e o Histórico recarregam.

### Como rodar (CLI)

```bash
# Preview read-only
npm run sync:nomus:bom-apply-preview -- --parentCode=304.02AA

# Apply de um produto (dry-run sem --confirm)
npm run sync:nomus:bom-apply-one -- --parentCode=304.02AA

# Apply real (exige frase exata)
npm run sync:nomus:bom-apply-one -- --parentCode=304.02AA --confirm="APLICAR BOM NOMUS 304.02AA"

# Smoke read-only dos pilotos
npm run test:nomus:bom-apply-after-master-data
```

## 11. Passo a passo do dia para a Engenharia

Sequência recomendada para usar a **Central de Engenharia Nomus** sem se perder.

### a) Toda manhã

1. Abrir **Produtos → Manutenção Nomus → Visão Geral** (sem produto selecionado).
2. Clicar em **Atualizar painel da engenharia** no card de resumo (topo da tela).
3. Olhar os 8 cartões agregados:
   - **Produtos Nomus (stage)** — total no Nomus oficial.
   - **Cadastro mestre faltante** — se > 0, abrir **Carga Mestre Nomus** e diagnosticar.
   - **Bases com divergência** — se > 0, rodar **Preview igualar bases**.
   - **Prontos para aplicar BOM** — fila do dia.
   - **Precisam revisão** — exigem decisão humana.
   - **Bloqueados** — pendências (material/filho/opcional).
   - **Sem ação necessária** — produtos já alinhados.
   - **Itens com histórico Nomus** — auditoria.
4. Conferir os 3 cartões inferiores: última **Igualar bases**, última **Aplicar BOM Nomus**, último **Backfill de histórico**.

### b) Tratando um produto

1. Na **Central de Atualização Nomus** (abaixo do painel de resumo), filtrar
   "Prontos" ou "Precisa revisão".
2. Clicar em **Abrir produto** — abre direto na aba técnica recomendada.
3. Na aba Visão Geral do produto aparece o **Checklist de liberação para custeio**
   no topo, com 8 itens em verde/amarelo/vermelho.
4. Seguir os atalhos do checklist conforme o status:
   - Cadastro faltante → Carga Mestre.
   - Mestre desalinhado → Igualar bases.
   - Materiais faltantes → Carga Mestre.
   - Opcionais pendentes → Opcionais de Precificação.
   - BOM efetiva bloqueada → Diagnóstico técnico.
   - Impacto a revisar → aba Impacto de Custo.
   - BOM pronta → aba Plano de aplicação → **Aplicar BOM Nomus**.
5. Conferir a aba **Histórico** para ver runs e entradas.

### c) Significado de cada status (operador)

| Status visível | O que significa | Ação |
|---|---|---|
| **OK** | Etapa concluída — pode seguir. | Nenhuma. |
| **Atenção** | Há decisão a tomar, sem bloqueio. | Revisar o item indicado. |
| **Bloqueado** | Não dá para seguir sem resolver. | Resolver a causa exata. |
| **Pendente** | Ainda não calculado ou registrado. | Rodar a etapa correspondente. |
| **Não aplicável** | Etapa não vale para o produto. | Ignorar. |

### d) Como saber que posso liberar para custeio

Quando **todos os itens** do Checklist de Liberação estiverem em **OK** ou
**Não aplicável**:

- Não há cadastro mestre faltante.
- Cadastro do produto é Nomus controlado.
- Materiais/componentes existem.
- Opcionais estão tratados.
- BOM efetiva sem bloqueio.
- Impacto de custo revisado.
- BOM aplicada (ou marcada como sem ação).
- Histórico aparece na aba.

### e) Se algo der erro

- **"Falha de rede"** ao aplicar — verificar o servidor (pm2 status / systemctl).
- **"Plano desatualizado"** — clicar em **Atualizar preview** antes de aplicar
  novamente.
- **"Confirmação inválida"** — copiar exatamente a frase mostrada no preview
  (`APLICAR BOM NOMUS <CÓDIGO>` ou `IGUALAR BASES NOMUS` etc.).
- **"BOM bloqueada"** — abrir Diagnóstico técnico para ver causa.

### f) Antes de liberar para custeio

Recomendação operacional:

1. Conferir Checklist de Liberação inteiro em verde para o(s) produto(s).
2. Conferir aba **Histórico** do produto com últimos runs.
3. Sinalizar para a equipe de Custos/Pricing.

## 12. Scripts úteis (para o time técnico)

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
- `npm run sync:nomus:master-data-equalize-preview` — preview read-only do
  Igualar bases.
- `npm run sync:nomus:master-data-equalize-apply -- --confirm="IGUALAR BASES NOMUS"`
  — apply controlado do Igualar bases (com histórico).
- `npm run test:nomus:master-data-equalize` — smoke read-only do Igualar bases
  (valida preview, bloqueios do apply sem confirmação correta, snapshot
  `EngineeringSyncRun`/`EngineeringChangeLog` antes/depois e ausência de FK órfã).
- `npm run sync:nomus:master-data-history-backfill` — dry-run idempotente que
  lista Products/Materials criados pela Carga Mestre Nomus sem entrada de
  histórico `IMPORTED`. Para gravar o backfill (idempotente):
  `npm run sync:nomus:master-data-history-backfill -- --confirm="BACKFILL HISTORICO NOMUS"`.
  O backfill cria seu próprio `EngineeringSyncRun` (`summaryJson.origin =
  "MASTER_DATA_HISTORY_BACKFILL"`) e nunca altera Product/Material.

### Diagnóstico do servidor

Para confirmar antes do apply real que a FK `EngineeringChangeLog.runId →
EngineeringSyncRun.id` está saudável, rodar via psql:

```sql
SELECT COUNT(*) AS logs_com_runid_orfao
FROM "EngineeringChangeLog" l
LEFT JOIN "EngineeringSyncRun" r ON r.id = l."runId"
WHERE l."runId" IS NOT NULL
  AND r.id IS NULL;
```

O resultado deve ser `0`. Os smoke tests
`npm run test:nomus:master-data-equalize` e
`npm run test:nomus:bom-apply-after-master-data` já validam exatamente isso,
mas o SQL acima é útil para inspeção rápida.

### Scripts do Aplicar BOM por produto

- `npm run sync:nomus:bom-apply-preview -- --parentCode=<código>` — preview
  read-only do apply de BOM. Imprime ações, bloqueios, planHash e impacto.
- `npm run sync:nomus:bom-apply-one -- --parentCode=<código>` — dry-run; sem
  `--confirm` o script só lista o que seria aplicado.
- `npm run sync:nomus:bom-apply-one -- --parentCode=<código> --confirm="APLICAR BOM NOMUS <CÓDIGO>"`
  — apply real do produto único.
-   `npm run test:nomus:bom-apply-after-master-data` — smoke read-only que roda
  preview dos pilotos, garante que confirmação errada **não** muta dado e
  confere FK órfã `EngineeringChangeLog.runId`.
- `npm run test:nomus:engineering-release-ready` — smoke consolidado de release:
  valida preview de Igualar bases + preview de Aplicar BOM (piloto) +
  histórico de um produto + lista de runs recentes + FK órfã + snapshot
  antes/depois.

Esses scripts devem ser rodados no servidor (precisam de `DATABASE_URL`).
