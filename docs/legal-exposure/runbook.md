# Exposure — runbook

Nenhum passo de homologação ou produção abaixo foi executado por este trabalho.

## LOCAL DEVELOPMENT

Flags padrão desligadas. Testes usam fixture e `fetch` falso.

```text
npm run test:legal-exposure
npm run legal:exposure:health
npm run legal:exposure:sync:preview
npm run legal:exposure:datajud:probe
```

O preview e o health não chamam fonte externa. O probe, sem `--confirm-probe=DATAJUD_PROBE`, termina sem rede.

A migration `prisma/migrations/20260929200000_legal_exposure` foi escrita e não aplicada.

## SERVER/HOMOLOGATION

Executar só depois da revisão do diff, no servidor autorizado, uma fase por vez. Parar e ler a saída antes da fase seguinte.

1. Conferir o checkout e que não é produção.
2. Conferir `DATABASE_URL` do banco de homologação, sem imprimir a URL.
3. `npx prisma migrate status`
4. Revisar o SQL da migration.
5. Aplicar pelo fluxo oficial de migration de homologação.
6. Preencher as variáveis de ambiente com as flags ainda em `0`.
7. `npm run legal:exposure:health`
8. `npm run legal:exposure:sync:preview`
9. Probe DataJud somente com confirmação explícita e tribunal informado.
10. Ligar uma fonte por vez e testar conexão read-only.
11. Só então considerar `--apply` com `--confirm-apply=LEGAL_EXPOSURE_APPLY`.
12. Agendar cron/systemd com as frequências abaixo.
13. Abrir `/exposure` em homologação com um usuário que tenha `legal.exposure.view` e com outro que só tenha `settings.view`.

## PRODUCTION

Não executar neste ciclo. Produção só depois de homologação aceita e autorização explícita. Repetir os gates de homologação contra o banco e o host de produção, com janela e rollback de código — a migration é aditiva e não deve ser revertida com DROP.

## Frequência recomendada

Não instalada.

```text
Domicílio: 15 minutos
Domicílio, processos conhecidos: 1 hora
DJEN: 1 hora
DataJud, descoberta: 4 horas (continua bloqueada até o probe)
DataJud, processos conhecidos: 2 horas
health: 15 minutos
```

Exemplo, não aplicado:

```text
*/15 * * * * cd /opt/induscost && npm run legal:exposure:domicilio:preview
0 * * * * cd /opt/induscost && npm run legal:exposure:djen:preview
```

Apply em cron só depois do preview homologado.
