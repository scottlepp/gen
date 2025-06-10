import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

export async function analyzeImage(exercise: string) {
    const imageData = fs.readFileSync('gemini-native-image.png', 'base64');
  
    // Analyze the generated image
    const analysisPrompt = `Analyze this image of a person performing ${exercise} and provide a rating from 1-10, where:
    1 = Completely incorrect/unsuitable
    10 = Perfect representation
    
    Consider these criteria:
    1. Correct exercise form (0-5 points)
    2. Clear visibility of the exercise (0-3 points)
    3. Image quality and lighting (0-1 points)
    4. Appropriate gym setting (0-1 points)
    
    Start your response with "Rating: X/10" followed by a detailed explanation of the score and any issues found.`;
  
    const analysisResult = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-05-20',
      contents: [
        {
          parts: [
            { text: analysisPrompt },
            {
              inlineData: {
                mimeType: 'image/png',
                data: imageData
              }
            }
          ]
        }
      ],
      config: {
        responseModalities: ['Text']
      }
    });
  
    if (analysisResult.candidates === undefined || analysisResult.candidates.length === 0) {
      throw new Error('Failed to analyze image - no candidates');
    }
  
    const analysisCandidate = analysisResult.candidates[0];
    if (analysisCandidate.content === undefined || analysisCandidate.content.parts === undefined) {
      throw new Error('Failed to generate image - no content');
    }
  
    const analysis = analysisCandidate.content.parts[0].text;
    console.log('Image Analysis:', analysis);

    const rating = analysis?.match(/Rating: (\d+)\/10/)?.[1];
    if (rating === undefined) {
      throw new Error('Failed to analyze image - no rating');
    }
    const ratingNumber = parseInt(rating);
    if (isNaN(ratingNumber)) {
      throw new Error('Failed to analyze image - invalid rating');
    }

    console.log('Rating:', ratingNumber);

    if (ratingNumber < 8) {
        console.log('Image is not a good representation of the exercise');
        throw new Error('Image is not a good representation of the exercise');
    }

    return imageData;
  }

  async function main() {
    try {
      await analyzeImage('dips');
    } catch (error) {
      console.error('Main error:', error);
      process.exit(1); // Exit with error code
    } finally {
    }
  }
  
  if (require.main === module) {
    main();
  }
  