# Comercial → Satisfação de Clientes

Regras oficiais do módulo. Este documento é a referência de negócio; o código
é a implementação, e onde houver divergência a decisão está aqui.

---

## 1. O que o módulo resolve

Antes dele, a pesquisa de satisfação vivia num Google Forms: sem vínculo com
`Customer`, sem indicadores, sem série histórica auditável. O módulo traz isso
para dentro do IndusCost e permite que o cliente responda **pela Internet**,
sem VPN, sem Tailscale, sem rede corporativa e sem usuário IndusCost.

---

## 2. Questionário V1 — imutável

Código: `CUSTOMER_SATISFACTION_V1`. Semeado pela migration com **UUIDs
literais fixos** (reexecutar é no-op).

### Escala histórica — congelada

| Nota | Rótulo |
|---|---|
| 1 | Ruim |
| 2 | Regular |
| 3 | Bom |
| 4 | Ótimo |
| 5 | Excelente |

### Identificação

| Código | Pergunta | Obrigatório |
|---|---|---|
| `CUSTOMER_NAME` | Cliente (nome da empresa) | Sim |
| `TAX_ID` | CNPJ | **Não** |
| `CONTACT_PHONE` | Telefone/celular para contato | Sim |
| `SURVEY_DATE` | Data | Sim |
| `RESPONDENT_NAME` | Responsável pelo preenchimento | Sim |

### Critérios avaliados (RATING 1–5, todos obrigatórios)

`COMMERCIAL_SERVICE` · `QUOTE_ORDER_RESPONSE_TIME` · `DELIVERY_DEADLINE` ·
`ORDER_CONFORMITY` · `PRODUCT_QUALITY` · `TECHNICAL_SUPPORT`

Mais `OPEN_FEEDBACK` (texto, obrigatório).

### O que ficou de fora, e por quê

O artefato `Choose / Opção 1`, presente na exportação do Google Forms, **não
entrou**. Não há evidência de que seja pergunta negocial; incluí-lo significaria
inventar significado e contaminar a série. O importador ignora essa coluna sem
invalidar a linha.

### Por que o V1 é imutável

`code` é a identidade semântica — comparação entre campanhas usa o code, nunca
o texto nem a posição. Uma revisão futura nasce como **novo template (V2)**;
o V1 continua existindo e as respostas históricas nunca são reescritas.

---

## 3. Campanha

```
DRAFT ──→ SCHEDULED ──→ OPEN ──→ CLOSED ──→ ARCHIVED
   └──────────────────────↑
```

Transições fora desse fluxo são recusadas (`assertCampaignTransition`).

**Publicar congela o questionário**: as perguntas do template são copiadas para
`SatisfactionSurveyCampaignQuestion` e é contra esse snapshot que as respostas
apontam. Depois disso, período avaliado e questionário não mudam mais — só a
janela de resposta e textos de apoio.

**Exclusão**: apenas rascunho nunca publicado, sem convites e sem respostas.
Todo o resto encerra ou arquiva — histórico não some.

---

## 4. Customer é a única fonte

Não existe cadastro paralelo de cliente. A campanha guarda **snapshots** do
contexto da época (nome, CNPJ, responsável comercial) para preservar como era
naquele momento — isso não cria uma segunda verdade.

"Comprou no período" vem de `SalesOrder`, a fonte oficial. Não existe coluna
espelho tipo `customer.hasBoughtRecently`.

---

## 5. Links e token

- Token: `crypto.randomBytes(32)` (256 bits), base64url.
- O banco guarda **apenas** `sha256(token)` + um prefixo não sensível para
  suporte identificar o link.
- O token viaja no **fragmento** da URL: `https://satisfacao.<dominio>/r#TOKEN`.
  Fragmento não é enviado no request HTTP, então não aparece em log de
  Cloudflare, nginx ou origin.
- A URL pública não expõe nenhum id interno.

**Consequência aceita**: como só guardamos o hash, o token em claro não pode
ser relido. "Copiar link" de um convite que já tem link ativo **rotaciona** —
revoga o anterior e emite um novo, entregue uma única vez. Preferimos invalidar
o link antigo a enfraquecer o hashing por conveniência de UI. A tela avisa isso
antes de agir.

