export interface BlobStorage {
  /**
   * Upload a file to blob storage
   * @param fileName - The name/path of the file
   * @param data - The file data (Buffer, Blob, or Uint8Array)
   * @param options - Upload options
   * @returns Promise resolving to the public URL of the uploaded file
   */
  upload(fileName: string, data: Buffer | Blob | Uint8Array, options?: UploadOptions): Promise<string>;
  
  /**
   * Delete a file from blob storage
   * @param fileName - The name/path of the file to delete
   */
  delete(fileName: string): Promise<void>;
  
  /**
   * Get a signed URL for a file (if supported)
   * @param fileName - The name/path of the file
   * @param expiresIn - Expiration time in seconds
   */
  getSignedUrl?(fileName: string, expiresIn?: number): Promise<string>;
}

export interface UploadOptions {
  access?: 'public' | 'private';
  contentType?: string;
  cacheControl?: string;
} 