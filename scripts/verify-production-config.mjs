#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

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
const rootKeys = [
  'name',
  'networks',
  'secrets',
  'services',
  'volumes',
  'x-harden',
  'x-logging',
];
const expectedServiceKeys = {
  app: [
    'cap_drop',
    'command',
    'depends_on',
    'entrypoint',
    'environment',
    'healthcheck',
    'image',
    'logging',
    'networks',
    'read_only',
    'restart',
    'secrets',
    'security_opt',
    'tmpfs',
    'user',
  ],
  caddy: [
    'cap_drop',
    'command',
    'depends_on',
    'entrypoint',
    'environment',
    'healthcheck',
    'image',
    'logging',
    'networks',
    'read_only',
    'restart',
    'security_opt',
    'tmpfs',
    'user',
    'volumes',
  ],
  'cloudflared-a': [
    'cap_drop',
    'command',
    'depends_on',
    'entrypoint',
    'healthcheck',
    'image',
    'logging',
    'networks',
    'read_only',
    'restart',
    'secrets',
    'security_opt',
    'ulimits',
    'user',
  ],
  'cloudflared-b': [
    'cap_drop',
    'command',
    'depends_on',
    'entrypoint',
    'healthcheck',
    'image',
    'logging',
    'networks',
    'read_only',
    'restart',
    'secrets',
    'security_opt',
    'ulimits',
    'user',
  ],
  'db-backup': [
    'cap_drop',
    'command',
    'depends_on',
    'entrypoint',
    'environment',
    'image',
    'logging',
    'networks',
    'profiles',
    'read_only',
    'restart',
    'secrets',
    'security_opt',
    'tmpfs',
    'user',
  ],
  migrator: [
    'cap_drop',
    'command',
    'depends_on',
    'entrypoint',
    'environment',
    'healthcheck',
    'image',
    'logging',
    'networks',
    'read_only',
    'restart',
    'secrets',
    'security_opt',
    'tmpfs',
    'user',
  ],
  postgres: [
    'cap_drop',
    'command',
    'entrypoint',
    'environment',
    'healthcheck',
    'image',
    'logging',
    'networks',
    'read_only',
    'restart',
    'secrets',
    'security_opt',
    'tmpfs',
    'user',
    'volumes',
  ],
};
const permanentServices = [
  'app',
  'caddy',
  'cloudflared-a',
  'cloudflared-b',
  'postgres',
];
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
  app: [
    '/app/.next/cache:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=0700',
    '/tmp:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=1770',
  ],
  caddy: [
    '/config:rw,noexec,nosuid,nodev,uid=65532,gid=65532,mode=0700',
    '/data:rw,noexec,nosuid,nodev,uid=65532,gid=65532,mode=0700',
    '/tmp:rw,noexec,nosuid,nodev,uid=65532,gid=65532,mode=1770',
  ],
  'cloudflared-a': [],
  'cloudflared-b': [],
  'db-backup': ['/tmp:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=1770'],
  migrator: ['/tmp:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=1770'],
  postgres: [
    '/tmp:rw,noexec,nosuid,nodev,uid=70,gid=70,mode=1770',
    '/var/run/postgresql:rw,noexec,nosuid,nodev,uid=70,gid=70,mode=0770',
  ],
};
const secretFiles = [
  'cloudflare-tunnel-token-cloudflared-a',
  'cloudflare-tunnel-token-cloudflared-b',
  'journal-mac-keyring-app',
  'journal-r2-access-key-id-app',
  'journal-r2-secret-access-key-app',
  'postgres-app-password-app',
  'postgres-app-password-postgres',
  'postgres-backup-password-db-backup',
  'postgres-backup-password-postgres',
  'postgres-bootstrap-password-postgres',
  'postgres-migrator-password-migrator',
  'postgres-migrator-password-postgres',
  'restic-password-db-backup',
  'restic-s3-access-key-id-db-backup',
  'restic-s3-secret-access-key-db-backup',
];
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
const expectedDependencies = {
  app: {
    migrator: 'service_completed_successfully',
    postgres: 'service_healthy',
  },
  caddy: { app: 'service_healthy' },
  'cloudflared-a': { caddy: 'service_healthy' },
  'cloudflared-b': { caddy: 'service_healthy' },
  'db-backup': { postgres: 'service_healthy' },
  migrator: { postgres: 'service_healthy' },
  postgres: undefined,
};
const exactImages = {
  cloudflared:
    'cloudflare/cloudflared:2026.7.1@sha256:188bb03589a32affed3cf4d0590565ffe67b78866e6b5582574afab2b705bafe',
  postgres:
    'postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15',
};
const postgresHealth =
  'PGPASSWORD="$$(cat /run/secrets/postgres-migrator-password)" exec ' +
  "psql -h 127.0.0.1 -w -X -qAt -U portfolio_migrator -d portfolio -c 'select 1' >/dev/null";

