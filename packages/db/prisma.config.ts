import { defineConfig } from 'prisma/config';

// O Prisma 7 não lê .env sozinho: DATABASE_URL vem do ambiente
// (Compose, Makefile ou `export` no terminal). `prisma generate` não precisa dele.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://placeholder:placeholder@localhost:5432/placeholder',
  },
});
