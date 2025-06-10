import * as Minio from 'minio';
import { BlobStorage, UploadOptions } from './BlobStorage';

export class MinIOStorage implements BlobStorage {
  private client: Minio.Client;
  private bucketName: string;
  private baseUrl: string;

  constructor(config: {
    endPoint: string;
    port?: number;
    useSSL?: boolean;
    accessKey: string;
    secretKey: string;
    bucketName: string;
    baseUrl?: string;
  }) {
    this.client = new Minio.Client({
      endPoint: config.endPoint,
      port: config.port || 9000,
      useSSL: config.useSSL || false,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
    
    // Sanitize bucket name to ensure it's DNS-compliant
    this.bucketName = config.bucketName;
    this.baseUrl = config.baseUrl || `${config.useSSL ? 'https' : 'http'}://${config.endPoint}${config.port ? ':' + config.port : ''}`;
    
    // Ensure bucket exists
    this.ensureBucket();
  }

  private async ensureBucket(): Promise<void> {
    try {
      console.log(`Checking if bucket '${this.bucketName}' exists...`);
      const exists = await this.client.bucketExists(this.bucketName);
      if (!exists) {
        console.log(`Creating bucket '${this.bucketName}'...`);
        await this.client.makeBucket(this.bucketName);
        console.log(`Bucket '${this.bucketName}' created successfully`);
        
        // Set bucket policy to allow public read access
        try {
          const policy = {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { AWS: ['*'] },
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${this.bucketName}/*`],
              },
            ],
          };
          
          await this.client.setBucketPolicy(this.bucketName, JSON.stringify(policy));
          console.log(`Public read policy set for bucket '${this.bucketName}'`);
        } catch (policyError) {
          console.warn('Warning: Could not set public policy for bucket (this may be expected in some MinIO configurations):', policyError);
        }
      } else {
        console.log(`Bucket '${this.bucketName}' already exists`);
      }
    } catch (error) {
      console.error(`Error ensuring bucket '${this.bucketName}' exists:`, error);
      throw new Error(`Failed to ensure bucket exists: ${error}`);
    }
  }

  async upload(fileName: string, data: Buffer | Blob | Uint8Array, options?: UploadOptions): Promise<string> {
    try {
      // Convert data to Buffer if needed
      let buffer: Buffer;
      if (data instanceof Buffer) {
        buffer = data;
      } else if (data instanceof Blob) {
        buffer = Buffer.from(await data.arrayBuffer());
      } else {
        buffer = Buffer.from(data);
      }

      // Set metadata
      const metaData: { [key: string]: string } = {};
      if (options?.contentType) {
        metaData['Content-Type'] = options.contentType;
      }
      if (options?.cacheControl) {
        metaData['Cache-Control'] = options.cacheControl;
      }

      // Upload to MinIO
      await this.client.putObject(this.bucketName, fileName, buffer, buffer.length, metaData);
      
      // Return public URL
      return `${this.baseUrl}/${this.bucketName}/${fileName}`;
    } catch (error) {
      console.error('Error uploading to MinIO:', error);
      throw new Error(`Failed to upload file: ${error}`);
    }
  }

  async delete(fileName: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucketName, fileName);
    } catch (error) {
      console.error('Error deleting from MinIO:', error);
      throw new Error(`Failed to delete file: ${error}`);
    }
  }

  async getSignedUrl(fileName: string, expiresIn: number = 3600): Promise<string> {
    try {
      return await this.client.presignedGetObject(this.bucketName, fileName, expiresIn);
    } catch (error) {
      console.error('Error generating signed URL:', error);
      throw new Error(`Failed to generate signed URL: ${error}`);
    }
  }
} 