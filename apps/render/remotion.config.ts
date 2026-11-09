import { Config } from '@remotion/cli/config';

// Usado pelo Remotion Studio (`pnpm --filter @studio/render studio`).
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
