import OpenAI from 'openai';
import { ImageGenerator, ImageGenerationRequest, ImageGenerationResult } from './ImageGenerator';

export class OpenRouterImageGenerator implements ImageGenerator {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'openrouter/auto') {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    });
    this.model = model;
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const content: OpenAI.Chat.ChatCompletionContentPart[] = [
      { type: 'text', text: request.prompt },
    ];

    if (request.referenceImage) {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:${request.referenceImage.mimeType};base64,${request.referenceImage.data}`,
        },
      });
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
      // @ts-ignore - OpenRouter extension for image generation
      modalities: ['image'],
    });

    const message = response.choices[0]?.message;
    if (!message) {
      throw new Error('OpenRouter: failed to generate image - no message in response');
    }

    const rawMessage = message as any;
    console.log('OpenRouter response keys:', Object.keys(rawMessage));

    // Try images array first (OpenRouter's documented format)
    const images = rawMessage.images;
    if (images && images.length > 0) {
      const img = images[0];
      console.log('OpenRouter image type:', typeof img);

      // Could be a data URL string
      if (typeof img === 'string') {
        const match = img.match(/^data:(image\/[\w+]+);base64,(.+)$/);
        if (match) {
          return { imageData: match[2], mimeType: match[1] };
        }
        // Raw base64 string
        return { imageData: img, mimeType: 'image/png' };
      }

      // Could be an object like { type: "image_url", image_url: { url: "data:..." } }
      if (typeof img === 'object') {
        if (img.b64_json) {
          return { imageData: img.b64_json, mimeType: img.content_type || 'image/png' };
        }
        // Handle { type: "image_url", image_url: { url: "data:..." } }
        const url = img.image_url?.url || img.url;
        if (url && typeof url === 'string') {
          const urlMatch = url.match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (urlMatch) {
            return { imageData: urlMatch[2], mimeType: urlMatch[1] };
          }
        }
      }
    }

    // Try multimodal content array (some models return parts)
    if (Array.isArray(rawMessage.content)) {
      for (const part of rawMessage.content) {
        if (part.type === 'image_url' && part.image_url?.url) {
          const match = part.image_url.url.match(/^data:(image\/[\w+]+);base64,(.+)$/);
          if (match) {
            return { imageData: match[2], mimeType: match[1] };
          }
        }
      }
    }

    console.log('OpenRouter full response message:', JSON.stringify(rawMessage, null, 2).slice(0, 500));
    throw new Error('OpenRouter: failed to extract image data from response');
  }
}
