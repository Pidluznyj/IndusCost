# Dossiê QUOD Completo — Direct Data

Consulta paga e manual. Abrir a tela, atualizar a página ou ver o último dossiê não chama o provedor.

## Contrato confirmado

- Documentação: https://apiv3.directd.com.br/scalar/v1 e o catálogo [Dossiê QUOD - Completo](https://www.directd.com.br/central-de-ajuda/apis/catalogo/DossieCreditoCompleto).
- Produto: Dossiê QUOD Completo (PF/PJ).
- Método do provedor: `GET /api/DossieCreditoCompleto`.
- Parâmetro de pessoa jurídica na tabela oficial: `CNPJ`. O exemplo da página também escreve `Cnpj`; a integração envia `CNPJ`.
- Autenticação recomendada: `Authorization: Bearer`. O token não entra na URL.
- Preço de referência do catálogo: R$ 6,99. O valor usado é `QUOD_DOSSIER_UNIT_PRICE_CENTS`.
- O JSON traz `score` numérico e não declara a escala. A tela não converte para 0–100.
- Protestos documentados como São Paulo. Não é certidão nacional e não dispara IEPTB.

O JSON do catálogo é o contrato implementado. O preço efetivo e a cobrança real da conta ainda precisam ser confirmados com a Direct Data antes de ligar a consulta.

## O que o IndusCost faz

- O gatilho interno é `POST /api/customers/:id/quod-dossier`, só com `consent: true` e chave de idempotência.
- Só `SUPER_ADMIN` dispara a consulta paga. Quem já acessa a tela de clientes lê o dossiê armazenado; o botão de consultar fica oculto.
- Cache válido é só leitura. Nova cobrança antecipada exige `forceRefresh` e consentimento explícito.
- O saldo financeiro é da Direct Data. O IndusCost não impõe teto mensal, máximo por CNPJ nem intervalo entre consultas.
- Uma consulta em andamento por CNPJ e cobrança desconhecida (timeout local, 5xx sem `metaDados.resultado`) bloqueiam outra chamada até conciliar. Não há retry automático.
- `SaldoInsuficiente`, autenticação recusada e fonte indisponível não são cobrados, conforme a tabela oficial de `metaDados.resultado`.
- O resultado vira evidência do motor de crédito já existente. Restrição confirmada pede `EM_ANALISE`. Score alto não remove inadimplência nem protesto interno. Score baixo, sozinho, não bloqueia.
- A consulta não grava título do Nomus nem altera o score cadastral.

## Ativação em homologação

1. Aplicar a migration aditiva `20261025120000_quod_dossier`. Não aplicar em produção por este procedimento.
2. Definir no ambiente do servidor, sem commitar o token:

```
QUOD_DOSSIER_ENABLED=true
QUOD_DIRECT_DATA_TOKEN=...
QUOD_DOSSIER_UNIT_PRICE_CENTS=699
QUOD_DOSSIER_CACHE_TTL_MS=604800000
```

3. Confirmar com a Direct Data o preço, o saldo e se o parâmetro `CNPJ` é aceito na conta.
4. Entrar como SUPER_ADMIN, abrir Consulta CNPJ e só então confirmar a consulta paga.
5. Verificar auditoria `QUOD_DOSSIER_QUERY`, o histórico e que um vendedor recebe 403 na mesma rota.

## Rollback

Desligar `QUOD_DOSSIER_ENABLED`. As tabelas e o histórico permanecem. Nenhuma consulta nova é enviada. O crédito interno continua valendo sem o dossiê.
