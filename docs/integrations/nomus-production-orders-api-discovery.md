# Descoberta técnica — Ordem de Produção na API Nomus

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Contexto** | Funil Pedido → Caixa (OP = camada **opcional**) |
| **Data** | 2026-07-11 |
| **Tipo** | Guia de descoberta read-only |
| **Script** | `tmp-audits/discover-nomus-production-orders-api.ts` |

> Relacionado: [`../sales/sales-order-to-cash-funnel-requirements.md`](../sales/sales-order-to-cash-funnel-requirements.md)

---

## 1. Objetivo

Verificar, de forma **controlada e read-only**, se a API Nomus expõe **Ordem de Produção (OP)** e se existe vínculo com **Pedido de Venda**.

Esta descoberta **não**:

- acessa produção a partir do agente Cursor;  
- grava no banco;  
- cria tabela;  
- altera sync oficial;  
- torna OP obrigatória no funil.

---

## 2. Endpoints testados (candidatos)

Paths relativos a `NOMUS_BASE_URL` (em geral já termina em `/rest/`):

| Path | Query opcional |
|------|----------------|
| `ordens` | — |
| `ordensProducao` | — |
| `ordensDeProducao` | — |
| `ordens-producao` | — |
| `ordensProducao` | `pagina=1` |
| `ordemProducao` | — |
| `ordensFabricacao` | — |
| `ordens-fabricacao` | — |
| `producao/ordens` | — |

Além disso, o script inspeciona **`/rest/pedidos`** (amostra ou pedido filtrado) em busca de campos embutidos:

`ordemProducao`, `ordensProducao`, `idOrdemProducao`, `itensOrdemProducao`, `atendidoPelaProducao`, `qtdeAtendidaProducao`, `statusProducao`, `producao`, `ops`, etc.

O código IndusCost já lê alguns desses campos do **raw do pedido** (`extractNomusProductionOrders` em `salesOrderNomusRaw.ts`) quando presentes no JSON sincronizado — a descoberta valida se a **API REST** também lista OP como recurso próprio.

---

## 3. Como rodar (no servidor)

1. Garantir `.env` com o **mesmo padrão** dos syncs Nomus:
   - `NOMUS_BASE_URL`
   - `NOMUS_TOKEN` e/ou `NOMUS_AUTH_HEADER_NAME` + `NOMUS_AUTH_HEADER_VALUE`
2. No diretório do repositório:

```bash
npx tsx tmp-audits/discover-nomus-production-orders-api.ts
```

Com pedido específico:

```bash
npx tsx tmp-audits/discover-nomus-production-orders-api.ts --salesOrderCode "PD 02339" --verbose
npx tsx tmp-audits/discover-nomus-production-orders-api.ts --salesOrderExternalId 12345 --limit 5
```

Autenticação: reutiliza `buildNomusHeaders` / `buildNomusUrl` de `src/lib/nomusRestClient.ts` (sem duplicar lógica de token).

---

## 4. Como interpretar a saída

Tabela:

```text
endpoint | status | resultado | campos detectados | classificação
```

### Classificação por endpoint / final

| Classe | Significado |
|--------|-------------|
| **CONFIRMADO** | HTTP 200 com dados e hints de OP **e** vínculo com pedido |
| **POSSIVEL** | Responde 200 (ou lista vazia) / há hints, mas vínculo pedido↔OP não está claro |
| **INDISPONIVEL** | 404/405 ou paths sem recurso útil |
| **INCONCLUSIVO** | 401/403, 5xx, rede, ou credencial ausente |

Payloads são **sanitizados** (tokens, CPF/CNPJ/e-mail mascarados; amostra truncada).

---

## 5. Decisão de arquitetura

| Resultado da descoberta | Ação no produto |
|-------------------------|-----------------|
| CONFIRMADO | Enriquecer Funil Pedido → Caixa com OP como **camada opcional** (sem migration sem autorização) |
| POSSIVEL | Continuar investigação; preferir campos no raw do pedido se já existirem |
| INDISPONIVEL / INCONCLUSIVO | Funil **segue sem OP**; UI mostra “Informação não disponível na importação atual.” quando o usuário pedir detalhe de produção |

---

## 6. OP é camada opcional

Conforme requisitos do funil:

```text
Cliente → Pedido → [OP, se API/dado confiável] → Documento → NF → CR → Baixa
```

- Sem OP confiável, o funil **não quebra**.  
- OP **não** manda em financeiro, comissões, CR ou baixa.

---

## 7. Funil não depende de OP

O **Funil Pedido → Caixa** / Funil de Receita Industrial tem fonte oficial = **Pedido de Venda**.

Documento de saída, NF, CR e baixa vêm da espinha já usada na Conciliação de Carteira.  
OP, se existir, é **enriquecimento operacional** — nunca requisito de DoD do funil.

---

## 8. Segurança / escopo

- Rodar apenas em ambiente com credencial autorizada (servidor/staging).  
- Não commitar saída com dados sensíveis.  
- Não habilitar write, sync ou migration a partir deste script.