---

## 6. Sessão pública

O token é trocado uma vez por uma sessão de escopo `SATISFACTION_RESPONSE`,
amarrada a campanha/convite:

- não é `AppSession`, não tem papel nem permissão;
- cookie `induscost_satisfaction_session`, `HttpOnly`, `SameSite=Strict`,
  `Secure` conforme o protocolo, TTL 2h;
- não abre absolutamente nada do IndusCost administrativo.

A sessão **não é revogada no envio**: um retry de rede legítimo precisa cair no
resultado idempotente ("já enviado"), não em "link inválido". A trava contra
segunda resposta é o `invitation.completedAt` + o UNIQUE de `idempotencyKey`.

---

## 7. Fórmulas oficiais

Centralizadas em `satisfactionMetrics.ts`. O frontend não recalcula nada.

| Indicador | Definição |
|---|---|
| Nota média | `SUM(ratingValue) / COUNT(ratingValue)`, só ratings válidos |
| Positivas | `ratingValue IN (4,5)` |
| Críticas | `ratingValue IN (1,2)` |
| Top box | `ratingValue = 5` |
| Taxa de resposta | `convites ativos concluídos / convites ativos` |
| Abandono | `(iniciados − concluídos) / iniciados`, quando iniciados > 0 |
| Alerta | qualquer `ratingValue <= 2` |

### Regras que não se negociam

- **Rating válido é inteiro 1..5.** Nada de 0, decimal ou string. Percentual
  (20%, 40%…) nunca é persistido como fato; média é projeção derivada.
- **Não respondido = linha de Answer ausente.** Nunca zero, nunca default.
- **DRAFT não entra em métrica de satisfação.** Só `SUBMITTED`.
- **Sem denominador confiável, a taxa é `null`** — mostrada como "—", nunca 0%.
  É o caso da importação histórica: o Google Forms não diz quantos foram
  convidados, e inventar denominador falsearia a série.

### NPS: deliberadamente ausente

O V1 não tem pergunta 0–10 de recomendação. Converter 1–5 em NPS seria inventar
metodologia e quebrar a comparabilidade. Há teste automatizado que **falha** se
alguém adicionar função de NPS/CES ao módulo de métricas. Se um dia existir uma
V2 com pergunta adequada, o NPS nasce lá — sem tocar o V1.

---

## 8. Importação histórica (Google Forms)

```
UPLOAD → PREVIEW → VALIDAÇÃO → APROVAÇÃO → APPLY → PÓS-VALIDAÇÃO
```

- **PREVIEW não escreve nada** — nem o lote.
- **APPLY é idempotente**: UNIQUE `(importBatchId, importFingerprint)` mais
  checagem de fingerprint por campanha. A impressão digital é do **conteúdo**,
  então reordenar o arquivo não gera duplicata.
- `originalSubmittedAt` preserva o instante histórico; `submittedAt` marca a
  entrada no IndusCost. As duas datas coexistem — uma nunca sobrescreve a outra.
- Nota ilegível vira `null` e é reportada, nunca chutada.
- Cliente ambíguo (nome que resolve para mais de um `Customer`) fica
  **UNMATCHED** para revisão humana. Um palpite errado contamina a análise.

---

## 9. Permissões

Sem RBAC paralelo — entradas no contrato canônico existente:

| Recurso | Ações |
|---|---|
| `commercial.satisfaction` | view, create, update, manage, export |
| `commercial.satisfaction.responses` | view, export |
| `commercial.satisfaction.import` | view, execute |

`deny > allow > herança` continua valendo. O **escopo de carteira do vendedor é
resolvido no backend** (`getAllowedCustomerIds`): a consulta é restrita, e não
o dado escondido no frontend.

---

## 10. Privacidade e log

Registramos `requestId`, `campaignId`, `responseId`, `event`, `result`,
`durationMs`, `statusCode`.

Nunca: token, cookie, telefone, CNPJ, comentário, respostas, secret do
Turnstile. Não há IP/User-Agent persistido como dado de negócio, nem
fingerprinting, nem tracking de terceiros.
