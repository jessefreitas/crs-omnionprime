# CRS — OmnionPrime

Snapshot versionado do serviço que roda em **https://crs.omnionprime.com.br** (`/admin-next/dashboard`).

Este é o **estado real em produção** — extraído diretamente do container `crs` em
`2026-06-29`, **com os patches de runtime já aplicados** ao `src/`. Não é um clone limpo
do upstream: é "a verdade que roda".

## Base

- **Projeto upstream:** [`Wei-Shaw/claude-relay-service`](https://github.com/Wei-Shaw/claude-relay-service)
- **Versão:** `1.1.303` (ver `VERSION`)
- **Stack:** Node.js 20 + Redis 7 · backend em `src/` · painel admin (Vue 3 + Vite) em `web/admin-spa/`

## Customizações OmnionPrime (sobre o upstream)

| Arquivo | O que faz |
|---|---|
| `data/crs_patch.js` | Conserta o proxy Gemini do CRS (issue Wei-Shaw #995 — `ensureValidToken` ausente + `projectId` vazio em accounts `gemini-cli`). **Já aplicado** ao `src/` deste snapshot. |
| `data/crs_patch.py` | Variante Python do patch acima. |
| `data/add_gpt55.js` | Insere os modelos `gpt-5.5` / `gpt-5.5-codex` em `src/services/modelService.js`. **Já aplicado.** |

> O patch original (com instruções de aplicação) também vive em
> `Projetos/RelayAPI/patches/crs-gemini-fix/` (repo `auth-relay`).

## O que **não** está aqui (secrets — propositalmente excluídos)

- Variáveis de ambiente do container (`ADMIN_PASSWORD`, `ENCRYPTION_KEY`, `JWT_SECRET`, `REDIS_PASSWORD`, …) → use `.env.example` como referência.
- `data/init.json` — usuário admin + hash de senha.
- Tokens OAuth e API keys dos tenants → vivem no **Redis**, nunca em arquivo.
- `node_modules/`, `logs/`, `temp/`, `data/model_pricing.json` (regenerável via `npm run update:pricing`).

## Rodar localmente

```bash
cp .env.example .env          # preencher ADMIN_*, ENCRYPTION_KEY, JWT_SECRET, REDIS_*
npm install
npm run install:web && npm run build:web   # build do painel admin
npm start                     # src/app.js (porta padrão 3000)
```

Redis é obrigatório (`REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`).

## Arquitetura no cluster OmnionPrime

```
Cloudflare ──> relay.omnionprime.com.br  (auth-relay: GitHub OAuth + quota)  ──┐
                                                                               ├─> CRS (este projeto)
direto ──────> crs.omnionprime.com.br    (este serviço, container `crs`)  ─────┘     + crs-redis
```

VPS EspaçoVIP `45.227.112.46` · Portainer `portainer.omnionprime.com.br` (endpoint 3) · container `crs`.

## Atualizar o snapshot a partir da produção

Reextrair `/app` do container (sem `node_modules`, `logs`, `temp`, `data/init.json`, `data/model_pricing.json`) via SSH/`tar -T` e commitar o diff.
