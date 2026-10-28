# LIKE SERASA — Boa Vista Define Limite Positivo PJ via Direct Data

Consulta paga de crédito no cadastro de clientes, ao lado da análise QUOD + IEPTB. Nome exibido **LIKE SERASA**;
produto técnico **Boa Vista — Define Limite Positivo Pessoa Jurídica**; provedor comercial **Direct Data**; fonte dos
dados **Boa Vista**. A interface nunca sugere que o fornecedor é a Serasa nem usa logotipos.

Estado em 28/10/2026: implementado, testado localmente e **desligado por padrão**. A consulta real só pode
acontecer na produção AWS, depois da ativação operacional explícita descrita em §8.

## 1. Arquitetura

| Camada | Arquivo | Papel |
|---|---|---|
| Configuração | `src/lib/boaVistaDefineLimite/config.ts` | Constantes, `readLikeSerasaConfig` (`LIKE_SERASA_*`), preço autorizado 2150 centavos |
| Gate de ambiente | `src/lib/boaVistaDefineLimite/environmentGate.ts` | `decideLiveQuery` (fail-closed) e `decideDemoQuery` |
| Adapter HTTP | `src/lib/boaVistaDefineLimite/adapter.ts` | `GET /api/BoaVistaDefineLimitePositivoPJ?CNPJ&GERARCOMPROVANTE`, `Authorization: Bearer`, timeout, sem retry, `fetch` injetável |
| Parser | `src/lib/boaVistaDefineLimite/parse.ts` | Só campos do OpenAPI v3; ausência = "indisponível"; dinheiro em centavos só quando inequívoco; documentos de pessoas mascarados |
| Persistência | `store.ts`, `memoryStore.ts`, `store.server.ts` | Tabela própria `BoaVistaDefineLimiteConsultation` (modo LIVE/DEMO); reserva transacional + índice único parcial |
| Execução | `src/lib/boaVistaDefineLimite/query.ts` | Consulta real e simulação; códigos; cobrança; cache de 7 dias por cliente e produto |
| Rotas | `src/lib/boaVistaDefineLimite/routes.ts` | `GET/POST /api/customers/:id/like-serasa`, `GET …/:consultationId`, `GET …/:consultationId/receipt` |
| Classificação Direct Data | `src/lib/directData/classifyProviderResponse.ts` (compartilhado, inalterado) | `metaDados.resultado` → cobrado / não cobrado / indeterminado |
| Interface | `src/components/customers/LikeSerasaSection.tsx` | Botão, modal, cartão, relatório A–F, histórico |
| Montagem | `CustomerQuodDossierPanel.tsx` (`extraActions`), `CreditIntelligencePackageSection.tsx` | Botão na mesma linha do botão QUOD + Protestos; seção abaixo dos cartões |
| Registro | `server.ts` | `registerLikeSerasaRoutes` com auditoria em `CommercialAuditLog` (`LikeSerasaConsultation` / `LIKE_SERASA_QUERY`) |
| Migration | `prisma/migrations/20261103120000_boa_vista_define_limite` | Aditiva; `CREATE TABLE IF NOT EXISTS`; FK para `Customer` |

Separação do QUOD: nenhum arquivo do QUOD/IEPTB/pacote mudou de comportamento. A única alteração compartilhada é a
prop opcional `extraActions` em `CreditIntelligenceSourceCards` (renderiza nós extras na linha de ações).

## 2. Regra fundamental: só produção consulta a API real

`decideLiveQuery` exige, nesta ordem, **todas** as condições; a primeira que falha bloqueia e nada é reservado nem
enviado:

1. `INDUSCOST_OPERATIONAL_ROLE=production` no processo (homologação: `homologation`; ausente = `ROLE_UNDECLARED`);
2. arquivo de atestação **fora do repositório e fora do `.env`**, do root, no servidor autorizado:
   `INDUSCOST_OPERATIONAL_ROLE_FILE` (padrão `/etc/induscost/operational-role`) com o conteúdo `production`
   (ausente/ilegível = `ATTESTATION_MISSING`; outro conteúdo = `ATTESTATION_MISMATCH`);
