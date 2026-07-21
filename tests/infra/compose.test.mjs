import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const YAML = require('yaml');

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const composePath = path.join(repositoryRoot, 'compose.production.yml');
const commandTimeoutMs = 15_000;
const runtimeTimeoutMs = 180_000;

const postgresImage =
  'postgres:18.4-alpine@sha256:' +
  '9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15';
const cloudflaredImage =
  'cloudflare/cloudflared:2026.7.1@sha256:' +
  '188bb03589a32affed3cf4d0590565ffe67b78866e6b5582574afab2b705bafe';
const placeholderAppImage = `ghcr.io/martinlindblad/mlp@sha256:${'a'.repeat(
  64,
)}`;
const placeholderBackupImage = `ghcr.io/martinlindblad/mlp-backup@sha256:${'b'.repeat(
  64,
)}`;
const placeholderCaddyImage = `ghcr.io/martinlindblad/mlp-caddy@sha256:${'c'.repeat(
  64,
)}`;

const serviceNames = [
  'app',
  'caddy',
  'cloudflared-a',
  'cloudflared-b',
  'db-backup',
  'migrator',
  'postgres',
];
const networkNames = ['database', 'egress', 'tunnel', 'web'];
const permanentServices = [
  'app',
  'caddy',
  'cloudflared-a',
  'cloudflared-b',
  'postgres',
];
const egressServices = ['app', 'cloudflared-a', 'cloudflared-b', 'db-backup'];
const secretFiles = {
  'cloudflare-tunnel-token-cloudflared-a': {
    canonical: 'cloudflare-tunnel-token',
    gid: '65532',
    target: 'cloudflare-tunnel-token',
    uid: '65532',
  },
  'cloudflare-tunnel-token-cloudflared-b': {
    canonical: 'cloudflare-tunnel-token',
    gid: '65532',
    target: 'cloudflare-tunnel-token',
    uid: '65532',
  },
  'postgres-app-password-app': {
    canonical: 'postgres-app-password',
    gid: '1000',
    target: 'postgres-app-password',
    uid: '1000',
  },
  'journal-mac-keyring-app': {
    canonical: 'journal-mac-keyring',
    gid: '1000',
    target: 'journal-mac-keyring',
    uid: '1000',
  },
  'journal-r2-access-key-id-app': {
    canonical: 'journal-r2-access-key-id',
    gid: '1000',
    target: 'journal-r2-access-key-id',
    uid: '1000',
  },
  'journal-r2-secret-access-key-app': {
    canonical: 'journal-r2-secret-access-key',
    gid: '1000',
    target: 'journal-r2-secret-access-key',
    uid: '1000',
  },
  'postgres-app-password-postgres': {
    canonical: 'postgres-app-password',
    gid: '70',
    target: 'postgres-app-password',
    uid: '70',
  },
  'postgres-backup-password-db-backup': {
    canonical: 'postgres-backup-password',
    gid: '10001',
    target: 'postgres-backup-password',
    uid: '10001',
  },
  'postgres-backup-password-postgres': {
    canonical: 'postgres-backup-password',
    gid: '70',
    target: 'postgres-backup-password',
    uid: '70',
  },
  'postgres-bootstrap-password-postgres': {
    canonical: 'postgres-bootstrap-password',
    gid: '70',
    target: 'postgres-bootstrap-password',
    uid: '70',
  },
  'postgres-migrator-password-migrator': {
    canonical: 'postgres-migrator-password',
    gid: '1000',
    target: 'postgres-migrator-password',
    uid: '1000',
  },
  'postgres-migrator-password-postgres': {
    canonical: 'postgres-migrator-password',
    gid: '70',
    target: 'postgres-migrator-password',
    uid: '70',
  },
  'restic-password-db-backup': {
    canonical: 'restic-password',
    gid: '10001',
    target: 'restic-password',
    uid: '10001',
  },
  'restic-s3-access-key-id-db-backup': {
    canonical: 'restic-s3-access-key-id',
    gid: '10001',
    target: 'restic-s3-access-key-id',
    uid: '10001',
  },
  'restic-s3-secret-access-key-db-backup': {
    canonical: 'restic-s3-secret-access-key',
    gid: '10001',
    target: 'restic-s3-secret-access-key',
    uid: '10001',
  },
};

const canonicalSecretEnvironmentVariables = {
  'cloudflare-tunnel-token': 'MLP_CLOUDFLARE_TUNNEL_TOKEN',
  'journal-mac-keyring': 'MLP_JOURNAL_MAC_KEYRING',
  'journal-r2-access-key-id': 'MLP_JOURNAL_R2_ACCESS_KEY_ID',
  'journal-r2-secret-access-key': 'MLP_JOURNAL_R2_SECRET_ACCESS_KEY',
  'postgres-app-password': 'MLP_POSTGRES_APP_PASSWORD',
  'postgres-backup-password': 'MLP_POSTGRES_BACKUP_PASSWORD',
  'postgres-bootstrap-password': 'MLP_POSTGRES_BOOTSTRAP_PASSWORD',
  'postgres-migrator-password': 'MLP_POSTGRES_MIGRATOR_PASSWORD',
  'restic-password': 'MLP_RESTIC_PASSWORD',
  'restic-s3-access-key-id': 'MLP_RESTIC_S3_ACCESS_KEY_ID',
  'restic-s3-secret-access-key': 'MLP_RESTIC_S3_SECRET_ACCESS_KEY',
};

const expectedNetworks = {
  app: ['database', 'egress', 'web'],
  caddy: ['tunnel', 'web'],
  'cloudflared-a': ['egress', 'tunnel'],
  'cloudflared-b': ['egress', 'tunnel'],
  'db-backup': ['database', 'egress'],
  migrator: ['database'],
  postgres: ['database'],
};

const expectedUsers = {
  app: '1000:1000',
  caddy: '65532:65532',
  'cloudflared-a': '65532:65532',
  'cloudflared-b': '65532:65532',
  'db-backup': '10001:10001',
  migrator: '1000:1000',
  postgres: '70:70',
};

const expectedTmpfs = {
  app: ['/app/.next/cache', '/tmp'],
  caddy: ['/config', '/data', '/tmp'],
  'cloudflared-a': [],
  'cloudflared-b': [],
  'db-backup': ['/tmp'],
  migrator: ['/tmp'],
  postgres: ['/tmp', '/var/run/postgresql'],
};

const expectedSecretMounts = {
  app: [
    ['journal-mac-keyring-app', 'journal-mac-keyring'],
    ['journal-r2-access-key-id-app', 'journal-r2-access-key-id'],
    ['journal-r2-secret-access-key-app', 'journal-r2-secret-access-key'],
    ['postgres-app-password-app', 'postgres-app-password'],
  ],
  caddy: [],
  'cloudflared-a': [
    ['cloudflare-tunnel-token-cloudflared-a', 'cloudflare-tunnel-token'],
  ],
  'cloudflared-b': [
    ['cloudflare-tunnel-token-cloudflared-b', 'cloudflare-tunnel-token'],
  ],
  'db-backup': [
    ['postgres-backup-password-db-backup', 'postgres-backup-password'],
    ['restic-password-db-backup', 'restic-password'],
    ['restic-s3-access-key-id-db-backup', 'restic-s3-access-key-id'],
    ['restic-s3-secret-access-key-db-backup', 'restic-s3-secret-access-key'],
  ],
  migrator: [
    ['postgres-migrator-password-migrator', 'postgres-migrator-password'],
  ],
  postgres: [
    ['postgres-app-password-postgres', 'postgres-app-password'],
    ['postgres-backup-password-postgres', 'postgres-backup-password'],
    ['postgres-bootstrap-password-postgres', 'postgres-bootstrap-password'],
    ['postgres-migrator-password-postgres', 'postgres-migrator-password'],
  ],
};

const postgresHealthShell =
  'PGPASSWORD="$$(cat /run/secrets/postgres-migrator-password)" exec ' +
  "psql -h 127.0.0.1 -w -X -qAt -U portfolio_migrator -d portfolio -c 'select 1' >/dev/null";

async function readRequiredText(relativePath) {
  try {
    return await readFile(path.join(repositoryRoot, relativePath), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      assert.fail(`${relativePath}: required Task 9 artifact is missing`);
    }
    throw error;
  }
}

