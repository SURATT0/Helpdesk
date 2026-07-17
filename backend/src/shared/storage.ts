import fs from "node:fs/promises";
import path from "node:path";
import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { env } from "../config/env";

/**
 * Storage adapter. `LocalStorage` (dev) and `S3Storage` (prod) both implement
 * this; the concrete driver is chosen from env. Only the adapter touches the
 * filesystem / S3 — the rest of the app depends on the interface.
 */
export interface IFileStorage {
  save(key: string, data: Buffer): Promise<{ key: string; url: string }>;
  read(key: string): Promise<Buffer>;
  /** Remove an object. Missing objects are not an error (idempotent). */
  delete(key: string): Promise<void>;
  getUrl(key: string): string;
}

class LocalStorage implements IFileStorage {
  constructor(private readonly dir: string) {}

  async save(key: string, data: Buffer) {
    const full = path.join(this.dir, key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    return { key, url: this.getUrl(key) };
  }

  read(key: string) {
    return fs.readFile(path.join(this.dir, key));
  }

  async delete(key: string) {
    try {
      await fs.unlink(path.join(this.dir, key));
    } catch (err) {
      // Already gone → idempotent success; rethrow anything else.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  getUrl(key: string) {
    return `/uploads/${key}`;
  }
}

class S3Storage implements IFileStorage {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    opts: {
      region: string;
      endpoint?: string;
      forcePathStyle: boolean;
      accessKeyId?: string;
      secretAccessKey?: string;
      publicUrl?: string;
    },
  ) {
    this.publicUrl = opts.publicUrl;
    this.client = new S3Client({
      region: opts.region,
      // Set for S3-compatible servers (MinIO); omitted for real AWS S3.
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      // MinIO and most non-AWS servers only speak path-style addressing.
      forcePathStyle: opts.forcePathStyle,
      // Explicit creds when provided; otherwise fall back to the AWS default
      // credential chain (IAM role / shared config) for real S3.
      ...(opts.accessKeyId && opts.secretAccessKey
        ? {
            credentials: {
              accessKeyId: opts.accessKeyId,
              secretAccessKey: opts.secretAccessKey,
            },
          }
        : {}),
    });
  }

  private readonly publicUrl?: string;

  async save(key: string, data: Buffer) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }),
    );
    return { key, url: this.getUrl(key) };
  }

  async read(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    // The v3 SDK's Body exposes transformToByteArray() in Node — a single-shot
    // read that avoids manual stream plumbing.
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  getUrl(key: string) {
    if (this.publicUrl) return `${this.publicUrl.replace(/\/$/, "")}/${key}`;
    return `s3://${this.bucket}/${key}`;
  }
}

export const storage: IFileStorage =
  env.storageDriver === "s3"
    ? new S3Storage(env.s3Bucket, {
        region: env.s3Region,
        endpoint: env.s3Endpoint,
        forcePathStyle: env.s3ForcePathStyle,
        accessKeyId: env.s3AccessKeyId,
        secretAccessKey: env.s3SecretAccessKey,
        publicUrl: env.s3PublicUrl,
      })
    : new LocalStorage(env.localStorageDir);
