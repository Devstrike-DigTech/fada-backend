import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucketName: string;
  private readonly publicUrl: string;

  constructor(private readonly configService: ConfigService) {
    const accountId = this.configService.get<string>('storage.r2.accountId');
    const accessKey = this.configService.get<string>('storage.r2.accessKey');
    const secretKey = this.configService.get<string>('storage.r2.secretKey');

    this.bucketName = this.configService.get<string>(
      'storage.r2.bucketName',
      'fada-storage',
    );
    this.publicUrl = this.configService.get<string>(
      'storage.r2.publicUrl',
      '',
    );

    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: accessKey ?? '',
        secretAccessKey: secretKey ?? '',
      },
    });
  }

  async upload(
    buffer: Buffer,
    mimeType: string,
    folder: string,
    filename?: string,
  ): Promise<string> {
    const key = `${folder}/${filename ?? uuidv4()}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );

    this.logger.debug(`Uploaded file: ${key}`);
    return `${this.publicUrl}/${key}`;
  }

  async delete(url: string): Promise<void> {
    const key = url.replace(`${this.publicUrl}/`, '');
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }),
    );
    this.logger.debug(`Deleted file: ${key}`);
  }
}
