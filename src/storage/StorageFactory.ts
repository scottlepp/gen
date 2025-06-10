import { BlobStorage } from './BlobStorage';
import { MinIOStorage } from './MinIOStorage';

export class StorageFactory {
  private static instance: BlobStorage | null = null;

  static getInstance(): BlobStorage {
    if (!this.instance) {
      this.instance = this.createStorage();
    }
    return this.instance;
  }

  private static createStorage(): BlobStorage {
    // For now, default to MinIO
    // This can be made configurable via environment variables
    const storageType = process.env.STORAGE_TYPE || 'minio';

    switch (storageType.toLowerCase()) {
      case 'minio':
        // Parse endpoint URL if it's provided as a full URL
        let endPoint = process.env.MINIO_ENDPOINT || 'localhost';
        let useSSL = process.env.MINIO_USE_SSL === 'true';
        let port = parseInt(process.env.MINIO_PORT || '9000');
        
        // Handle full URLs (e.g., https://minio-xyz.domain.com)
        if (endPoint.startsWith('http://') || endPoint.startsWith('https://')) {
          const url = new URL(endPoint);
          endPoint = url.hostname;
          useSSL = url.protocol === 'https:';
          port = url.port ? parseInt(url.port) : (useSSL ? 443 : 80);
        }

        return new MinIOStorage({
          endPoint,
          port,
          useSSL,
          accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
          secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
          bucketName: process.env.MINIO_BUCKET_NAME || 'fitness-app',
          baseUrl: process.env.MINIO_BASE_URL,
        });
      
      default:
        throw new Error(`Unsupported storage type: ${storageType}`);
    }
  }

  // For testing purposes
  static setInstance(storage: BlobStorage): void {
    this.instance = storage;
  }

  // Reset the singleton instance
  static reset(): void {
    this.instance = null;
  }
} 