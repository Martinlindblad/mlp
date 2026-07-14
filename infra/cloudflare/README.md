# Cloudflare Tunnel production route contract

Create one remotely managed tunnel named `mlp-prod`. Both connector containers
use the same root-only `cloudflare-tunnel-token` secret; the token is never a
service environment value or command argument.

Configure public hostname routes in this exact order:

1. `martin-lindblad.com` -> `http://caddy:8080`
2. `www.martin-lindblad.com` -> `http://caddy:8080`
3. `migration.martin-lindblad.com` -> `http://caddy:8080`
4. Final catch-all -> HTTP 404

Cloudflare Access applies only to `migration.martin-lindblad.com` and the
approved operator identity. Do not place Access in front of the apex or `www`.
The two connectors share the tunnel token and provide connector redundancy,
not VM high availability.

The tunnel is outbound-only. Do not publish Caddy, Next.js, or PostgreSQL host
ports. Enable HSTS at Cloudflare only after Task 13 verifies public TLS,
redirects, routing, and rollback behavior.
