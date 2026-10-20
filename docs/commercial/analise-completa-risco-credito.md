# Análise completa de risco e crédito (QUOD + IEPTB)

## Contrato Direct Data confirmado

| Produto | Endpoint | Auth | Preço de catálogo |
|---|---|---|---:|
| Dossiê QUOD Completo | `GET /api/DossieCreditoCompleto?CNPJ=` | `Authorization: Bearer` | R$ 6,99 |
| Protestos Nacional — IEPTB Online | `GET /api/ProtestosOnline?Cnpj=` | `Authorization: Bearer` | R$ 3,50 |

Fonte do IEPTB: [catálogo Direct Data — ProtestosOnline](https://www.directd.com.br/central-de-ajuda/apis/catalogo/ProtestosOnline).

O token **não** vai na URL. CPF não é enviado na consulta de CNPJ. Uma chamada por produto, sem retry automático em timeout/5xx.

`metaDados.assincrono=true` sem `retorno` é resultado parcial / cobrança indeterminada — não é "sem protesto".

## Orçamento

- Limite por produto: `QUOD_DOSSIER_MONTHLY_LIMIT_CENTS`, `IEPTB_ONLINE_MONTHLY_LIMIT_CENTS`.
- Limite global opcional: `CREDIT_INTELLIGENCE_MONTHLY_LIMIT_CENTS` (0 = sem teto global).
- Produção hoje tem teto QUOD de R$ 6,99. **Não subir automaticamente** para R$ 10,49.
- Antes de ativar o IEPTB, o operador precisa autorizar:
  1. `IEPTB_ONLINE_ENABLED=true`
  2. `IEPTB_ONLINE_MONTHLY_LIMIT_CENTS` compatível com o contrato
  3. `CREDIT_INTELLIGENCE_MONTHLY_LIMIT_CENTS` cobrindo QUOD + IEPTB, se houver teto único

## Cache

TTL padrão 7 dias. Pacote reutiliza consulta válida. Reconsulta antecipada exige checkbox + `forceRefresh` e respeita intervalo mínimo.

GET autenticado lê o resultado armazenado. Só `SUPER_ADMIN` dispara POST/consulta paga; o botão fica oculto para os demais.

## Ativação (produção)

1. Confirmar autorização contratual do produto IEPTB na conta Direct Data.
2. Aplicar migration `20261026120000_ieptb_online_package` (aditiva).
3. Manter `IEPTB_ONLINE_ENABLED=false` no deploy inicial.
4. Validar GET do pacote (sem POST pago).
5. Ajustar tetos.
6. Ligar a flag só após aprovação.

## Rollback

Desligar `IEPTB_ONLINE_ENABLED`. Rotas QUOD isoladas continuam. Histórico QUOD não é alterado. Tabela IEPTB pode permanecer vazia.
