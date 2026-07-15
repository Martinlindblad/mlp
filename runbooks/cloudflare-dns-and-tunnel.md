# Cloudflare DNS authority and tunnel runbook

This runbook separates the authoritative-DNS transfer from the application
cutover. During this task, Vercel continues serving the apex and `www`; do not
change Vercel, registrar, Cloudflare, or production VM state from an unapproved
automation. Two operators should record the command, UTC time, result, and
redacted evidence for every gate below.

## 1. Inventory Vercel DNS before creating the zone

Create `migration-artifacts/dns/` with mode `0700`. It is ignored by Git. Save
a Vercel export and an independent authoritative `dig` capture for every
record type. The inventory must include every apex, subdomain, MX, TXT, CAA,
and verification record, including name, type, TTL, priority, and target. The
full ignored inventory may retain values needed for comparison, but redact any
secret verification payload from a committed report, ticket, terminal paste,
or review comment.

Normalize non-NS records into a root-readable canonical set. Compare the
Vercel authoritative capture with a fresh Cloudflare export after cloning the
zone. The machine-readable comparison file is
`/var/lib/mlp/dns-inventory-comparison.json`, owned by `root:root` with mode
`0600`, and has this contract:

```json
{
  "status": "matched",
  "sourceNonNsCount": 3,
  "sourceNonNsRecords": [
    "martin-lindblad.com.\tA\t300\t-\t76.76.21.21",
    "martin-lindblad.com.\tCAA\t300\t-\t0 issue \"letsencrypt.org\"",
    "www.martin-lindblad.com.\tCNAME\t300\t-\tcname.vercel-dns.com."
  ],
  "sourceNonNsDigest": "d57a23b6817d05095e6f2e40fb7f0b4ff4bc70dd7f7ec2c47509b6a12acfdf0f",
  "matchedNonNsCount": 3,
  "matchedNonNsRecords": [
    "martin-lindblad.com.\tA\t300\t-\t76.76.21.21",
    "martin-lindblad.com.\tCAA\t300\t-\t0 issue \"letsencrypt.org\"",
    "www.martin-lindblad.com.\tCNAME\t300\t-\tcname.vercel-dns.com."
  ],
  "matchedNonNsDigest": "d57a23b6817d05095e6f2e40fb7f0b4ff4bc70dd7f7ec2c47509b6a12acfdf0f",
  "missingNonNsRecords": [],
  "missingMailOrVerificationRecords": []
}
```

The records and counts are examples, not production values. Encode each
canonical record as
`fqdn<TAB>TYPE<TAB>TTL<TAB>priority-or--<TAB>target`. Both arrays must be the
same lexically sorted, duplicate-free set, both counts must be strictly
positive and equal to their array length, and both digests must be SHA-256 of
the compact JSON array with no trailing newline. The gate recomputes both
digests instead of trusting the report fields. Any missing non-NS record,
including any mail or verification record, blocks the registrar change. Do
not treat Cloudflare-created NS records as missing source records.

Create the Cloudflare zone in the account that will own the production
tunnel. Clone every source record. Keep `martin-lindblad.com` and
`www.martin-lindblad.com` on their verified Vercel targets and set them to
DNS-only while authority moves. Set each application-record TTL to exactly
300 seconds at least 24 hours before application cutover.

Capture the still-working application origin as canonical TSV in
`/etc/mlp/vercel-origin-records.tsv`, `root:root` mode `0600`:

The `\t` markers below mean literal tab characters; do not write a backslash
followed by `t` into the file.

```text
martin-lindblad.com.\tA\t76.76.21.21
martin-lindblad.com.\tAAAA\t-
martin-lindblad.com.\tCNAME\t-
www.martin-lindblad.com.\tA\t-
www.martin-lindblad.com.\tAAAA\t-
www.martin-lindblad.com.\tCNAME\tcname.vercel-dns.com.
```

Replace the example answers with the observed records. Use one row per DNS
answer and one `-` row for each expected absence. Every apex and `www`
combination of `A`, `AAAA`, and `CNAME` must therefore be explicit. Never mix
`-` with a present answer for the same name/type. Keep names and CNAME targets
lower-case and fully qualified. Store the two assigned Cloudflare nameservers,
lower-case and fully qualified, one per line in
`/etc/mlp/cloudflare-nameservers`, also `root:root` mode `0600`.

## 2. Change only the registrar delegation

After a second operator verifies the complete comparison, change only the
registrar delegation to the two Cloudflare nameservers. Do not change the apex
or `www` application targets. Vercel must continue serving the application
throughout the hold.

Run this gate every few hours:

```bash
sudo EXPECTED_NS_FILE=/etc/mlp/cloudflare-nameservers \
  ORIGIN_EXPECTATIONS_FILE=/etc/mlp/vercel-origin-records.tsv \
  INVENTORY_REPORT_FILE=/var/lib/mlp/dns-inventory-comparison.json \
  scripts/acceptance/dns-authority.sh martin-lindblad.com
curl --fail --silent --show-error https://martin-lindblad.com >/dev/null
```

