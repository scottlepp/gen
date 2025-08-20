import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleGenAI } from "@google/genai";
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { StorageFactory } from './storage/StorageFactory';
import fs from 'fs';
import fetch from 'node-fetch';
import { analyzeImage } from './analyzer';

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

interface Profile {
  user_id: string;
  display_name: string;
  interests: string[];
  custom_avatar_url: string | null;
  gender: 'male' | 'female';
}

async function hasPostedToday(userId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT COUNT(*) as count 
       FROM posts 
       WHERE user_id = $1 
       AND created_at >= CURRENT_DATE 
       AND created_at < CURRENT_DATE + INTERVAL '1 day'`,
      [userId]
    );
    return parseInt(result.rows[0].count) > 0;
  } finally {
    client.release();
  }
}

async function getRandomProfile(): Promise<Profile> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      WITH random_profile AS (
        SELECT p.id, p.user_id, p.display_name, p.custom_avatar_url
        FROM profiles p
        WHERE p.user_id LIKE '%-m-g' 
           OR p.user_id LIKE '%-f-g'
           OR p.user_id LIKE '%_m_g'
           OR p.user_id LIKE '%_f_g'
        AND NOT EXISTS (
          SELECT 1 
          FROM posts 
          WHERE posts.user_id = p.user_id 
          AND posts.created_at >= CURRENT_DATE 
          AND posts.created_at < CURRENT_DATE + INTERVAL '1 day'
        )
        ORDER BY RANDOM()
        LIMIT 1
      )
      SELECT 
        rp.user_id,
        rp.display_name,
        rp.custom_avatar_url,
        COALESCE(array_agg(i.name), ARRAY['fitness', 'wellness', 'health']) as interests
      FROM random_profile rp
      LEFT JOIN profile_interests pi ON pi.profile_id = rp.id
      LEFT JOIN interests i ON i.id = pi.interest_id
      GROUP BY rp.user_id, rp.display_name, rp.custom_avatar_url
    `);

    if (result.rows.length === 0) {
      throw new Error('No available profiles found that haven\'t posted today');
    }

    // Extract and validate gender from user_id (format: name-gender-gen or name_gender_gen)
    const user_id = result.rows[0].user_id;
    
    // Try both dash and underscore separators
    const dashParts = user_id.split('-');
    const underscoreParts = user_id.split('_');
    
    let gender: 'male' | 'female';
    let genderPart: string;
    
    // Check which separator was used
    if (dashParts.length >= 2 && (dashParts[dashParts.length-1] === 'm' || dashParts[dashParts.length-1] === 'f')) {
      genderPart = dashParts[dashParts.length-1];
    } else if (underscoreParts.length >= 2 && (underscoreParts[underscoreParts.length-1] === 'm' || underscoreParts[underscoreParts.length-1] === 'f')) {
      genderPart = underscoreParts[underscoreParts.length-1];
    } else {
      console.error('Invalid user_id format:', user_id);
      throw new Error('Invalid user_id format - missing or invalid gender');
    }
    
    const genderAbbt = genderPart as 'm' | 'f';
    gender = genderAbbt === 'm' ? 'male' : 'female';
    console.log('Extracted gender:', gender, 'from user_id:', user_id);

    return {
      ...result.rows[0],
      gender
    };
  } finally {
    client.release();
  }
}

async function getImageAsBase64(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    const buffer = await response.buffer();
    return buffer.toString('base64');
  } catch (error) {
    console.error('Error fetching avatar image:', error);
    return ''; // Return empty string if image fetch fails
  }
}