function parseCompose(source) {
  let parsed;
  try {
    parsed = YAML.parse(source, { merge: true });
  } catch {
    assert.fail('compose.production.yml must be valid YAML');
  }
  assert.ok(
    parsed && typeof parsed === 'object' && !Array.isArray(parsed),
    'Compose root must be a mapping',
  );
  return parsed;
}

function objectKeys(value, label) {
  assert.ok(
    value && typeof value === 'object' && !Array.isArray(value),
    `${label} must be a mapping`,
  );
  return Object.keys(value).sort();
}

function serviceNetworkMap(service, serviceName) {
  assert.ok(
    service.networks &&
      typeof service.networks === 'object' &&
      !Array.isArray(service.networks),
    `${serviceName} must use explicit long-form network membership`,
  );
  return service.networks;
}

function tmpfsTargets(service) {
  if (service.tmpfs === undefined) return [];
  assert.ok(Array.isArray(service.tmpfs), 'tmpfs must use an explicit list');
  return service.tmpfs
    .map((entry) => {
      if (typeof entry === 'string') return entry.split(':', 1)[0];
      assert.ok(
        entry && typeof entry === 'object' && typeof entry.target === 'string',
        'long-form tmpfs entries require a target',
      );
      return entry.target;
    })
    .sort();
}

function secretMounts(service, serviceName) {
  if (service.secrets === undefined) return [];
  assert.ok(
    Array.isArray(service.secrets),
    `${serviceName} secrets must be a list`,
  );
  return service.secrets
    .map((secret) => {
      assert.ok(
        secret && typeof secret === 'object' && !Array.isArray(secret),
        `${serviceName} must use long-form secret mounts`,
      );
      assert.deepEqual(
        Object.keys(secret).sort(),
        ['source', 'target'],
        `${serviceName}/${secret.source} ownership must come from its reviewed host file`,
      );
      assert.equal(
        secret.target,
        secretFiles[secret.source]?.target,
        `${serviceName} secret targets must remain explicit and canonical`,
      );
      return [secret.source, secret.target];
    })
    .sort(([left], [right]) => left.localeCompare(right));
}

function filesystemMounts(service, serviceName) {
  return (service.volumes ?? []).map((mount) => {
    if (typeof mount === 'string') {
      const [source, target, ...options] = mount.split(':');
      return {
        readOnly: options.includes('ro'),
        source,
        target,
        type:
          source.startsWith('.') || source.startsWith('/') ? 'bind' : 'volume',
      };
    }
    assert.ok(
      mount && typeof mount === 'object' && !Array.isArray(mount),
      `${serviceName} volume mounts must use a supported Compose form`,
    );
    return {
      readOnly: mount.read_only === true,
      source: mount.source,
      target: mount.target,
      type: mount.type,
    };
  });
}

function findFilesystemMount(service, serviceName, target) {
  const matches = filesystemMounts(service, serviceName).filter(
    (mount) => mount.target === target,
  );
  assert.equal(
    matches.length,
    1,
    `${serviceName} must mount exactly one filesystem at ${target}`,
  );
  return matches[0];
}

function commandText(command) {
  assert.ok(Array.isArray(command), 'command/healthcheck must use exec form');
  assert.ok(
    command.every((entry) => typeof entry === 'string'),
    'command/healthcheck entries must be strings',
  );
  return command.join(' ');
}

function assertOrdered(source, fragments, label) {
  let previous = -1;
  for (const fragment of fragments) {
    const index = source.indexOf(fragment, previous + 1);
    assert.ok(index > previous, `${label}: missing/out-of-order ${fragment}`);
    previous = index;
  }
}

function assertPrefixedInterpolation(value, prefix, setting) {
  assert.equal(typeof value, 'string', `${setting} must be interpolated`);
  assert.match(
    value,
    new RegExp(`^\\$\\{${prefix}[A-Z0-9_]*:\\?[^}]+\\}$`, 'u'),
    `${setting} must use a required ${prefix} interpolation`,
  );
}

function dependencyConditions(service, serviceName) {
  if (service.depends_on === undefined) return undefined;
  const normalized = {};
  for (const [dependency, contract] of Object.entries(service.depends_on)) {
    assert.ok(
      contract && typeof contract === 'object' && !Array.isArray(contract),
      `${serviceName}/${dependency} must use a conditional dependency`,
    );
    assert.notEqual(
      contract.restart,
      true,
      `${serviceName}/${dependency} must not couple later restarts`,
    );
    assert.notEqual(
      contract.required,
      false,
      `${serviceName}/${dependency} must remain required`,
    );
    normalized[dependency] = { condition: contract.condition };
  }
  return normalized;
}

function assertNoForbiddenDockerSurfaces(config, { rendered = false } = {}) {
  const forbiddenKeys = [
    'cap_add',
    'devices',
    'device_cgroup_rules',
    'expose',
    'ipc',
    'network_mode',
    'pid',
    'ports',
    'privileged',
    'stdin_open',
    'tty',
    'volumes_from',
  ];
  for (const [serviceName, service] of Object.entries(config.services)) {
    for (const key of forbiddenKeys) {
      assert.equal(
        service[key],
        undefined,
        `${serviceName} must not set forbidden Docker surface ${key}`,
      );
    }
    assert.equal(
      service.build,
      undefined,
      `${serviceName} must use a prebuilt immutable image`,
    );
    if (rendered) {
      assert.equal(
        service.entrypoint,
        null,
        `${serviceName} must retain its reviewed image entrypoint`,
      );
    } else {
      assert.equal(
        service.entrypoint,
        undefined,
        `${serviceName} must retain its reviewed image entrypoint`,
      );
    }
    assert.equal(
      service.env_file,
      undefined,
      `${serviceName} must receive only reviewed interpolated environment values`,
    );
    for (const volume of service.volumes ?? []) {
      const serialized =
        typeof volume === 'string' ? volume : JSON.stringify(volume);
      assert.doesNotMatch(
        serialized,
        /(?:docker\.sock|\/dev\/|\/proc\/|\/sys\/)/u,
        `${serviceName} must not mount host control/device surfaces`,
      );
    }
  }
}

function assertTopologyAndImages(
  config,
  { interpolationValues = {}, rendered = false } = {},
) {
  assert.equal(config.name, 'mlp-prod');
  assert.deepEqual(objectKeys(config.services, 'services'), serviceNames);
  assert.deepEqual(objectKeys(config.networks, 'networks'), networkNames);
  assert.deepEqual(objectKeys(config.volumes, 'volumes'), ['postgres-data']);
  assert.deepEqual(
    objectKeys(config.secrets, 'secrets'),
    Object.keys(secretFiles).sort(),
  );

  if (!rendered) {
    assert.deepEqual(config.networks, {
      database: { internal: true },
      egress: {},
      tunnel: { internal: true },
      web: { internal: true },
    });
    assert.deepEqual(config.volumes, { 'postgres-data': {} });
  } else {
    for (const [networkName, network] of Object.entries(config.networks)) {
      assert.equal(network.name, `mlp-prod_${networkName}`);
      assert.deepEqual(network.ipam ?? {}, {});
      assert.equal(
        network.driver ?? 'bridge',
        'bridge',
        `${networkName} must use Docker's default bridge driver`,
      );
      assert.notEqual(network.external, true);
      assert.equal(
        network.driver_opts,
        undefined,
        `${networkName} must not inject host-level driver options`,
      );
    }
    const dataVolume = config.volumes['postgres-data'];
    assert.equal(dataVolume.name, 'mlp-prod_postgres-data');
    assert.notEqual(dataVolume.external, true);
    assert.equal(dataVolume.driver ?? 'local', 'local');
    assert.equal(
      dataVolume.driver_opts,
      undefined,
      'postgres-data must remain a plain Docker-managed volume',
    );
  }

  const { services } = config;
  assert.equal(services.postgres.image, postgresImage);
  assert.equal(services['cloudflared-a'].image, cloudflaredImage);
  assert.equal(services['cloudflared-b'].image, cloudflaredImage);
  assert.equal(services.app.image, services.migrator.image);
  if (rendered) {
    assert.equal(services.app.image, interpolationValues.APP_IMAGE);
    assert.equal(services['db-backup'].image, interpolationValues.BACKUP_IMAGE);
    assert.equal(services.caddy.image, interpolationValues.APP_CADDY_IMAGE);
    assert.match(
      services.caddy.image,
      /^ghcr\.io\/martinlindblad\/mlp-caddy@sha256:[0-9a-f]{64}$/u,
    );
  } else {
    assert.match(services.app.image, /^\$\{APP_IMAGE:\?[^}]+\}$/u);
    assert.match(services['db-backup'].image, /^\$\{BACKUP_IMAGE:\?[^}]+\}$/u);
    assert.match(services.caddy.image, /^\$\{APP_CADDY_IMAGE:\?[^}]+\}$/u);
  }

  const renderedImages = Object.values(services).map(({ image }) =>
    image
      .replace(/^\$\{APP_IMAGE:\?[^}]+\}$/u, placeholderAppImage)
      .replace(/^\$\{APP_CADDY_IMAGE:\?[^}]+\}$/u, placeholderCaddyImage)
      .replace(/^\$\{BACKUP_IMAGE:\?[^}]+\}$/u, placeholderBackupImage),
  );
  assert.equal(renderedImages.length, 7);
  for (const image of renderedImages) {
    assert.match(
      image,
      /^[a-z0-9][a-z0-9./_-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)?@sha256:[0-9a-f]{64}$/u,
      `service image must resolve to an immutable digest: ${image}`,
    );
  }
}