The script checks `1.1.1.1`, `8.8.8.8`, and `9.9.9.9` for the exact assigned
nameservers, a Cloudflare SOA, the exact Vercel apex/`www` answers, and the
complete inventory report. Its first complete pass atomically creates
the fixed `/var/lib/mlp/cloudflare-authority-start`; callers cannot override
that path. The state stores the start time plus a baseline fingerprint derived
from the canonical zone, nameservers, complete origin matrix, and verified
inventory digest. A changed baseline fingerprint restarts the hold at zero. It
exits 75 and prints elapsed and remaining seconds until 172800 seconds (48
hours) have passed. Any observed DNS, origin, or inventory mismatch removes
that state and restarts the hold. Exit 0 with
`authority stable for at least 172800 seconds` is the only authority approval.
Preserve the command outputs as redacted evidence.

Do not route application traffic to the tunnel until the script has exited 0,
the application TTL has been 300 for at least 24 hours, and Vercel still
serves both application hostnames.

## 3. Create the remote-managed production tunnel

In the same Cloudflare account, create one remotely managed tunnel named
exactly `mlp-prod`. Configure its ingress in this exact order:

```yaml
ingress:
  - hostname: migration.martin-lindblad.com
    service: http://caddy:8080
  - hostname: martin-lindblad.com
    service: http://caddy:8080
  - hostname: www.martin-lindblad.com
    service: http://caddy:8080
  - service: http_status:404
```

Cloudflare Access applies only to `migration.martin-lindblad.com`. Create a
self-hosted application and an allow policy for the approved operator
identity. Do not put Access in front of the apex or `www`. Create a temporary
Access service token only for automated migration checks.

Write the tunnel token directly to
`/etc/mlp/secrets/cloudflare-tunnel-token`; never place it on a command line,
in shell history, Git, a ticket, or a log. The token and every file below must
be `root:root` mode `0600`, below root-owned mode-`0700` directories:

- `/etc/mlp/cloudflare-account-id`
- `/etc/mlp/cloudflare-tunnel-id`
- `/etc/mlp/secrets/cloudflare-api-read-token`
- `/etc/mlp/secrets/cloudflare-access-client-id`
- `/etc/mlp/secrets/cloudflare-access-client-secret`

The API credential is a least-privilege, read-only API token limited to the
production account's Cloudflare Tunnel read permission. It exists only so the
gate can prove the remote-managed tunnel name, status, exact ingress, final
catch-all, and two distinct live connector identities. Do not use a global API
key. The Access credential is the temporary service token, not the operator's
interactive login.

Start Caddy, `cloudflared-a`, and `cloudflared-b` through the fixed root
Compose wrapper. Wait for both container health checks and the Cloudflare
dashboard to show two distinct connected connector replicas. The duplicate
connectors improve connector availability only; the single VM is still a
single point of failure.

## 4. Run the tunnel and Access gate

Run:

```bash
sudo scripts/acceptance/tunnel-health.sh
```

The script performs read-only checks. It requires exactly the two expected
local connectors, both healthy; exactly two distinct live connector identities
from the Cloudflare API; exactly one non-deleted tunnel named `mlp-prod` whose
ID matches the stored tunnel ID; the remote `mlp-prod` ingress above with no
extra behavior-changing keys and final `http_status:404`; an unauthenticated
Access redirect; authenticated readiness status 200; and no app, Caddy, or
PostgreSQL host port. API and Access secrets are passed to `curl` through
root-only temporary header files, never command arguments or output.

Then prove failover serially. Never stop both connectors together. For each
failover probe, assemble the two value-only Access secrets into a root-only
temporary header file with tracing disabled, pass it to `curl` as
`--header @file`, and remove it with a trap. Never put either secret value in
command arguments, output, or shell history.

```bash
sudo /usr/local/sbin/mlp-compose stop cloudflared-a
# From a protected operator shell, send the two CF-Access service-token
# headers and require status 200 from the migration readiness URL.
sudo /usr/local/sbin/mlp-compose start cloudflared-a
sudo scripts/acceptance/tunnel-health.sh

sudo /usr/local/sbin/mlp-compose stop cloudflared-b
# Repeat the authenticated readiness check and require status 200.
sudo /usr/local/sbin/mlp-compose start cloudflared-b
sudo scripts/acceptance/tunnel-health.sh
```

Restore `cloudflared-a` to healthy and confirm it before stopping
`cloudflared-b`; restore `cloudflared-b` before leaving the procedure. Record
both public 200 results and the final successful gate. Confirm separately that
`ss -ltnup` shows no new public listener and that Docker publishes no app,
Caddy, or PostgreSQL host port.

## 5. Stop conditions and cleanup

Stop immediately on any inventory mismatch, resolver mismatch, non-Cloudflare
SOA, changed Vercel origin answer, Access bypass, connector count other than
two, unhealthy connector, remote ingress difference, published origin port,
or failed authenticated readiness probe. Do not compensate by proxying the
old origin, weakening Access, or shortening the hold.

After cutover acceptance and the required observation period, remove the
temporary migration DNS/tunnel hostname and Access application. Revoke the
temporary Access service token and the read-only API token, remove their local
files, and preserve only redacted gate evidence. Tunnel token removal follows
the later decommission plan, not this runbook.
