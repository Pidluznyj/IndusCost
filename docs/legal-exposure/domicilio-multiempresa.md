# Exposure — Domicílio Judicial Eletrônico (multiempresa)

Nada neste documento foi executado em homologação ou produção. Nenhum segredo
aparece aqui: onde houver `<...>`, o valor é digitado por quem opera o servidor.

## 1. O que a integração faz

Acrescenta o Domicílio Judicial Eletrônico (PDPJ/CNJ) como mais uma fonte do
pipeline do Exposure. Para cada empresa monitorada que tenha credencial própria,
o sistema lista as comunicações oficiais destinadas àquele CNPJ e as anexa ao
processo que já existe no Exposure.

Não substitui DataJud, DJEN nem Escavador. Não cria um segundo cadastro de
processos. Não registra ciência, não abre o teor e não executa ato processual.

## 2. Contrato do CNJ (conferido)

Fonte: OpenAPI oficial de homologação, "PDPJ - Domicílio Eletrônico" v1.0 —
`https://gateway.stg.cloud.pje.jus.br/domicilio-eletronico-hml/v3/api-docs` — e a
página `https://docs.pdpj.jus.br/servicos-negociais/domicilio-judicial-eletronico/`.

| Item | Contrato |
|---|---|
| Autenticação | OAuth2 `client_credentials` no SSO do PJe; token Bearer (JWT) |
| Token (homologação) | `https://sso.stg.cloud.pje.jus.br/auth/realms/pje/protocol/openid-connect/token` |
| Base (homologação) | `https://gateway.stg.cloud.pje.jus.br/domicilio-eletronico-hml` |
| Base e token (produção) | **Não constam na documentação pública.** Usar os informados pelo CNJ no credenciamento |
| `On-behalf-Of` | CPF (11 dígitos) do usuário responsável, em todas as requisições |
| `tenantId` | Cabeçalho obrigatório na listagem; obtido em `GET /api/v1/eu` (`perfis[].tenantId`) |
| Listagem | `GET /api/v1/comunicacoes` — `statusCiente` obrigatório (`A`/`L`/`N`); `dataInicio`+`dataFim` (ISO 8601, no máximo 7 dias) **ou** `numeroProcesso`; `page` (base 0), `size`, `sort` |
| Resposta | `{ page: { count, pageNumber, pageSize, totalPages }, data: [ComunicacaoProcessualViewModel] }` |
| Situação (`status`) | `EM_CURSO`, `INTEIRO_TEOR_OBTIDO`, `CIENTE`, `CIENCIA_AUTOMATICA`, `CANCELADA` |
| Limite de requisições | Não documentado. O cliente respeita `429`/`Retry-After` e um intervalo mínimo por conta |
| Histórico disponível | Não documentado. A carga inicial é configurável (padrão 30 dias) |

### Operações usadas (allowlist)

Só estas três saem para a rede, com método e caminho exatos:

1. `POST <token>` — autenticação.
2. `GET /api/v1/eu` — confere que a credencial pertence ao CNPJ e devolve o tenant.
3. `GET /api/v1/comunicacoes` — listagem paginada.

### Operações proibidas

`PUT /api/v1/processos/{numeroProcesso}/comunicacoes/{numeroComunicacao}` obtém o
inteiro teor e a comunicação passa a "ciente". **Não existe no código** e qualquer
método/caminho fora da allowlist é recusado antes do `fetch`
(`DOMICILIO_OPERATION_NOT_ALLOWED`). Também não são chamados `/logs`, `/ticket`,
`/notificacoes` nem rotas de cadastro.

A listagem devolve `linksDocumentos` (links do inteiro teor). Esses links **não são
guardados, exibidos nem seguidos**; fica só a contagem de documentos disponíveis.

## 3. Arquitetura

