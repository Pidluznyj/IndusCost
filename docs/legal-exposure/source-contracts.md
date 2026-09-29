# Exposure — contratos de fonte

Cada fonte segue RAW → mapper → DTO interno. Serviço e UI não leem o JSON do CNJ.

## Domicílio

Variáveis: base, token, client id, client secret, CPF On-behalf-Of e os paths de identidade e de listagem. Os paths não são inventados; ficam vazios até o operador informar o contrato vigente.

Auth: `client_credentials` e header `On-behalf-Of`. O token fica em memória, com folga de 15 segundos. Não vai para PostgreSQL nem para log.

Listagem read-only, janela sobreposta de 2 dias, não de 15 minutos. Idempotência: `DOMICILIO:<tenantId>:<sourceCommunicationId>`.

Proibido: PUT de ciência, inteiro teor, mark as read, acknowledge.

O mapper de teste aceita uma fixture sanitizada (`content[]` com `id`, `numeroProcesso`, `tipoComunicacao`, `statusCiente`). Isso não é o contrato oficial.

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
- Paths oficiais do Domicílio ainda não fixados no ambiente.
- Credencial e tenant reais não foram usados.
- Certidão TRT e CNDT são registro manual. CNDT negativa não significa ausência de processo.
- A linha do tempo de um processo pagina a junção recente de movimentos, comunicações e eventos.