function assertNetworksAndHardening(config, { rendered = false } = {}) {
  for (const internalName of ['database', 'tunnel', 'web']) {
    assert.equal(config.networks[internalName].internal, true);
    assert.notEqual(config.networks[internalName].external, true);
  }
  assert.equal(config.networks.egress.internal ?? false, false);
  assert.notEqual(config.networks.egress.external, true);

  for (const serviceName of serviceNames) {
    const service = config.services[serviceName];
    const networks = serviceNetworkMap(service, serviceName);
    assert.deepEqual(
      Object.keys(networks).sort(),
      expectedNetworks[serviceName],
    );
    for (const [networkName, attachment] of Object.entries(networks)) {
      const priority = attachment?.gw_priority;
      if (networkName === 'egress') {
        assert.ok(
          egressServices.includes(serviceName),
          `${serviceName} is not an approved egress consumer`,
        );
        assert.equal(
          priority,
          1,
          `${serviceName} egress requires gw_priority 1`,
        );
      } else {
        assert.equal(
          priority,
          undefined,
          `${serviceName}/${networkName} must not claim default-gateway priority`,
        );
      }
    }

    assert.equal(service.user, expectedUsers[serviceName]);
    assert.equal(service.read_only, true, `${serviceName} must be read-only`);
    assert.deepEqual(service.cap_drop, ['ALL']);
    assert.deepEqual(service.security_opt, ['no-new-privileges:true']);
    assert.deepEqual(tmpfsTargets(service), expectedTmpfs[serviceName]);

    assert.deepEqual(service.logging, {
      driver: 'json-file',
      options: { 'max-file': '5', 'max-size': '10m' },
    });
  }

  assertNoForbiddenDockerSurfaces(config, { rendered });
}

