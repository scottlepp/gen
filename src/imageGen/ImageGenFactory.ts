import { ImageGenerator } from './ImageGenerator';
import { GeminiImageGenerator } from './GeminiImageGenerator';

export class ImageGenFactory {
  private static instance: ImageGenerator | null = null;

  static getInstance(): ImageGenerator {
    if (!this.instance) {
      this.instance = this.createGenerator();
    }
    return this.instance;
  }

  private static createGenerator(): ImageGenerator {
    const provider = process.env.IMAGE_GEN_PROVIDER || 'gemini';
    const model = process.env.IMAGE_GEN_MODEL;

    switch (provider.toLowerCase()) {
      case 'gemini':
      case 'google':
        return new GeminiImageGenerator(
          process.env.GOOGLE_API_KEY || '',
          model || 'gemini-2.5-flash-image'
        );

      case 'openrouter': {
        // Lazy import to avoid requiring openai package when using other providers
        const { OpenRouterImageGenerator } = require('./OpenRouterImageGenerator');
        return new OpenRouterImageGenerator(
          process.env.OPENROUTER_API_KEY || '',
          model || 'openrouter/auto'
        );
      }

      default:
        throw new Error(`Unsupported image generation provider: ${provider}`);
    }
  }

  static setInstance(generator: ImageGenerator): void {
    this.instance = generator;
  }

  static reset(): void {
    this.instance = null;
  }
}
