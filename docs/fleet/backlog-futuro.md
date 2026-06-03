# Gestão de Frota — backlog futuro

Itens **não implementados** ou apenas parcialmente cobertos na versão atual. Não devem ser assumidos como disponíveis em produção até entrega explícita.

Legenda:

- **Pendência** — não existe no código hoje.
- **Parcial** — existe alternativa limitada; detalhe na nota.

---

## GPS e telemetria

**Status:** Pendência.

- Rastreamento em tempo real, histórico de rotas, geocerca e alertas por velocidade/parada.
- Hoje o km depende de lançamento manual na retirada/devolução, abastecimento e manutenção.

---

## Integração Detran (e órgãos reguladores)

**Status:** Pendência.

- Consulta automática de licenciamento, restrições, recall e débitos por placa/RENAVAM.
- Hoje documentos e multas são cadastro manual.

---

## Integração financeira completa

**Status:** Pendência (módulo frota tem custos operacionais isolados).

- Lançamento em contabilidade geral, centro de custo corporativo, AP/AR, conciliação bancária e NF-e de oficina/abastecimento.
- **Parcial hoje:** `FleetCost`, abastecimentos, multas; competência `AAAA-MM`; mascaramento por permissão; relatório de custos exportável em CSV.

---

## Upload real de anexos

**Status:** Parcial.

- **Hoje:** `FleetAttachment` grava `fileName` + `fileUrl` (URL já existente). API rejeita envio em base64.
- **Pendência:** storage próprio (S3, blob, pasta corporativa), upload pela UI, vírus scan, preview de PDF/imagem.

---

## App mobile nativo

**Status:** Pendência (alternativa web existe).

- **Parcial hoje:** fluxo **Uso em campo** em `/fleet/field` (web responsivo) para checkout/checkin e checklist.
- **Pendência:** app iOS/Android offline, push, câmera nativa, biometria.

---

## Alçadas avançadas (aprovações)

**Status:** Parcial.

- **Hoje:** aprovação de reservas (`fleet.reservations.approve`); manutenção com limiar de valor (`manutencaoValorAprovacao` em settings) e status `PENDING_APPROVAL`; motivo obrigatório em cancelamentos críticos.
- **Pendência:** múltiplos níveis por valor/unidade, substitutos, SLA, notificação por e-mail/Teams, fila de aprovação corporativa.

---

## Oficina e estoque de peças

**Status:** Pendência.

- Ordens de serviço com oficina interna/externa, peças, estoque, requisição e baixa.
- **Parcial hoje:** manutenção com fornecedor, valores estimado/final e vínculo a custo; sem catálogo de peças nem estoque.

---

## Outras melhorias frequentes (não comprometidas)

| Tema | Status |
|------|--------|
| Integração com RH (motoristas) | Pendência |
| Combustível / cartão frota (import automático) | Pendência |
| Política de uso por categoria de veículo | Parcial (categoria CNH × tipo veículo) |
| BI dedicado / Data warehouse | Pendência (há relatórios CSV/API) |
| Notificações proativas (e-mail/push) | Pendência (alertas só in-app/API) |
| Assinatura digital de checklist | Pendência |
| Multi-empresa / multi-filial avançado | Parcial (campos unidade/CC) |

---

## Como propor priorização

1. Registrar necessidade de negócio e volume (veículos, reservas/dia).
2. Verificar se **Parcial** já atende com processo manual.
3. Estimar dependência (ex.: storage antes de upload; contabilidade antes de integração financeira plena).
4. Alinhar com equipe de TI para épico no backlog do produto IndusCost.

Documentação do que **já existe**: [README.md](./README.md).