function assertSecretMatrixAndBootstrap(
  config,
  source,
  { interpolationValues = {}, rendered = false } = {},
) {
  for (const [secretName, contract] of Object.entries(secretFiles)) {
    assert.deepEqual(
      config.secrets[secretName],
      rendered
        ? {
            file: `/etc/mlp/compose-secrets/${secretName}`,
            name: `mlp-prod_${secretName}`,
          }
        : { file: `/etc/mlp/compose-secrets/${secretName}` },
    );
    assert.match(contract.uid, /^\d+$/u);
    assert.match(contract.gid, /^\d+$/u);
  }
  for (const serviceName of serviceNames) {
    assert.deepEqual(
      secretMounts(config.services[serviceName], serviceName),
      expectedSecretMounts[serviceName],
    );
    assert.doesNotMatch(
      JSON.stringify(config.services[serviceName]),
      /MLP_[A-Z0-9_]+/u,
      `${serviceName} must not receive Compose-client secret-source values`,
    );
  }
  assert.doesNotMatch(
    JSON.stringify(config.secrets),
    /"(?:environment|content)":/u,
    'read-only services require bind-backed file secrets, never Compose-injected content',
  );
  assert.equal(
    source.match(/^\s*file:\s*\/etc\/mlp\/compose-secrets\/[a-z0-9-]+\s*$/gmu)
      ?.length ?? 0,
    Object.keys(secretFiles).length,
    'all per-consumer secret files must use the persistent reviewed root',
  );

  const postgres = config.services.postgres;
  assert.equal(postgres.environment.POSTGRES_DB, 'portfolio');
  assert.equal(postgres.environment.POSTGRES_USER, 'postgres');
  assert.equal(
    postgres.environment.POSTGRES_PASSWORD_FILE,
    '/run/secrets/postgres-bootstrap-password',
  );
  assert.match(
    postgres.environment.POSTGRES_INITDB_ARGS,
    /(?:^|\s)--auth-host=scram-sha-256(?:\s|$)/u,
  );
  const bootstrapMount = findFilesystemMount(
    postgres,
    'postgres',
    '/docker-entrypoint-initdb.d/10-init-roles.sh',
  );
  assert.equal(bootstrapMount.type, 'bind');
  assert.equal(bootstrapMount.readOnly, true);
  assert.match(
    bootstrapMount.source,
    /(?:^|\/)infra\/postgres\/init-roles\.sh$/u,
    'PostgreSQL must mount only the reviewed Task 2 role bootstrap',
  );

  for (const serviceName of serviceNames.filter(
    (name) => name !== 'postgres',
  )) {
    const serialized = JSON.stringify(config.services[serviceName]);
    assert.doesNotMatch(
      serialized,
      /postgres-bootstrap-password/u,
      `bootstrap administrator secret must never reach ${serviceName}`,
    );
  }

  const expectedPasswordFiles = {
    app: '/run/secrets/postgres-app-password',
    'db-backup': '/run/secrets/postgres-backup-password',
    migrator: '/run/secrets/postgres-migrator-password',
  };
  for (const [serviceName, passwordFile] of Object.entries(
    expectedPasswordFiles,
  )) {
    assert.equal(
      config.services[serviceName].environment.PGPASSWORD_FILE,
      passwordFile,
    );
  }

  for (const [serviceName, prefix, settings] of [
    [
      'app',
      'APP_',
      [
        'PGHOST',
        'PGPORT',
        'PGDATABASE',
        'PGUSER',
        'PGPOOL_MAX',
        'PGCONNECT_TIMEOUT_MS',
        'PGSTATEMENT_TIMEOUT_MS',
      ],
    ],
    [
      'migrator',
      'MIGRATOR_',
      [
        'PGHOST',
        'PGPORT',
        'PGDATABASE',
        'PGUSER',
        'PGPOOL_MAX',
        'PGCONNECT_TIMEOUT_MS',
        'PGSTATEMENT_TIMEOUT_MS',
      ],
    ],
    ['db-backup', 'BACKUP_', ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER']],
  ]) {
    for (const setting of settings) {
      if (rendered) {
        assert.equal(
          config.services[serviceName].environment[setting],
          interpolationValues[`${prefix}${setting}`],
          `${serviceName}/${setting} must retain the reviewed rendered value`,
        );
      } else {
        assertPrefixedInterpolation(
          config.services[serviceName].environment[setting],
          prefix,
          `${serviceName}/${setting}`,
        );
      }
    }
  }
  if (rendered) {
    assert.equal(
      config.services.caddy.environment.CONTACT_MODE,
      interpolationValues.APP_CONTACT_MODE,
    );
  } else {
    assertPrefixedInterpolation(
      config.services.caddy.environment.CONTACT_MODE,
      'APP_',
      'caddy/CONTACT_MODE',
    );
  }

  const expectedJournalEnvironment = {
    JOURNAL_ACTIVE_KEY_ID: {
      interpolation: 'APP_JOURNAL_ACTIVE_KEY_ID',
      value: interpolationValues.APP_JOURNAL_ACTIVE_KEY_ID,
    },
    JOURNAL_AGE_RECIPIENT: {
      interpolation: 'APP_JOURNAL_AGE_RECIPIENT',
      value: interpolationValues.APP_JOURNAL_AGE_RECIPIENT,
    },
    JOURNAL_MAC_KEYRING_FILE: {
      value: '/run/secrets/journal-mac-keyring',
    },
    JOURNAL_R2_ACCESS_KEY_ID_FILE: {
      value: '/run/secrets/journal-r2-access-key-id',
    },
    JOURNAL_R2_BUCKET: {
      interpolation: 'APP_JOURNAL_R2_BUCKET',
      value: interpolationValues.APP_JOURNAL_R2_BUCKET,
    },
    JOURNAL_R2_ENDPOINT: {
      interpolation: 'APP_JOURNAL_R2_ENDPOINT',
      value: interpolationValues.APP_JOURNAL_R2_ENDPOINT,
    },
    JOURNAL_R2_SECRET_ACCESS_KEY_FILE: {
      value: '/run/secrets/journal-r2-secret-access-key',
    },
  };
  for (const serviceName of serviceNames) {
    const journalKeys = Object.keys(
      config.services[serviceName].environment ?? {},
    )
      .filter((name) => name.startsWith('JOURNAL_'))
      .sort();
    assert.deepEqual(
      journalKeys,
      serviceName === 'app'
        ? Object.keys(expectedJournalEnvironment).sort()
        : [],
      `${serviceName} must not receive unapproved journal runtime settings`,
    );
  }
  for (const [name, contract] of Object.entries(expectedJournalEnvironment)) {
    if (contract.interpolation && !rendered) {
      assert.equal(
        config.services.app.environment[name],
        `\${${contract.interpolation}:?${contract.interpolation} is required}`,
        `app/${name} must use the reviewed required interpolation`,
      );
    } else {
      assert.equal(
        config.services.app.environment[name],
        contract.value,
        `app/${name} must retain the reviewed runtime value`,
      );
    }
  }
  assert.doesNotMatch(
    JSON.stringify(config),
    /(?:recovery-secrets|age-identity|age-identities|age-keygen)/u,
    'Compose must not expose recovery/admin/age identity material',
  );

  const backupEnvironment = config.services['db-backup'].environment;
  assert.equal(
    backupEnvironment.RESTIC_PASSWORD_FILE,
    '/run/secrets/restic-password',
  );
  assert.equal(
    backupEnvironment.RESTIC_S3_ACCESS_KEY_ID_FILE,
    '/run/secrets/restic-s3-access-key-id',
  );
  assert.equal(
    backupEnvironment.RESTIC_S3_SECRET_ACCESS_KEY_FILE,
    '/run/secrets/restic-s3-secret-access-key',
  );
  if (rendered) {
    assert.equal(
      backupEnvironment.RESTIC_REPOSITORY,
      interpolationValues.BACKUP_RESTIC_REPOSITORY,
    );
    assert.match(backupEnvironment.RESTIC_REPOSITORY, /^UNCONFIGURED_/u);
  } else {
    assertPrefixedInterpolation(
      backupEnvironment.RESTIC_REPOSITORY,
      'BACKUP_',
      'RESTIC_REPOSITORY',
    );
  }

  for (const [serviceName, service] of Object.entries(config.services)) {
    for (const [name, value] of Object.entries(service.environment ?? {})) {
      assert.doesNotMatch(
        name,
        /^AWS_/u,
        `${serviceName} must not receive inherited AWS credential names`,
      );
      if (/(?:PASSWORD|ACCESS_KEY|TOKEN)/u.test(name)) {
        assert.match(
          name,
          /_FILE$/u,
          `${serviceName}/${name} must be a file-backed credential`,
        );
        assert.match(
          String(value),
          /^\/run\/secrets\/[a-z0-9-]+$/u,
          `${serviceName}/${name} must point below /run/secrets`,
        );
      }
    }
  }
}

function assertLifecycleAndHealth(config, { rendered = false } = {}) {
  for (const serviceName of permanentServices) {
    assert.equal(config.services[serviceName].restart, 'unless-stopped');
    assert.ok(
      config.services[serviceName].healthcheck,
      `${serviceName} requires a healthcheck`,
    );
  }
  for (const serviceName of ['db-backup', 'migrator']) {
    assert.equal(config.services[serviceName].restart, 'no');
  }
  assert.equal(
    config.services['db-backup'].healthcheck,
    undefined,
    'backup image has no healthcheck and must rely on exit status',
  );
  if (rendered) {
    assert.ok(
      config.services.migrator.healthcheck?.disable === true ||
        JSON.stringify(config.services.migrator.healthcheck?.test) ===
          JSON.stringify(['NONE']),
      'rendered migrator healthcheck must remain disabled',
    );
  } else {
    assert.deepEqual(
      config.services.migrator.healthcheck,
      { disable: true },
      'migrator must disable the inherited app-image healthcheck and rely on exit status',
    );
  }
  assert.deepEqual(config.services.migrator.command, [
    '/app/dist/scripts/db/migrate.js',
  ]);
  for (const serviceName of ['app', 'caddy', 'db-backup', 'postgres']) {
    if (rendered) {
      assert.equal(
        config.services[serviceName].command,
        null,
        `${serviceName} must retain its reviewed image entrypoint/CMD`,
      );
    } else {
      assert.equal(
        config.services[serviceName].command,
        undefined,
        `${serviceName} must retain its reviewed image entrypoint/CMD`,
      );
    }
  }
  assert.deepEqual(
    Object.entries(config.services)
      .filter(
        ([, service]) =>
          service.healthcheck?.disable !== true &&
          JSON.stringify(service.healthcheck?.test) !==
            JSON.stringify(['NONE']),
      )
      .filter(([, service]) => service.healthcheck !== undefined)
      .map(([name]) => name)
      .sort(),
    permanentServices.slice().sort(),
    'only five permanent services may have enabled healthchecks',
  );
  assert.deepEqual(config.services['db-backup'].profiles, ['jobs']);
  for (const serviceName of serviceNames.filter(
    (name) => name !== 'db-backup',
  )) {
    assert.equal(config.services[serviceName].profiles, undefined);
  }

  const expectedDependencies = {
    app: {
      migrator: { condition: 'service_completed_successfully' },
      postgres: { condition: 'service_healthy' },
    },
    caddy: { app: { condition: 'service_healthy' } },
    'cloudflared-a': { caddy: { condition: 'service_healthy' } },
    'cloudflared-b': { caddy: { condition: 'service_healthy' } },
    'db-backup': { postgres: { condition: 'service_healthy' } },
    migrator: { postgres: { condition: 'service_healthy' } },
    postgres: undefined,
  };
  for (const serviceName of serviceNames) {
    assert.deepEqual(
      dependencyConditions(config.services[serviceName], serviceName),
      expectedDependencies[serviceName],
      `${serviceName} dependency conditions must be exact`,
    );
  }

  const postgresHealth = config.services.postgres.healthcheck.test;
  assert.equal(postgresHealth.length, 2);
  assert.equal(postgresHealth[0], 'CMD-SHELL');
  if (rendered) {
    assert.ok(
      [postgresHealthShell, postgresHealthShell.replaceAll('$$', '$')].includes(
        postgresHealth[1],
      ),
      'rendered PostgreSQL health must retain the exact fail-closed TCP query',
    );
  } else {
    assert.equal(postgresHealth[1], postgresHealthShell);
  }

  const appHealth = commandText(config.services.app.healthcheck.test);
  assert.match(appHealth, /\/nodejs\/bin\/node/u);
  assert.match(appHealth, /http:\/\/127\.0\.0\.1:3000\/api\/health\/ready/u);
  const caddyHealth = commandText(config.services.caddy.healthcheck.test);
  assert.match(caddyHealth, /http:\/\/127\.0\.0\.1:8080\/api\/health\/live/u);
  assert.match(caddyHealth, /Host:martin-lindblad\.com/u);
  assert.match(caddyHealth, /CF-Connecting-IP:127\.0\.0\.1/u);

  const expectedConnectorHealth = [
    'CMD',
    'cloudflared',
    'tunnel',
    '--metrics',
    '127.0.0.1:2000',
    'ready',
  ];
  for (const serviceName of ['cloudflared-a', 'cloudflared-b']) {
    const service = config.services[serviceName];
    assert.deepEqual(service.healthcheck.test, expectedConnectorHealth);
    assertOrdered(
      commandText(service.command),
      [
        'tunnel',
        '--metrics',
        '127.0.0.1:2000',
        'run',
        '--token-file',
        '/run/secrets/cloudflare-tunnel-token',
      ],
      `${serviceName} must bind the active-tunnel readiness endpoint to loopback`,
    );
    assert.deepEqual(service.ulimits?.nofile, {
      hard: 70000,
      soft: 70000,
    });
  }
}

function assertWritableSurfaces(config) {
  assert.equal(
    filesystemMounts(config.services.postgres, 'postgres').length,
    2,
  );
  const postgresData = findFilesystemMount(
    config.services.postgres,
    'postgres',
    '/var/lib/postgresql',
  );
  assert.deepEqual(postgresData, {
    readOnly: false,
    source: 'postgres-data',
    target: '/var/lib/postgresql',
    type: 'volume',
  });
  const bootstrap = findFilesystemMount(
    config.services.postgres,
    'postgres',
    '/docker-entrypoint-initdb.d/10-init-roles.sh',
  );
  assert.equal(bootstrap.type, 'bind');
  assert.equal(bootstrap.readOnly, true);
  assert.match(bootstrap.source, /(?:^|\/)infra\/postgres\/init-roles\.sh$/u);

  assert.equal(filesystemMounts(config.services.caddy, 'caddy').length, 1);
  const caddyConfig = findFilesystemMount(
    config.services.caddy,
    'caddy',
    '/etc/caddy',
  );
  assert.equal(caddyConfig.type, 'bind');
  assert.equal(caddyConfig.readOnly, true);
  assert.match(caddyConfig.source, /(?:^|\/)infra\/caddy$/u);
  for (const serviceName of serviceNames.filter(
    (name) => !['caddy', 'postgres'].includes(name),
  )) {
    assert.deepEqual(
      filesystemMounts(config.services[serviceName], serviceName),
      [],
      `${serviceName} must not receive a filesystem mount`,
    );
  }
}

function dockerComposeStatus() {
  const version = spawnSync('docker', ['compose', 'version', '--short'], {
    encoding: 'utf8',
    killSignal: 'SIGKILL',
    timeout: commandTimeoutMs,
  });
  if (version.error || version.status !== 0) {
    return {
      available: false,
      daemon: false,
      reason: 'Docker Compose CLI unavailable',
    };
  }
  const match = version.stdout.trim().match(/^(\d+)\.(\d+)\.(\d+)/u);
  assert.ok(match, 'Docker Compose must report a semantic version');
  const numeric = match.slice(1).map(Number);
  assert.ok(
    numeric[0] > 2 ||
      (numeric[0] === 2 &&
        (numeric[1] > 33 || (numeric[1] === 33 && numeric[2] >= 1))),
    'Docker Compose >= 2.33.1 is required for gw_priority',
  );
  const info = spawnSync('docker', ['info'], {
    encoding: 'utf8',
    killSignal: 'SIGKILL',
    timeout: commandTimeoutMs,
  });
  return {
    available: true,
    daemon: !info.error && info.status === 0,
    reason: info.error || info.status !== 0 ? 'Docker daemon unavailable' : '',
  };
}

function interpolationEnvironment() {
  return {
    ...process.env,
    MLP_CLOUDFLARE_TUNNEL_TOKEN: 'task9-cloudflare-token',
    MLP_JOURNAL_MAC_KEYRING:
      '{"current":{"secret":"bW9jay1qb3VybmFsLW1hYy1rZXktMzJiISESEhISEhISEhISEhI"}}',
    MLP_JOURNAL_R2_ACCESS_KEY_ID: 'task9-journal-access-key',
    MLP_JOURNAL_R2_SECRET_ACCESS_KEY: 'task9-journal-secret-key',
    MLP_POSTGRES_APP_PASSWORD: 'task9-app-password',
    MLP_POSTGRES_BACKUP_PASSWORD: 'task9-backup-password',
    MLP_POSTGRES_BOOTSTRAP_PASSWORD: 'task9-bootstrap-password',
    MLP_POSTGRES_MIGRATOR_PASSWORD: 'task9-migrator-password',
    MLP_RESTIC_PASSWORD: 'task9-restic-password',
    MLP_RESTIC_S3_ACCESS_KEY_ID: 'task9-access-key',
    MLP_RESTIC_S3_SECRET_ACCESS_KEY: 'task9-secret-key',
  };
}

async function readExampleInterpolationValues() {
  const values = {};
  for (const filename of ['app.env', 'migrator.env', 'backup.env']) {
    const source = await readRequiredText(
      `infra/runtime.example/env/${filename}`,
    );
    for (const [index, rawLine] of source
      .replaceAll('\r\n', '\n')
      .split('\n')
      .entries()) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith('#')) continue;
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/u);
      assert.ok(match, `${filename}:${index + 1} must be non-empty KEY=value`);
      const [, name, value] = match;
      assert.equal(
        Object.hasOwn(values, name),
        false,
        `${name} must be unique`,
      );
      values[name] = value;
    }
  }
  return values;
}