```text
legalExposureService.sync (orquestrador existente)
  └─ collectDomicilioBatches        concorrência limitada, um resultado por empresa
       └─ runners.domicilio(empresa) → sources/domicilio/domicilioSyncRunner.server.ts
            ├─ domicilioAccounts.ts          contas por CNPJ lidas do ambiente
            ├─ domicilioAuth.server.ts       token em memória, isolado por conta
            ├─ domicilioHttp.server.ts       allowlist de operação e de host, sem redirecionamento,
            │                                intervalo mínimo, nova tentativa limitada
            ├─ domicilioMonitoringClient     /api/v1/eu e /api/v1/comunicacoes
            └─ domicilioMapper.ts            contrato do CNJ → observações internas
  └─ applyBatchToMemory (existente)  conciliação, evidência, eventos, alertas, conexão
  └─ repository.persist (existente)  uma transação; upsert por chave de idempotência
```

### Reaproveitado sem alteração de comportamento

Cadastro de processos (`LegalCase`), conciliação por número CNJ e CNPJ explícito,
evidência por fonte, vínculo empresa↔processo, comunicações (`LegalCommunication`),
eventos append-only, alertas, conexão por empresa e fonte (`LegalSourceConnection`),
trilha de execuções, RBAC, flags e a política HTTP comum.

### Estendido

- `NormalizedSourceBatch`: `coverage` (janela coberta) e `domicilio` (contadores).
- `upsertConnection`: `lastFullSyncAt` passa a ser o checkpoint, só avançado quando a
  fonte informa cobertura completa.
- `normalizeCommunicationStatus`: reconhece o enum oficial do Domicílio.
- Ficha do processo (aba Comunicações) e central de fontes (estado por empresa).

### Banco de dados

**Nenhuma migration.** Os modelos existentes já comportam a integração:
`LegalCommunication.idempotencyKey` (única) = `DOMICILIO:<tenantId>:<numeroComunicacao>`;
`LegalSourceConnection (entityId, source)` (única) guarda status e checkpoint por
empresa; `LegalExposureEntity.domicilioTenantId` recebe o tenant confirmado pelo CNJ.

## 4. Multiempresa

Uma conta por CNPJ. Não há conta padrão: sem CNPJ a credencial não é usada.

```text
PDPJ_DOMICILIO_ACCOUNTS=LAZARIOS,KOPPETEL
PDPJ_DOMICILIO_<CHAVE>_CNPJ
PDPJ_DOMICILIO_<CHAVE>_CLIENT_ID
PDPJ_DOMICILIO_<CHAVE>_CLIENT_SECRET
PDPJ_DOMICILIO_<CHAVE>_ON_BEHALF_OF_CPF
PDPJ_DOMICILIO_<CHAVE>_TENANT_ID        (opcional; conferido contra o CNJ)
```

Para incluir outra empresa basta acrescentar uma chave e o bloco dela. Não há código por empresa.

Isolamento:

- A conta é escolhida pelo CNPJ da empresa monitorada. Empresa sem conta não gera chamada.
- `GET /api/v1/eu` tem de devolver um perfil com o mesmo CNPJ (e o mesmo tenant, se
  configurado). Se não devolver, a coleta para em `AUTH_ERROR` sem listar.
- Token, intervalo mínimo, paginação, checkpoint, status e erros são por conta.
- Comunicação cujo destinatário não é a empresa da conta (raiz de CNPJ diferente) é
  descartada e contada em `rejectedRecipient`.
- As empresas são consultadas em paralelo (`PDPJ_DOMICILIO_MAX_CONCURRENCY`, padrão 2,
  máximo 4). A falha de uma não interrompe as outras.
- Processo com as duas empresas: um processo lógico, dois vínculos e uma comunicação
  por destinatária. A ciência de uma não vale para a outra.

## 5. Coleta, checkpoint e idempotência

1. Janelas de até 7 dias desde o checkpoint menos 2 dias de sobreposição. Sem
   checkpoint, volta `PDPJ_DOMICILIO_BACKFILL_DAYS` (padrão 30, máximo 365).
2. Todas as páginas de cada janela (`page` até `totalPages`).
3. Releitura por `numeroProcesso` dos processos com comunicação ainda pendente
   (até 25 por execução), para captar mudança de situação fora da janela.
4. O checkpoint (`lastFullSyncAt`) só avança quando **todas** as janelas foram lidas
   até a última página. Página faltando, limite de páginas ou erro no meio →
   resultado `PARTIAL`: grava o que chegou e mantém o checkpoint.
