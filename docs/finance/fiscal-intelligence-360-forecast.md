# Inteligência Fiscal 360° — fórmulas e metodologia das projeções

**Atualizado:** 2026-10-29 · **Código:** `fiscal360Forecast.ts` (motor puro) · `fiscal360Processor.server.ts` (`rebuildFiscal360Forecast`) · versão `fiscal360.forecast@2026-10-29.1`

As projeções são **persistidas** (`FiscalForecastScenario` + `FiscalForecastSnapshot`) e recalculadas pelo processador — nunca na requisição, nunca por filtro. Cada linha guarda versão, data de cálculo, metodologia textual, faixa e mês de desembolso. Não alteram dados oficiais.

## 1. Duas naturezas, nunca misturadas

### 1.1 Determinística (`kind = DETERMINISTIC`)
Saldo em aberto de obrigações **já conhecidas** (guias e títulos tributários):

```
valor(empresa, tributo, mês) = Σ openBalance  das obrigações com vencimento no mês
mês = max(mês do vencimento, mês de referência)        # vencidas caem no mês corrente
```
Competências que já têm obrigação conhecida **não** recebem estimativa (sem dupla contagem).

### 1.2 Estimada (`kind = ESTIMATED`) — razão histórica por CNPJ × tributo
Para cada (empresa, tributo) com histórico:

```
r_m           = devido_m / receita_externa_oficial_m           (por competência fechada, últimos 24 meses)
razão         = Pk(r_m)   com k = P25 | mediana | P75           (premissa do cenário)
receita_proj_m= base × sazonalidade_m × (1+g)^((i+1)/12) × (1+ajuste)
estimativa_m  = receita_proj_m × razão
faixa         = [receita_proj × P25(r), receita_proj × P75(r)]
```
* `devido_m` = valor devido da **apuração** quando existir; senão, das obrigações (guias/títulos). A fonte usada aparece na metodologia da linha.
* `receita_externa_oficial_m` = faturamento oficial (`fiscalNfeWhereSql`) — intercompany, logística e canceladas ficam de fora.
* `base` = média dos 3 últimos meses fechados com faturamento.
* `sazonalidade_m` = receita do mesmo mês do ano anterior ÷ média dos 12 meses (limitada a 0,5–1,5), somente com 12 meses completos; senão 1.
* **Não é um percentual único**: cada tributo e cada CNPJ tem sua razão.
* **Tributos periódicos** (ocorrem em < 6 dos últimos 12 meses — ex.: IRPJ/CSLL trimestral): só projetados no mês em que ocorreram no ano anterior, com razão anual (Σ devido 12m ÷ Σ receita 12m) × receita projetada do trimestre; faixa ±20%.
* **Sem base suficiente** (< 3 competências com receita e devido, ou faturamento insuficiente nos 3 últimos meses): `availability = UNAVAILABLE` com motivo — **nunca zero**.

### 1.3 Parâmetros tributários explícitos (opcional, versionado)
`FiscalRuleVersion` `fiscal360.tax-parameters` (status `ACTIVE`) com **fonte normativa**, **início de vigência** e alíquota efetiva por CNPJ × tributo:

```
estimativa_m = max(0, receita_proj_m × alíquota − crédito_rate × compras_mensais × (1 + ajuste_compras))
```
Vale somente dentro da vigência (`effectiveFrom ≤ mês ≤ effectiveTo`) — **nunca retroativo**. Alterar parâmetros reenfileira só `REBUILD_FORECAST`; nenhum XML nem documento é reprocessado.

## 2. Prazo entre competência e pagamento
`cashMonth = mês + defasagem`. Defasagem = premissa do cenário, ou **mediana observada** por tributo (`paidMonth − competenceMonth` dos pagamentos contados, mínimo 3 amostras), ou **1 mês** (padrão declarado) sem amostras.

## 3. Cenários
| Cenário | Receita | Razão | Compras (parâmetros) |
|---|---|---|---|
| **Base** | média recente + sazonalidade | mediana | 0 |
| **Conservador** | −10% | P75 (mais imposto) | −10% |
| **Expansão** | +15% a.a. | mediana | +10% |
| **Personalizado** | premissas livres (sanitizadas e limitadas) | P25 / mediana / P75 | −90% a +300% |

Personalizado é calculado como **prévia** (`POST …/forecast/preview`, lê agregados persistidos, não grava) e pode ser **salvo** com permissão `finance.fiscal360.assumptions`, persistindo premissas, versão da metodologia e resultado.

## 4. Efeitos comparados (`summarizeFiscal360Forecast`)
* **Tributos devidos** = Σ projeções com competência no horizonte.
* **Desembolso** = Σ projeções com `cashMonth` no horizonte.
* **Capital de giro** = tributo do horizonte que só sai do caixa depois dele (financiamento pela defasagem).
* **Carga/margem/lucro** = devidos ÷ receita projetada (a diferença contra o Base, em p.p., é o efeito sobre margem/lucro). Sem receita → "Dados insuficientes".

## 5. Reforma tributária (IBS/CBS/IS)
* O parser já guarda `vIBS/vCBS/vIS` em `extensibleTotals`; o fato de documento os classifica como **`INFORMATIVE`** — nunca somados ao destacado efetivo nem ao pago.
* Regras da reforma (`fiscal360.tax-reform`) exigem **fonte normativa, início de vigência, versão e descrição**; ficam em rascunho até ativação auditada. **Nenhuma alíquota definitiva é presumida** e nenhuma regra futura é aplicada retroativamente.
* Atualizar parâmetros reprocessa apenas projeções dependentes (job `REBUILD_FORECAST`).

## 6. Limitações conhecidas (declaradas na interface)
1. Carteira de pedidos e compras projetadas **não** entram na v1 (a receita vem do histórico de faturamento oficial). Contrato de integração previsto em `loadFiscal360ForecastInputs`.
2. Créditos fiscais só entram via parâmetros explícitos; não há apuração automática de créditos.
3. Regime tributário por CNPJ não é cadastrado no sistema: a razão histórica o reflete implicitamente.
4. Tributos sobre lucro (IRPJ/CSLL) dependem de apuração cadastrada; sem ela → "projeção indisponível".
