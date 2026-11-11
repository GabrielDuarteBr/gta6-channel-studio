import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dbPackageDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Aplica as migrations no banco de teste, se TEST_DATABASE_URL estiver definido. */
export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
