# Gestão de Frota — manual operacional

Guia rápido para o dia a dia no IndusCost. Pressupõe que você já tem acesso ao menu **Gestão de Frota** (`fleet.view` no mínimo).

Se aparecer *“Você não tem permissão para acessar o módulo”*, peça ao administrador a permissão adequada (ver [README.md](./README.md#permissões)).

---

## Antes de começar

- **Unidade** e **centro de custo** ajudam em filtros e relatórios — preencha quando fizer sentido.
- Ações destrutivas (inativar, vender, cancelar custo) pedem **motivo** quando a política da empresa exigir.
- Valores em reais só aparecem com `fleet.financial.view` ou `fleet.manage`; caso contrário verá `••••••`.

---

## Como cadastrar um veículo

**Quem pode:** `fleet.vehicles.edit` ou `fleet.manage`.

1. Abra **Gestão de Frota** → aba **Veículos**.
2. Clique em **Novo veículo** (ou equivalente).
3. Informe **marca**, **modelo** e, se aplicável, **placa** (não pode duplicar placa ativa).
4. Escolha **origem** (próprio, alugado, leasing, etc.) e **km** inicial.
5. Salve.

O veículo inicia em status operacional conforme regras do cadastro (em geral disponível para reserva após validações).

**Dica:** veículos alugados/leasing costumam exigir **contrato ativo** — o sistema alerta na listagem se faltar contrato ou documento vencido.

---

## Como cadastrar um contrato

**Quem pode:** `fleet.vehicles.edit` ou `fleet.manage`.

Contratos ficam na **ficha do veículo**, não na aba genérica “Contratos” do menu (essa aba só orienta o caminho).

1. Aba **Veículos** → ícone de visualizar/abrir o veículo.
2. Seção **Contratos** → **Novo contrato**.
3. Preencha fornecedor/locadora, tipo, datas de início e fim, valores se tiver permissão financeira.
4. Salve.

Contratos vencidos ou ausentes geram **alertas** no dashboard e na lista de veículos.

---

## Como cadastrar um documento

**Quem pode:** `fleet.vehicles.edit` ou `fleet.manage`.

1. Na ficha do veículo → seção **Documentos**.
2. **Novo documento**: tipo (ex.: seguro, licenciamento), número, data de vencimento.
3. Salve.

Para renovar sem apagar histórico, use **Substituir** quando disponível (documento anterior passa a `REPLACED`).

**Pendência:** anexos de arquivo dependem de **URL** já hospedada em outro sistema; não há upload de PDF direto no servidor nesta versão.

---

## Como cadastrar um motorista

**Quem pode:** `fleet.manage`.

1. Aba **Motoristas** → **Novo motorista**.
2. Informe **nome** e **CPF** (único entre motoristas ativos).
3. Preencha **CNH** (categoria e validade) — CNH vencida impede autorização plena e pode bloquear retirada conforme configuração.
4. Defina **status** (`PENDING`, `AUTHORIZED`, etc.).
5. Salve.

Motoristas **bloqueados** não devem ser usados em novas reservas.

**Carga em massa:** em **Configurações**, quem tem `fleet.manage` pode importar CSV de motoristas (preview antes de aplicar).

---

## Como reservar um veículo

**Quem pode:** `fleet.reservations.create` ou `fleet.manage`.

1. Aba **Agenda / Reservas**.
2. **Nova reserva**: escolha veículo, motorista (se necessário), data/hora início e fim, destino e motivo.
3. O sistema verifica conflito de agenda, documentos e disponibilidade do veículo.
4. Salve — a reserva nasce em **aguardando aprovação** (`PENDING_APPROVAL`).

Use **Disponibilidade** (quando a tela oferecer) para ver veículos livres no período.

---

## Como aprovar uma reserva

**Quem pode:** `fleet.reservations.approve` ou `fleet.manage`.

1. Na lista ou calendário de reservas, localize status **pendente de aprovação**.
2. Abra a reserva e use **Aprovar**.
3. Se precisar recusar, use **Rejeitar** e informe o **motivo** (obrigatório).

Após aprovação, o veículo pode aparecer como **reservado** até a retirada.

---

## Como registrar a retirada (checkout)

**Quem pode:** `fleet.reservations.create` ou `fleet.manage`.

Pode ser feito na reserva (modal) ou em **Uso em campo** (`/fleet/field`).

1. Com reserva **aprovada**, inicie **Retirada**.
2. Preencha o **checklist de saída** (todos os itens obrigatórios; itens críticos com problema bloqueiam).
3. Informe **km** de saída (deve ser coerente com o km do veículo).
4. Confirme.

A reserva passa a **em uso** e o veículo para **em uso**.

Se a configuração exigir checklist de retirada, não é possível pular esta etapa.

---

## Como registrar a devolução (checkin)

**Quem pode:** `fleet.reservations.create` ou `fleet.manage`.

1. Na reserva em uso, escolha **Devolução**.
2. Preencha checklist de **devolução** (avarias/danos podem gerar pendências).
3. Informe **km** de retorno (não pode ser menor que o km da retirada).
4. Confirme.

A reserva finaliza (`FINISHED` ou `FINISHED_WITH_PENDING` se houver pendência de avaria).

---

## Como abrir uma manutenção

**Quem pode:** `fleet.maintenance.manage` ou `fleet.manage`.

1. Aba **Manutenções** → **Nova manutenção** (ou pela ficha do veículo).
2. Selecione veículo, tipo (corretiva/preventiva), prioridade, descrição.
3. Se marcar **bloqueia veículo**, o veículo pode ir para manutenção/bloqueado no fluxo.
4. Salve.

Fluxo típico na ficha da manutenção:

- **Aprovar** (se valor exigir aprovação por limiar),
- **Iniciar**,
- **Concluir** (com data e valor final, se aplicável),
- **Gerar custo** (opcional, vincula custo ao veículo).

Manutenções canceladas exigem motivo quando configurado.

---

## Como lançar um custo

**Quem pode:** `fleet.financial.view` ou `fleet.manage` (para ver e lançar valores).

1. Aba **Custos** (ou subaba Custos no financeiro da frota).
2. **Novo custo**: veículo, tipo, valor, data, competência (mês `AAAA-MM`).
3. Salve.

Também é possível gerar custo a partir de **abastecimento** (automático por padrão) ou **manutenção** (ação gerar custo).

Custos **cancelados** permanecem no histórico, mas não entram nos totais do dashboard.

---

## Multas e ocorrências (resumo)

Na aba **Ocorrências** / financeiro:

- **Multa:** veículo, data, valor, status (recebida, paga, contestada…).
- **Sinistro/ocorrência:** descrição, gravidade; sinistros graves podem **bloquear** o veículo e sugerir abertura de manutenção.

Mesmas regras de permissão financeira para visualizar valores.

---

## Como interpretar o dashboard e alertas

**Dashboard** (aba inicial):

- **Operação:** totais de veículos por situação, reservas do dia, atrasadas.
- **Conformidade:** documentos e CNHs vencidos/vencendo, contratos, manutenções abertas, multas e sinistros pendentes.
- **Financeiro do mês:** custo total e custo/km da competência atual (se tiver permissão).

**Alertas** (lista no dashboard):

| Tipo comum | Significado prático |
|------------|---------------------|
| Documento vencido/vencendo | Renovar na ficha do veículo |
| CNH vencida/vencendo | Atualizar motorista ou bloquear uso |
| Contrato vencido | Renovar ou devolver veículo |
| Reserva atrasada | Motorista não devolveu no prazo |
| Manutenção / preventiva | Tratar ordem de serviço |
| Pagamento / custo | Alertas financeiros (só para quem tem permissão financeira) |

Cores: crítico (vermelho) exige ação imediata; aviso (âmbar) é preventivo.

O dashboard atualiza periodicamente na tela; para integrações externas use `GET /api/fleet/alerts`.

---

## Relatórios e exportação

Aba **Relatórios**: escolha tipo (frota, uso, custos, manutenção, documentos), filtros de período e exporte **CSV** quando disponível.

Listagens longas na API usam paginação (`page`, `limit`); na UI, use filtros para refinar antes de exportar.

---

## Configurações do módulo

Aba **Configurações** (`fleet.settings.manage` para salvar):

- Bloquear reserva com documento vencido.
- Bloquear retirada com CNH vencida.
- Obrigatoriedade de checklists.
- Dias de antecedência para alertas de documento e CNH.

Sem permissão de configuração, os campos aparecem somente leitura.

---

## Importação inicial (CSV)

Para muitos veículos ou motoristas de uma vez (equipe com `fleet.manage`):

1. **Configurações** → seção de importação.
2. Envie CSV UTF-8 (separador `;` ou `,`).
3. Execute **Preview** — corrija erros por linha no relatório.
4. Confirme **Apply** com o texto de confirmação exigido.

Não sobrescreve cadastros existentes sem marcar opção explícita de atualização.

---

## Onde buscar ajuda técnica

- Documentação técnica: [README.md](./README.md)
- Permissões: [../FLEET_PERMISSIONS.md](../FLEET_PERMISSIONS.md)
- Funcionalidades futuras: [backlog-futuro.md](./backlog-futuro.md)