5. Comunicações e checkpoint são gravados na mesma transação. Se a gravação falhar,
   nada avança e a próxima execução repete a janela.
6. Reprocessar o mesmo lote não cria comunicação, evento nem alerta repetido.
7. Nada é apagado quando a fonte deixa de devolver um registro.

## 6. Conciliação

- Processo conhecido: a comunicação é vinculada, entra uma evidência `DOMICILIO` e as
  evidências anteriores ficam como estavam. Campos do processo só são preenchidos se
  estiverem vazios; divergência com fonte oficial vira evento de conflito, sem sobrescrever.
- Processo desconhecido com número CNJ válido: segue a descoberta existente (correlação
  por CNPJ explícito), com evento `NEW_CASE`. O enriquecimento pelo DataJud continua
  pelo fluxo dele.
- Sem número CNJ válido: a comunicação fica registrada sem processo ("pendente de conciliação").
- **Não vêm desta fonte**: valor da causa, polo, probabilidade de perda, provisão e
  classificação de mérito. O mapper não os envia ao pipeline.

## 7. Segurança e privacidade

- Segredos só no ambiente do servidor. Nunca em código, Git, resposta de API ou log.
- Endereços aceitos apenas em `https` e em `*.pje.jus.br`, `*.pdpj.jus.br`, `*.cnj.jus.br`.
- Redirecionamento recusado (`redirect: "error"`). Nenhuma URL do payload é seguida.
- Metadados guardados por lista positiva: sem CPF de servidor, sem usuário que deu
  ciência, sem documentos de pessoas físicas, sem links.
- A API e a tela continuam atrás do RBAC do Exposure (`legal.exposure.view` e filhos).
- A central de fontes mostra presença de credencial, nunca valores.

## 8. Observabilidade

Cada execução registra, por empresa (`summary.domicilioEntities` da execução
`LEGAL_EXPOSURE_DOMICILIO`): conta, resultado, código de erro, páginas, registros
recebidos, aceitos, novos, rejeitados por destinatário, inválidos, processos relidos,
pendentes de conciliação, se a janela foi completa e o checkpoint.

A aba Fontes mostra o estado por empresa e avisa quando a coleta está incompleta ou
defasada (mais de 1 hora sem coleta completa): nesse caso a ausência de comunicações
não está confirmada. Falha de coleta gera evento `SOURCE_FAILED` e alerta.

## 9. Flags e rollback

Tudo nasce desligado. Sem `LEGAL_EXPOSURE_ENABLED=1` **e** `PDPJ_DOMICILIO_ENABLED=1`
não há chamada, mesmo com credenciais presentes.

Rollback: `PDPJ_DOMICILIO_ENABLED=0` e, se houver, desabilitar o timer do Domicílio.
Não há migration a reverter. Comunicações, evidências e eventos já coletados ficam.
DataJud, DJEN e o restante do Exposure não dependem desta fonte.

## 10. Credenciais — procedimento (executado por quem opera o servidor)

Os valores são gerados no portal do Domicílio ("Gerenciar credenciais API"), um
conjunto por empresa. Não enviar por chat, e-mail ou ticket.

Recomendado: um arquivo de ambiente só para estes segredos, lido pelo serviço.

```bash
# 1. arquivo de segredos, só root lê
sudo install -m 600 -o root -g root /dev/null /etc/induscost/domicilio-homolog.env

# 2. editar com editor (não usar echo/printf: o valor ficaria no histórico do shell)
sudoedit /etc/induscost/domicilio-homolog.env
```

Conteúdo (um bloco por empresa; flags ainda em 0):

