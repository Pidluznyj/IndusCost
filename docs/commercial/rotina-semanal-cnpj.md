# Rotina semanal de CNPJ

A consulta reutiliza o agregador já existente (`BrasilAPI` + `publica.cnpj.ws`). O Banco Central permanece `not_applicable`. O resultado entra em `CustomerCnpjLookup`, com histórico próprio de execução, alteração e divergência. Cliente, fornecedor e títulos do Nomus não são atualizados. O score recalculado é só cadastral: boleto vencido ou protesto pendente continua bloqueando venda a prazo.

## Agenda

- Job `cnpj-weekly-refresh`
- Cron `0 8 * * 0`
- Fuso `America/Sao_Paulo`
- O mesmo scheduler interno dos demais jobs, com tick de 60 segundos
- Uma execução `RUNNING` por vez, com retomada se o heartbeat passar de 3 minutos
- Domingo seguinte não repete CNPJ já concluído na mesma execução

A flag nasce desligada. Ligar no ambiente só depois da migration e de um volume pequeno.

```text
CNPJ_WEEKLY_REFRESH_ENABLED=true
CNPJ_WEEKLY_REFRESH_MIN_INTERVAL_MS=3000
CNPJ_WEEKLY_REFRESH_TIMEOUT_MS=15000
CNPJ_WEEKLY_REFRESH_MAX_RETRIES=3
CNPJ_WEEKLY_REFRESH_MAX_ITEMS=5
```

`MAX_ITEMS` limita a homologação. Remover essa variável para a carga completa. Com a flag ligada no meio da semana, a execução daquele domingo é retomada ou iniciada, sem esperar o domingo seguinte.

## Permissões

- `settings.cnpj_weekly_refresh.view` acompanha a rotina em Configurações → Integrações
- `settings.cnpj_weekly_refresh.manage` executa agora e reprocessa falhas
- Vendedor sem essa chave não dispara a carga

## Implantação

1. Publicar o código pelo fluxo oficial do IndusCost.
2. Aplicar a migration aditiva `20261024120000_cnpj_weekly_refresh` em homologação.
3. Conceder as duas permissões a um administrador.
4. Ligar a flag com `MAX_ITEMS=5` e conferir o painel.
5. Remover `MAX_ITEMS` somente depois dessa amostra.
6. Não apontar o teste para a base de produção.

Rollback do aplicativo: desligar `CNPJ_WEEKLY_REFRESH_ENABLED`. As tabelas novas podem permanecer. Não desfazer a migration no primeiro rollback e não alterar tabelas do Nomus.