function productionInterpolationValues(values) {
  return {
    ...values,
    APP_JOURNAL_ACTIVE_KEY_ID: 'task7-prod.v1',
    APP_JOURNAL_AGE_RECIPIENT: `age1${'p'.repeat(58)}`,
    APP_JOURNAL_R2_ENDPOINT:
      'https://task7production.eu.r2.cloudflarestorage.com',
  };
}

function unconfiguredJournalInterpolationValues(values) {
  return {
    ...values,
    APP_JOURNAL_ACTIVE_KEY_ID: 'unconfigured-active',
    APP_JOURNAL_AGE_RECIPIENT: `age1${'q'.repeat(58)}`,
    APP_JOURNAL_R2_ENDPOINT: 'https://unconfigured.eu.r2.cloudflarestorage.com',
  };
}

function canonicalVerifierConfig(source, values) {
  const replaceInterpolations = (value) => {
    if (Array.isArray(value)) return value.map(replaceInterpolations);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          replaceInterpolations(entry),
        ]),
      );
    }
    if (typeof value !== 'string') return value;
    return value.replace(/\$\{([A-Z][A-Z0-9_]*):\?[^}]+\}/gu, (_, name) => {
      assert.ok(
        Object.hasOwn(values, name),
        `missing canonical interpolation value for ${name}`,
      );
      return values[name];
    });
  };

  const config = replaceInterpolations(parseCompose(source));
  config.networks = Object.fromEntries(
    Object.entries(config.networks).map(([name, network]) => [
      name,
      { name: `mlp-prod_${name}`, ...network, ipam: {} },
    ]),
  );
  config.volumes['postgres-data'] = { name: 'mlp-prod_postgres-data' };
  config.secrets = Object.fromEntries(
    Object.entries(config.secrets).map(([name, secret]) => [
      name,
      { ...secret, name: `mlp-prod_${name}` },
    ]),
  );

  for (const service of Object.values(config.services)) {
    service.entrypoint = null;
    if (service.command === undefined) service.command = null;
    if (service.depends_on) {
      service.depends_on = Object.fromEntries(
        Object.entries(service.depends_on).map(([name, dependency]) => [
          name,
          { ...dependency, required: true, restart: false },
        ]),
      );
    }
  }

  config.services.postgres.volumes = [
    {
      source: 'postgres-data',
      target: '/var/lib/postgresql',
      type: 'volume',
      volume: {},
    },
    {
      bind: { create_host_path: true },
      read_only: true,
      source: path.join(repositoryRoot, 'infra/postgres/init-roles.sh'),
      target: '/docker-entrypoint-initdb.d/10-init-roles.sh',
      type: 'bind',
    },
  ];
  config.services.caddy.volumes = [
    {
      bind: { create_host_path: true },
      read_only: true,
      source: path.join(repositoryRoot, 'infra/caddy'),
      target: '/etc/caddy',
      type: 'bind',
    },
  ];
  return config;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

async function createVerifierLayout(wrapperSource) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mlp-task9-verifier-'));
  const scriptsDirectory = path.join(root, 'scripts');
  const opsDirectory = path.join(root, 'ops');
  await Promise.all([mkdir(scriptsDirectory), mkdir(opsDirectory)]);
  const verifierPath = path.join(
    scriptsDirectory,
    'verify-production-config.mjs',
  );
  await copyFile(
    path.join(repositoryRoot, 'scripts/verify-production-config.mjs'),
    verifierPath,
  );
  const wrapperPath = path.join(opsDirectory, 'compose.sh');
  await writeFile(wrapperPath, wrapperSource, {
    encoding: 'utf8',
    mode: 0o700,
  });
  await chmod(wrapperPath, 0o700);
  return { root, verifierPath };
}

function runVerifier(verifierPath, extraEnvironment = {}, args = []) {
  return spawnSync(process.execPath, [verifierPath, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnvironment,
      MLP_COMPOSE_WRAPPER: '/task9/override-must-be-ignored',
      MLP_CONFIG_ROOT: '/task9/config-override-must-be-ignored',
      MLP_REPO_ROOT: '/task9/repo-override-must-be-ignored',
    },
    killSignal: 'SIGKILL',
    timeout: commandTimeoutMs,
  });
}

