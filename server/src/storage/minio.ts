import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type MinioStorageConfig = {
  endpoint: string;
  port: number;
  useSsl: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
  publicUrl: string;
};

export type UploadedPart = { partNumber: number; etag: string; size: number };
export type ObjectHead = { byteSize: bigint; contentType: string | null };

export interface MediaStorage {
  createMultipartUpload(key: string, contentType: string): Promise<string>;
  presignUploadPart(key: string, uploadId: string, partNumber: number): Promise<string>;
  listParts(key: string, uploadId: string): Promise<UploadedPart[]>;
  completeMultipartUpload(key: string, uploadId: string, parts: UploadedPart[]): Promise<void>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  headObject(key: string): Promise<ObjectHead>;
  presignGetObject(key: string): Promise<string>;
  presignInternalGetObject(key: string): Promise<string>;
  deleteObject(key: string): Promise<void>;
  ensureBucket(): Promise<void>;
  close(): void;
}

export class MinioStorage implements MediaStorage {
  private readonly internalClient: S3Client;
  private readonly publicClient: S3Client;

  constructor(private readonly config: MinioStorageConfig) {
    const credentials = { accessKeyId: config.accessKey, secretAccessKey: config.secretKey };
    const internalProtocol = config.useSsl ? "https" : "http";
    this.internalClient = new S3Client({
      endpoint: `${internalProtocol}://${config.endpoint}:${config.port}`,
      region: "us-east-1",
      forcePathStyle: true,
      credentials,
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
    this.publicClient = new S3Client({
      endpoint: config.publicUrl,
      region: "us-east-1",
      forcePathStyle: true,
      credentials,
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
  }

  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    const result = await this.internalClient.send(new CreateMultipartUploadCommand({
      Bucket: this.config.bucket,
      Key: key,
      ContentType: contentType,
    }));
    if (!result.UploadId) throw new Error("Object storage did not return an upload ID");
    return result.UploadId;
  }

  async presignUploadPart(key: string, uploadId: string, partNumber: number): Promise<string> {
    return getSignedUrl(this.publicClient, new UploadPartCommand({
      Bucket: this.config.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    }), { expiresIn: 15 * 60 });
  }

  async listParts(key: string, uploadId: string): Promise<UploadedPart[]> {
    const parts: UploadedPart[] = [];
    let marker: string | undefined;
    do {
      const page = await this.internalClient.send(new ListPartsCommand({
        Bucket: this.config.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumberMarker: marker,
      }));
      for (const part of page.Parts ?? []) {
        if (part.PartNumber !== undefined && part.ETag) {
          parts.push({ partNumber: part.PartNumber, etag: part.ETag, size: part.Size ?? 0 });
        }
      }
      marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
    } while (marker !== undefined);
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: UploadedPart[]): Promise<void> {
    const completed: CompletedPart[] = parts.map(({ partNumber, etag }) => ({
      PartNumber: partNumber,
      ETag: etag,
    }));
    await this.internalClient.send(new CompleteMultipartUploadCommand({
      Bucket: this.config.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: completed },
    }));
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.internalClient.send(new AbortMultipartUploadCommand({
      Bucket: this.config.bucket,
      Key: key,
      UploadId: uploadId,
    }));
  }

  async headObject(key: string): Promise<ObjectHead> {
    const result = await this.internalClient.send(new HeadObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    }));
    if (result.ContentLength === undefined) throw new Error("Object storage returned no object size");
    return {
      byteSize: BigInt(result.ContentLength),
      contentType: result.ContentType ?? null,
    };
  }

  async presignGetObject(key: string): Promise<string> {
    return getSignedUrl(this.publicClient, new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    }), { expiresIn: 2 * 60 * 60 });
  }

  async presignInternalGetObject(key: string): Promise<string> {
    return getSignedUrl(this.internalClient, new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    }), { expiresIn: 15 * 60 });
  }

  async deleteObject(key: string): Promise<void> {
    await this.internalClient.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  async ensureBucket(): Promise<void> {
    try {
      try {
        await this.internalClient.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
      } catch (error) {
        const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (candidate.name !== "NotFound" && candidate.name !== "NoSuchBucket" &&
          candidate.$metadata?.httpStatusCode !== 404) throw error;
        await this.internalClient.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
      }
    } catch (error) {
      throw new Error("MinIO bucket initialization failed", { cause: error });
    }
  }

  close(): void {
    this.internalClient.destroy();
    this.publicClient.destroy();
  }
}
