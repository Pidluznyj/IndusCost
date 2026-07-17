# Auditoria read-only de tributos do Pedido (TRIB-07)

## Objetivo

Diagnosticar, no servidor com acesso ao banco, por que a aba **Tributos** de um
Pedido está `available`, `partial` ou `unavailable`.

O Cursor não possui acesso ao banco de produção. Portanto, a criação e os testes
do auditor **não validam o PD 02781**; essa validação deve ser executada
posteriormente no servidor.

## Comando

No diretório da aplicação no servidor:

```bash
npm run audit:sales-order:taxes -- --order=PD02781
```

O formato aceito é `PD` seguido do número. `PD 02781` também é normalizado para
`PD02781`.

## Pré-requisitos

- checkout contendo o TRIB-07;
- dependências instaladas;
- `DATABASE_URL` configurada para o banco que será auditado;
- usuário do banco com permissão de leitura nas tabelas consultadas;
- nenhuma credencial deve ser passada na linha de comando.

## Segurança e escopo

O auditor:

- executa somente `findFirst` e `findMany`;
- não executa `create`, `update`, `upsert`, `delete`, SQL de escrita ou transação;
- não chama API, sincronização ou qualquer endpoint do Nomus;
- não grava relatório em arquivo;
- não lê nem imprime `rawPayload`, `rawJson`, `xmlRaw` ou XML de cancelamento;
- mascara chaves fiscais;
- imprime a `DATABASE_URL` apenas como protocolo, host, porta e database, sem
  usuário, senha ou query string;
- limita cada consulta a 100 registros.

## Conteúdo do relatório

O JSON emitido no terminal contém:

- pedido localizado, ID local, ID/código externo;
- vínculos `SalesOrderNfeLink`;
- Documentos de Saída relacionados via fatos Order-to-Cash;
- NF-es encontradas por `SALES_ORDER_NFE_LINK`, `STOCK_DOCUMENT`,
  `ORDER_TO_CASH` e `ITEM_REF`;
- status local e elegibilidade de cada NF para totais;
- campos fiscais disponíveis e ausentes;
- tributos `HEADER` por NF e consolidado;
- motivo exato de `unavailable`;
- quantidade e evidência de duplicidades eliminadas;
- vínculos pendentes e conflitos com outros pedidos.

As NF-es canceladas permanecem visíveis para auditoria, mas não entram no
consolidado tributário.

## Interpretação

- `available`: existe NF válida e os dados documentais necessários estão
  disponíveis.
- `partial`: existe NF válida, porém algum campo fiscal, summary ou evidência
  documental está incompleto. Os valores encontrados continuam no relatório.
- `unavailable`: pedido ausente, nenhuma NF encontrada nas fontes oficiais, ou
  somente NF-es canceladas/inelegíveis.

`exactUnavailableReason` informa a causa específica quando o status é
`unavailable`.

## Exit code

- `0`: auditoria concluída, inclusive quando o pedido não existe ou não possui
  NF válida;
- diferente de `0`: falha técnica, como argumento inválido, `DATABASE_URL`
  inválida ou banco indisponível.

Exemplo em shell:

```bash
npm run audit:sales-order:taxes -- --order=PD02781
echo $?
```

## Evidência a registrar no servidor

Para validar posteriormente o PD 02781, registrar:

1. data/hora e ambiente;
2. commit implantado;
3. comando executado;
4. exit code;
5. `status` e `exactUnavailableReason`;
6. contagens de NF, duplicidades, pendências e conflitos;
7. JSON sanitizado do terminal, conforme política interna.

Não copiar `DATABASE_URL`, senha, XML, payload bruto ou dados pessoais para
chamados e conversas.
