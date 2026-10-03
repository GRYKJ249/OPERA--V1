import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, chmod, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { openDb } from '../server/db.ts';

const GITEA_VERSION = '1.27.3';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workPath = resolve(root, 'runtime/gitea');
const dataPath = resolve(workPath, 'data');
const customPath = resolve(workPath, 'custom');
const binaryPath = resolve(workPath, `gitea-${GITEA_VERSION}`);
const configPath = resolve(customPath, 'conf/app.ini');
const themeSource = resolve(root, 'gitea/theme-opera.css');
const themeTarget = resolve(customPath, 'public/assets/css/theme-opera.css');

function ini(value: string, forceQuoted = false): string {
  if (/[\r\n\0]/.test(value)) throw new Error('A Gitea configuration value contains an unsupported control character.');
  if (value.includes('"""')) throw new Error('A Gitea configuration value cannot be safely quoted.');
  return forceQuoted || /[#;]/.test(value) ? `"""${value}"""` : value;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function ensureGiteaBinary(): Promise<void> {
  if (await fileExists(binaryPath)) return;
  await mkdir(workPath, { recursive: true });

  const fileName = `gitea-${GITEA_VERSION}-linux-amd64`;
  const releaseBase = `https://github.com/go-gitea/gitea/releases/download/v${GITEA_VERSION}`;
  const checksumResponse = await fetch(`${releaseBase}/${fileName}.sha256`);
  if (!checksumResponse.ok) throw new Error(`Could not fetch the checksum for Gitea ${GITEA_VERSION}.`);
  const expected = (await checksumResponse.text()).match(/\b([a-f0-9]{64})\s+\*?gitea-[^\s]+/i)?.[1];
  if (!expected) throw new Error(`The Gitea ${GITEA_VERSION} checksum file was not in the expected format.`);

  const response = await fetch(`${releaseBase}/${fileName}`);
  if (!response.ok || !response.body) throw new Error(`Could not download the official Gitea ${GITEA_VERSION} binary.`);
  const temporaryPath = `${binaryPath}.${process.pid}.download`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporaryPath, { mode: 0o700 }));
  const actual = await sha256(temporaryPath);
  if (actual !== expected) {
    await import('node:fs/promises').then(({ rm }) => rm(temporaryPath, { force: true }));
    throw new Error('The downloaded Gitea binary failed its SHA-256 check.');
  }
  await chmod(temporaryPath, 0o700);
  await rename(temporaryPath, binaryPath);
}