function invariant(condition) {
  if (!condition) throw new Error('production configuration invariant failed');
}

function mapping(value) {
  invariant(value && typeof value === 'object' && !Array.isArray(value));
  return value;
}

function keys(value) {
  return Object.keys(mapping(value)).sort();
}

function exactKeys(value, expected) {
  invariant(isDeepStrictEqual(keys(value), expected.slice().sort()));
}

function exactValue(actual, expected) {
  invariant(isDeepStrictEqual(actual, expected));
}

function nullish(value) {
  return value === undefined || value === null;
}

function immutableImage(value) {
  return (
    typeof value === 'string' &&
    /^[a-z0-9][a-z0-9./_-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)?@sha256:[0-9a-f]{64}$/u.test(
      value,
    )
  );
}

function validateTopLevel(config) {
  exactKeys(config, rootKeys);
  invariant(config.name === 'mlp-prod');
  exactKeys(config.services, serviceNames);
  exactKeys(config.networks, networkNames);
  exactKeys(config.volumes, ['postgres-data']);
  exactKeys(config.secrets, secretFiles);
  exactValue(config['x-harden'], {
    cap_drop: ['ALL'],
    read_only: true,
    security_opt: ['no-new-privileges:true'],
  });
  exactValue(config['x-logging'], {
    driver: 'json-file',
    options: { 'max-file': '5', 'max-size': '10m' },
  });

  for (const name of networkNames) {
    const network = mapping(config.networks[name]);
    invariant(network.name === `mlp-prod_${name}`);
    invariant((network.driver ?? 'bridge') === 'bridge');
    invariant(network.external !== true);
    invariant(network.driver_opts === undefined);
    if (network.ipam !== undefined) exactKeys(network.ipam, []);
    if (name === 'egress') invariant(network.internal !== true);
    else invariant(network.internal === true);
  }

  const dataVolume = mapping(config.volumes['postgres-data']);
  invariant(dataVolume.name === 'mlp-prod_postgres-data');
  invariant((dataVolume.driver ?? 'local') === 'local');
  invariant(dataVolume.external !== true);
  invariant(dataVolume.driver_opts === undefined);

  for (const name of secretFiles) {
    const secret = mapping(config.secrets[name]);
    invariant(secret.file === `/etc/mlp/compose-secrets/${name}`);
    invariant(secret.name === `mlp-prod_${name}`);
    exactKeys(secret, ['file', 'name']);
  }
}

function validateServiceKeys(services) {
  for (const name of serviceNames) {
    exactKeys(services[name], expectedServiceKeys[name]);
  }
}

