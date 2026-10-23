# Pedidos de Compra Nomus — relatório de implementação (sincronização independente e reconciliação)

Registro do trabalho executado. Arquitetura e operação:
[`purchase-orders-independent-sync-and-reconciliation.md`](purchase-orders-independent-sync-and-reconciliation.md).

| | |
|---|---|
| Classificação | **IMPLEMENTADO E PRONTO PARA HOMOLOGAÇÃO** |
| Branch | `fix/nomus-purchase-orders-sync-lifecycle` (worktree `C:/Dev/induscost-nomus-po-sync`), commit local, sem push |
| Commit-base | `9d46d87a` (`origin/main` em 23/10/2026) |
| Caso real | PC00637 · ID Nomus 638 · emitido 22/10/2026 · excluído no Nomus em 22/10, visível como Aprovado em 23/10 |
| Restrições cumpridas | sem produção, sem AWS, nenhuma migration em banco real, registro 638 intocado, Nomus não alterado, sem push/merge |

## 1. Causa raiz

1. O sync só fazia upsert do que a API devolvia; pedido excluído nunca era tocado (fase "Aprovado" congelada).
2. Compras só rodava encadeado ao runner de CR e só se CR terminasse com sucesso.
3. O runner adquiria o lock global com `flock -n`; lock ocupado saía com exit 0 sem registro.

## 2. O que foi entregue

| Parte | Entrega |
|---|---|
| A — agenda independente | Serviço canônico `runNomusPurchaseOrdersSync` (lock de entidade próprio, espera pelo lock global sem adquiri-lo, run em `NomusSourceSyncRun`, estados RUNNING/SUCCESS/FAILED/INCONCLUSIVE/SKIPPED, atraso do disparo, códigos de saída 0/3/1); fonte única `NOMUS_PO_SCHEDULE_SOURCE` (chain/independent) com o disparo inativo registrado como SKIPPED; cron versionado (minuto 37 + 03:37 BRT) com instalador render/verify/install/uninstall e homologação bloqueada por padrão; cadeia de CR passa `CHAIN_AFTER_AR`; shell fino sem flock. |
| B — ciclo de vida | Migration aditiva `20261101120000` (6 colunas, tabela de eventos, enum `PURCHASE_ORDER`/`SKIPPED` com `IF NOT EXISTS`, inicialização conservadora); adapter puro sobre o motor canônico com completude, idempotência por run, intervalo mínimo, guarda de volume, consulta por ID com 404 só confiável sob flag, reativação e eventos de transição; nada apagado, ausência não cancela; pedido confirmado ausente não recebe vínculo novo de CP. |
| C — UI e painel | Lista com filtro de presença (padrão exclui confirmados; KPIs/total/paginação no mesmo `where`), selo ao lado da fase, banner e histórico no detalhe; painel em Configurações com status/STALE, flags, presença, métricas 24 h, execuções, ausentes, incremental manual, prévia e autorização (execute + Super Admin + frase); observabilidade SYNC-09 inclui Compras e ignora pulos/prévias; logs sem URL, credencial ou valores. |
| D — auditoria 638 | `npm run nomus:purchase-orders:audit-presence -- --external-id=638 [--nomus-lookup] [--nomus-scan] [--show-amounts]`, somente leitura. |
| E — testes | 48 unitários/contrato + 19 de integração em PostgreSQL 17 (Nomus falso). |
| F — flags e rollout | Todas desligadas/conservadoras por padrão; implantação em etapas e rollback sem exclusão física documentados. |

## 3. Decisões e desvios

- **Universo da reconciliação diária sem filtro de datas** (padrão `NOMUS_PO_RECONCILE_SCOPE=full`): os
  parâmetros `dataInicio`/`dataFim` não são comprovados e podem filtrar outro campo de data, omitindo pedidos
  emitidos na janela — o que geraria ausências falsas. A janela de 12 meses continua disponível
  (`NOMUS_PO_RECONCILE_SCOPE=window`), mas só prova o universo com `NOMUS_PO_DATE_FILTER_VALIDATED=1`.
- **Incremental horário** é `SUCCESS` com `payloadComplete=false` por desenho (a janela não prova universo).
- **Autorizar ausências** = permissão `execute` de `admin.settings.nomus_sync` + papel Super Admin + frase de
  confirmação. O contrato de permissões só tem `view`/`execute` para esse recurso; criar uma chave nova exigiria
  alterar o catálogo/seed compartilhado com outros trabalhos de permissionamento. Fica registrado como evolução.