function assertRenderedProductionContract(config, source, interpolationValues) {
  assertTopologyAndImages(config, { interpolationValues, rendered: true });
  assertNetworksAndHardening(config, { rendered: true });
  assertSecretMatrixAndBootstrap(config, source, {
    interpolationValues,
    rendered: true,
  });
  assertLifecycleAndHealth(config, { rendered: true });
  assertWritableSurfaces(config);
}

function composeArguments(projectName, trailing, overridePath) {
  const argumentsList = [
    'compose',
    '--project-name',
    projectName,
    '--project-directory',
    repositoryRoot,
    '--env-file',
    path.join(repositoryRoot, 'infra/runtime.example/env/app.env'),
    '--env-file',
    path.join(repositoryRoot, 'infra/runtime.example/env/migrator.env'),
    '--env-file',
    path.join(repositoryRoot, 'infra/runtime.example/env/backup.env'),
    '--file',
    composePath,
  ];
  if (overridePath) argumentsList.push('--file', overridePath);
  return [...argumentsList, ...trailing];
}

function assertNoSentinelLeak(result, sentinels, operation) {
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (sentinels.some((sentinel) => output.includes(sentinel))) {
    assert.fail(`${operation} exposed a Task 9 credential sentinel`);
  }
}

function sanitizedProcessDiagnostics(result, sentinels) {
  assertNoSentinelLeak(result, sentinels, 'diagnostic collection');
  let output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  for (const sentinel of sentinels) {
    output = output.replaceAll(sentinel, '[REDACTED]');
  }
  output = output.trim().slice(-8192);
  const errorCode = result.error?.code ?? 'none';
  const status = result.status ?? 'none';
  const signal = result.signal ?? 'none';
  return `status=${status} signal=${signal} error=${errorCode}${
    output ? `\n${output}` : ''
  }`;
}

async function createComposeSecretFixture(environment, sentinels) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mlp-task9-secrets-'));
  const secretDirectory = path.join(root, 'secrets');
  const overridePath = path.join(root, 'compose.secrets.yml');
  await mkdir(secretDirectory, { mode: 0o700 });

  for (const [secretName, contract] of Object.entries(secretFiles)) {
    const variable = canonicalSecretEnvironmentVariables[contract.canonical];
    const value = environment[variable];
    assert.equal(typeof value, 'string', `${secretName} requires ${variable}`);
    assert.notEqual(
      value.length,
      0,
      `${secretName} requires a non-empty value`,
    );
    assert.doesNotMatch(value, /[\r\n]/u, `${secretName} must be one line`);
    await writeFile(path.join(secretDirectory, secretName), value, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  await writeFile(
    overridePath,
    YAML.stringify({
      secrets: Object.fromEntries(
        Object.keys(secretFiles).map((secretName) => [
          secretName,
          { file: path.join(secretDirectory, secretName) },
        ]),
      ),
    }),
    { encoding: 'utf8', mode: 0o600 },
  );

  const ownershipCommands = Object.entries(secretFiles)
    .map(
      ([secretName, { gid, uid }]) =>
        `chown ${uid}:${gid} /secrets/${secretName}; chmod 0400 /secrets/${secretName}; test "$(stat -c '%u:%g:%a:%h' /secrets/${secretName})" = '${uid}:${gid}:400:1'`,
    )
    .join('\n');
  const stage = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--pull',
      'never',
      '--network',
      'none',
      '--user',
      '0:0',
      '--mount',
      `type=bind,source=${secretDirectory},target=/secrets`,
      postgresImage,
      '/bin/sh',
      '-ceu',
      ownershipCommands,
    ],
    {
      encoding: 'utf8',
      env: environment,
      killSignal: 'SIGKILL',
      timeout: commandTimeoutMs,
    },
  );
  assertNoSentinelLeak(stage, sentinels, 'PostgreSQL secret staging');
  if (stage.error || stage.status !== 0) {
    await rm(root, { force: true, recursive: true });
    assert.fail(
      `PostgreSQL secret staging failed\n${sanitizedProcessDiagnostics(
        stage,
        sentinels,
      )}`,
    );
  }
  return { overridePath, root };
}

test('production Compose defines exactly seven immutable services and four networks', async () => {
  const source = await readRequiredText('compose.production.yml');
  assertTopologyAndImages(parseCompose(source));
});

test('production Compose isolates network gateways and forbids host-control surfaces', async () => {
  const source = await readRequiredText('compose.production.yml');
  assertNetworksAndHardening(parseCompose(source));
});

test('production Compose enforces fifteen UID-safe file sources and app-only journal mounts', async () => {
  const source = await readRequiredText('compose.production.yml');
  assertSecretMatrixAndBootstrap(parseCompose(source), source);
});

test('production Compose gates startup with only five permanent healthchecks', async () => {
  const source = await readRequiredText('compose.production.yml');
  assertLifecycleAndHealth(parseCompose(source));
});

test('production Compose grants only reviewed named-volume, config, and tmpfs writes', async () => {
  const source = await readRequiredText('compose.production.yml');
  assertWritableSurfaces(parseCompose(source));
});

