import { GoogleGenAI } from "@google/genai";
import { ImageGenerator, ImageGenerationRequest, ImageGenerationResult } from './ImageGenerator';

export class GeminiImageGenerator implements ImageGenerator {
  private ai: InstanceType<typeof GoogleGenAI>;
  private model: string;

  constructor(apiKey: string, model: string = 'gemini-2.5-flash-image') {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const parts: any[] = [{ text: request.prompt }];

    if (request.referenceImage) {
      parts.push({
        inlineData: {
          mimeType: request.referenceImage.mimeType,
          data: request.referenceImage.data,
        },
      });
    }

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ parts }],
      config: {
        responseModalities: ['Text', 'Image'],
      },
    });

    if (!response.candidates || response.candidates.length === 0) {
      throw new Error('Gemini: failed to generate image - no candidates');
    }

    const candidate = response.candidates[0];
    if (!candidate.content || !candidate.content.parts) {
      throw new Error('Gemini: failed to generate image - no content');
    }

    for (const part of candidate.content.parts) {
      if (part.inlineData && part.inlineData.data) {
        return {
          imageData: part.inlineData.data,
          mimeType: part.inlineData.mimeType || 'image/png',
        };
      }
    }

    throw new Error('Gemini: failed to generate image - no image data in response');
  }
}