- **Minuto 37** atendido conforme pedido; é compartilhado com Propostas (ambos só sondam o lock global). Se a taxa
  de 429 subir, trocar o minuto no template.
- **Vínculos com Contas a Pagar**: a propriedade financeira não é recalculada por ausência (evita transferir títulos
  por inferência); só a criação de vínculo novo em pedido confirmado ausente é bloqueada (409).
- **Teste existente alterado** (`nomusPurchaseOrder.test.ts`, "PO runner usa lock global e lock próprio"): codificava o
  `flock -n` do lock global, que era parte do defeito. Substituído por asserções do novo contrato (shell sem flock,
  lock canônico próprio, serviço sonda e espera o global). `nomusCanonicalSyncContract.test.ts` passou a incluir o
  shell de Compras na verificação de "shell sem regra de negócio" (cobertura ampliada, nada removido).
- **Efeito colateral corrigido**: o frescor da Tesouraria (`treasuryDailyClosingPreviewFactsRepository`) usava o
  último run SUCCESS de qualquer entidade; restrito a Pedidos de Venda/CR/CP para que os runs horários de Compras
  não mascarem um CR/CP parado (comportamento anterior preservado).

## 4. Verificação

| Gate | Resultado |
|---|---|
| Testes novos — unitários/contrato | 48/48 (`npm run test:nomus:purchase-orders:sync`) |
| Integração PostgreSQL 17 (Nomus falso) | 19/19 (`COMMISSION_PG17_BIN=… npm run test:nomus:purchase-orders:pg`) |
| Regressão por identidade (grafo de importação + guards estáticos) | 528 arquivos; base 6.874 testes/42 falhas × cabeça 6.922/42 — **0 regressões**, mesmas 42 falhas pré-existentes |
| `tsc` por identidade | base 1.368 × cabeça 1.368 — **0 novos**, nenhum nos arquivos tocados |
| `prisma validate` | ok |
| Ensaio da migration (PG17 descartável) | 11/11: aplica sobre o schema da base, preserva pedidos/itens/avaliação/vínculo, 638 `PRESENT`, drift zero, FK Restrict, rollback técnico sem apagar pedidos, reaplicação após rollback |
| `vite build` + `check:browser-bundle` + `check:frontend-server-imports` + `check:server-imports` | ok (base também ok) |
| Navegador (harness com componentes reais e API simulada) | painel (STALE calculado pelo motor real, autorização com frase, botão oculto para não Super Admin), lista (selos, filtro → parâmetro `presence`, cancelado oficial sem selo), detalhe (banner e histórico); sem erros de console |

Matriz de testes (resumo): completude (1–8), ciclo de vida (9–15), proteções (16–26), rótulos (27), fonte única e
flags (28–32), resiliência/sanitização/consulta por ID (33–35), saúde/observabilidade (36–38), carteira (39–40),
permissões e rotas 401/403 (41–43), CLI/shell/cron/auditoria/migration (44–48); integração PG17: PC00637 de ponta a
ponta (incremental não remove → só-prévia → candidata → intervalo → falha 503 → limite de páginas → confirmada →
carteira/KPIs → bloqueio de vínculo novo → fonte inativa → lock global → concorrência → prévia → status → reativação
→ guarda de volume → consulta por ID → nenhuma exclusão física).

## 5. Pendências de homologação (dependem do servidor; nada a codificar)

1. `prisma migrate deploy` em homologação **antes** do código.
2. Auditoria somente leitura do 638 com `--nomus-lookup --nomus-scan`: registrar a resposta real do
   `GET pedidoscompra/638` (decide `NOMUS_PO_DIRECTED_LOOKUP_TRUST_404`) e o tamanho do universo.
3. Prévia de reconciliação pelo painel: conferir que só pedidos realmente excluídos aparecem.
4. Instalar o cron com `--allow-homolog`, observar runs `SKIPPED` com `chain`, depois `independent`.
5. Ligar a reconciliação, autorizar candidatas, e só após a 2ª varredura em outro dia ligar a confirmação.
6. Validar a semântica de `dataInicio`/`dataFim` antes de qualquer uso de `NOMUS_PO_RECONCILE_SCOPE=window`.

Ordem obrigatória de implantação: migration → código → (opcional) cron → flags, uma etapa por vez.