async function runtimeSecrets(): Promise<{ secretKey: string; internalToken: string; lfsJwtSecret: string }> {
  const secretsPath = resolve(workPath, 'runtime-secrets.json');
  try {
    return JSON.parse(await readFile(secretsPath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const secrets = {
    secretKey: randomBytes(32).toString('hex'),
    internalToken: randomBytes(32).toString('hex'),
    lfsJwtSecret: randomBytes(32).toString('hex'),
  };
  await writeFile(secretsPath, `${JSON.stringify(secrets)}\n`, { mode: 0o600, flag: 'wx' });
  return secrets;
}

function databaseSettings(): { host: string; name: string; user: string; password: string; sslMode: string } {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing; Gitea uses Opera’s existing PostgreSQL database.');
  const url = new URL(process.env.DATABASE_URL);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  if (!url.hostname || !databaseName || !url.username) throw new Error('DATABASE_URL is missing required PostgreSQL connection details.');
  const sslMode = url.searchParams.get('sslmode') || process.env.PGSSLMODE || 'require';
  return {
    host: `${url.hostname}:${url.port || '5432'}`,
    name: databaseName,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    sslMode,
  };
}

async function writeGiteaConfig(): Promise<void> {
  const db = databaseSettings();
  const secrets = await runtimeSecrets();
  const configuredOrigin = process.env.PUBLIC_URL?.trim().replace(/\/+$/, '');
  const origin = configuredOrigin
    || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : `http://127.0.0.1:${process.env.PORT || 5000}`);
  const publicUrl = new URL(origin);
  if (!['http:', 'https:'].includes(publicUrl.protocol)) throw new Error('PUBLIC_URL must use HTTP or HTTPS.');

  await mkdir(resolve(customPath, 'conf'), { recursive: true });
  await mkdir(resolve(customPath, 'public/assets/css'), { recursive: true });
  await mkdir(resolve(dataPath, 'repositories'), { recursive: true });
  await mkdir(resolve(dataPath, 'attachments'), { recursive: true });
  await mkdir(resolve(dataPath, 'lfs'), { recursive: true });
  await copyFile(themeSource, themeTarget);

  const config = [
    '[DEFAULT]',
    `APP_NAME = ${ini('Gitea · Opera')}`,
    `RUN_USER = ${ini(userInfo().username)}`,
    'RUN_MODE = prod',
    `WORK_PATH = ${ini(workPath)}`,
    '',
    '[server]',
    `APP_DATA_PATH = ${ini(dataPath)}`,
    `DOMAIN = ${ini(publicUrl.hostname)}`,
    'HTTP_ADDR = 127.0.0.1',
    'HTTP_PORT = 3001',
    'PROTOCOL = http',
    `ROOT_URL = ${ini(`${publicUrl.origin}/gitea/`)}`,
    'DISABLE_SSH = true',
    'START_SSH_SERVER = false',
    'LFS_START_SERVER = true',
    `LFS_JWT_SECRET = ${ini(secrets.lfsJwtSecret)}`,
    '',
    '[database]',
    'DB_TYPE = postgres',
    `HOST = ${ini(db.host)}`,
    `NAME = ${ini(db.name)}`,
    `USER = ${ini(db.user)}`,
    `PASSWD = ${ini(db.password, true)}`,
    `SSL_MODE = ${ini(db.sslMode)}`,
    'SCHEMA = gitea',
    'CHARSET = utf8',
    '',
    '[service]',
    'ENABLE_REVERSE_PROXY_AUTHENTICATION = true',
    'ENABLE_REVERSE_PROXY_AUTO_REGISTRATION = true',
    'REVERSE_PROXY_AUTHENTICATION_USER = X-WEBAUTH-USER',
    'REVERSE_PROXY_AUTHENTICATION_EMAIL = X-WEBAUTH-EMAIL',
    'REVERSE_PROXY_AUTHENTICATION_FULL_NAME = X-WEBAUTH-FULLNAME',
    '',
    '[security]',
    'INSTALL_LOCK = true',
    `SECRET_KEY = ${ini(secrets.secretKey)}`,
    `INTERNAL_TOKEN = ${ini(secrets.internalToken)}`,
    '',
    '[repository]',
    `ROOT = ${ini(resolve(dataPath, 'repositories'))}`,
    '',
    '[attachment]',
    `PATH = ${ini(resolve(dataPath, 'attachments'))}`,
    '',
    '[lfs]',
    `PATH = ${ini(resolve(dataPath, 'lfs'))}`,
    '',
    '[session]',
    'PROVIDER = file',
    `PROVIDER_CONFIG = ${ini(resolve(dataPath, 'sessions'))}`,
    '',
    '[ui]',
    'DEFAULT_THEME = opera',
    'THEMES = opera',
    '',
    '[log]',
    'MODE = console',
    'LEVEL = Info',
    '',
  ].join('\n');
  await writeFile(configPath, config, { mode: 0o600 });
}

async function checkGiteaSchema(): Promise<void> {
  const db = openDb();
  try {
    const result = await db.query("SELECT 1 FROM pg_namespace WHERE nspname = 'gitea'");
    if (!result.rowCount) throw new Error('The gitea schema is missing. Run `npm run gitea:init` once, then restart the app.');
  } finally {
    await db.close();
  }
}

async function main(): Promise<void> {
  await checkGiteaSchema();
  await ensureGiteaBinary();
  await writeGiteaConfig();

  const gitea = spawn(binaryPath, [
    'web',
    '--config', configPath,
    '--work-path', workPath,
    '--custom-path', customPath,
  ], {
    cwd: root,
    env: { ...process.env, PGOPTIONS: '-c search_path=gitea,public' },
    stdio: 'inherit',
  });
  const opera = spawn(process.execPath, [
    '--no-warnings',
    '--env-file-if-exists=.env',
    'server/serve.ts',
  ], { cwd: root, env: process.env, stdio: 'inherit' });

  let stopping = false;
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    if (gitea.exitCode === null) gitea.kill('SIGTERM');
    if (opera.exitCode === null) opera.kill('SIGTERM');
  };
  for (const child of [gitea, opera]) {
    child.on('error', (error) => {
      console.error('[services] A child service could not start:', error.message);
      stop(1);
    });
    child.on('exit', (code, signal) => {
      if (!stopping) {
        console.error(`[services] A child service stopped (${signal ?? code ?? 'unknown'}); stopping the other service.`);
        stop(code ?? 1);
      }
    });
  }
  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));
}

main().catch((error) => {
  console.error('[setup] Could not start Opera and Gitea:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});