```text
PDPJ_DOMICILIO_ENABLED=0
PDPJ_DOMICILIO_BASE_URL=<base informada pelo CNJ para o ambiente>
PDPJ_DOMICILIO_TOKEN_URL=<token informado pelo CNJ para o ambiente>
PDPJ_DOMICILIO_ACCOUNTS=LAZARIOS,KOPPETEL
PDPJ_DOMICILIO_LAZARIOS_CNPJ=<cnpj>
PDPJ_DOMICILIO_LAZARIOS_CLIENT_ID=<client id>
PDPJ_DOMICILIO_LAZARIOS_CLIENT_SECRET=<client secret>
PDPJ_DOMICILIO_LAZARIOS_ON_BEHALF_OF_CPF=<cpf do responsável>
PDPJ_DOMICILIO_KOPPETEL_CNPJ=<cnpj>
PDPJ_DOMICILIO_KOPPETEL_CLIENT_ID=<client id>
PDPJ_DOMICILIO_KOPPETEL_CLIENT_SECRET=<client secret>
PDPJ_DOMICILIO_KOPPETEL_ON_BEHALF_OF_CPF=<cpf do responsável>
```

```bash
# 3. drop-in do serviço apontando para o arquivo (o drop-in não contém segredo)
sudo mkdir -p /etc/systemd/system/induscost-homolog.service.d
printf '[Service]\nEnvironmentFile=/etc/induscost/domicilio-homolog.env\n' \
  | sudo tee /etc/systemd/system/induscost-homolog.service.d/97-domicilio.conf >/dev/null
sudo systemctl daemon-reload
sudo systemctl restart induscost-homolog

# 4. conferir presença sem imprimir valores
sudo stat -c '%a %U:%G %n' /etc/induscost/domicilio-homolog.env        # 600 root:root
sudo grep -c '^PDPJ_DOMICILIO_' /etc/induscost/domicilio-homolog.env   # só a contagem
```

Não usar `source` no arquivo, `cat` nem `systemctl show -p Environment` para conferir.
A tela Exposure › Fontes mostra, por empresa, "Credencial configurada" ou as variáveis que faltam.

Rotação: gerar a nova credencial no portal, trocar `CLIENT_ID`/`CLIENT_SECRET` no
arquivo, reiniciar o serviço e revogar a antiga no portal. O token em memória é
descartado no reinício; trocar o `CLIENT_ID` também invalida o cache.

Os nomes `induscost-homolog` e `/etc/systemd/system/induscost-homolog.service.d` são os
que já aparecem em `infra/satisfaction-homolog/APLICAR.md`. O caminho
`/etc/induscost/` é uma proposta: confirme o diretório antes de criar.

## 11. Homologação — roteiro para quem opera o servidor

A homologação tem o egress bloqueado (ver `infra/satisfaction-homolog/APLICAR.md`).
Chamada real ao CNJ exige liberar, para o serviço, **somente** os hosts do ambiente do
CNJ escolhido. Essa liberação é decisão sua e não está neste roteiro.

**A. Preflight (somente leitura)**

```bash
cd /opt/induscost            # ou o caminho oficial da homologação
git status --short | head
git fetch origin && git log -1 --oneline origin/main
systemctl is-active induscost-homolog
```

**B. Baseline do Exposure antes do deploy** (guardar a saída)

```bash
npm run legal:exposure:health
sudo -u postgres psql -d teste_bi_homolog -Atc 'select count(*) from "LegalCase"'
sudo -u postgres psql -d teste_bi_homolog -Atc 'select source, count(*) from "LegalCommunication" group by 1 order by 1'
sudo -u postgres psql -d teste_bi_homolog -Atc 'select source, count(*) from "LegalCaseSourceEvidence" group by 1 order by 1'
```

**C. Deploy** — pelo script oficial, sem passos manuais:

```bash
induscost-deploy-homologacao
```

Não há migration nesta entrega. Se o script apontar migration pendente, ela não é desta integração: pare e analise.

**D. Verificação com a integração desligada**

Abrir `/exposure`: lista, ficha e indicadores iguais ao baseline. Aba Fontes: Domicílio
"Desligada por política". Repetir as contagens do passo B: têm de ser as mesmas.

**E. Credenciais** — seção 10, com `PDPJ_DOMICILIO_ENABLED=0`. Aba Fontes passa a
mostrar "Credencial configurada" por empresa, ainda desligada.

**F. Primeira consulta (uma empresa, sem gravar)** — só depois de decidir o egress:

```bash
# flags ligadas apenas para este comando; preview não grava
LEGAL_EXPOSURE_ENABLED=1 PDPJ_DOMICILIO_ENABLED=1 \
  npm run legal:exposure:domicilio:preview -- --entity=<id da empresa no Exposure>
```