3. `NODE_ENV=production` (`NODE_ENV_NOT_PRODUCTION` caso contrário — necessário, nunca suficiente);
4. `LIKE_SERASA_LIVE_ENABLED=1` (`FEATURE_DISABLED`);
5. `LIKE_SERASA_DIRECT_DATA_TOKEN` presente (`TOKEN_MISSING`).

Por que não `NODE_ENV`: a homologação também roda build de produção. Por que não só uma variável: `.env` é copiado
entre ambientes; o arquivo de atestação é criado à mão só na AWS e nunca sai do servidor. O frontend só mostra o que
o backend decide (`live.allowed` / `live.message`); a decisão real é da rota.

**Demonstração** (`LIKE_SERASA_DEMO_ENABLED=1`): fixtures sintéticas (`fixtures.ts`), sem rede, sem cobrança,
recusada quando o papel declarado **ou** o atestado for `production`. Registros ficam com `mode=DEMO`,
`billingStatus=NOT_APPLICABLE`, `providerQueryId` iniciado por `demo-`, razão social com "(SIMULADO)", selo
"Resultado simulado" no cartão, relatório e histórico. Um resultado DEMO nunca satisfaz o cache da consulta real.

## 3. Contrato da API (confirmado no OpenAPI v3 — `https://apiv3.directd.com.br/swagger/v3/swagger.json`, 28/10/2026)

- `GET /api/BoaVistaDefineLimitePositivoPJ`; parâmetros `CNPJ` (com ou sem máscara) e `GERARCOMPROVANTE`
  (`Desabilitar` | `Habilitar`). Autenticação: `Authorization: Bearer {token}` (recomendada), `X-API-Token` ou
  `?TOKEN=` (legado; **não usado**). `Async` não é enviado: a resposta 200 é síncrona.
- Envelope: `metaDados` (`consultaNome`, `consultaUid`, `chave`, `usuario`, `mensagem`, `resultadoId`, `resultado`,
  `apiVersao`, `gerarComprovante`, `urlComprovante`, `data`, `tempoExecucaoMs`) e `retorno`.
- `retorno` (todos **strings opcionais**): cadastro (`cnpj`, `razaoSocial`, `nomeFantasia`, `situacao`,
  `dataFundacao`, `naturezaJuridica`, `porte`, `capitalSocial`, `faixaFuncionarios`, `quantidadeFiliais`,
  `ramoAtividadePrimario`, `cnaePrimario`, `opcaoTributaria`, `enderecos[]`, `telefones[]`, `email`), `decisoes`
  (`codigoSituacao`, `descricao`, `resultado`), `score` (`score`, `tipoScore`, `descrScore`, `classificacaoABC`,
  `classificacaoNumero`, `probabilidadeInadimplencia`, `texto`, `risco`, `modeloScore`), `indicadores`
  (`creditoObtido`, `compromissos`, `pagamentoPontual` com `pontuacao` + `ocorrencias[{periodo, pontuacao_Mensal}]`,
  `pagamentoAtrasado`, `eventosPessoaJuridica`, `periodoRelacionamentoFornecedores`), `restricoes`
  (`pendenciasFinanceiras`, `protestos`, `acoesCiveis`, `falenciaRecuperacaoJudicial` com `quantidade`, `valorTotal`,
  datas e `ocorrencias[]`; `chequesSemFundoBacen`, `chequesSemFundoVarejo`, `contumacia`; `limiteCredito`
  {`descricao`, `valor`, `texto`}; `faturamentoPresumido`), `governancas` (sócios e administradores com `documento`),
  `alertas[]`, `historicoConsulta`, `participacoes`.
