import "server-only";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "@/backend/config/env";
import { STORAGE } from "@/backend/constants/app.constants";
import { AppError } from "@/backend/errors/AppError";

let client: S3Client | undefined;

/** Cloudflare R2 through its S3-compatible API. Credentials stay server-side. */
function r2(): S3Client {
  if (client) return client;
  const env = getEnv();
  client = new S3Client({
    region: "auto",
    endpoint: env.R2_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
  return client;
}

export const statementBucket = () => getEnv().R2_BUCKET;

/** Object key: `<user_id>/<import_id>/<safe name>`. The user prefix lets the ledger enforce ownership. */
export function statementKey(userId: string, importId: string, fileName: string): string {
  const safe = fileName.replace(/[^\w.-]+/g, "_").slice(-120);
  return `${userId}/${importId}/${safe}`;
}

const isNotFound = (err: unknown) =>
  err instanceof S3ServiceException && (err.$metadata.httpStatusCode === 404 || err.name === "NotFound" || err.name === "NoSuchKey");

const upstream = (err: unknown, message?: string) => new AppError("UPSTREAM", { internal: err, message });

export const statementStorage = {
  /** Presigned PUT so the browser uploads straight to R2 (bypasses the serverless body limit). */
  async createUploadUrl(key: string): Promise<string> {
    try {
      return await getSignedUrl(r2(), new PutObjectCommand({ Bucket: statementBucket(), Key: key }), {
        expiresIn: STORAGE.SIGNED_UPLOAD_TTL_SECONDS,
      });
    } catch (err) {
      throw upstream(err);
    }
  },

  /** Size and content type of the stored object, or null if it isn't there (yet). */
  async head(key: string): Promise<{ sizeBytes: number; contentType: string | null } | null> {
    try {
      const res = await r2().send(new HeadObjectCommand({ Bucket: statementBucket(), Key: key }));
      return { sizeBytes: res.ContentLength ?? 0, contentType: res.ContentType ?? null };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw upstream(err);
    }
  },

  async download(key: string): Promise<Buffer> {
    try {
      const res = await r2().send(new GetObjectCommand({ Bucket: statementBucket(), Key: key }));
      if (!res.Body) throw new Error("empty body");
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if (isNotFound(err)) throw new AppError("NOT_FOUND", { message: "The uploaded file is no longer available. Upload it again." });
      throw upstream(err, "The uploaded file could not be read.");
    }
  },

  /** Idempotent: deleting a missing object succeeds. */
  async remove(key: string): Promise<void> {
    try {
      await r2().send(new DeleteObjectCommand({ Bucket: statementBucket(), Key: key }));
    } catch (err) {
      throw upstream(err);
    }
  },
};
