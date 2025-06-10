#!/usr/bin/env ts-node

import { StorageFactory } from './StorageFactory';
import dotenv from 'dotenv';

dotenv.config();

async function testStorage() {
  try {
    console.log('Testing storage abstraction...');
    
    // Get storage instance
    const storage = StorageFactory.getInstance();
    console.log('Storage instance created successfully');
    
    // Create a test file
    const testContent = Buffer.from('Hello, MinIO Storage!', 'utf-8');
    const fileName = `test/test-${Date.now()}.txt`;
    
    // Upload the file
    console.log('Uploading test file...');
    const uploadedUrl = await storage.upload(fileName, testContent, {
      access: 'public',
      contentType: 'text/plain'
    });
    console.log('File uploaded successfully:', uploadedUrl);
    
    // Optionally get signed URL
    if (storage.getSignedUrl) {
      console.log('Getting signed URL...');
      const signedUrl = await storage.getSignedUrl(fileName, 3600);
      console.log('Signed URL:', signedUrl);
    }
    
    // Clean up - delete the test file
    console.log('Cleaning up test file...');
    await storage.delete(fileName);
    console.log('Test file deleted successfully');
    
    console.log('✅ Storage test completed successfully!');
    
  } catch (error) {
    console.error('❌ Storage test failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  testStorage();
} 