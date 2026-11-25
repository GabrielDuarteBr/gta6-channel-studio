import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/** Armazenamento de objetos (S3 puro: SeaweedFS no notebook, qualquer S3 na VPS). */
export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  head(key: string): Promise<{ size: number } | null>;
  delete(key: string): Promise<void>;
  /** Envio em fluxo (vídeos grandes): o tamanho precisa ser conhecido. */
  putStream(key: string, body: Readable, length: number, contentType: string): Promise<void>;
  /** Leitura em fluxo (vídeos grandes). */
  getStream(key: string): Promise<Readable>;
}

export class StorageError extends Error {
  override name = 'StorageError';
}

export interface S3Config {
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
}

/**
 * Chaves aceitas, sem "..": Biblioteca, produções, envios do painel ainda não processados
 * (incoming/), provas de permissão de parceiros (partners/) e camadas da arte do personagem
 * (character-art/).
 */
const KEY = /^(library|productions|incoming|partners|character-art)\/[a-z0-9][a-z0-9._/-]{0,200}$/;

export function assertKey(key: string): void {
  if (!KEY.test(key) || key.includes('..') || key.includes('//')) {
    throw new StorageError(`chave de armazenamento inválida: ${key}`);
  }
}

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(cfg: S3Config) {
    this.bucket = cfg.S3_BUCKET;
    this.client = new S3Client({
      endpoint: cfg.S3_ENDPOINT,
      region: cfg.S3_REGION,
      // SeaweedFS (e MinIO) usam endereço por caminho: http://s3:8333/<bucket>/<chave>
      forcePathStyle: true,
      credentials: { accessKeyId: cfg.S3_ACCESS_KEY, secretAccessKey: cfg.S3_SECRET_KEY },
    });
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    assertKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Uint8Array> {
    assertKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) throw new StorageError(`objeto vazio: ${key}`);
      return await res.Body.transformToByteArray();
    } catch (err) {
      if (err instanceof NoSuchKey) throw new StorageError(`objeto não encontrado: ${key}`);
      throw err;
    }
  }

  async head(key: string): Promise<{ size: number } | null> {
    assertKey(key);
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0 };
    } catch (err) {
      if (err instanceof NotFound || err instanceof NoSuchKey) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async putStream(key: string, body: Readable, length: number, contentType: string) {
    assertKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentLength: length,
        ContentType: contentType,
      }),
    );
  }

  async getStream(key: string): Promise<Readable> {
    assertKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) throw new StorageError(`objeto vazio: ${key}`);
      return res.Body as Readable;
    } catch (err) {
      if (err instanceof NoSuchKey) throw new StorageError(`objeto não encontrado: ${key}`);
      throw err;
    }
  }
}

/** Para testes: tudo em memória. */
export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    assertKey(key);
    this.objects.set(key, { body: new Uint8Array(body), contentType });
  }

  async get(key: string): Promise<Uint8Array> {
    assertKey(key);
    const o = this.objects.get(key);
    if (!o) throw new StorageError(`objeto não encontrado: ${key}`);
    return o.body;
  }

  async head(key: string): Promise<{ size: number } | null> {
    const o = this.objects.get(key);
    return o ? { size: o.body.byteLength } : null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async putStream(key: string, body: Readable, length: number, contentType: string) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
    const all = Buffer.concat(chunks);
    if (all.byteLength !== length) throw new StorageError('tamanho não confere');
    await this.put(key, all, contentType);
  }

  async getStream(key: string): Promise<Readable> {
    return Readable.from([Buffer.from(await this.get(key))]);
  }
}
