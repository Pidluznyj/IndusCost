# Runbook — superfície pública da Satisfação

Configuração externa necessária para o cliente responder pela Internet.
**Nada aqui foi aplicado** — Cloudflare, DNS, nginx, AWS e Tailscale seguem
intocados. Este documento é o roteiro para quem for executar depois.

> Nenhum segredo real aparece neste arquivo. Onde houver `<...>`, substitua no
> ambiente de destino, nunca aqui.

---

## 1. Desenho

```
Internet
   │
   ▼
Cloudflare (WAF + Turnstile + rate limit de borda)
   │
   ▼
satisfacao.<dominio>            ← hostname público, separado do administrativo
   │
   ▼
Túnel / gateway público          ← allowlist de paths (1ª barreira)
   │
   ▼
IndusCost (Node :3000)
   │
   ├── Public Host Guard          ← 2ª barreira, dentro do Node
   ├── /r  → bundle público isolado
   └── /api/public/satisfaction/* → 4 endpoints
```

O hostname administrativo continua separado e protegido. **Não** exponha
`AWS_PUBLIC_IP:3000` diretamente.

---

## 2. Allowlist do gateway

Encaminhar **somente**:

```
/r
/assets/*
/favicon.ico
/robots.txt
/api/public/satisfaction/session
/api/public/satisfaction/form
/api/public/satisfaction/draft
/api/public/satisfaction/submit
```

Todo o resto → `404` (não `403`: não confirmamos a existência da aplicação
interna).

### Exemplo conceitual de nginx

```nginx
# Ilustrativo. Adapte ao padrão real do ambiente antes de aplicar.
server {
  server_name satisfacao.<dominio>;

  add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
  add_header Referrer-Policy "no-referrer" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header Content-Security-Policy
    "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com" always;
  add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;

  location = /r                          { proxy_pass http://127.0.0.1:3000; }
  location ^~ /assets/                   { proxy_pass http://127.0.0.1:3000; }
  location = /favicon.ico                { proxy_pass http://127.0.0.1:3000; }
  location = /robots.txt                 { proxy_pass http://127.0.0.1:3000; }
  location ^~ /api/public/satisfaction/  {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;          # o guard do Node decide pelo Host
  }

  location / { return 404; }              # deny por padrão
}
```

`proxy_set_header Host $host` é essencial: é pelo `Host` que o guard do Node
reconhece a superfície pública.

---

## 3. Variáveis de ambiente

| Variável | Papel |
|---|---|
| `SATISFACTION_PUBLIC_HOSTS` | Hosts públicos, separados por vírgula, sem porta. Ativa o guard. |
| `SATISFACTION_PUBLIC_BASE_URL` | Base do link enviado ao cliente (`https://satisfacao.<dominio>`). |
| `SATISFACTION_PUBLIC_SURFACE_HEADER` | Opcional: header dedicado que o gateway define. |
| `SATISFACTION_TRUST_PROXY` | `1` só quando houver proxy próprio na frente (chave do rate limit). |
| `SATISFACTION_TURNSTILE_SITE_KEY` | Site key do widget. |
| `SATISFACTION_TURNSTILE_SECRET_KEY` | Secret do siteverify. **Preenchê-lo torna a proteção obrigatória.** |
| `SATISFACTION_TURNSTILE_MODE` | `disabled` desliga explicitamente (homologação sem key). |
| `SATISFACTION_TURNSTILE_DEV_BYPASS` | Bypass de desenvolvimento — **ignorado em produção**. |

Sem `SATISFACTION_PUBLIC_HOSTS` o guard fica inativo e o app interno segue
normal — é o comportamento correto para o ambiente administrativo, mas em
produção pública a variável é obrigatória.

---

## 4. Turnstile

1. Criar o site no painel Cloudflare para `satisfacao.<dominio>`.
2. Guardar site key e secret no gerenciador de segredos do ambiente.
3. Preencher as variáveis e reiniciar o processo Node.
4. Conferir que o widget aparece em `/r` e que um submit sem desafio é recusado.

A validação é **sempre server-side** (siteverify) e acontece **antes** de
qualquer persistência de `SUBMITTED`. Falha de rede no siteverify resulta em
recusa — indisponibilidade não vira permissão.

---

## 5. Rate limit

Aplicacional (in-memory, por processo), já no código:

| Bucket | Janela | Máximo |
|---|---|---|
| `session` | 60s | 20 |
| `draft` | 60s | 60 |
| `submit` | 300s | 10 |

Complementar na borda do Cloudflare com regra por IP em
`/api/public/satisfaction/submit`. Os limites acima são generosos para o
cliente legítimo — que responde uma pesquisa curta, uma vez.

---

## 6. Ordem de homologação

1. Aplicar a migration `20260913120000_commercial_customer_satisfaction`.
2. Conferir que o template V1 foi semeado (12 perguntas).
3. Definir as variáveis de ambiente e reiniciar o Node.
4. Configurar o hostname e a allowlist do gateway.
5. Configurar o Turnstile.
6. Rodar os smoke tests abaixo.

---

## 7. Smoke tests

Substitua `<host>` pelo hostname público.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/r
```
Esperado: `200`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/api/auth/me
```
Esperado: `404`.

Repetir e esperar `404` em: `/login`, `/api/users`, `/api/customers`,
`/api/sales-orders`, `/api/finance`, `/api/inventory`, `/api/admin`.

```bash
curl -s -D- -o /dev/null https://<host>/r | grep -i -E 'x-robots-tag|cache-control|referrer-policy'
```
Esperado: `noindex, nofollow, noarchive`, `no-store`, `no-referrer`.

Token inválido não deve criar sessão:
```bash
curl -s -X POST https://<host>/api/public/satisfaction/session -H 'Content-Type: application/json' -d '{"token":"invalido"}'
```
Esperado: `{"ok":false,"reason":"INVALID",...}`.

---

## 8. Testes manuais no dispositivo real

- Abrir o link individual em **celular** e em **tablet**.
- Preencher parcialmente, fechar o navegador, reabrir o mesmo link → o rascunho
  volta.
- Enviar. Reenviar o mesmo link → deve mostrar "suas respostas já foram
  registradas", **não** erro.
- Conferir que o menu do IndusCost não aparece em nenhum momento.
- Conferir que a escala 1–5 mostra o rótulo (Ruim…Excelente), não só o número.

---

## 9. Rollback lógico

O módulo é aditivo: nenhuma tabela existente foi alterada.

- **Desligar a superfície pública**: limpar `SATISFACTION_PUBLIC_HOSTS` e
  remover o hostname do gateway. O módulo administrativo continua funcionando.
- **Revogar acesso**: revogar os convites (invalida os links na hora) ou
  encerrar a campanha.
- **Reverter código**: `git revert` do merge. As tabelas ficam órfãs mas
  inertes; nenhum domínio existente depende delas.

---

## 10. Pendências externas (não aplicadas)

- [ ] Hostname `satisfacao.<dominio>` no Cloudflare
- [ ] Rota do túnel / gateway público
- [ ] Allowlist e deny padrão no nginx
- [ ] Site e secret do Turnstile
- [ ] Variáveis de ambiente no servidor
- [ ] Regra de rate limit na borda