test(
  'production verifier consumes only sibling-wrapper JSON and rejects contract drift without leaks',
  { timeout: 90_000 },
  async () => {
    await readRequiredText('scripts/verify-production-config.mjs');
    const source = await readRequiredText('compose.production.yml');
    const fixtureRoot = await mkdtemp(
      path.join(os.tmpdir(), 'mlp-task9-verifier-data-'),
    );
    const configPath = path.join(fixtureRoot, 'config.json');
    const argumentsPath = path.join(fixtureRoot, 'arguments');
    const sentinel = `TASK9_VERIFIER_${randomBytes(16).toString('hex')}`;
    const wrapperSource = `#!/bin/bash
set -Eeuo pipefail
umask 077
printf '%s\\n' "$@" > ${shellQuote(argumentsPath)}
cat ${shellQuote(configPath)}
`;
    let layout;
    try {
      layout = await createVerifierLayout(wrapperSource);
      const exampleInterpolationValues = await readExampleInterpolationValues();
      const canonical = canonicalVerifierConfig(
        source,
        exampleInterpolationValues,
      );
      await writeFile(configPath, `${JSON.stringify(canonical)}\n`, 'utf8');

      const valid = runVerifier(layout.verifierPath, {
        MLP_POSTGRES_APP_PASSWORD: sentinel,
      });
      assertNoSentinelLeak(valid, [sentinel], 'production verifier success');
      assert.equal(
        valid.status,
        0,
        'the verifier must accept tracked runtime example values used by CI rendering',
      );
      assert.equal(valid.stdout, 'production config valid\n');
      assert.equal(valid.stderr, '');

      const placeholderCanonical = canonicalVerifierConfig(
        source,
        unconfiguredJournalInterpolationValues(exampleInterpolationValues),
      );
      await writeFile(
        configPath,
        `${JSON.stringify(placeholderCanonical)}\n`,
        'utf8',
      );
      const placeholder = runVerifier(layout.verifierPath, {
        MLP_POSTGRES_APP_PASSWORD: sentinel,
      });
      assertNoSentinelLeak(
        placeholder,
        [sentinel],
        'placeholder production verifier rejection',
      );
      assert.notEqual(
        placeholder.status,
        0,
        'the verifier must reject unconfigured journal placeholders',
      );
      assert.deepEqual(
        (await readFile(argumentsPath, 'utf8')).trim().split('\n'),
        ['--profile', '*', 'config', '--format', 'json'],
        'the verifier must invoke only its sibling root wrapper for JSON',
      );

      const singleDollarRender = structuredClone(canonical);
      singleDollarRender.services.postgres.healthcheck.test[1] =
        postgresHealthShell.replaceAll('$$', '$');
      await writeFile(
        configPath,
        `${JSON.stringify(singleDollarRender)}\n`,
        'utf8',
      );
      const compatible = runVerifier(layout.verifierPath, {
        MLP_POSTGRES_APP_PASSWORD: sentinel,
      });
      assertNoSentinelLeak(
        compatible,
        [sentinel],
        'single-dollar Compose rendering',
      );
      assert.equal(
        compatible.status,
        0,
        'the verifier must accept the equivalent fail-closed rendering from supported older Compose versions',
      );
      assert.equal(compatible.stdout, 'production config valid\n');
      assert.equal(compatible.stderr, '');

      const candidateImage = `ghcr.io/martinlindblad/mlp@sha256:${randomBytes(
        32,
      ).toString('hex')}`;
      const mismatchedCandidate = runVerifier(
        layout.verifierPath,
        { MLP_POSTGRES_APP_PASSWORD: sentinel },
        ['--candidate-app-image', candidateImage],
      );
      assertNoSentinelLeak(
        mismatchedCandidate,
        [sentinel, candidateImage],
        'mismatched candidate verification',
      );
      assert.notEqual(
        mismatchedCandidate.status,
        0,
        'candidate verification must reject rendered app and migrator images that do not equal the requested candidate',
      );
      assert.equal(mismatchedCandidate.stdout, '');
      assert.equal(mismatchedCandidate.stderr, 'production config invalid\n');

      const candidateRender = structuredClone(canonical);
      candidateRender.services.app.image = candidateImage;
      candidateRender.services.migrator.image = candidateImage;
      await writeFile(
        configPath,
        `${JSON.stringify(candidateRender)}\n`,
        'utf8',
      );
      const candidate = runVerifier(
        layout.verifierPath,
        { MLP_POSTGRES_APP_PASSWORD: sentinel },
        ['--candidate-app-image', candidateImage],
      );
      assertNoSentinelLeak(candidate, [sentinel], 'candidate verification');
      assert.equal(candidate.status, 0);
      assert.deepEqual(
        (await readFile(argumentsPath, 'utf8')).trim().split('\n'),
        [
          '--candidate-app-image',
          candidateImage,
          '--profile',
          '*',
          'config',
          '--format',
          'json',
        ],
        'the verifier must pass only its bounded candidate image flag to the sibling wrapper',
      );

      for (const args of [
        ['--candidate-app-image'],
        ['--candidate-app-image', 'mlp:latest'],
        [`--candidate-app-image=${candidateImage}`],
        ['--unexpected'],
      ]) {
        const rejected = runVerifier(
          layout.verifierPath,
          { MLP_POSTGRES_APP_PASSWORD: sentinel },
          args,
        );
        assertNoSentinelLeak(
          rejected,
          [sentinel, candidateImage],
          'invalid verifier arguments',
        );
        assert.notEqual(rejected.status, 0);
        assert.equal(rejected.stdout, '');
        assert.equal(rejected.stderr, 'production config invalid\n');
      }

      const mutations = [
        [
          'top-level config object',
          (config) =>
            (config.configs = {
              injected: { file: '/etc/mlp/injected.conf' },
            }),
        ],
        [
          'mutated hardening extension',
          (config) => (config['x-harden'].privileged = true),
        ],
        [
          'mutated logging extension',
          (config) => (config['x-logging'].driver = 'none'),
        ],
        [
          'published port',
          (config) => (config.services.app.ports = ['3000:3000']),
        ],
        [
          'mutable image',
          (config) => (config.services.app.image = 'mlp:latest'),
        ],
        [
          'unknown service',
          (config) =>
            (config.services.debug = structuredClone(config.services.app)),
        ],
        ['unknown network', (config) => (config.networks.extra = {})],
        [
          'external network',
          (config) => (config.networks.egress.external = true),
        ],
        [
          'wrong network membership',
          (config) => delete config.services.app.networks.database,
        ],
        [
          'wrong gateway priority',
          (config) => (config.services.app.networks.egress.gw_priority = 2),
        ],
        ['root runtime user', (config) => (config.services.app.user = '0:0')],
        ['writable root', (config) => (config.services.app.read_only = false)],
        [
          'retained capability',
          (config) => (config.services.app.cap_drop = []),
        ],
        [
          'disabled no-new-privileges',
          (config) => (config.services.app.security_opt = []),
        ],
        ['missing tmpfs', (config) => (config.services.app.tmpfs = [])],
        [
          'unbounded logging',
          (config) => (config.services.app.logging.options['max-size'] = '0'),
        ],
        [
          'wrong secret target',
          (config) =>
            (config.services.app.secrets[0].target =
              'postgres-migrator-password'),
        ],
        ['wrong restart', (config) => (config.services.app.restart = 'always')],
        [
          'weakened dependency',
          (config) =>
            (config.services.app.depends_on.migrator.condition =
              'service_started'),
        ],
        [
          'missing permanent healthcheck',
          (config) => delete config.services.app.healthcheck,
        ],
        [
          'fail-open PostgreSQL healthcheck',
          (config) =>
            (config.services.postgres.healthcheck.test[1] += ' || true'),
        ],
        [
          'low connector nofile',
          (config) =>
            (config.services['cloudflared-a'].ulimits.nofile.soft = 1024),
        ],
        [
          'entrypoint override',
          (config) => (config.services.app.entrypoint = ['/bin/sh']),
        ],
        [
          'service config mount',
          (config) =>
            (config.services.app.configs = [
              { source: 'injected', target: '/app/injected.conf' },
            ]),
        ],
        [
          'post-start hook',
          (config) =>
            (config.services.app.post_start = [
              { command: ['/bin/sh', '-c', 'id'] },
            ]),
        ],
        [
          'pre-start hook',
          (config) =>
            (config.services.app.pre_start = [
              { command: ['/bin/sh', '-c', 'id'] },
            ]),
        ],
        [
          'pre-stop hook',
          (config) =>
            (config.services.app.pre_stop = [
              { command: ['/bin/sh', '-c', 'id'] },
            ]),
        ],
        [
          'volumes_from override',
          (config) => (config.services.app.volumes_from = ['postgres']),
        ],
        [
          'privileged service',
          (config) => (config.services.app.privileged = true),
        ],
        [
          'host network',
          (config) => (config.services.app.network_mode = 'host'),
        ],
        ['host PID', (config) => (config.services.app.pid = 'host')],
        ['host IPC', (config) => (config.services.app.ipc = 'host')],
        [
          'Docker socket mount',
          (config) =>
            (config.services.app.volumes = [
              {
                source: '/var/run/docker.sock',
                target: '/var/run/docker.sock',
                type: 'bind',
              },
            ]),
        ],
        [
          'writable Caddy policy',
          (config) => (config.services.caddy.volumes[0].read_only = false),
        ],
        [
          'bind-backed PostgreSQL volume',
          (config) =>
            (config.volumes['postgres-data'].driver_opts = {
              device: '/tmp/postgres',
              o: 'bind',
              type: 'none',
            }),
        ],
        [
          'service environment secret',
          (config) =>
            (config.services.app.environment.DATABASE_PASSWORD = sentinel),
        ],
        [
          'secret uid remap that file sources cannot honor',
          (config) => (config.services.app.secrets[0].uid = '1000'),
        ],
      ];

      for (const [label, mutate] of mutations) {
        const invalid = structuredClone(canonical);
        mutate(invalid);
        await writeFile(configPath, `${JSON.stringify(invalid)}\n`, 'utf8');
        const result = runVerifier(layout.verifierPath, {
          MLP_POSTGRES_APP_PASSWORD: sentinel,
        });
        assertNoSentinelLeak(
          result,
          [sentinel],
          `verifier rejection: ${label}`,
        );
        assert.notEqual(
          result.status,
          0,
          `the production verifier must reject ${label}`,
        );
        assert.notEqual(result.stdout, 'production config valid\n');
      }
    } finally {
      await Promise.all([
        rm(fixtureRoot, { force: true, recursive: true }),
        layout
          ? rm(layout.root, { force: true, recursive: true })
          : Promise.resolve(),
      ]);
    }
  },
);

