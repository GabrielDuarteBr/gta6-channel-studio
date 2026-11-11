import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dbPackageDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Banco de teste próprio por pacote (ex.: studio_test_db, studio_test_agents): o Turbo
 * roda os pacotes em paralelo e um TRUNCATE de um não pode apagar os dados do outro.
 * O `prisma migrate deploy` cria o banco se não existir e aplica as migrations.
 */
export function packageTestUrl(baseUrl: string, pkg: string): string {
  const u = new URL(baseUrl);
  const base = u.pathname.replace(/^\//, '') || 'studio_test';
  u.pathname = `/${base}_${pkg.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  return u.toString();
}

export default function setup(): void {
  const baseUrl = process.env.TEST_DATABASE_URL;
  if (!baseUrl) return;
  const url = packageTestUrl(baseUrl, basename(process.cwd()));
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  // Os workers do Vitest herdam o ambiente do processo principal.
  process.env.TEST_DATABASE_URL = url;
}
