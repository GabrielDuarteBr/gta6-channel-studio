import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // Os testes de integração compartilham o mesmo banco de teste.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