test('production verifier renders the complete reviewed schema through its sibling wrapper', async (t) => {
  const docker = dockerComposeStatus();
  if (!docker.available) {
    t.skip(
      'Docker Compose CLI unavailable; schema rendering remains a mandatory Linux CI gate',
    );
    return;
  }
  await readRequiredText('scripts/verify-production-config.mjs');
  const source = await readRequiredText('compose.production.yml');
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-task9-rendered-'),
  );
  const argumentsPath = path.join(fixtureRoot, 'arguments');
  const renderedPath = path.join(fixtureRoot, 'rendered.json');
  const appEnvPath = path.join(fixtureRoot, 'app.env');
  const migratorEnvPath = path.join(fixtureRoot, 'migrator.env');
  const backupEnvPath = path.join(fixtureRoot, 'backup.env');
  const interpolationValues = productionInterpolationValues(
    await readExampleInterpolationValues(),
  );
  const writeEnvFile = (filePath, keys) =>
    writeFile(
      filePath,
      `${keys.map((key) => `${key}=${interpolationValues[key]}`).join('\n')}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  await writeEnvFile(appEnvPath, [
    'APP_IMAGE',
    'APP_CADDY_IMAGE',
    'APP_PGHOST',
    'APP_PGPORT',
    'APP_PGDATABASE',
    'APP_PGUSER',
    'APP_PGPOOL_MAX',
    'APP_PGCONNECT_TIMEOUT_MS',
    'APP_PGSTATEMENT_TIMEOUT_MS',
    'APP_JOURNAL_R2_ENDPOINT',
    'APP_JOURNAL_R2_BUCKET',
    'APP_JOURNAL_ACTIVE_KEY_ID',
    'APP_JOURNAL_AGE_RECIPIENT',
    'APP_CONTACT_MODE',
  ]);
  await writeEnvFile(migratorEnvPath, [
    'MIGRATOR_PGHOST',
    'MIGRATOR_PGPORT',
    'MIGRATOR_PGDATABASE',
    'MIGRATOR_PGUSER',
    'MIGRATOR_PGPOOL_MAX',
    'MIGRATOR_PGCONNECT_TIMEOUT_MS',
    'MIGRATOR_PGSTATEMENT_TIMEOUT_MS',
  ]);
  await writeEnvFile(backupEnvPath, [
    'BACKUP_IMAGE',
    'BACKUP_PGHOST',
    'BACKUP_PGPORT',
    'BACKUP_PGDATABASE',
    'BACKUP_PGUSER',
    'BACKUP_RESTIC_REPOSITORY',
  ]);
  const wrapperSource = `#!/bin/bash
set -Eeuo pipefail
umask 077
printf '%s\\n' "$@" > ${shellQuote(argumentsPath)}
docker compose --project-name mlp-prod --project-directory ${shellQuote(
    repositoryRoot,
  )} --env-file ${shellQuote(appEnvPath)} --env-file ${shellQuote(
    migratorEnvPath,
  )} --env-file ${shellQuote(backupEnvPath)} --file ${shellQuote(
    composePath,
  )} "$@" | tee ${shellQuote(renderedPath)}
`;
  let layout;
  try {
    layout = await createVerifierLayout(wrapperSource);
    const environment = interpolationEnvironment();
    const sentinels = Object.entries(environment)
      .filter(([name]) => name.startsWith('MLP_'))
      .map(([, value]) => value);
    const result = runVerifier(layout.verifierPath, environment);
    assertNoSentinelLeak(result, sentinels, 'rendered production verification');
    assert.equal(
      result.status,
      0,
      'the production verifier must accept Docker Compose JSON',
    );
    assert.equal(result.stdout, 'production config valid\n');
    assert.equal(result.stderr, '');
    assert.deepEqual(
      (await readFile(argumentsPath, 'utf8')).trim().split('\n'),
      ['--profile', '*', 'config', '--format', 'json'],
    );

    let rendered;
    try {
      rendered = JSON.parse(await readFile(renderedPath, 'utf8'));
    } catch {
      assert.fail('the sibling wrapper did not return Docker Compose JSON');
    }
    assertRenderedProductionContract(rendered, source, interpolationValues);
  } finally {
    await Promise.all([
      rm(fixtureRoot, { force: true, recursive: true }),
      layout
        ? rm(layout.root, { force: true, recursive: true })
        : Promise.resolve(),
    ]);
  }
});

test(
  'fresh hardened PostgreSQL bootstrap accepts its SCRAM secret and rejects a wrong password',
  { timeout: runtimeTimeoutMs },
  async (t) => {
    const docker = dockerComposeStatus();
    if (!docker.daemon) {
      t.skip(
        `${docker.reason}; fresh-volume UID 70 and wrong-password proof remain mandatory Linux CI gates`,
      );
      return;
    }
    await readRequiredText('compose.production.yml');

    const projectName = `mlp-task9-pg-${randomBytes(6).toString('hex')}`;
    const environment = interpolationEnvironment();
    const sentinels = Object.entries(environment)
      .filter(([name]) => name.startsWith('MLP_'))
      .map(([, value]) => value);
    let secretFixture;
    let bodyError;
    try {
      const pull = spawnSync(
        'docker',
        ['pull', '--platform', 'linux/amd64', postgresImage],
        {
          encoding: 'utf8',
          env: environment,
          killSignal: 'SIGKILL',
          timeout: 120_000,
        },
      );
      assertNoSentinelLeak(pull, sentinels, 'PostgreSQL image pull');
      if (pull.error || pull.status !== 0) {
        assert.fail(
          `pinned PostgreSQL image pull failed\n${sanitizedProcessDiagnostics(
            pull,
            sentinels,
          )}`,
        );
      }
      secretFixture = await createComposeSecretFixture(environment, sentinels);
      const start = spawnSync(
        'docker',
        composeArguments(
          projectName,
          ['up', '--detach', '--wait', '--wait-timeout', '90', 'postgres'],
          secretFixture.overridePath,
        ),
        {
          encoding: 'utf8',
          env: environment,
          killSignal: 'SIGKILL',
          timeout: 120_000,
        },
      );
      assertNoSentinelLeak(start, sentinels, 'PostgreSQL bootstrap');
      if (start.error || start.status !== 0) {
        const logs = spawnSync(
          'docker',
          composeArguments(
            projectName,
            ['logs', '--no-color', 'postgres'],
            secretFixture.overridePath,
          ),
          {
            encoding: 'utf8',
            env: environment,
            killSignal: 'SIGKILL',
            timeout: commandTimeoutMs,
          },
        );
        assertNoSentinelLeak(logs, sentinels, 'PostgreSQL bootstrap logs');
        assert.fail(
          `fresh hardened PostgreSQL bootstrap failed\nstart:\n${sanitizedProcessDiagnostics(
            start,
            sentinels,
          )}\nlogs:\n${sanitizedProcessDiagnostics(logs, sentinels)}`,
        );
      }

      const mountedSecret = spawnSync(
        'docker',
        composeArguments(
          projectName,
          [
            'exec',
            '--no-TTY',
            'postgres',
            '/bin/sh',
            '-ceu',
            postgresHealthShell.replaceAll('$$', '$'),
          ],
          secretFixture.overridePath,
        ),
        {
          encoding: 'utf8',
          env: environment,
          killSignal: 'SIGKILL',
          timeout: commandTimeoutMs,
        },
      );
      assertNoSentinelLeak(
        mountedSecret,
        sentinels,
        'mounted migrator-secret probe',
      );
      assert.equal(
        mountedSecret.status,
        0,
        'the mounted migrator secret must authenticate the exact TCP health query',
      );

      const wrongPassword = spawnSync(
        'docker',
        composeArguments(
          projectName,
          [
            'exec',
            '--no-TTY',
            '--env',
            'PGPASSWORD=task9-deliberately-wrong',
            'postgres',
            'psql',
            '-h',
            '127.0.0.1',
            '-w',
            '-X',
            '-qAt',
            '-U',
            'portfolio_migrator',
            '-d',
            'portfolio',
            '-c',
            'select 1',
          ],
          secretFixture.overridePath,
        ),
        {
          encoding: 'utf8',
          env: environment,
          killSignal: 'SIGKILL',
          timeout: commandTimeoutMs,
        },
      );
      assertNoSentinelLeak(wrongPassword, sentinels, 'wrong-password probe');
      assert.equal(
        wrongPassword.status === 0,
        false,
        'a wrong PostgreSQL password must fail over TCP',
      );
    } catch (error) {
      bodyError = error;
    }

    if (secretFixture) {
      const cleanup = spawnSync(
        'docker',
        composeArguments(
          projectName,
          ['down', '--volumes', '--remove-orphans', '--timeout', '10'],
          secretFixture.overridePath,
        ),
        {
          encoding: 'utf8',
          env: environment,
          killSignal: 'SIGKILL',
          timeout: 60_000,
        },
      );
      assertNoSentinelLeak(cleanup, sentinels, 'PostgreSQL cleanup');
      await rm(secretFixture.root, { force: true, recursive: true });
      if (cleanup.error || cleanup.status !== 0) {
        throw new Error(
          `Task 9 PostgreSQL test and cleanup failed\n${sanitizedProcessDiagnostics(
            cleanup,
            sentinels,
          )}`,
          { cause: bodyError },
        );
      }
    }
    if (bodyError) throw bodyError;
  },
);
