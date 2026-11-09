/** Render de teste: `pnpm --filter @studio/render render:hello [--vertical] [--1080]` */
import { baseEnvSchema, parseEnv, profileDefaults } from '@studio/shared';
import { renderHello } from '../render-hello';

const env = parseEnv(baseEnvSchema);
const height = process.argv.includes('--1080')
  ? 1080
  : profileDefaults(env.APP_PROFILE).renderHeight;
const report = await renderHello({
  outDir: process.env.RENDER_OUT_DIR ?? 'out',
  height,
  vertical: process.argv.includes('--vertical'),
});
console.log(JSON.stringify(report));
