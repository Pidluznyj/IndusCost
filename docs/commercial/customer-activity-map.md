# Comercial → Clientes → Indicadores → Mapa de Atuação

Camada geográfica **somente leitura** sobre a carteira de clientes. Mostra onde
estão os clientes e onde houve atividade, sem redefinir nenhuma regra comercial.

---

## 1. Regras reutilizadas (não há regra nova)

| Conceito | Fonte | Mesmo critério de |
|---|---|---|
| Cliente | `Customer` (um por `id`) | card "Clientes cadastrados" |
| Ativo | `Customer.status === "ACTIVE"` | cards "Ativos / Inativos" |
| Pedidos | `SalesOrder` com status fora de `CANCELLED`/`ERROR` | card "Com ao menos um pedido" |
| Novos clientes | `Customer.createdAt` nos últimos 30 dias | card "Novos (últimos 30 dias)" |
| Responsável | `CrmCustomerCommercialOwner` ativo (`sellerCanonicalName`) | Carteira / CRM |
| Última compra | maior `issueDate` dos pedidos válidos | — |

A regra de 90 dias sem compra (POL-COM-001 §11) trata da **perda do
responsável**, não da situação do cliente; por isso não é usada aqui.

---

## 2. Localização

O cadastro não tem latitude/longitude. A posição vem de **cidade + UF** →
centróide do município, por um dataset local versionado
(`brazilMunicipalities.data.ts`, malha do IBGE, 5.571 municípios). Nada é
geocodificado em runtime, nada é gravado no cliente.

| Precisão | Quando | No mapa |
|---|---|---|
| `EXACT` | reservado para coordenada própria (hoje nenhum cliente tem) | — |
| `CITY` | cidade reconhecida na UF | município, bolhas, clusters |
| `STATE` | UF válida, cidade ausente ou não reconhecida | só no total da UF |
| `UNKNOWN` | sem UF, UF inválida, sem nada, ou fora do Brasil | não aparece; é contado |

Normalização **determinística**: só iguala caixa, acentuação e pontuação
("CURITÍBA" = "Curitiba"). Não há fuzzy — "Curitba" fica como `STATE`, com o
motivo "Cidade não reconhecida". Cidade de outra UF nunca é reaproveitada.

`mapeados + só UF + sem localização = clientes do filtro`. O card "Sem
localização precisa" abre a lista desses cadastros com o motivo.

---

## 3. Estágios do zoom

Uma camada de dados por vez, para heatmap e clusters não competirem:

| Zoom | Estágio | O que aparece |
|---|---|---|
| < 6 | Concentração | coroplético por UF + heatmap dos municípios |
| 6 – 8,5 | Municípios | bolha com a contagem; bolhas que se sobrepõem na tela viram uma só (soma) |
| ≥ 9 | Clientes | clusters de clientes; clique aproxima, abre leque (≤ 12) ou lista |

A intensidade usa **raiz quadrada** do valor (só no visual) para que uma capital
não apague cidades pequenas. Tooltip, ranking e cards mostram sempre o valor
absoluto.

---

## 4. Filtros

A tela de Indicadores não tinha filtros; o mapa tem os seus:

- **Responsável comercial** e **Situação** definem a população de clientes.
- **Pedidos no período** muda só a contagem de pedidos. Cliente não sai do mapa
  por não ter comprado no período — carteira é estrutural, atividade é que
  depende de tempo.

---

## 5. API

Permissão: `commercial.customers` / view (a mesma de Indicadores).

- `GET /api/customers/indicators/map` — resumo, UFs e municípios agregados.
- `GET /api/customers/indicators/map/customers` — clientes individuais sob
  demanda: `bbox=oeste,sul,leste,norte`, `ibgeCode=` ou `unresolved=true`
  (teto de 1.500 por resposta).

Sem N+1: a visão geral faz 3 consultas fixas (clientes, `groupBy` de pedidos e
`groupBy` de responsáveis para o filtro); o
detalhe faz 1 leitura + 1 `groupBy` só dos clientes devolvidos.

---

## 6. Base cartográfica

Tiles configuráveis em tempo de build:

```
VITE_ACTIVITY_MAP_TILE_URL          URL com {z}/{x}/{y}; "none" desliga
VITE_ACTIVITY_MAP_TILE_ATTRIBUTION  crédito exigido pelo provedor
```

O padrão é o OpenStreetMap, cuja política atende uso interno de baixo volume.
Para uso intenso, apontar para um provedor contratado. Sem tiles o mapa segue
legível: o contorno das UFs (`brazilStates.geo.ts`, IBGE) é local.

---

## 7. Fora do escopo

Não geocodifica endereços, não grava coordenadas, não altera cliente,
responsável, pedido ou situação, e não estima "potencial de mercado".
