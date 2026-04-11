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

    // OpenRouter returns images as data URLs in the images array
    const images = (message as any).images;
    if (!images || images.length === 0) {
      throw new Error('OpenRouter: failed to generate image - no images in response');
    }

    const dataUrl: string = images[0];

    // Parse data URL: "data:image/png;base64,<data>"
    const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      return {
        imageData: match[2],
        mimeType: match[1],
      };
    }

    // If it's raw base64 without the data URL prefix
    return {
      imageData: dataUrl,
      mimeType: 'image/png',
    };
  }
}
