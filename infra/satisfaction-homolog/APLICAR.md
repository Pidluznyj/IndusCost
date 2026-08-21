# Superfície pública de HOMOLOGAÇÃO da Satisfação — procedimento de aplicação

Roteiro para quem tiver acesso a **servidor-01**, à **AWS** e ao painel
**Cloudflare**. Cada passo traz backup, validação e critério de aceite.

> **Estado dos gates de código (verificado em `origin/main` = `dbc5029`):**
> `navigationGroups` 13/13 · `satisfaction` 172/172 · `collector/inventory` 500/500.
> O bloqueio que derrubou a tentativa anterior (`69e408e`) está resolvido — o
> deploy de homologação está liberado do ponto de vista de testes.

> Nenhum segredo aparece neste documento. Onde houver `<...>`, o valor vem do
> gerenciador de segredos do ambiente.

---

## Arquitetura alvo

```
Internet
  → Cloudflare (TLS na borda, proxy ativo, SEM Access neste hostname)
  → satisfacao-homolog.grupolazarios.com.br
  → Cloudflare Tunnel JÁ EXISTENTE na AWS
  → Tailscale (AWS 100.85.97.124 → servidor-01 100.64.174.124)
  → Nginx dedicado  100.64.174.124:8443     ← allowlist estrita
  → 127.0.0.1:3001  (IndusCost homologação)
  → Public Host Guard do Node               ← segunda barreira
  → /r · /assets/* · /favicon.ico · /robots.txt · /api/public/satisfaction/*
```

Nenhuma porta é aberta para a Internet. O listener existe apenas no endereço
Tailscale e só aceita o nó da AWS.

---

## Ordem de execução

A ordem importa e é deliberada:

1. **Deploy primeiro** — o código com o módulo precisa estar no ar.
2. **Variáveis logo em seguida** — assim o Public Host Guard do Node já está
   ativo *antes* de qualquer coisa ficar alcançável de fora. Definir
   `SATISFACTION_PUBLIC_HOSTS` não afeta o tráfego existente: o guard só
   reage ao `Host` público, que ainda não é roteado.
3. **Nginx depois** — a primeira barreira já nasce apontando para um Node
   que sabe se defender.
4. **Tunnel e Access por último** — a exposição externa é o passo final,
   quando as duas barreiras já estão de pé (§37, falhar fechado).

### Passo 0 — Deploy da homologação

```bash
# no servidor de homologação
cd /opt/induscost   # ou o caminho oficial da homologação
git fetch origin && git log -1 --oneline origin/main   # deve ser dbc5029 ou posterior
induscost-deploy-homologacao
```

O script oficial já executa gates, backup, testes, migrations, build e rollback.
**Não reproduza o deploy manualmente.** Se falhar, pare e analise — não altere o
servidor para mascarar o erro.

**Aceite:** deploy PASS, migration `20260913120000_commercial_customer_satisfaction`
aplicada, 11 tabelas criadas, template V1 semeado com 12 perguntas.

```bash
# conferência da migration (sem expor DATABASE_URL)
sudo -u postgres psql -d teste_bi_homolog -c "\dt \"Satisfaction*\""
sudo -u postgres psql -d teste_bi_homolog -c "SELECT code, version, \"isLocked\" FROM \"SatisfactionSurveyTemplate\";"
sudo -u postgres psql -d teste_bi_homolog -c "SELECT count(*) FROM \"SatisfactionSurveyQuestion\";"
```

---

### Passo 1 — Variáveis de ambiente (servidor-01)

Só depois do Passo 0 concluído. Aplicar **antes** de expor o hostname: com o guard já ativo, não existe janela em que a superfície pública responda sem ele.

```bash
sudo mkdir -p /etc/systemd/system/induscost-homolog.service.d
sudo cp infra/satisfaction-homolog/systemd/98-satisfaction-public.conf \
        /etc/systemd/system/induscost-homolog.service.d/98-satisfaction-public.conf
sudo systemctl daemon-reload
sudo systemctl restart induscost-homolog
sudo systemctl status induscost-homolog --no-pager | head -12
```

Confirme que **não** existe `SATISFACTION_TURNSTILE_SECRET_KEY` definida — com
o secret presente o modo vira obrigatório e todo submit passaria a falhar,
porque o egress do serviço está bloqueado.

```bash
sudo systemctl show induscost-homolog -p Environment | tr ' ' '\n' | grep -i satisfaction
```

**Aceite:** as 6 variáveis presentes, nenhuma chave de Turnstile.

---

### Passo 2 — Nginx dedicado (servidor-01)