function validateImages(services, candidateAppImage) {
  invariant(services.postgres.image === exactImages.postgres);
  invariant(
    /^ghcr\.io\/martinlindblad\/mlp-caddy@sha256:[0-9a-f]{64}$/u.test(
      services.caddy.image,
    ),
  );
  invariant(services['cloudflared-a'].image === exactImages.cloudflared);
  invariant(services['cloudflared-b'].image === exactImages.cloudflared);
  invariant(services.app.image === services.migrator.image);
  if (candidateAppImage !== undefined) {
    invariant(services.app.image === candidateAppImage);
    invariant(services.migrator.image === candidateAppImage);
  }
  for (const service of Object.values(services)) {
    invariant(immutableImage(service.image));
    invariant(service.build === undefined);
  }
}

function validateForbiddenSurfaces(service) {
  for (const name of [
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
  ]) {
    invariant(service[name] === undefined);
  }
  invariant(nullish(service.entrypoint));
  invariant(service.env_file === undefined);
}

function validateNetworkMembership(services) {
  for (const name of serviceNames) {
    const networks = mapping(services[name].networks);
    exactKeys(networks, expectedNetworks[name]);
    for (const [networkName, attachmentValue] of Object.entries(networks)) {
      const attachment = mapping(attachmentValue);
      if (networkName === 'egress') {
        invariant(attachment.gw_priority === 1);
        exactKeys(attachment, ['gw_priority']);
      } else {
        exactKeys(attachment, []);
      }
    }
  }
}

function validateHardening(services) {
  for (const name of serviceNames) {
    const service = mapping(services[name]);
    invariant(service.user === expectedUsers[name]);
    invariant(service.read_only === true);
    exactValue(service.cap_drop, ['ALL']);
    exactValue(service.security_opt, ['no-new-privileges:true']);
    exactValue((service.tmpfs ?? []).slice().sort(), expectedTmpfs[name]);
    exactValue(service.logging, {
      driver: 'json-file',
      options: { 'max-file': '5', 'max-size': '10m' },
    });
    validateForbiddenSurfaces(service);
  }
}

function normalizeSecretMounts(service) {
  return (service.secrets ?? [])
    .map((secretValue) => {
      const secret = mapping(secretValue);
      exactKeys(secret, ['source', 'target']);
      return [secret.source, secret.target];
    })
    .sort(([left], [right]) => left.localeCompare(right));
}

function validateSecrets(services) {
  for (const name of serviceNames) {
    exactValue(
      normalizeSecretMounts(services[name]),
      expectedSecretMounts[name],
    );
  }
  for (const name of serviceNames.filter((entry) => entry !== 'postgres')) {
    invariant(
      !JSON.stringify(services[name]).includes('postgres-bootstrap-password'),
    );
  }
}

