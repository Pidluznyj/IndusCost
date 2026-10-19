# Ciclo de vida dos ciclos de avaliação

Branch `feat/performance-cycle-lifecycle`, criado sobre `fix/org-hierarchy-effective-manager`. Desenvolvido e testado só localmente, em banco descartável. Nada foi aplicado em homologação nem em produção.

## Modelo

Duas dimensões novas, independentes da situação operacional (rascunho → encerrado):

| Dimensão | Valores | Regra |
| --- | --- | --- |
| Tipo (`classification`) | `OFFICIAL`, `TEST` | Escolhido na criação, sem valor padrão na tela. Teste **nunca** compõe indicador oficial. Oficial → teste só se o ciclo não teve publicação oficial. Teste → oficial não existe. |
| Ativação (`activation`) | `ACTIVE`, `INACTIVE` | Reversível. Inativo fica congelado e sai da visão padrão. |

Ciclos que já existiam recebem `OFFICIAL` e `ACTIVE` pela migration. Nada muda na elegibilidade deles. Nenhum ciclo é reclassificado por nome.

### Predicado oficial único

`cycleGovernance(db, ciclo).officialEligible` (`src/lib/hrPerformance/performanceLifecycle.ts`) é verdadeiro só quando o ciclo é **oficial**, **ativo**, **homologado ou encerrado**, foi **aberto com publicação oficial** (não piloto) e tem **resultado homologado**. O motivo de cada exclusão aparece em `reasons`.

| Leitura | Regra |
| --- | --- |
| Evolução entre ciclos (Painel) | Só ciclos ativos e oficiais. `?includeNonOfficial=1` (RH com escopo total) traz teste e inativo, rotulados. |
| Histórico na ficha do colaborador | Mesma regra. Piloto aparece com o selo "Não oficial" e o motivo. |
| Minha equipe | Sem tarefas de ciclo inativo. |
| Acompanhamento de PDI | Sem PDI de ciclo inativo, salvo filtrando o próprio ciclo (auditoria). |
| CSV | Ciclo inativo: `409 CYCLE_INACTIVE`. Ciclo de teste: cada linha leva `classificacao_ciclo = TESTE - NAO OFICIAL`. |
| PDF | Ciclo inativo: não emite (`409`). Ciclo de teste: carimbo "Ciclo de teste — sem valor oficial". Não oficial por outro motivo: nota com o motivo. |
| Nine-Box, painel e calibração do ciclo | Continuam mostrando os dados do próprio ciclo, com os selos e o aviso no topo. Não somam nada entre ciclos. |

Nenhum outro módulo do IndusCost lê resultados de desempenho (conferido no código), então não há indicador fora do módulo a filtrar.

## Inativar

Só SUPER_ADMIN, com motivo (mínimo de 8 caracteres). O que acontece:

- revoga todos os convites e sessões do ciclo;
- grava responsável, data e motivo no ciclo e na auditoria (`CYCLE_INACTIVATED`).

**Trava central.** A partir daí, nenhuma gravação que crie ou altere registro desse ciclo passa: resposta, envio, calibração, homologação, convite, devolutiva, PDI, documento, edição. A trava fica em `planPerformanceWrite`, usada pelos dois armazenamentos (PostgreSQL e memória), então não depende de cada rota lembrar dela. Só passam os campos de ciclo de vida do próprio ciclo e a auditoria. O portal público responde com a mensagem neutra de convite inválido. Nada é apagado.

**Visão padrão.** A lista de ciclos esconde os inativos; a opção "Mostrar ciclos inativos" volta a exibi-los. A mesa do ciclo fica só para consulta, com aviso.

## Reativar

Só SUPER_ADMIN, com motivo. Confere se o modelo do ciclo ainda está publicado ou arquivado. Convites e sessões revogados **continuam revogados**; se o ciclo estava aberto, a tela avisa para reemitir. A elegibilidade oficial é recalculada pelo predicado: um ciclo de teste continua fora.

## Excluir ciclo de teste

Só SUPER_ADMIN. Exige:
- tipo **teste**;
- ciclo **já inativo**;
- nome do ciclo digitado e motivo;
- nenhuma publicação oficial;
- **nenhum documento emitido** (o registro de códigos dos PDFs é preservado).

Quando algum bloqueio existe, a tela mostra o motivo e a alternativa é manter o ciclo inativo. A tentativa bloqueada fica registrada (`CYCLE_DELETE_BLOCKED`).

A exclusão roda numa transação, nesta ordem:
1. confere a trava de revisão;
2. confere de novo, dentro da transação, que o ciclo é teste inativo e sem documento;
3. apaga, nessa sequência: acompanhamentos, PDIs, devolutivas, resultados, sessões, convites, respostas, tarefas, lembretes, participantes e o ciclo. O apagamento é por id, sem depender de cascata;
4. compara o que foi apagado com o plano: qualquer diferença cancela tudo;
5. verifica que não sobrou registro do ciclo;
6. grava `CYCLE_DELETED` com nome, motivo e contagens.

