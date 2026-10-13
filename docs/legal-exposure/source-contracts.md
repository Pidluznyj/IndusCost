# Exposure — contratos de fonte

Cada fonte segue RAW → mapper → DTO interno. Serviço e UI não leem o JSON do CNJ.

## Domicílio

Detalhe completo, credenciais e roteiro de homologação em `domicilio-multiempresa.md`.

Contrato conferido no OpenAPI oficial de homologação do CNJ. Operações usadas, com método e caminho fixos no código: `POST <token>`, `GET /api/v1/eu`, `GET /api/v1/comunicacoes`. Qualquer outra é recusada antes do `fetch`.

Uma conta por CNPJ (`PDPJ_DOMICILIO_ACCOUNTS` + `PDPJ_DOMICILIO_<CHAVE>_*`): client id, client secret, CPF On-behalf-Of e tenant próprios. Base e token vêm do ambiente e só são aceitos em `https` nos domínios oficiais.

Auth: `client_credentials`; `On-behalf-Of` em todas as requisições; `tenantId` na listagem. O token fica em memória, por conta, com folga de 15 segundos. Não vai para PostgreSQL nem para log.

Listagem read-only paginada, janelas de até 7 dias desde o checkpoint com 2 dias de sobreposição. Idempotência: `DOMICILIO:<tenantId>:<numeroComunicacao>`. Checkpoint em `LegalSourceConnection.lastFullSyncAt`, só avançado com cobertura completa.

Proibido: `PUT /api/v1/processos/{n}/comunicacoes/{n}` (inteiro teor → ciência), logs, ticket e qualquer escrita. Os links de inteiro teor devolvidos na listagem não são guardados nem seguidos.

## DataJud

Consulta implementada: processo conhecido, `POST /api_publica_{tribunal}/_search`, corpo `{ query: { match: { numeroProcesso } } }`. O alias do tribunal vem de `LegalExposureJurisdiction`, não de um TRT fixo no código.

A descoberta por CNPJ não monta query e não chama a rede, mesmo com `DATAJUD_CNPJ_DISCOVERY_ENABLED=1`. Motivo: o formato público de partes e polos ainda não foi observado. O probe (`legal:exposure:datajud:probe`) só lista caminhos de chaves e só depois de `--confirm-probe=DATAJUD_PROBE`.

**COMANDO DO PROBE DATAJUD — NÃO EXECUTADO.**

O mapper não inventa polo. Sem o campo observado, `entityPole` fica `UNKNOWN` e `parties` fica vazio.

## DJEN

Cliente GET configurável em `DJEN_BASE_URL`. Sem scraping e sem browser.

Nome sem número CNJ vira candidato. Número CNJ correlaciona e tem precedência sobre o nome. `LIKELY` aparece como "Possível ocorrência — revisão necessária". Fuzzy não confirma.

HTTP 429 vira `RATE_LIMITED`, lê `Retry-After` e não repete em loop.

## Normalização

CNPJ de 14 dígitos com dígitos verificadores. Número CNJ de 20 dígitos. Hash SHA-256 de JSON canônico com chaves ordenadas. Segredo, Authorization, token e CPF são removidos antes de persistir ou devolver.

## Limitações conhecidas

- Payload real de parte/polo do DataJud ainda não observado.
- Endereços de produção do Domicílio não constam na documentação pública do CNJ.
- Credencial e tenant reais não foram usados; nenhuma chamada real ao Domicílio foi feita.
- Certidão TRT e CNDT são registro manual. CNDT negativa não significa ausência de processo.
- A linha do tempo de um processo pagina a junção recente de movimentos, comunicações e eventos.