async function generatePostContent(exercise: string, profile: Profile): Promise<ExercisePost> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-05-20" });
  // const imageModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp-image-generation' })

  // Generate content about the exercise
  const contentPrompt = `Create a social media post about doing ${exercise} today. 
  The person posting is a ${profile.gender} fitness enthusiast interested in: ${profile.interests.join(', ')}.
  
  The post should:
  - Be casual and personal, like a real social media post
  - Include how they're feeling about the workout
  - Mention any personal goals or achievements
  - Be engaging and relatable
  - Not be too technical or instructional
  - Feel authentic and natural
  - Use pronouns appropriate for a ${profile.gender} person
  - Not overuse emojis or hashtags, but can include one or two
  
  Example style:
  "Just crushed my squats today! Feeling stronger than ever. These last few weeks of training have been amazing. Who else loves leg day?"
  
  Return the response in the following JSON format:
  {"content": "string", "title": "string"}`;
  
  const contentResult = await model.generateContent(contentPrompt);
  const content = contentResult.response.text();
  
  // Parse the JSON response
  let postData: { content: string; title: string };
  try {
    const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
    postData = JSON.parse(cleanContent);
  } catch (error) {
    console.error('Failed to parse post data:', error);
    throw new Error('Invalid post data format');
  }

  // Generate image prompt
  const imagePrompt = `Create a real image of a ${profile.gender} person performing ${exercise} in a gym setting. 
  The person should look exactly like the person in the provided profile picture.
  The image should look like a candid gym photo someone might post on social media.
  The person should be in workout clothes and the image should have good lighting.
  The style should appeal to someone interested in: ${profile.interests.join(', ')}.
  Make it look natural and not too posed or professional.
  Ensure the person's appearance matches the profile picture exactly.
  The person should be clearly identifiable as ${profile.gender}.
  The pose of the person should not defy gravity.
  The image should be an aspect ratio of 16:9.`;

  // Fetch and convert avatar image to base64
  const avatarBase64 = profile.custom_avatar_url ? await getImageAsBase64(profile.custom_avatar_url) : '';
  
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash-preview-image-generation',
    contents: [
      {
        parts: [
          { text: imagePrompt },
          ...(avatarBase64 ? [{
            inlineData: {
              mimeType: 'image/png',
              data: avatarBase64
            }
          }] : [])
        ]
      }
    ],
    config: {
      responseModalities: ['Text', 'Image']
    }
  });

  if (response.candidates === undefined || response.candidates.length === 0) {
    throw new Error('Failed to generate image - no candidates');
  }

  const candidate = response.candidates[0];
  if (candidate.content === undefined || candidate.content.parts === undefined) {
    throw new Error('Failed to generate image - no content');
  }

  let imageData: string | null = null;

  for (const part of candidate.content.parts) {
    if (part.text) {
      console.log(part.text);
    } else if (part.inlineData && part.inlineData.data) {
      imageData = part.inlineData.data;
      const buffer = Buffer.from(part.inlineData.data, 'base64');
      fs.writeFileSync('gemini-native-image.png', buffer);
      console.log('Image saved as gemini-native-image.png');
    }
  }

  if (!imageData) {
    throw new Error('Failed to generate image');
  }

  imageData = await analyzeImage(exercise);

  // Create a Blob from the image data
  const imageBlob = new Blob([Buffer.from(imageData, 'base64')], { type: 'image/png' });
  const imageFileName = `${exercise.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.png`;

  // Upload to storage
  const storage = StorageFactory.getInstance();
  const imageUrl = await storage.upload(`exercises/${imageFileName}`, imageBlob, {
    access: 'public',
    contentType: 'image/png',
  });

  return {
    title: postData.title || `${exercise} - Feeling Strong! 💪`,
    content: postData.content,
    image_url: imageUrl,
    author: profile.display_name,
    user_id: profile.user_id
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
    const profile = await getRandomProfile();
    
    // Double-check if the user has posted today (race condition protection)
    if (await hasPostedToday(profile.user_id)) {
      console.log(`User ${profile.user_id} has already posted today, skipping...`);
      return;
    }

    const post = await generatePostContent(exercise, profile);
    await saveToDatabase(post);
    console.log(`Successfully generated and saved content for ${exercise}`);
  } catch (error) {
    console.error('Error in generateAndSavePost:', error);
    throw error;
  }
}

async function getRandomExercise(): Promise<string> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT name
      FROM workout_exercises
      ORDER BY RANDOM()
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      throw new Error('No exercises found in the database');
    }

    return result.rows[0].name;
  } finally {
    client.release();
  }
}

// Example usage
async function main() {
  try {
    const exercise = await getRandomExercise();
    await generateAndSavePost(exercise);
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

export { generateAndSavePost }; 
