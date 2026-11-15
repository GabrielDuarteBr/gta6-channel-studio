#!/usr/bin/env node
// Todo pacote do workspace precisa estar na etapa "deps" do Dockerfile; senão o
// pnpm install da imagem não instala as dependências dele (falha só em produção).
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const dockerfile = readFileSync('infra/docker/node.Dockerfile', 'utf8');
const missing = [];
for (const group of ['apps', 'packages']) {
  for (const name of readdirSync(group)) {
    const dir = `${group}/${name}`;
    if (!existsSync(`${dir}/package.json`)) continue;
    if (!dockerfile.includes(`COPY ${dir}/package.json ${dir}/`)) missing.push(dir);
  }
}
if (missing.length) {
  console.error(`❌ Faltam na etapa deps do infra/docker/node.Dockerfile: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('✅ Todos os pacotes do workspace estão na etapa deps do Dockerfile.');