function validateEnvironment(services) {
  exactValue(services.postgres.environment, {
    POSTGRES_DB: 'portfolio',
    POSTGRES_INITDB_ARGS: '--auth-host=scram-sha-256',
    POSTGRES_PASSWORD_FILE: '/run/secrets/postgres-bootstrap-password',
    POSTGRES_USER: 'postgres',
  });
  const appEnvironment = mapping(services.app.environment);
  exactKeys(appEnvironment, [
    'JOURNAL_ACTIVE_KEY_ID',
    'JOURNAL_AGE_RECIPIENT',
    'JOURNAL_MAC_KEYRING_FILE',
    'JOURNAL_R2_ACCESS_KEY_ID_FILE',
    'JOURNAL_R2_BUCKET',
    'JOURNAL_R2_ENDPOINT',
    'JOURNAL_R2_SECRET_ACCESS_KEY_FILE',
    'PGCONNECT_TIMEOUT_MS',
    'PGDATABASE',
    'PGHOST',
    'PGPASSWORD_FILE',
    'PGPOOL_MAX',
    'PGPORT',
    'PGSTATEMENT_TIMEOUT_MS',
    'PGUSER',
  ]);
  exactValue(
    Object.fromEntries(
      Object.entries(appEnvironment).filter(
        ([name]) =>
          ![
            'JOURNAL_ACTIVE_KEY_ID',
            'JOURNAL_AGE_RECIPIENT',
            'JOURNAL_R2_ENDPOINT',
          ].includes(name),
      ),
    ),
    {
      JOURNAL_MAC_KEYRING_FILE: '/run/secrets/journal-mac-keyring',
      JOURNAL_R2_ACCESS_KEY_ID_FILE:
        '/run/secrets/journal-r2-access-key-id',
      JOURNAL_R2_BUCKET: 'mlp-contact-journal',
      JOURNAL_R2_SECRET_ACCESS_KEY_FILE:
        '/run/secrets/journal-r2-secret-access-key',
      PGCONNECT_TIMEOUT_MS: '5000',
      PGDATABASE: 'portfolio',
      PGHOST: 'postgres',
      PGPASSWORD_FILE: '/run/secrets/postgres-app-password',
      PGPOOL_MAX: '5',
      PGPORT: '5432',
      PGSTATEMENT_TIMEOUT_MS: '5000',
      PGUSER: 'portfolio_app',
    },
  );
  invariant(
    /^https:\/\/[a-z0-9][a-z0-9-]*\.eu\.r2\.cloudflarestorage\.com$/u.test(
      appEnvironment.JOURNAL_R2_ENDPOINT,
    ),
  );
  invariant(!/unconfigured|placeholder|example/iu.test(appEnvironment.JOURNAL_R2_ENDPOINT));
  invariant(
    /^[a-z0-9][a-z0-9._-]{0,31}$/u.test(
      appEnvironment.JOURNAL_ACTIVE_KEY_ID,
    ),
  );
  invariant(!/^unconfigured\b/u.test(appEnvironment.JOURNAL_ACTIVE_KEY_ID));
  invariant(
    /^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/u.test(
      appEnvironment.JOURNAL_AGE_RECIPIENT,
    ),
  );
  invariant(appEnvironment.JOURNAL_AGE_RECIPIENT !== `age1${'q'.repeat(58)}`);

  exactValue(services.migrator.environment, {
    PGCONNECT_TIMEOUT_MS: '5000',
    PGDATABASE: 'portfolio',
    PGHOST: 'postgres',
    PGPASSWORD_FILE: '/run/secrets/postgres-migrator-password',
    PGPOOL_MAX: '2',
    PGPORT: '5432',
    PGSTATEMENT_TIMEOUT_MS: '60000',
    PGUSER: 'portfolio_migrator',
  });
  const caddyEnvironment = mapping(services.caddy.environment);
  exactKeys(caddyEnvironment, ['CONTACT_MODE']);
  invariant(
    ['contact-enabled', 'contact-maintenance'].includes(
      caddyEnvironment.CONTACT_MODE,
    ),
  );

  const backupEnvironment = mapping(services['db-backup'].environment);
  exactKeys(backupEnvironment, [
    'PGDATABASE',
    'PGHOST',
    'PGPASSWORD_FILE',
    'PGPORT',
    'PGUSER',
    'RESTIC_PASSWORD_FILE',
    'RESTIC_REPOSITORY',
    'RESTIC_S3_ACCESS_KEY_ID_FILE',
    'RESTIC_S3_SECRET_ACCESS_KEY_FILE',
  ]);
  exactValue(
    Object.fromEntries(
      Object.entries(backupEnvironment).filter(
        ([name]) => name !== 'RESTIC_REPOSITORY',
      ),
    ),
    {
      PGDATABASE: 'portfolio',
      PGHOST: 'postgres',
      PGPASSWORD_FILE: '/run/secrets/postgres-backup-password',
      PGPORT: '5432',
      PGUSER: 'portfolio_backup',
      RESTIC_PASSWORD_FILE: '/run/secrets/restic-password',
      RESTIC_S3_ACCESS_KEY_ID_FILE: '/run/secrets/restic-s3-access-key-id',
      RESTIC_S3_SECRET_ACCESS_KEY_FILE:
        '/run/secrets/restic-s3-secret-access-key',
    },
  );
  invariant(
    typeof backupEnvironment.RESTIC_REPOSITORY === 'string' &&
      backupEnvironment.RESTIC_REPOSITORY.length > 0 &&
      !/[@?#]/u.test(backupEnvironment.RESTIC_REPOSITORY),
  );
  for (const name of ['cloudflared-a', 'cloudflared-b']) {
    invariant(
      services[name].environment === undefined ||
        keys(services[name].environment).length === 0,
    );
  }
  for (const [serviceName, service] of Object.entries(services)) {
    for (const environmentName of keys(service.environment ?? {})) {
      invariant(!environmentName.startsWith('AWS_'));
      if (serviceName !== 'app') invariant(!environmentName.startsWith('JOURNAL_'));
    }
  }
}

function validateDependencies(services) {
  for (const name of serviceNames) {
    const expected = expectedDependencies[name];
    if (expected === undefined) {
      invariant(services[name].depends_on === undefined);
      continue;
    }
    const dependencies = mapping(services[name].depends_on);
    exactKeys(dependencies, Object.keys(expected));
    for (const [dependencyName, condition] of Object.entries(expected)) {
      const dependency = mapping(dependencies[dependencyName]);
      invariant(dependency.condition === condition);
      invariant(dependency.required !== false);
      invariant(dependency.restart !== true);
    }
  }
}

function validateLifecycle(services) {
  for (const name of permanentServices) {
    invariant(services[name].restart === 'unless-stopped');
  }
  invariant(services.migrator.restart === 'no');
  invariant(services['db-backup'].restart === 'no');
  exactValue(services['db-backup'].profiles, ['jobs']);
  for (const name of serviceNames.filter((entry) => entry !== 'db-backup')) {
    invariant(services[name].profiles === undefined);
  }

  exactValue(services.migrator.command, [
    'node',
    '/app/dist/scripts/db/migrate.js',
  ]);
  for (const name of ['app', 'caddy', 'db-backup', 'postgres']) {
    invariant(nullish(services[name].command));
  }
  const connectorCommand = [
    'tunnel',
    '--metrics',
    '127.0.0.1:2000',
    'run',
    '--token-file',
    '/run/secrets/cloudflare-tunnel-token',
  ];
  exactValue(services['cloudflared-a'].command, connectorCommand);
  exactValue(services['cloudflared-b'].command, connectorCommand);
}

function validateHealth(services) {
  const postgresTest = services.postgres.healthcheck?.test;
  invariant(
    isDeepStrictEqual(postgresTest, ['CMD-SHELL', postgresHealth]) ||
      isDeepStrictEqual(postgresTest, [
        'CMD-SHELL',
        postgresHealth.replace('$$', '$'),
      ]),
  );
  exactValue(services.app.healthcheck, {
    interval: '15s',
    retries: 4,
    start_period: '20s',
    test: [
      'CMD',
      'node',
      '-e',
      "fetch('http://127.0.0.1:3000/api/health/ready',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))",
    ],
    timeout: '5s',
  });
  exactValue(services.caddy.healthcheck, {
    interval: '15s',
    retries: 4,
    start_period: '10s',
    test: [
      'CMD',
      'wget',
      '-q',
      '--header=Host:martin-lindblad.com',
      '--header=CF-Connecting-IP:127.0.0.1',
      '--spider',
      'http://127.0.0.1:8080/api/health/live',
    ],
    timeout: '5s',
  });
  const connectorHealth = {
    interval: '15s',
    retries: 4,
    start_period: '20s',
    test: [
      'CMD',
      'cloudflared',
      'tunnel',
      '--metrics',
      '127.0.0.1:2000',
      'ready',
    ],
    timeout: '5s',
  };
  exactValue(services['cloudflared-a'].healthcheck, connectorHealth);
  exactValue(services['cloudflared-b'].healthcheck, connectorHealth);
  invariant(
    services.migrator.healthcheck?.disable === true ||
      isDeepStrictEqual(services.migrator.healthcheck?.test, ['NONE']),
  );
  invariant(services['db-backup'].healthcheck === undefined);

  for (const name of ['cloudflared-a', 'cloudflared-b']) {
    exactValue(services[name].ulimits?.nofile, {
      hard: 70000,
      soft: 70000,
    });
  }
}

function normalizedMounts(service) {
  return (service.volumes ?? []).map((mountValue) => {
    const mount = mapping(mountValue);
    invariant(['bind', 'volume'].includes(mount.type));
    invariant(
      !JSON.stringify(mount).match(
        /(?:docker\.sock|\/dev\/|\/proc\/|\/sys\/)/u,
      ),
    );
    return {
      readOnly: mount.read_only === true,
      source: mount.source,
      target: mount.target,
      type: mount.type,
    };
  });
}

function validateMounts(services) {
  const postgresMounts = normalizedMounts(services.postgres);
  invariant(postgresMounts.length === 2);
  const data = postgresMounts.find(
    (mount) => mount.target === '/var/lib/postgresql',
  );
  exactValue(data, {
    readOnly: false,
    source: 'postgres-data',
    target: '/var/lib/postgresql',
    type: 'volume',
  });
  const bootstrap = postgresMounts.find(
    (mount) => mount.target === '/docker-entrypoint-initdb.d/10-init-roles.sh',
  );
  invariant(bootstrap?.type === 'bind');
  invariant(bootstrap?.readOnly === true);
  invariant(
    /(?:^|\/)infra\/postgres\/init-roles\.sh$/u.test(bootstrap?.source ?? ''),
  );

  const caddyMounts = normalizedMounts(services.caddy);
  invariant(caddyMounts.length === 1);
  invariant(caddyMounts[0].type === 'bind');
  invariant(caddyMounts[0].readOnly === true);
  invariant(caddyMounts[0].target === '/etc/caddy');
  invariant(/(?:^|\/)infra\/caddy$/u.test(caddyMounts[0].source ?? ''));

  for (const name of serviceNames.filter(
    (entry) => !['caddy', 'postgres'].includes(entry),
  )) {
    invariant(normalizedMounts(services[name]).length === 0);
  }
}

export function validateProductionConfig(config, candidateAppImage) {
  mapping(config);
  validateTopLevel(config);
  const services = mapping(config.services);
  validateServiceKeys(services);
  validateImages(services, candidateAppImage);
  validateNetworkMembership(services);
  validateHardening(services);
  validateSecrets(services);
  validateEnvironment(services);
  validateDependencies(services);
  validateLifecycle(services);
  validateHealth(services);
  validateMounts(services);
  return true;
}

function renderThroughWrapper(wrapperArguments) {
  const wrapperPath = fileURLToPath(
    new URL('../ops/compose.sh', import.meta.url),
  );
  const result = spawnSync(
    wrapperPath,
    [...wrapperArguments, '--profile', '*', 'config', '--format', 'json'],
    {
      encoding: 'utf8',
      env: process.env,
      killSignal: 'SIGKILL',
      maxBuffer: 5 * 1024 * 1024,
      timeout: 30_000,
    },
  );
  invariant(!result.error && result.status === 0 && result.signal === null);
  invariant(result.stderr === '');
  return JSON.parse(result.stdout);
}

function argumentsToForward(args) {
  if (args.length === 0) return [];
  invariant(args.length === 2 && args[0] === '--candidate-app-image');
  invariant(/^ghcr\.io\/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$/u.test(args[1]));
  return args;
}

function main() {
  try {
    const wrapperArguments = argumentsToForward(process.argv.slice(2));
    validateProductionConfig(
      renderThroughWrapper(wrapperArguments),
      wrapperArguments[1],
    );
    process.stdout.write('production config valid\n');
  } catch {
    process.stderr.write('production config invalid\n');
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1]
  ? realpathSync(path.resolve(process.argv[1]))
  : '';
if (invokedPath === realpathSync(fileURLToPath(import.meta.url))) main();
