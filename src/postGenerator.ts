import { GoogleGenerativeAI } from '@google/generative-ai';
const { GoogleGenAI } = require("@google/genai");
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { put } from '@vercel/blob';
import fs from 'fs';

dotenv.config();

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

// Initialize database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

interface ExercisePost {
  title: string;
  content: string;
  image_url: string;
  author: string;
  user_id: string;
}

async function generatePostContent(exercise: string): Promise<ExercisePost> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  const imageModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp-image-generation' })

  // Generate content about the exercise
  const contentPrompt = `Write a detailed description of how to perform ${exercise} correctly, including proper form, common mistakes to avoid, and benefits. Make it engaging and informative.`;
  const contentResult = await model.generateContent(contentPrompt);
  const content = contentResult.response.text();

  // Generate image prompt
  const imagePrompt = `Create a detailed, realistic image of a person performing ${exercise} with proper form. The person should be in a modern gym setting with good lighting. The image should be photorealistic and clearly show the exercise technique.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash-exp-image-generation',
    contents: imagePrompt,
    config: {
      responseModalities: ['Text', 'Image']
    },
  });

  let imageData: string | null = null;

  for (const part of response.candidates[0].content.parts) {
    // Based on the part type, either show the text or save the image
    if (part.text) {
      console.log(part.text);
    } else if (part.inlineData && part.inlineData.data) {
      imageData = part.inlineData.data;
      const buffer = Buffer.from(part.inlineData.data, 'base64');
      fs.writeFileSync('gemini-native-image.png', buffer);
      console.log('Image saved as gemini-native-image.png');
    }
  }

  // // Generate the image
  // const imageResult = await imageModel.generateContent({
  //   contents: [{ role: 'user', parts: [{ text: imagePrompt }] }],
  //   generationConfig: {
  //     temperature: 0.7,
  //     topK: 40,
  //     topP: 0.95,
  //     maxOutputTokens: 1024,
  //   }
  // });

  // // Get the image data from the response
  // let imageData: Buffer | null = null;
  // const response = imageResult.response;
  // if (response.candidates && response.candidates[0]?.content?.parts) {
  //   for (const part of response.candidates[0].content.parts) {
  //     if (part.inlineData) {
  //       imageData = Buffer.from(part.inlineData.data, 'base64');
  //       break;
  //     }
  //   }
  // }

  if (!imageData) {
    throw new Error('Failed to generate image');
  }

  // Analyze the generated image
  const analysisPrompt = `Analyze this image of a person performing ${exercise} and provide a rating from 1-10, where:
  1 = Completely incorrect/unsuitable
  10 = Perfect representation
  
  Consider these criteria:
  1. Correct exercise form (0-3 points)
  2. Clear visibility of the exercise (0-2 points)
  3. Image quality and lighting (0-2 points)
  4. Appropriate gym setting (0-3 points)
  
  Start your response with "Rating: X/10" followed by a detailed explanation of the score and any issues found.`;

  const analysisResult = await ai.models.generateContent({
    model: 'gemini-2.0-flash-exp-image-generation',
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

  const analysis = analysisResult.candidates[0].content.parts[0].text;
  console.log('Image Analysis:', analysis);

  // Create a Blob from the image data
  const imageBlob = new Blob([Buffer.from(imageData, 'base64')], { type: 'image/png' });
  const imageFileName = `${exercise.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.png`;

  // Upload to Vercel Blob
  const blob = await put(`exercises/${imageFileName}`, imageBlob, {
    access: 'public',
  });

  return {
    title: `How to Perform ${exercise} Correctly`,
    content,
    image_url: blob.url,
    author: 'Fitness Expert',
    user_id: 'system'
  };
}

async function saveToDatabase(post: ExercisePost): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO posts (title, content, image_url, author, user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [post.title, post.content, post.image_url, post.author, post.user_id]
    );
    console.log('Post saved successfully');
  } catch (error) {
    console.error('Error saving to database:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function generateAndSavePost(exercise: string): Promise<void> {
  try {
    const post = await generatePostContent(exercise);
    await saveToDatabase(post);
    console.log(`Successfully generated and saved content for ${exercise}`);
  } catch (error) {
    console.error('Error in generateAndSaveExercise:', error);
    throw error;
  }
}

// Example usage
async function main() {
  try {
    await generateAndSavePost('Squats');
  } catch (error) {
    console.error('Main error:', error);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

export { generateAndSavePost}; 