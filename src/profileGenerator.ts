import { GoogleGenerativeAI } from '@google/generative-ai';
const { GoogleGenAI } = require("@google/genai");
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { StorageFactory } from './storage/StorageFactory';
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
  interests: string[];
  custom_avatar_url: string | null;
  fitness_level: 'beginner' | 'intermediate' | 'advanced';
  gender: 'male' | 'female';
}

async function getRandomInterests(count: number = 3): Promise<string[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT name FROM interests ORDER BY RANDOM() LIMIT $1`,
      [count]
    );
    return result.rows.map(row => row.name);
  } catch (error) {
    console.error('Error fetching random interests:', error);
    // Fallback to default interests if query fails
    return ['fitness', 'wellness', 'health'];
  } finally {
    client.release();
  }
}

async function analyzeAvatar(imageData: string): Promise<boolean> {
  const analysisPrompt = `Analyze this fitness profile avatar and check for the following issues:
  1. Are the hands anatomically correct and properly positioned?
  2. Are any weights or equipment shown in a realistic way?
  3. Is the person's form and posture natural?
  4. Are there any obvious anatomical distortions?
  5. Is the lighting and image quality professional?
  6. Does the person look like a real fitness enthusiast?
  
  Return ONLY a JSON object in this exact format, with no additional text or markdown:
  {"hasIssues": boolean, "issues": string[], "qualityScore": number}`;

  let analysisResult;
  try {
    console.log('Starting avatar analysis...');
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    analysisResult = await model.generateContent([
      analysisPrompt,
      {
        inlineData: {
          mimeType: 'image/png',
          data: imageData
        }
      }
    ]);

    const rawContent = analysisResult.response.text();
    if (!rawContent) {
      console.error('Invalid analysis result structure:', JSON.stringify(analysisResult, null, 2));
      return true;
    }
    console.log('Raw analysis response:', rawContent);

    // Clean the response by removing markdown code block markers and whitespace
    const cleanContent = rawContent.replace(/```json\n?|\n?```/g, '').trim();
    console.log('Cleaned analysis response:', cleanContent);
    
    let analysis;
    try {
      analysis = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('Failed to parse analysis JSON:', parseError);
      console.error('Attempted to parse:', cleanContent);
      return true;
    }

    console.log('Parsed analysis result:', {
      hasIssues: analysis.hasIssues,
      issues: analysis.issues,
      qualityScore: analysis.qualityScore
    });

    if (typeof analysis.hasIssues !== 'boolean' || 
        !Array.isArray(analysis.issues) || 
        typeof analysis.qualityScore !== 'number') {
      console.error('Invalid analysis structure:', analysis);
      return true;
    }

    return analysis.hasIssues;
  } catch (error) {
    console.error('Error in avatar analysis:', error);
    if (error instanceof Error) {
      console.error('Error stack:', error.stack);
    }
    console.error('Analysis result at time of error:', analysisResult);
    return true; // Assume issues if analysis fails
  }
}

async function generateAvatar(gender: string, fitnessLevel: string, maxAttempts: number = 3): Promise<string> {
  let attempts = 0;
  let imageData: string | null = null;
  let hasIssues = true;

  while (attempts < maxAttempts && hasIssues) {
    attempts++;
    console.log(`Generating avatar attempt ${attempts}/${maxAttempts}`);

    const imagePrompt = `Create a profile picture of a ${gender} person who looks like a fitness enthusiast.
    The person should be in workout clothes and have a natural, confident expression.
    The image should be well-lit and look like a professional headshot.
    The person should look like they are at a ${fitnessLevel} fitness level.
    The style should be modern and appealing to fitness enthusiasts.
    The person should be clearly identifiable as ${gender}.
    
    Important details:
    - Hands should be anatomically correct and naturally positioned
    - If showing weights or equipment, they should be properly placed and realistic
    - The person's form and posture should be natural and professional
    - No anatomical distortions or unrealistic features
    - Professional lighting and image quality
    - The person should look like a real fitness enthusiast, not a model`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-preview-image-generation',
      contents: imagePrompt,
      config: {
        responseModalities: ['Text', 'Image']
      },
    });

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData && part.inlineData.data) {
        imageData = part.inlineData.data;
        break;
      }
    }

    if (imageData) {
      hasIssues = await analyzeAvatar(imageData);
      if (hasIssues) {
        console.log('Avatar has issues, regenerating...');
      }
    }
  }

  if (!imageData) {
    throw new Error('Failed to generate acceptable avatar after multiple attempts');
  }

  return imageData;
}

async function generateProfileContent(): Promise<Profile> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  
  // Get random interests first
  const interests = await getRandomInterests();
  const gender = Math.random() < 0.5 ? 'male' : 'female';
  const fitnessLevel = ['beginner', 'intermediate', 'advanced'][Math.floor(Math.random() * 3)];

  // Generate content about the profile
  const contentPrompt = `Create a social media profile for a ${gender} fitness enthusiast. 
  The person should be a ${fitnessLevel} level fitness enthusiast.
  Their main interests are: ${interests.join(', ')}.
  
  The profile should:
  - Have a unique, memorable display name (max 30 characters)
  - Include a personal bio that reflects their fitness journey and goals
  - Feel authentic and relatable
  - Match their fitness level in tone and experience
  - Reference their interests naturally in the bio
  - Use pronouns appropriate for a ${gender} person
  
  Example display names (DO NOT USE THESE):
  - "FitnessGuru123"
  - "WorkoutWarrior"
  - "GymLifePro"
  
  Example display names (GOOD):
  - "SarahLifts"
  - "MikeOnTheMove"
  - "JenFitnessJourney"
  
  Return the response in the following JSON format:
  {"displayName": "string", "bio": "string"}`;
  
  const result = await model.generateContent(contentPrompt);
  const content = result.response.text();
  
  // Parse the JSON response
  let profileData: { displayName: string; bio: string };
  try {
    const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
    profileData = JSON.parse(cleanContent);
  } catch (error) {
    console.error('Failed to parse profile data:', error);
    throw new Error('Invalid profile data format');
  }

  // Generate avatar with analysis and regeneration
  const imageData = await generateAvatar(gender, fitnessLevel);

  // Create a Blob from the image data
  const imageBlob = new Blob([Buffer.from(imageData, 'base64')], { type: 'image/png' });
  const imageFileName = `avatars/${profileData.displayName.toLowerCase().replace(/\s+/g, '')}-g-${Date.now()}.png`;

  // Upload to storage
  const storage = StorageFactory.getInstance();
  const imageUrl = await storage.upload(imageFileName, imageBlob, {
    access: 'public',
    contentType: 'image/png',
  });

  const g = gender === 'male' ? 'm' : 'f';
  const timestamp = Date.now().toString().slice(-6); // Last 6 digits of timestamp
  return {
    user_id: `${profileData.displayName.toLowerCase().replace(/\s+/g, '')}_${timestamp}-${g}-g`,
    display_name: profileData.displayName,
    bio: profileData.bio,
    interests: interests,
    custom_avatar_url: imageUrl,
    fitness_level: fitnessLevel as 'beginner' | 'intermediate' | 'advanced',
    gender: gender
  };
}

async function saveToDatabase(profile: Profile): Promise<void> {
  const client = await pool.connect();
  try {
    // Start a transaction
    await client.query('BEGIN');

    // Insert the profile
    const profileResult = await client.query(
      `INSERT INTO profiles (user_id, display_name, bio, custom_avatar_url, fitness_level)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [profile.user_id, profile.display_name, profile.bio, profile.custom_avatar_url, profile.fitness_level]
    );

    const profileId = profileResult.rows[0].id;

    // Get interest IDs
    const interestResult = await client.query(
      `SELECT id FROM interests WHERE name = ANY($1)`,
      [profile.interests]
    );

    // Insert profile interests
    for (const interest of interestResult.rows) {
      await client.query(
        `INSERT INTO profile_interests (profile_id, interest_id)
         VALUES ($1, $2)`,
        [profileId, interest.id]
      );
    }

    await client.query('COMMIT');
    console.log('Profile and interests saved successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving to database:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function generateAndSaveProfile(): Promise<void> {
  try {
    const profile = await generateProfileContent();
    await saveToDatabase(profile);
    console.log(`Successfully generated and saved profile for user ${profile.user_id}`);
  } catch (error) {
    console.error('Error in generateAndSaveProfile:', error);
    throw error;
  }
}

// Example usage
async function main() {
  try {
    await generateAndSaveProfile();
  } catch (error) {
    console.error('Main error:', error);
    process.exit(1); // Exit with error code
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

export { generateAndSaveProfile }; 