```bash
# 1.1 conferir que a porta escolhida está livre no IP Tailscale
sudo ss -lntp | grep -E '100\.64\.174\.124|:8443' || echo "8443 livre"

# 1.2 instalar o arquivo (não existe hoje; nada a sobrescrever)
sudo cp infra/satisfaction-homolog/nginx/induscost-satisfaction-homolog.conf \
        /etc/nginx/sites-available/induscost-satisfaction-homolog

# 1.3 backup do estado atual do Nginx ANTES de habilitar
sudo tar czf /root/backup-nginx-$(date +%Y%m%d-%H%M%S).tgz /etc/nginx/sites-available /etc/nginx/sites-enabled

# 1.4 habilitar
sudo ln -s /etc/nginx/sites-available/induscost-satisfaction-homolog \
           /etc/nginx/sites-enabled/induscost-satisfaction-homolog

# 1.5 VALIDAR antes de qualquer reload — se falhar, NÃO recarregue
sudo nginx -t

# 1.6 só então
sudo systemctl reload nginx
```

> Se a porta 8443 estiver ocupada, escolha outra livre e ajuste **os dois**
> lados: o `listen` do Nginx e o ingress do Tunnel (passo 2).

**Aceite:** `nginx -t` PASS; Collector e gateway de produção continuam
respondendo (ver Passo 5).

---

### Passo 3 — Cloudflare Tunnel (na AWS)

Auditar **antes** de mudar:

```bash
# na AWS
systemctl status cloudflared --no-pager | head -20
cloudflared --version
cloudflared tunnel list
# NÃO imprima credentials-file, token nem cert.pem
```

Descubra o modo de gerenciamento:

- **Dashboard-managed** (token): adicione o Public Hostname pelo painel
  Zero Trust → Networks → Tunnels → *(tunnel existente)* → Public Hostnames:
  - Subdomain: `satisfacao-homolog`
  - Domain: `grupolazarios.com.br`
  - Service: `HTTP` → `100.64.174.124:8443`
- **config.yml-managed**: acrescente ao `ingress`, **antes** da regra catch-all:

  ```yaml
  ingress:
    # ... regras existentes do induscost.grupolazarios.com.br permanecem intactas
    - hostname: satisfacao-homolog.grupolazarios.com.br
      service: http://100.64.174.124:8443
    - service: http_status:404      # catch-all existente, sempre por último
  ```

  ```bash
  sudo cp /etc/cloudflared/config.yml /root/backup-cloudflared-config-$(date +%Y%m%d-%H%M%S).yml
  sudo cloudflared tunnel ingress validate
  sudo systemctl reload cloudflared || sudo systemctl restart cloudflared
  ```

**Não** crie registro A para IP. **Não** abra NAT/port-forward. O DNS é criado
pelo próprio mecanismo de Public Hostname do Tunnel (CNAME proxied).

**Aceite:** `cloudflared tunnel ingress validate` PASS; a regra do
`induscost.grupolazarios.com.br` permanece byte a byte igual.

---

### Passo 4 — Cloudflare Access (crítico)

O hostname da Satisfação **não pode** herdar a política do administrativo.

```
Zero Trust → Access → Applications
```

1. **Documente a política atual** do `induscost.grupolazarios.com.br`
   (nome, tipo, regras) antes de qualquer mudança.
2. Verifique se existe aplicação com **wildcard** (`*.grupolazarios.com.br`)
   que englobaria o novo hostname.
3. Se existir, a mudança mínima é criar uma aplicação **Bypass** específica para
   `satisfacao-homolog.grupolazarios.com.br` com política `Everyone`.
   Aplicações mais específicas têm precedência sobre o wildcard — o
   administrativo continua protegido sem que a regra dele seja tocada.
4. **Não** afrouxe, renomeie ou reordene a política do administrativo.

**Aceite:** `curl -I https://induscost.grupolazarios.com.br/` continua
devolvendo o desafio do Access (302/403), e
`https://satisfacao-homolog.grupolazarios.com.br/r` responde 200 sem login.

---

### Passo 5 — Smoke privado (da AWS, antes da Internet)

```bash
H='Host: satisfacao-homolog.grupolazarios.com.br'
B='http://100.64.174.124:8443'

curl -s -o /dev/null -w '%{http_code}\n' -H "$H" "$B/r"                     # 200
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" "$B/api/public/satisfaction/form"  # 200

for p in /api/auth/me /login /api/users /api/customers /api/sales-orders \
         /api/finance /api/inventory /api/admin /api/goals \
         /api/commercial/satisfaction/campaigns; do
  printf '%-45s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' -H "$H" "$B$p")"
done   # todos 404
```

