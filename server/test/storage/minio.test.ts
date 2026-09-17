import { randomUUID } from "node:crypto";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, describe, expect, it } from "vitest";
import { MinioStorage } from "../../src/storage/minio";

const enabled = process.env.RUN_MINIO_TESTS === "1";
const bucket = process.env.MINIO_TEST_BUCKET ?? "family-learning-mvp-test";
const endpoint = process.env.MINIO_TEST_ENDPOINT ?? "127.0.0.1";
const port = Number(process.env.MINIO_TEST_PORT ?? "19000");
const accessKey = process.env.MINIO_TEST_ACCESS_KEY ?? "family_learning_api";
const secretKey = process.env.MINIO_TEST_SECRET_KEY ?? "family_test_app_secret_local";
const publicUrl = process.env.MINIO_TEST_PUBLIC_URL ?? `http://${endpoint}:${port}`;
const appOrigin = "http://localhost:5173";
const storage = enabled
  ? new MinioStorage({
      endpoint,
      port,
      useSsl: false,
      accessKey,
      secretKey,
      bucket,
      publicUrl,
    })
  : undefined;
const objectKeys: string[] = [];
const multipartUploads: Array<{ key: string; uploadId: string }> = [];

describe.skipIf(!enabled)("MinIO multipart adapter integration", () => {
  afterAll(async () => {
    if (!storage) return;
    await Promise.all(multipartUploads.map(({ key, uploadId }) =>
      storage.abortMultipartUpload(key, uploadId).catch(() => undefined),
    ));
    await Promise.all(objectKeys.map((key) => storage.deleteObject(key).catch(() => undefined)));
    storage.close();
  });

  it("uploads, completes, inspects and deletes an object using a public signed part URL", async () => {
    if (!storage) throw new Error("MinIO integration storage is not configured");
    expect(bucket).toMatch(/test/i);
    const key = `integration-test/${randomUUID()}.mp4`;
    objectKeys.push(key);
    let stage = "ensure bucket";
    try {
      await storage.ensureBucket();
      await storage.ensureBucket();
      stage = "check exact-origin CORS preflight";
      const preflight = await fetch(`${publicUrl}/${bucket}/${key}`, {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "PUT",
          "Access-Control-Request-Headers": "content-type",
        },
      });
      expect(preflight.headers.get("access-control-allow-origin")).toBe(appOrigin);
      expect(preflight.headers.get("access-control-allow-origin")).not.toBe("*");
      expect(preflight.headers.get("access-control-allow-methods")).toContain("PUT");
      stage = "create multipart upload";
      const uploadId = await storage.createMultipartUpload(key, "video/mp4");
      multipartUploads.push({ key, uploadId });
      stage = "sign upload part";
      const partUrl = await storage.presignUploadPart(key, uploadId, 1);
      expect(new URL(partUrl).origin).toBe(new URL(publicUrl).origin);
      const payload = new TextEncoder().encode("test-mp4-part");
      stage = "PUT signed part";
      const put = await fetch(partUrl, {
        method: "PUT",
        headers: { Origin: appOrigin, "Content-Type": "application/octet-stream" },
        body: payload,
      });
      expect(put.ok).toBe(true);
      expect(put.headers.get("access-control-allow-origin")).toBe(appOrigin);
      expect(put.headers.get("etag")).toBeTruthy();

      stage = "list uploaded parts";
      const parts = await storage.listParts(key, uploadId);
      expect(parts).toHaveLength(1);
      stage = "complete multipart upload";
      await storage.completeMultipartUpload(key, uploadId, parts);
      stage = "head object";
      expect(await storage.headObject(key)).toMatchObject({ byteSize: BigInt(payload.byteLength), contentType: "video/mp4" });
      stage = "verify the bucket is private without a signed URL";
      const anonymousRead = await fetch(`${publicUrl}/${bucket}/${key}`);
      expect(anonymousRead.status).toBe(403);
      const anonymousList = await fetch(`${publicUrl}/${bucket}?list-type=2`);
      expect(anonymousList.status).toBe(403);
      stage = "verify public playback signing and HTTP Range";
      const playbackUrl = await storage.presignGetObject(key);
      expect(new URL(playbackUrl).origin).toBe(new URL(publicUrl).origin);
      const ranged = await fetch(playbackUrl, { headers: { Range: "bytes=0-3", Origin: appOrigin } });
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get("content-range")).toMatch(/^bytes 0-3\//u);
      expect(ranged.headers.get("access-control-allow-origin")).toBe(appOrigin);
      stage = "delete object";
      await storage.deleteObject(key);
      await expect(storage.headObject(key)).rejects.toThrow();
    } catch (error) {
      const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
      const details = cause instanceof Error ? `${cause.name}: ${cause.message}` : "";
      throw new Error(`${stage} failed: ${error instanceof Error ? error.name + ": " + error.message : String(error)} ${details}`);
    }
  });

  it("aborts an incomplete multipart upload", async () => {
    if (!storage) throw new Error("MinIO integration storage is not configured");
    expect(bucket).toMatch(/test/i);
    const key = `integration-test/${randomUUID()}.mp4`;
    const uploadId = await storage.createMultipartUpload(key, "video/mp4");
    multipartUploads.push({ key, uploadId });
    await storage.abortMultipartUpload(key, uploadId);
    await expect(storage.listParts(key, uploadId)).rejects.toThrow();
  });

  it("does not grant the application credentials MinIO-wide administrative access", async () => {
    const client = new S3Client({
      endpoint: publicUrl,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    });
    try {
      await expect(client.send(new CreateBucketCommand({ Bucket: `unrelated-${randomUUID()}` })))
        .rejects.toMatchObject({ $metadata: { httpStatusCode: 403 } });
    } finally {
      client.destroy();
    }
  });
});