- Erros: 400 documento inválido, 401 token, **403 saldo/plano** ("Saldo insuficiente…", "Não existe um plano
  ativo…"), 404 não encontrado, 408 tempo esgotado, 500 falha, 503 manutenção; 201/202 só no modo assíncrono.

**Não confirmado pela documentação** (tratado defensivamente): escala e faixa do score (`score.score` é texto;
guardado como veio e como inteiro quando for inteiro; nunca convertido para o Score de Confiança V1); unidade de
`probabilidadeInadimplencia` (exibida como informada); unidade das pontuações mensais (rotuladas "unidade não
documentada"); formato monetário de `limiteCredito.valor` (centavos só quando o texto é inequívoco, senão só o
rótulo); se `GERARCOMPROVANTE=Habilitar` tem custo adicional (padrão desligado). O teste de contrato
`contract.test.ts` fica pendente até a primeira resposta real (§8.7).

## 4. Interface

- Botão **LIKE SERASA — R$ 21,50** na mesma linha de ações do botão "Consultar risco completo — QUOD + Protestos
  Brasil" (`data-testid="like-serasa-request-paid"`), só para SUPER_ADMIN; desabilitado com explicação para pessoa
  física, CNPJ ausente/inválido e ambiente sem consulta real ("disponível somente em produção"); no modo demonstração
  vira "LIKE SERASA — simulação".
- Modal: "Consulta LIKE SERASA", Fonte: Boa Vista via Direct Data, Cliente, CNPJ, Valor R$ 21,50, aviso de cobrança,
  consentimento obrigatório, botões Cancelar / "Confirmar consulta de R$ 21,50". Abrir o modal não consulta nada.
- Cartão LIKE SERASA (limite sugerido, score e classe, risco, consulta, validade, atribuição) e cartão de histórico.
- Relatório A–F: limite sugerido **separado** do limite interno (que não existe no cadastro: "Não cadastrado") e da
  situação de crédito interna; score/classe/PD/risco sem conversão; comportamento financeiro (séries mensais);
  restrições por categoria sem somar; cadastro empresarial com documentos de sócios mascarados; evidências (data,
  usuário, produto, provedor, id do fornecedor, situação da resposta e da cobrança, validade, parser, comprovante
  por rota autenticada, campos indisponíveis).
- Estados: nunca consultado, válida, vencida, em andamento, falha, parcial, cobrança desconhecida.

## 5. Permissões e proteções

- Só `SUPER_ADMIN` dispara consulta paga (`canRequestLikeSerasa`), validado no servidor; qualquer usuário
  autenticado lê status/histórico/relatório.
- `Origin` igual ao `Host`, rate limit por usuário, consentimento + chave de idempotência (≥ 8 caracteres, UUID v4
  gerado com `crypto` seguro no cliente), reserva transacional por CNPJ (`IN_FLIGHT`), bloqueio por cobrança
  desconhecida (`UNKNOWN_BILLING`), cache válido (`CACHE_VALID`), timeout sem repetição, e intervalo mínimo entre
  reconsultas manuais (`LIKE_SERASA_MIN_REFRESH_INTERVAL_MS`, 60 s): dois usuários clicando "atualizar" quase ao
  mesmo tempo geram uma única cobrança (o segundo recebe o resultado em cache).
- Auditoria: cada tentativa paga grava `CommercialAuditLog` (`entityType=LikeSerasaConsultation`,
  `action=LIKE_SERASA_QUERY`, código, modo, cobrança, ambiente, `creditEffect=NONE`).
- Dados pessoais: documentos de sócios/administradores mascarados nas seções; e-mail e telefones não lidos; retorno
  bruto só com `LIKE_SERASA_STORE_RAW_PAYLOAD=1` e redigido; URL do comprovante só na coluna própria e servida por
  rota autenticada.

## 6. Tratamento financeiro

| Situação | `status` | `billingStatus` | Código |
|---|---|---|---|
| Sucesso com `resultado` cobrado | SUCCEEDED | ESTIMATED (valor autorizado) | OK |
| Cache válido | — | — | CACHE_VALID (sem custo) |
| Saldo insuficiente (HTTP 403 / "Não existe um plano ativo") | FAILED | NOT_SENT | INSUFFICIENT_BALANCE (402) |
| Token inválido (401) | FAILED | NOT_SENT | AUTH |
| Documento recusado (400/404) | FAILED | NOT_SENT | INVALID_INPUT |
| Limite de requisições (429) | UNKNOWN_BILLING | UNKNOWN | RATE_LIMIT |
| Timeout / rede / 5xx sem resultado oficial | UNKNOWN_BILLING | UNKNOWN | TIMEOUT / NETWORK / HTTP_ERROR |
| Retorno parcial com `resultado=Sucesso` | PARTIAL | ESTIMATED | PARTIAL |
| Retorno inesperado sem resultado oficial | PARTIAL | UNKNOWN | PARTIAL |
| Falha ao gravar | UNKNOWN_BILLING | UNKNOWN | PERSISTENCE_FAILED |
| Simulação | SUCCEEDED | NOT_APPLICABLE | OK (mode DEMO) |

O valor de R$ 21,50 é o **autorizado**; nunca é apresentado como cobrança liquidada. O sistema não faz chamadas
extras para descobrir se uma tentativa foi cobrada: a conciliação é manual no painel Direct Data (§8.6).

## 7. Integração com a análise de crédito

Três fontes distintas: Score de Confiança IndusCost V1 (interno), QUOD (externo) e LIKE SERASA (externo). O LIKE
SERASA **não** entra no `calculateCreditConfidence`, **não** altera `decideCommercialCredit`, **não** altera limite
aprovado (não existe esse campo no cadastro) nem bloqueia cliente. Negativações da Boa Vista e do QUOD são exibidas em
relatórios separados, nunca somadas. A comparação "limite sugerido pela Boa Vista × limite interno × situação de
crédito" fica na seção A do relatório.

## 8. Ativação futura em produção (só com autorização operacional explícita)

1. **Migration primeiro**: `prisma migrate deploy` com `20261103120000_boa_vista_define_limite` (aditiva).
2. **Publicar o código** (branch `feat/like-serasa-boa-vista`). Ao publicar, nada muda: sem `LIKE_SERASA_LIVE_ENABLED`
   a consulta real continua bloqueada em todos os ambientes.
3. **Homologação**: no `.env` da homologação, `INDUSCOST_OPERATIONAL_ROLE=homologation` (e, se desejado,
   `LIKE_SERASA_DEMO_ENABLED=1` para a simulação). Verificação de que a homologação não chama a Direct Data:
   `GET /api/customers/<id>/like-serasa` → `live.allowed=false`, `live.reason=ROLE_NOT_PRODUCTION`; um POST real
   devolve 403 `ENVIRONMENT_BLOCKED` e não cria linha; `grep LIKE_SERASA_LIVE_ENABLED /opt/induscost-homolog/app/.env`
   vazio; o drop-in de egress da homologação continua intocado (nada foi alterado em firewall/allowlist).
4. **AWS, e só lá**: `sudo install -m 0600 -o root -g root /dev/stdin /etc/induscost/operational-role <<< production`;
   no `.env` de produção: `INDUSCOST_OPERATIONAL_ROLE=production`, `LIKE_SERASA_DIRECT_DATA_TOKEN=<token da conta
   Direct Data>` (pode ser o mesmo token da QUOD se a conta for a mesma; variável separada por desenho),
   `LIKE_SERASA_UNIT_PRICE_CENTS=2150`; manter `LIKE_SERASA_LIVE_ENABLED=false` até a autorização.
5. **Ativar**: `LIKE_SERASA_LIVE_ENABLED=1` + restart do serviço. Conferir `GET …/like-serasa` → `live.allowed=true`.
6. **Primeira consulta real autorizada**: um SUPER_ADMIN, num cliente PJ combinado, confirma o modal. Validar:
   linha com `mode=LIVE`, `status=SUCCEEDED`, `billingStatus=ESTIMATED`, `providerQueryId` da Direct Data;
   `CommercialAuditLog` com `LIKE_SERASA_QUERY`; no painel Direct Data, o consumo da consulta. Salvar a resposta
   redigida (`LIKE_SERASA_STORE_RAW_PAYLOAD=1` temporariamente ou export manual) e rodar
   `LIKE_SERASA_CONTRACT_SAMPLE=<arquivo> npx tsx --test src/lib/boaVistaDefineLimite/contract.test.ts`.
7. **Acompanhar falhas e cobranças**: `SELECT status, "billingStatus", "failureCode", count(*) FROM
   "BoaVistaDefineLimiteConsultation" WHERE mode='LIVE' GROUP BY 1,2,3`; linhas `UNKNOWN` bloqueiam novas consultas do
   CNPJ até a conciliação manual (atualizar `billingStatus` para `NOT_SENT` ou `ESTIMATED` conforme o painel).
8. **Desligar imediatamente**: `LIKE_SERASA_LIVE_ENABLED=0` + restart (ou remover o arquivo de atestação). O
   histórico permanece legível.
9. **Reverter a funcionalidade sem perder histórico**: remover o registro de rotas em `server.ts` e os componentes;
   a tabela e os `CommercialAuditLog` ficam. A migration não precisa ser revertida.

## 9. Testes

| Suíte | Cobertura |
|---|---|
| `environmentGate.test.ts` | 12 casos do gate (dev sem/com token, homolog com token e `NODE_ENV=production`, desconhecido, produção desabilitada/sem token/sem atestação/atestação divergente, produção completa, arquivo real, demonstração) |
| `parse.test.ts` | fixture completa, limite/score ausentes, monetários nulos, resposta inesperada, parcial, redação, CNPJ/CPF |
| `likeSerasa.test.ts` | rotas: custo 2150, permissão, consentimento, origem, PF, CNPJ inválido, bloqueios dev/homolog/produção, produção com HTTP simulado, cache válido/vencido/forceRefresh, duplo clique e concorrência, timeout sem repetição, 403/401/429/500/400/503, parcial, limite/score ausentes, falha de persistência, retenção/comprovante, demonstração, rate limit, adapter |
| `likeSerasa.pg17.integration.test.ts` | PostgreSQL 17 real: BigInt, cache, idempotência, corrida entre conexões (índice parcial), cobrança desconhecida, DEMO × LIVE, cadastro intocado |
| `contract.test.ts` | nomes documentados, método/parâmetros/auth; primeira resposta real (pendente) |
| `LikeSerasaSection.test.tsx` | botão ao lado do QUOD, permissão, PF/CNPJ/ambiente, modal, relatório A–F, indisponíveis, DEMO, montagem |
| Regressão | QUOD, IEPTB, pacote, Score de Confiança V1, classificador Direct Data, imports frontend/servidor |

## 10. Riscos residuais

- Campos de escala/unidade da Boa Vista não documentados (score, PD, pontuações mensais): exibidos como vieram.
- Custo do comprovante PDF não confirmado: `LIKE_SERASA_RECEIPT_ENABLED` desligado.
- Cobrança: a estimativa é local; só o painel Direct Data confirma consumo; respostas indeterminadas bloqueiam o CNPJ
  até conciliação manual.
- Credencial: depende de conta Direct Data com o produto Boa Vista contratado ("Não existe um plano ativo compatível
  com a API requisitada" → `INSUFFICIENT_BALANCE`).
- Pendências de ativação: arquivo de atestação na AWS, variáveis, primeira consulta real e amostra do contrato.
