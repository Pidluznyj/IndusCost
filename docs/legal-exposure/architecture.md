# Exposure — arquitetura

## Objetivo

O Exposure monitora a exposição jurídica das empresas do próprio grupo. Ele detecta, consolida, alerta e preserva evidência. Não substitui advogado e não calcula chance de ganho, perda ou condenação.

Não faz parte da inteligência cadastral de clientes (`CustomerCnpjLookup`, score comercial). Pode reutilizar apenas a normalização de CNPJ.

## Arquitetura

```text
src/lib/legalExposure/          núcleo puro + serviço
  sources/domicilio|datajud|djen
  legalExposureRoutes.ts        Express
src/components/legalExposure/   UI
scripts/legalExposure*.ts       CLI, sem setInterval no processo web
```

O `server.ts` só registra a rota. Chamada externa nasce desligada (`LEGAL_EXPOSURE_ENABLED=0` e flags de cada fonte).

## Modelos

Entidade monitorada, alias, conexão de fonte, jurisdição, processo, evidência por fonte, parte, movimento, comunicação, evento append-only, alerta, certidão e auditoria.

Um número CNJ é um `LegalCase`, com N evidências. Domicílio, DataJud e DJEN não criam três processos.

Não há hard-delete automático de processo, comunicação, movimento, evento, certidão ou auditoria quando a fonte deixa de devolver o registro. `firstSeenAt` e `lastSeenAt` permanecem.

## RBAC

Menu e API do módulo exigem `legal.exposure.view` / recurso `admin.exposure`.

`settings.view`, `finance.view` e `employees.view` não abrem o Exposure.

Filhos:

- `admin.exposure.sources`
- `admin.exposure.sync` (`execute`)
- `admin.exposure.certificates`
- `admin.exposure.communications`
- `admin.exposure.settings`

O backend recusa a rota. Esconder o menu não é a barreira.

## Correlação

1. Número CNJ exato — confirma e une as fontes.
2. CNPJ explícito da entidade monitorada — confirma.
3. Identificador oficial já vinculado — confirma.
4. Razão social exata — revisão (`LIKELY`), não confirmação.
5. Alias exato — revisão.
6. Semelhança — candidato `UNCONFIRMED`, nunca confirmado.

Não correlaciona por valor, data próxima, cidade, advogado ou órgão.

## Eventos e alertas

Evento é append-only. Nova situação gera outro evento; o anterior não é reescrito.

A primeira fonte emite `NEW_CASE`. As seguintes emitem `SOURCE_CONFIRMATION`, sem novo alerta de processo.

Citação pendente ou expirada é crítica. Processo confirmado no polo passivo e intimação nova são altos. Ocorrência nominal exata pede revisão. Cancelamento e baixa são informativos.

Não existe score jurídico.

## Saúde das fontes

A política está em `legalExposureHealth.ts`. Para o Domicílio: até 30 minutos saudável, acima disso degradado, acima de 1 hora desatualizado.

`NOT_CONFIGURED` não é saudável. `NO_RESULTS` não é `SOURCE_ERROR`. A UI diz "Nenhum processo identificado nas fontes consultadas."

## Proibição de ciência

O automático pode autenticar, listar metadados e consultar processo. Não abre inteiro teor, não dá ciência, não confirma citação ou intimação e não marca comunicação como lida.

Não há cliente, endpoint ou botão de ciência. O caminho HTTP que pareça ciência é recusado antes do `fetch`. Os campos `officialContentOpenedAt` existem só para evolução futura e o sync não os preenche.