O comando precisa das variáveis do arquivo de segredos no ambiente do processo. Use o
mecanismo que você já usa para rodar os scripts `legal:exposure:*` com o ambiente do
serviço (a unit de exemplo em `infra/systemd/legal-exposure/` mostra o `EnvironmentFile`).

Conferir na saída: `outcome` `SUCCESS` ou `NO_RESULTS`, `externalCall: true`, quantidade
de comunicações. Comparar com o portal do Domicílio da mesma empresa, **sem abrir o
teor de nenhuma comunicação**.

**G. Gravação limitada** — mesma empresa, `--mode=apply`. Depois:

```bash
sudo -u postgres psql -d teste_bi_homolog -Atc \
  'select "entityId", count(*), count(distinct "idempotencyKey") from "LegalCommunication" where source = '"'"'DOMICILIO'"'"' group by 1'
sudo -u postgres psql -d teste_bi_homolog -Atc \
  'select "entityId", status, "lastFullSyncAt" from "LegalSourceConnection" where source = '"'"'DOMICILIO'"'"''
sudo -u postgres psql -d teste_bi_homolog -Atc 'select count(*) from "LegalCase"'
```

Aceite: contagem igual à de chaves distintas; rodar de novo não muda as contagens;
`LegalCase` só cresce se o portal mostrar processo que o Exposure ainda não tinha;
valor da causa e polo dos processos existentes inalterados.

**H. Segunda empresa** — repetir F e G. Conferir que cada comunicação está na empresa
destinatária e que um processo comum às duas continua único.

**I. Permissões** — usuário com `legal.exposure.view` vê as comunicações; usuário só
com `settings.view` recebe 403.

**J. Logs**

```bash
journalctl -u induscost-homolog --since "30 min ago" --no-pager | grep -i -E "domicilio|legal-exposure" | tail -40
```

Não deve haver token, segredo ou CPF nas linhas.

**K. Aprovação** — só então decidir flags permanentes e agendamento.

**L. Rollback** — `PDPJ_DOMICILIO_ENABLED=0` no arquivo de segredos, reiniciar o serviço.

## 12. Produção — sequência proposta (não executada)

1. Deploy do código com a integração desligada.
2. Conferir o Exposure existente contra o baseline.
3. Credenciais da Lazários.
4. Credenciais da Koppetel.
5. Reler a documentação do CNJ vigente e confirmar que as três operações continuam sem efeito de ciência.
6. Preview e depois apply só da Lazários.
7. Conferir com o portal do CNJ (sem abrir teor).
8. Conferir ausência de duplicidade.
9. Conferir checkpoint.
10. Conferir integridade dos dados existentes (processos, valores, polos).
11. Preview e apply só da Koppetel.
12. Conferir segregação por CNPJ.
13. Conferir um processo compartilhado, se houver.
14. Ligar as duas em paralelo (`--source=DOMICILIO` sem `--entity`). A gravação global pela linha de comando só é aceita com `LEGAL_EXPOSURE_AUTOSYNC_ENABLED=1`; sem essa flag o comando recusa e sai com código 2.
15. Acompanhar a aba Fontes e os alertas por alguns dias.
16. Só então habilitar o timer (`infra/systemd/legal-exposure/induscost-legal-domicilio.timer`).

Havendo dúvida sobre efeito jurídico de qualquer chamada, não ligar a consulta real.

## 13. Limitações conhecidas

- Endereços de produção do CNJ não estão na documentação pública.
- Limite de requisições e profundidade do histórico não são documentados.
- O filtro por data da listagem não diz sobre qual data atua; por isso a sobreposição
  de 2 dias e a releitura dos processos pendentes.
- Nenhuma chamada real foi feita: o contrato foi conferido no OpenAPI e os testes usam um CNJ simulado.
- Comunicação de filial (mesma raiz de CNPJ) é aceita na conta da matriz, mas só o CNPJ
  exato da conta alimenta a descoberta de processo.
- O polo informado pelo Domicílio (`parteInteressada`) fica nos metadados da
  comunicação e não altera o polo do processo.