A auditoria do módulo não tem chave estrangeira, então todo o histórico do ciclo apagado continua consultável.

Ciclo oficial não é excluído, nem pelo SUPER_ADMIN. Isso exige um processo administrativo próprio, que não existe no sistema.

## Interface

- **Lista de ciclos:** selos "Teste" e "Inativo" no card; opção "Mostrar ciclos inativos".
- **Criação de ciclo:** campo obrigatório "Tipo do ciclo" (Oficial / Teste).
- **Mesa do ciclo:**
  - selos de tipo, ativação e "Entra / Fora dos indicadores oficiais";
  - aviso de teste ou de inativo;
  - botão **Ciclo de vida**, visível para quem gerencia o módulo. As ações (classificar como teste, inativar, reativar, excluir teste) só ficam habilitadas para o SUPER_ADMIN, e o servidor valida de novo;
  - histórico de ações com data e motivo;
  - exclusão com confirmação reforçada: digitar o nome e informar o motivo.

## Procedimento para o ciclo "Teste" da homologação

Nada foi feito nele. Depois do deploy deste branch:

1. **Conferir antes (somente leitura).** Com o SUPER_ADMIN, abra Desempenho e Cultura › Ciclos › "Teste" › **Ciclo de vida**. A tela mostra o tipo (será "Oficial", o padrão conservador), se entra nos indicadores e os motivos. Se ele foi aberto como piloto, aparece "Aberto como piloto, sem publicação oficial".
2. **Classificar como teste.** Clique em "Classificar como teste", informe o motivo e confirme. Se o sistema responder "teve resultados homologados com publicação oficial", o ciclo foi publicado oficialmente: pare e trate como processo administrativo.
3. **Inativar.** Clique em "Inativar", informe o motivo e confirme. A tela informa quantos convites e sessões foram revogados.
4. **Confirmar que saiu dos indicadores:**
   - os selos mostram "Teste · Inativo · Fora dos indicadores oficiais";
   - o Painel › evolução não mostra o ciclo;
   - a ficha de um participante não mostra o ciclo no histórico;
   - "Minha equipe" de um líder não mostra as tarefas;
   - o CSV e o PDF respondem que o ciclo está inativo.
5. **Excluir (opcional).** Só se a janela mostrar "Excluir teste" habilitado. Se houver documento emitido, a exclusão fica bloqueada de propósito; mantenha o ciclo inativo.

A mesma verificação pela API, com a sessão do SUPER_ADMIN:

```text
GET /api/hr/performance/cycles/<id>/lifecycle
GET /api/hr/performance/evolution
GET /api/hr/performance/evolution?includeNonOfficial=1
```

## Implantação

1. Migration `20261022120000_hr_performance_cycle_lifecycle`: só `ADD COLUMN` com default e um índice. Aplicar antes do código.
2. Código, junto com `fix/org-hierarchy-effective-manager`, da qual este branch depende.
3. Sem seed nem flag nova. O botão de ciclo de vida usa a permissão de gestão do módulo; as ações exigem papel SUPER_ADMIN.

**Rollback:** voltar o código. As colunas novas ficam sem uso: o código antigo não as lê, e os ciclos continuam como estavam.

## Testes

`src/lib/hrPerformance/performanceLifecycle.test.ts` (13) e o cenário de PostgreSQL real em `performancePrisma.integration.test.ts`:

| # | Requisito | Teste |
| --- | --- | --- |
| 1 | SUPER_ADMIN inativa ciclo de teste | inativação |
| 2 | Inativo consultável para auditoria | inativação; rotas (`workspace` 200, `includeNonOfficial`) |
| 3 | Fora das tarefas operacionais | `leaderQueue` sem tarefas |
| 4 | Convites e sessões param | QR e sessão aberta recusados depois de inativar |
| 5 | Fora da Nine-Box e das médias entre ciclos | evolução e histórico padrão vazios |
| 6 | Teste homologado nunca oficial | predicado oficial |
| 7 | Reativar não restaura sessão | reativação |
| 8 | Sem SUPER_ADMIN não inativa nem exclui | serviço e rotas (403) |
| 9 | SUPER_ADMIN não exclui oficial | `DELETE_BLOCKED` + auditoria da tentativa |
| 10 | Exclusão transacional de teste | memória e PostgreSQL real |
| 11 | Dependência protegida bloqueia | documento emitido |
| 12 | Auditoria fica após exclusão | memória e PostgreSQL real |
| 13 | Ciclos antigos preservados | leitura sem colunas novas; migration aplicada sobre ciclo existente (contagens iguais) |
| 14 | Relatórios e exportações | CSV rotulado e bloqueado; PDF bloqueado no inativo |
| 15 | Módulos não relacionados | suíte de unidade completa |
