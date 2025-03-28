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

interface Profile {
  user_id: string;
  display_name: string;
  bio: string;
  avatar_url?: string;
  custom_avatar_url: string | null;
}

async function generateProfileContent(userId: string, preferences: {
  fitnessLevel?: string;
  goals?: string[];
  interests?: string[];
}): Promise<Profile> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  // Generate profile content
  const contentPrompt = `Create a fitness enthusiast profile for a user with the following characteristics:
  - Fitness Level: ${preferences.fitnessLevel || 'intermediate'}
  - Goals: ${preferences.goals?.join(', ') || 'general fitness and health'}
  - Interests: ${preferences.interests?.join(', ') || 'strength training, cardio'}
  
  Generate a display name and a compelling bio that reflects their fitness journey and personality.
  
  The display name should:
  - Be 2-3 words maximum
  - Be fitness-themed but not cheesy
  - Not include numbers or special characters
  - Be memorable and unique
  - Avoid common fitness clichés
  - Be suitable for a professional fitness app
  
  Examples of good display names:
  - "Iron Will"
  - "Swift Runner"
  - "Zen Warrior"
  - "Peak Performance"
  - "Core Crusader"
  
  Examples of bad display names to avoid:
  - "FitnessKing123"
  - "GymRat_2024"
  - "WorkoutWarrior!!!"
  - "Fit4Life"
  - "GymGod"
  
  IMPORTANT: Return ONLY a JSON object in this exact format, with no additional text or markdown:
  {"displayName": "string", "bio": "string"}`;

  const contentResult = await model.generateContent(contentPrompt);
  const content = contentResult.response.text();
  
  // Clean the response and parse JSON
  let profileData: { displayName: string; bio: string };
  try {
    // Remove any markdown code block markers and clean the response
    const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
    profileData = JSON.parse(cleanContent);
  } catch (error) {
    console.error('Failed to parse profile data:', error);
    console.error('Raw content:', content);
    throw new Error('Invalid profile data format');
  }

  // Generate avatar prompt
  const avatarPrompt = `Create a professional fitness avatar image that represents this person:
  - Display Name: ${profileData.displayName}
  - Fitness Level: ${preferences.fitnessLevel || 'intermediate'}
  - Goals: ${preferences.goals?.join(', ') || 'general fitness and health'}
  
  The avatar should be:
  - Professional and modern looking
  - Show a fit, healthy person
  - Have good lighting and composition
  - Be suitable for a profile picture
  - Not include any text or logos`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash-exp-image-generation',
    contents: avatarPrompt,
    config: {
      responseModalities: ['Text', 'Image']
    },
  });

  let imageData: string | null = null;

  for (const part of response.candidates[0].content.parts) {
    if (part.text) {
      console.log(part.text);
    } else if (part.inlineData && part.inlineData.data) {
      imageData = part.inlineData.data;
      const buffer = Buffer.from(part.inlineData.data, 'base64');
      fs.writeFileSync('profile-avatar.png', buffer);
      console.log('Avatar saved as profile-avatar.png');
    }
  }

  if (!imageData) {
    throw new Error('Failed to generate avatar');
  }

  // Analyze the generated avatar
//   const analysisPrompt = `Analyze this fitness profile avatar and provide a rating from 1-10, where:
//   1 = Completely unsuitable
//   10 = Perfect representation
  
//   Consider these criteria:
//   1. Professional appearance (0-3 points)
//   2. Fitness representation (0-3 points)
//   3. Image quality and lighting (0-2 points)
//   4. Profile picture suitability (0-2 points)
  
//   Start your response with "Rating: X/10" followed by a detailed explanation of the score and any issues found.`;

//   const analysisResult = await ai.models.generateContent({
//     model: 'gemini-2.0-flash-exp-image-generation',
//     contents: [
//       {
//         parts: [
//           { text: analysisPrompt },
//           {
//             inlineData: {
//               mimeType: 'image/png',
//               data: imageData
//             }
//           }
//         ]
//       }
//     ],
//     config: {
//       responseModalities: ['Text']
//     }
//   });

//   const analysis = analysisResult.candidates[0].content.parts[0].text;
//   console.log('Avatar Analysis:', analysis);

  // Create a Blob from the image data
  const imageBlob = new Blob([Buffer.from(imageData, 'base64')], { type: 'image/png' });
  const imageFileName = `avatars/${userId}-${Date.now()}.png`;

  // Upload to Vercel Blob
  const blob = await put(imageFileName, imageBlob, {
    access: 'public',
  });

  return {
    user_id: userId,
    display_name: profileData.displayName,
    bio: profileData.bio,
    avatar_url: undefined,
    custom_avatar_url: blob.url
  };
}

async function saveToDatabase(profile: Profile): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO profiles (user_id, display_name, bio, avatar_url, custom_avatar_url)
       VALUES ($1, $2, $3, $4, $5)`,
      [profile.user_id, profile.display_name, profile.bio, profile.avatar_url, profile.custom_avatar_url]
    );
    console.log('Profile saved successfully');
  } catch (error) {
    console.error('Error saving to database:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function generateAndSaveProfile(userId: string, preferences: {
  fitnessLevel?: string;
  goals?: string[];
  interests?: string[];
}): Promise<void> {
  try {
    const profile = await generateProfileContent(userId, preferences);
    await saveToDatabase(profile);
    console.log(`Successfully generated and saved profile for user ${userId}`);
  } catch (error) {
    console.error('Error in generateAndSaveProfile:', error);
    throw error;
  }
}

// Example usage
async function main() {
  try {
    await generateAndSaveProfile(`user-${Date.now()}-gen`, {
      fitnessLevel: 'intermediate',
      goals: ['strength training', 'weight loss'],
      interests: ['yoga', 'running', 'nutrition']
    });
  } catch (error) {
    console.error('Main error:', error);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

export { generateAndSaveProfile }; 