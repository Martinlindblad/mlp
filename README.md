# Martin Lindblad Portfolio

Self-hosted Next.js portfolio application for `martin-lindblad.com`.

The production target is a Debian 13 VM running Docker Compose, PostgreSQL,
Caddy, and redundant Cloudflare Tunnel connectors. The application is packaged
as immutable Docker images and published to GHCR; public ingress goes through
Cloudflare, not a platform-hosted deployment.

## Runtime architecture

- Frontend and API: one Next.js standalone server container.
- Database: PostgreSQL 18.4 with least-privilege app, migrator, and backup roles.
- Ingress: Caddy behind Cloudflare Tunnel, with no published app/database ports.
- Operations: root-owned VM wrappers in `ops/` for compose, deploy, migration,
  backup, restore testing, status, and contact maintenance mode.
- Contact durability: accepted contact messages are projected into PostgreSQL
  and journaled to the approved encrypted Cloudflare R2 contact journal.

## Local development

Use the pinned toolchain:

```bash
corepack enable
corepack prepare yarn@1.22.22 --activate
yarn install --frozen-lockfile --non-interactive
yarn dev
```

Useful checks:

```bash
yarn typecheck
yarn test:unit
yarn build:production
yarn build:migration
```

PostgreSQL integration tests require a real PostgreSQL server and
`TEST_DATABASE_URL`.

## Production deployment

Production deployment is VM-based:

1. Publish verified linux/amd64 images with `.github/workflows/publish-image.yml`.
2. Install the exact digest-qualified image references into `/etc/mlp/env/*.env`.
3. Store secrets as root-owned mode `0600` files below `/etc/mlp/secrets`.
4. Run the reviewed VM wrappers, primarily `mlp-compose`, `mlp-migration`, and
   `mlp-deploy`.
5. Route public traffic through Cloudflare Tunnel after the migration gates pass.

Do not put runtime secrets in Git, image layers, command arguments, or logs.

## Migration status

This branch is moving the portfolio away from the previous hosted database and
platform setup. Old providers remain untouched until the VM deployment,
PostgreSQL migration, backup/restore proof, Cloudflare cutover, and observation
gates have passed.
