# Descoberta técnica — Ordem de Produção na API Nomus

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Contexto** | Funil Pedido → Caixa (OP = camada **opcional**) |
| **Data** | 2026-07-11 |
| **Tipo** | Guia de descoberta read-only + orientação para teste no servidor |
| **Script** | `tmp-audits/discover-nomus-production-orders-api.ts` |

> Relacionado: [`../sales/sales-order-to-cash-funnel-requirements.md`](../sales/sales-order-to-cash-funnel-requirements.md)

> **Atualização 2026-07-16:** endpoint `GET /rest/ordens` CONFIRMADO com vínculo oficial `itensPedido.idPedido` / `itensPedido.id`. Integração stage: [`nomus-production-orders-sync.md`](./nomus-production-orders-sync.md).

---

## 1. Objetivo

Verificar, de forma **controlada e read-only**, se a API Nomus expõe **Ordem de Produção (OP)** e se existe vínculo com **Pedido de Venda**.

Esta descoberta **não**:

- acessa produção a partir do agente Cursor;  
- grava no banco;  
- cria tabela;  
- altera sync oficial;  
- implementa integração de OP;  
- torna OP obrigatória no funil.

> **Escopo deste documento:** orientar o teste no servidor e documentar como interpretar o resultado.  
> **Este prompt / esta etapa não integra OP.**

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
2. No servidor, no diretório do repositório:

```bash
cd /opt/induscost
npx tsx tmp-audits/discover-nomus-production-orders-api.ts --salesOrderCode "PD 02339" --verbose
```

Variantes úteis:

```bash
cd /opt/induscost
npx tsx tmp-audits/discover-nomus-production-orders-api.ts
npx tsx tmp-audits/discover-nomus-production-orders-api.ts --salesOrderExternalId 12345 --limit 5
```

Autenticação: reutiliza `buildNomusHeaders` / `buildNomusUrl` de `src/lib/nomusRestClient.ts` (sem duplicar lógica de token).

---

## 4. Como interpretar a saída

Tabela típica do script:

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

### Como agir conforme o resultado

1. **Se endpoint CONFIRMADO**
   - criar futura fase de integração **opcional** de OP;
   - OP pode entrar entre Pedido e Documento no funil;
   - ainda precisa validar se OP liga com **item de pedido** (não só com o cabeçalho).

2. **Se endpoint POSSIVEL**
   - **não** usar no funil ainda;
   - pedir confirmação ao Nomus/suporte sobre recurso oficial e vínculo pedido↔OP.

3. **Se endpoint INDISPONIVEL**
   - manter funil **sem OP**;
   - exibir “Produção não disponível na integração atual”.

4. **Se endpoint INCONCLUSIVO**
   - **não** implementar;
   - revisar credenciais / documentação da API Nomus e repetir o teste.

---

## 5. Resultado esperado do teste em produção/servidor

O teste no servidor deve produzir, no mínimo:

| Entrega | Conteúdo |
|---------|----------|
| **Tabela de endpoints** | Path, HTTP status, classificação (CONFIRMADO / POSSIVEL / INDISPONIVEL / INCONCLUSIVO) |
| **Campos detectados** | Nomes de campos de OP no recurso próprio e/ou no raw de `pedidos` |
| **Vínculo com pedido** | Evidência (ou ausência) de ligação OP ↔ pedido (ex.: código `PD 02339` / id externo) |
| **Classificação final** | Uma das quatro classes acima, com justificativa curta |
| **Amostra sanitizada** | Trecho truncado sem tokens/PII |

**Não é resultado esperado:** migration, tabela nova, alteração de sync, write na Nomus, ou mudança no Funil Pedido → Caixa nesta etapa.

Após o teste, registrar o resultado real (data, ambiente, classificação final e trecho sanitizado) neste documento ou em anexo versionado **sem dados sensíveis**.

---

## 6. Decisão de arquitetura

**Mesmo se OP existir na API Nomus, ela será enriquecimento opcional — nunca dependência do funil.**

| Resultado da descoberta | Ação no produto |
|-------------------------|-----------------|
| **CONFIRMADO** | Planejar fase futura de integração **opcional**; OP entre Pedido e Documento; validar vínculo com item; sem migration sem autorização explícita |
| **POSSIVEL** | Não usar no funil; confirmar com Nomus/suporte |
| **INDISPONIVEL** | Funil segue sem OP; UI: “Produção não disponível na integração atual” |
| **INCONCLUSIVO** | Não implementar; revisar credenciais/docs e retestar |

Implicações fixas (independentes do resultado):

- Fonte oficial do funil continua sendo **Pedido de Venda** (`SalesOrder`).  
- Documento → NF → CR → Baixa não dependem de OP.  
- Sem OP confiável, o funil **não quebra**.  
- OP **não** manda em financeiro, comissões, CR ou baixa.

---

## 7. OP é camada opcional

Conforme requisitos do funil:

```text
Cliente → Pedido → [OP, se API/dado confiável] → Documento → NF → CR → Baixa
```

- Sem OP confiável, o funil **não quebra**.  
- OP **não** manda em financeiro, comissões, CR ou baixa.

---

## 8. Funil não depende de OP

O **Funil Pedido → Caixa** / Funil de Receita Industrial tem fonte oficial = **Pedido de Venda**.

Documento de saída, NF, CR e baixa vêm da espinha já usada na Conciliação de Carteira.  
OP, se existir, é **enriquecimento operacional** — nunca requisito de DoD do funil.

---

## 9. Segurança / escopo

- Rodar apenas em ambiente com credencial autorizada (servidor/staging).  
- Não commitar saída com dados sensíveis.  
- Não habilitar write, sync ou migration a partir deste script.  
- Esta etapa **não integra OP** — apenas prepara e documenta a descoberta.
