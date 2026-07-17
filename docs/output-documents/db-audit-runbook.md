# Runbook — auditoria de banco dos Documentos de Saída

## Finalidade

O auditor reúne evidências sobre `NomusStockDocument` e seus itens, vínculos com
Pedido de Venda e NF-e, alocações financeiras, Contas a Receber e os exemplos
informados por parâmetro. Ele gera relatórios sanitizados para análise posterior.

O auditor não cria nem corrige vínculos, não sincroniza dados com o Nomus e não
altera Pedido, NF-e, Contas a Receber, O2C ou qualquer outra tabela.

## Garantia read-only

A garantia read-only se aplica ao banco de dados. O processo grava somente os
dois arquivos locais de relatório.

As fontes exclusivas do auditor passam por uma verificação estática que rejeita:

- chamadas Prisma de criação, atualização, upsert ou exclusão;
- `$executeRaw`, `$executeRawUnsafe` e `$queryRawUnsafe`;
- SQL com `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP` ou `TRUNCATE`;
- `SELECT FOR UPDATE`, transações, alteração de isolation level e locks;
- chamadas ao Nomus e dependência de servidor HTTP ativo.

Como defesa adicional, recomenda-se executar com um usuário PostgreSQL que tenha
somente permissão de leitura. A configuração dessa conta é responsabilidade da
operação do servidor e não faz parte deste runbook.

## Pré-requisitos

- repositório atualizado no servidor;
- versão do Node.js compatível com o projeto;
- dependências do projeto já instaladas;
- variável de ambiente `DATABASE_URL` configurada no processo;
- acesso de leitura ao PostgreSQL;
- permissão de escrita no diretório `docs/output-documents/audits/`.

Não coloque credenciais na linha de comando, no relatório ou em mensagens de
análise. O auditor sanitiza o alvo do banco e não imprime usuário ou senha.

## Execução padrão

Na raiz do projeto:

```bash
npm run audit:output-documents:db
```

Os valores padrão investigados são:

- Documento de Saída: `8451`;
- Pedido: `PD02590`;
- NF-e: `7208`;
- limite amostral: `20`.

Execução explícita equivalente:

```bash
npm run audit:output-documents:db -- \
  --document=8451 \
  --order=PD02590 \
  --nfe=7208 \
  --sample-limit=20
```

## Parâmetros

- `--document=<inteiro positivo>`: `NomusStockDocument.externalId`;
- `--order=<texto>`: procura primeiro `SalesOrder.orderCode`; usa as chaves
  externas oficiais como fallback limitado;
- `--nfe=<inteiro positivo>`: procura primeiro `NomusNfe.externalId` e depois o
  número visível com consulta limitada;
- `--sample-limit=<inteiro positivo>`: limita amostras e exemplos;
- `--json-output=<caminho>`: caminho customizado para o JSON;
- `--markdown-output=<caminho>`: caminho customizado para o Markdown.

Exemplo com caminhos customizados:

```bash
npm run audit:output-documents:db -- \
  --document=8451 \
  --order=PD02590 \
  --nfe=7208 \
  --sample-limit=20 \
  --json-output=tmp-audits/output-documents-db-audit.json \
  --markdown-output=tmp-audits/output-documents-db-audit.md
```

As consultas parametrizadas são limitadas. A ausência de um exemplo não é erro
técnico: a seção correspondente retorna `found=false` e registra as estratégias
de busca tentadas.

## Relatórios gerados

Caminhos padrão:

```text
docs/output-documents/audits/output-documents-db-audit.json
docs/output-documents/audits/output-documents-db-audit.md
```

A escrita é atômica (`arquivo temporário` → `rename`). Em caso de falha, o
auditor remove o temporário e informa claramente o caminho afetado.

Os relatórios reais estão no `.gitignore` e não devem ser versionados. O único
modelo versionado é:

```text
docs/output-documents/audits/output-documents-db-audit.example.md
```

O terminal exibe apenas um resumo compacto com status, qualidade, exemplos,
duração e caminhos dos relatórios; o payload completo fica nos arquivos.

## Banco indisponível

Se o PostgreSQL estiver indisponível:

- a mensagem mostra apenas host, porta e database sanitizados;
- usuário e senha não são exibidos;
- o processo termina com código diferente de zero;
- o Prisma é desconectado no bloco de finalização;
- quando o filesystem estiver disponível, é gerado um relatório com
  `status=unavailable`;
- uma falha de filesystem não deixa arquivo temporário parcial.

Antes de interpretar métricas, corrija conectividade, rede/VPN ou a configuração
da `DATABASE_URL` e execute novamente. Não trate `status=unavailable` como
resultado de negócio.

## Preservação dos arquivos

