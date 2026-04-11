export interface ImageGenerationRequest {
  prompt: string;
  referenceImage?: {
    data: string;       // base64-encoded image
    mimeType: string;   // e.g., 'image/png'
  };
}

export interface ImageGenerationResult {
  imageData: string;    // base64-encoded image data
  mimeType: string;     // e.g., 'image/png'
}

export interface ImageGenerator {
  generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
}
