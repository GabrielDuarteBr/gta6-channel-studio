#!/usr/bin/env node
// Falha se o repositório depender de ferramentas de download do YouTube.
// Regra inegociável 1: o sistema NUNCA baixa vídeos do YouTube.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const list = JSON.parse(readFileSync(join(root, 'scripts/forbidden-deps.json'), 'utf8'));
const problems = [];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 1) Lockfile do pnpm (inclui dependências transitivas)
const lock = join(root, 'pnpm-lock.yaml');
if (existsSync(lock)) {
  const text = readFileSync(lock, 'utf8');
  for (const name of list.npm) {
    const re = new RegExp(`(^|[\\s'"/])${escape(name)}@`, 'm');
    if (re.test(text)) problems.push(`npm: ${name} (pnpm-lock.yaml)`);
  }
}

// 2) Arquivos Python e Dockerfiles
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.git', '.venv', '.next', 'dist', '.turbo'].includes(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const files = walk(root).filter((f) =>
  /(pyproject\.toml|requirements[^/]*\.txt|uv\.lock|Dockerfile[^/]*|\.Dockerfile|\.sh)$/.test(f),
);
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const name of [...list.python, ...list.binaries]) {
    const re = new RegExp(`(^|[\\s"'=/])${escape(name)}([\\s"'=<>~!\\[]|$)`, 'mi');
    if (re.test(text)) problems.push(`${name} em ${f.replace(root, '')}`);
  }
}

if (problems.length) {
  console.error('❌ Dependências proibidas encontradas (download do YouTube não é permitido):');
  for (const p of problems) console.error(`   - ${p}`);
  process.exit(1);
}
console.log('✅ Nenhuma dependência de download do YouTube encontrada.');
