import { getAllSettings, getPrisma } from '@studio/db';
import { baseEnvSchema, parseEnv, profileDefaults, type AppProfile } from '@studio/shared';

/** Perfil efetivo: sobreposição do painel ou APP_PROFILE do .env. */
export async function effectiveState() {
  const env = parseEnv(baseEnvSchema);
  const settings = await getAllSettings(getPrisma());
  const override = settings['profile.override'];
  const profile: AppProfile = override === 'env' ? env.APP_PROFILE : override;
  return { env, settings, profile, profileInfo: profileDefaults(profile) };
}
