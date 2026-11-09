/**
 * Cria (ou recria) o dono do painel: e-mail, senha e 2FA por TOTP.
 *
 * Uso interativo (recomendado):   make owner
 * Não interativo (testes/CI):      OWNER_EMAIL=... OWNER_PASSWORD=... pnpm owner:create
 */
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { encryptionEnvSchema, loadEncryptionKey, parseEnv } from '@studio/shared';
import QRCode from 'qrcode';
import { createOwner, getPrisma, LOGIN_POLICY } from '../src';

async function askHidden(question: string): Promise<string> {
  if (!stdin.isTTY) {
    const rl = createInterface({ input: stdin });
    const it = rl[Symbol.asyncIterator]();
    const line = (await it.next()).value ?? '';
    rl.close();
    return String(line);
  }
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve) => {
    let value = '';
    const onData = (ch: string) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        stdout.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        process.exit(130);
      } else if (ch === '\u007f') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const { TOKEN_ENCRYPTION_KEY } = parseEnv(encryptionEnvSchema);
  const key = loadEncryptionKey(TOKEN_ENCRYPTION_KEY);

  let email = process.env.OWNER_EMAIL ?? '';
  let password = process.env.OWNER_PASSWORD ?? '';
  if (!email) {
    const rl = createInterface({ input: stdin, output: stdout });
    email = (await rl.question('E-mail do dono do painel: ')).trim();
    rl.close();
  }
  if (!password) {
    password = await askHidden(`Senha (mín. ${LOGIN_POLICY.minPasswordLength} caracteres): `);
    const confirm = await askHidden('Repita a senha: ');
    if (password !== confirm) throw new Error('As senhas não conferem.');
  }

  const prisma = getPrisma();
  const owner = await createOwner(prisma, key, {
    email,
    password,
    ...(process.env.OWNER_TOTP_SECRET ? { totpSecret: process.env.OWNER_TOTP_SECRET } : {}),
  });
  await prisma.$disconnect();

  console.log('\n✅ Dono do painel criado:', owner.email);
  console.log(
    '\n1) Escaneie o QR code no app autenticador (Google Authenticator, Authy, 1Password...):\n',
  );
  console.log(await QRCode.toString(owner.otpauthUri, { type: 'terminal', small: true }));
  console.log('   Se não conseguir escanear, digite esta chave no app:', owner.totpSecret);
  console.log(
    '\n2) Guarde estes códigos de recuperação num lugar seguro (cada um vale uma vez):\n',
  );
  for (const c of owner.recoveryCodes) console.log('   ', c);
  console.log(
    '\n3) Abra http://localhost:3000 e entre com e-mail, senha e o código de 6 dígitos.\n',
  );
}

main().catch((err: unknown) => {
  console.error('❌', err instanceof Error ? err.message : err);
  process.exit(1);
});