Da LAN, provando que o listener **não** aceita outra origem:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" http://100.64.174.124:8443/r   # 403
```

**Aceite:** 200 nos públicos, 404 nos internos, 403 de origem não autorizada.

---

### Passo 6 — Smoke público (Internet)

```bash
B='https://satisfacao-homolog.grupolazarios.com.br'

curl -s -o /dev/null -w '%{http_code}\n' "$B/r"          # 200 — sem Access, sem login

for p in /api/auth/me /login /api/users /api/customers /api/sales-orders \
         /api/finance /api/inventory /api/admin /api/goals \
         /api/commercial/satisfaction; do
  printf '%-40s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$B$p")"
done   # todos 404 — NÃO aceitar 401, 403 nem 302 para login
```

Headers e cookie:

```bash
curl -s -D- -o /dev/null "$B/r" | grep -iE 'cache-control|x-robots-tag|referrer-policy|x-content-type'
curl -s -D- -o /dev/null -X POST "$B/api/public/satisfaction/session" \
     -H 'Content-Type: application/json' -d '{"token":"invalido"}' | grep -i set-cookie
```

Token inválido:

```bash
curl -s -X POST "$B/api/public/satisfaction/session" \
     -H 'Content-Type: application/json' -d '{"token":"invalido"}'
# esperado: {"ok":false,"reason":"INVALID","message":"Link inválido."}
```

**Aceite:** `no-store`, `noindex, nofollow, noarchive`, `no-referrer`,
`nosniff`; cookie (quando emitido) com `HttpOnly; Secure; SameSite=Strict`;
token inválido não cria sessão.

---

### Passo 7 — E2E funcional

Pelo administrativo da homologação, em **Comercial → Satisfação**:

1. Criar campanha de teste (use poucos clientes, de preferência de teste).
2. Publicar → o questionário congela e os links são emitidos.
3. Gerar link individual e abrir pelo hostname público.
4. Conferir: token some da barra de endereços; formulário carrega.
5. Responder parcialmente → fechar → reabrir o mesmo link → rascunho volta.
6. Concluir e enviar.
7. **Reenviar o mesmo submit** → deve retornar "já respondida", sem criar
   segunda resposta.
8. Dashboard reflete a resposta.

Prova no banco real:

```bash
sudo -u postgres psql -d teste_bi_homolog -c \
  "SELECT \"campaignId\", count(*) FROM \"SatisfactionSurveyResponse\" WHERE status='SUBMITTED' GROUP BY 1;"
# retry NÃO pode aumentar a contagem
```

---

## Rollback da superfície pública

Desliga o acesso externo sem tocar em dados. **A migration é aditiva e não deve
ser revertida** só para desligar a superfície.

```bash
# 1. remover o Public Hostname do Tunnel (painel) ou a regra do ingress
sudo cloudflared tunnel ingress validate && sudo systemctl reload cloudflared

# 2. desabilitar o Nginx da Satisfação
sudo rm /etc/nginx/sites-enabled/induscost-satisfaction-homolog
sudo nginx -t && sudo systemctl reload nginx

# 3. desativar a superfície no Node
sudo rm /etc/systemd/system/induscost-homolog.service.d/98-satisfaction-public.conf
sudo systemctl daemon-reload
sudo systemctl restart induscost-homolog
```

Com `SATISFACTION_PUBLIC_HOSTS` ausente o guard fica inativo e o módulo
administrativo continua funcionando normalmente. Collector e gateway de
produção não são afetados em nenhum dos passos.

---

## Verificações de não-regressão (antes e depois)

```bash
# Collector
curl -s -o /dev/null -w '%{http_code}\n' https://servidor-01.tail31eb9e.ts.net/collector/sector/raw-material

# Gateway de produção
curl -s -o /dev/null -w '%{http_code}\n' http://192.168.100.5:3000/

# Administrativo (deve continuar protegido pelo Access)
curl -s -o /dev/null -w '%{http_code}\n' https://induscost.grupolazarios.com.br/
```

Rode **antes** e **depois** de cada passo. Os três resultados têm de ser
idênticos nas duas execuções.

---

## Pendente para produção (não faz parte desta missão)

| Item | Estado |
|---|---|
| `satisfacao.grupolazarios.com.br` | NOT DEPLOYED |
| Turnstile real (site key + secret) | PENDING PRODUCTION CONFIGURATION |
| Egress mínimo para `challenges.cloudflare.com` | PENDING |
| Deploy de produção | NOT EXECUTED |
| Migration no banco de produção | NOT EXECUTED |