1. Não edite os relatórios gerados.
2. Copie os dois arquivos juntos para uma pasta de evidências com acesso
   controlado.
3. Registre data/hora da execução e os parâmetros utilizados.
4. Preserve os nomes ou associe o JSON e o Markdown ao mesmo identificador de
   execução.
5. Não faça commit dos relatórios reais.
6. Antes de compartilhar, confirme no bloco `metadata` que
   `sanitization.applied=true`.

O JSON é a fonte estruturada para processamento; o Markdown é a visualização
humana da mesma execução.

## Envio para análise

Envie os dois arquivos gerados:

- `output-documents-db-audit.json`;
- `output-documents-db-audit.md`.

Informe separadamente:

- data e ambiente da execução;
- comando usado, sem a `DATABASE_URL`;
- código de saída do processo;
- qualquer erro exibido no resumo compacto.

Não envie `.env`, URL completa de conexão, logs com credenciais, dumps de banco
ou payloads brutos do Nomus.

## Como confirmar que não houve escrita no banco

Antes da execução, rode o teste direcionado:

```bash
npm run test:output-documents:audit-db
```

Esse comando inclui a proteção estática DS-02.9. O teste deve passar sem
violações. Ele cobre as fontes listadas em
`src/lib/output-documents/auditOutputDocumentsReadOnlyGuard.ts`.

Após a execução, confira:

1. `metadata.readOnly` igual a `true`;
2. ausência de erro técnico no resumo;
3. apenas os dois arquivos de relatório criados ou substituídos;
4. nenhum processo de sync iniciado;
5. nenhuma dependência de API ou servidor HTTP.

Para garantia operacional mais forte, use uma conta PostgreSQL com privilégios
somente de `SELECT` e audite os logs do banco conforme a política do ambiente.
O campo `readOnly=true` é uma declaração do programa; a proteção efetiva é a
combinação do scanner estático, das consultas permitidas e das permissões do
usuário do banco.

## Interpretação das seções

- `metadata`: status, duração, alvo sanitizado, parâmetros e indicação
  read-only;
- `inventory`: volumes e distribuição do stage de documentos e itens;
- `fieldCoverage`: preenchimento dos campos do cabeçalho;
- `itemCoverage`: preenchimento dos campos dos itens;
- `rawJsonKeys`: matriz amostral de chaves sanitizadas; não é fonte oficial;
- `nfeLinks`: Documento → NF-e, existência local, cancelamento e conflitos;
- `salesOrderLinks`: Documento → Pedido, cardinalidade e fontes do vínculo;
- `allocations`: valores de documento e alocação, incluindo parcial,
  superalocação e arredondamento;
- `accountsReceivableLinks`: títulos ligados via NF, quitação, vencimento e
  divergências;
- `paymentTermsEvidence`: hipóteses sanitizadas de condição de pagamento;
- `financialEvidence`: precedência `CR real > Documento > previsão do Pedido`,
  sem dupla contagem;
- `dataQuality`: lacunas, riscos, cobertura e saúde dos vínculos;
- `examples`: investigação detalhada de Documento, Pedido e NF-e, incluindo
  `found` e estratégias tentadas;
- `recommendation`: próximos passos derivados do resultado, sem alterar dados.

Contagens e classificações devem ser interpretadas em conjunto. Por exemplo,
Documento e CR da mesma NF não representam duas coberturas financeiras.

## Dados a validar no servidor

Como o desenvolvimento não acessa dados reais, ainda precisam ser confirmados:

- existência do Documento `8451`, Pedido `PD02590` e NF-e `7208`;
- se o número visível coincide com `externalId` ou exige fallback;
- cobertura e qualidade reais de cabeçalhos, itens e `rawJson`;
- validade e cancelamento das NF-es encontradas;
- cardinalidade Documento ↔ NF-e ↔ Pedido;
- alocações parciais, completas e superalocadas;
- títulos abertos, parciais, recebidos, vencidos e sem vencimento;
- divergências entre NF e soma dos títulos;
- conflitos entre `SalesOrderNfeLink`, O2C, itens e `rawJson`;
- eficácia da sanitização sobre os formatos reais observados;
- permissões read-only do usuário PostgreSQL usado na execução.

## Limitações

- o auditor não corrige dados nem vínculos;
- resultados dependem do momento e da cobertura das sincronizações locais;
- `rawJson` e condições de pagamento amostrais são evidências, não regras
  oficiais;
- `OrderToCashAuditFact` é derivado e pode estar ausente ou desatualizado;
- a tolerância de um centavo classifica arredondamento, mas não muda regras
  financeiras;
- relatórios sanitizados reduzem exposição, mas ainda devem ser tratados como
  evidência interna;
- a execução não substitui logs, permissões e auditoria operacional do
  PostgreSQL.
