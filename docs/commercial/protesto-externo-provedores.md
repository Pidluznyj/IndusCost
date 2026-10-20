# Protesto externo por CNPJ

Consulta opcional, desligada por padrão. O IndusCost não extrai página pública, não inventa endpoint e não chama bureau sem contrato. A regra de crédito só recebe o resultado já classificado.

## O que foi verificado

Não há, neste repositório, documentação oficial de API nem credencial de homologação para CENPROT/IEPTB ou Serasa Experian. Por isso não existe adaptador HTTP. O adaptador `test` só devolve respostas simuladas e não sai da máquina.

Variáveis em `.env.example`. Enquanto `EXTERNAL_PROTEST_ENABLED` não for `true` e o provedor não for um adaptador contratado, a decisão de crédito não muda por causa desta consulta. A tela diz que a consulta não ocorreu. Isso não é “sem protesto”.

## Provedores avaliados

| Opção | O que é | Situação para o IndusCost |
| --- | --- | --- |
| CENPROT / IEPTB | Base nacional dos cartórios de protesto. Há consulta pública na web para o cidadão. O acesso institucional depende de convênio, com autenticação e ambiente de homologação definidos no contrato. | Não há URL, esquema de autenticação nem credencial oficial neste projeto. Consulta pública por página não será automatizada. |
| Serasa Experian | Bureau comercial. Protesto entra em produtos como Concentre/Relato, cobrados por consulta ou pacote, com contrato e código de produto. | Não há especificação nem credencial de teste aqui. Um endpoint adivinhado seria uma API inexistente. |
| Outros bureaus ou revendedores | Boa Vista, SPC Brasil, Quod e operadores que redistribuem CENPROT, quando autorizados por contrato. | Só entram depois de documento de API, base de homologação, responsável interno e base legal. |

Não há tabela de preço confiável no repositório. O custo costuma ser mensalidade mínima mais valor por consulta, com franquia e reconsulta. O número só existe na proposta do fornecedor.

## Contrato interno

O provedor implementa `consult({ cnpj, signal })` e devolve execução, situação, identificador da ocorrência, evidência, fonte e código de erro. Ele não decide venda.

A orquestração, em `externalProtestQuery.ts`, faz o resto:

- credencial só por variável de ambiente; o valor não entra na configuração exposta nem na auditoria;
- provedor desligado não é chamado;
- consulta por CNPJ válido;
- status de execução separado da situação do protesto;
- cache com validade configurável;
- timeout e no máximo duas novas tentativas, só para tempo esgotado ou indisponibilidade;
- recusa de provedor não contratado não entra no retry;
- limite de consultas por minuto;
- auditoria com situação, fonte, evidência e cliente, sem payload bruto e sem segredo;
- falha vira revisão, nunca “sem protesto”.

CENPROT e Serasa, se habilitados antes do contrato, respondem `PROVIDER_NOT_CONTRACTED` sem rede.

## Regra de crédito

A venda a prazo só trata como ausência de protesto uma consulta com execução bem-sucedida, dentro da validade, e situação `NONE_FOUND`.

| Resultado | Efeito no prazo |
| --- | --- |
| Desligado ou não consultado | Não bloqueia por este canal e não afirma ausência |
| Confirmado e vigente | Bloqueia (`BLOQUEADO`, protesto externo) |
| Cancelado, não confirmado, desatualizado, timeout, limite ou indisponível | Fica em análise. Não libera e não conta como ausência |
| Registro manual já confirmado | Continua bloqueando, mesmo com a consulta desligada |
| À vista | Continua fora da venda a prazo |

Protesto interno confirmado segue como bloqueio crítico, à parte desta consulta.

## Pré-requisitos ainda em aberto

1. Escolher o provedor e assinar o contrato, com ambiente de homologação.
2. Confirmar a base legal de LGPD para consulta de crédito e o tempo de retenção. O cache guarda situação, identificador e evidência, não o retorno bruto.
3. Definir quem pode disparar consulta paga. Hoje, com a flag ligada, a decisão de crédito usa o cache e consulta na falta de resultado vigente.
4. Receber a especificação real e só então escrever o adaptador HTTP, apontando para a base oficial.
5. Aplicar a migração aditiva `20261022140000_external_protest_consultation` em homologação antes de ligar a flag. Sem a tabela, a falha fecha o prazo em análise; não libera.

Não ativar a flag em produção neste passo e não fazer deploy.
