import { GoogleGenerativeAI } from '@google/generative-ai';
const { GoogleGenAI } = require("@google/genai");
import { Pool } from 'pg';
import dotenv from 'dotenv';

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

interface Comment {
  post_id: number;
  content: string;
  author: string;
  user_id: string;
}

interface Post {
  id: number;
  title: string;
  content: string;
  author: string;
  user_id: string;
}

async function getRandomPost(excludeUserId: string): Promise<Post> {
  const client = await pool.connect();
  try {
    // TODO: Uncomment this when we want to exclude posts that have already been commented on today
      // AND NOT EXISTS (
      //   SELECT 1 
      //   FROM comments c 
      //   WHERE c.post_id = p.id 
      //   AND c.created_at >= CURRENT_DATE 
      //   AND c.created_at < CURRENT_DATE + INTERVAL '1 day'
      // )
    const result = await client.query(`
      SELECT p.id, p.title, p.content, p.author, p.user_id
      FROM posts p
      WHERE p.created_at >= NOW() - INTERVAL '24 hours'
      AND p.user_id != $1
      ORDER BY RANDOM()
      LIMIT 1
    `, [excludeUserId]);

    if (result.rows.length === 0) {
      throw new Error('No recent posts found without comments today');
    }

    return result.rows[0];
  } finally {
    client.release();
  }
}

async function getRandomProfile(): Promise<{ user_id: string; display_name: string }> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT p.user_id, p.display_name
      FROM profiles p
      WHERE p.user_id LIKE '%-m-g' 
         OR p.user_id LIKE '%-f-g'
         OR p.user_id LIKE '%_m_g'
         OR p.user_id LIKE '%_f_g'
      AND NOT EXISTS (
        SELECT 1 
        FROM comments c 
        WHERE c.user_id = p.user_id 
        AND c.created_at >= CURRENT_DATE 
        AND c.created_at < CURRENT_DATE + INTERVAL '1 day'
      )
      ORDER BY RANDOM()
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      throw new Error('No available profiles found that haven\'t commented today');
    }

    return result.rows[0];
  } finally {
    client.release();
  }
}

async function generateComment(post: Post, profile: { user_id: string; display_name: string }): Promise<Comment> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  // Randomly select a comment style
  const commentStyles = [
    {
      name: "encouraging",
      examples: [
        "You're crushing it! 💪 Keep pushing! 🔥",
        "This is amazing progress! 🌟",
        "Way to go! You're inspiring!"
      ]
    },
    {
      name: "personal_connection",
      examples: [
        "I feel the same way about this exercise!",
        "This is exactly what I needed to see today!",
        "Totally relate to this! Same here!"
      ]
    },
    {
      name: "technical_tip",
      examples: [
        "Try adding a slight pause at the bottom next time!",
        "Your form looks great! Maybe try a wider stance?",
        "That's a great variation! Have you tried adding a pause?"
      ]
    },
    {
      name: "motivational",
      examples: [
        "This is the energy I needed today!",
        "You're making it happen! Keep going!",
        "This is what dedication looks like!"
      ]
    },
    {
      name: "community",
      examples: [
        "Who else loves this exercise?",
        "Let's get a group going for this!",
        "Anyone want to try this together?"
      ]
    }
  ];

  const selectedStyle = commentStyles[Math.floor(Math.random() * commentStyles.length)];
  const example = selectedStyle.examples[Math.floor(Math.random() * selectedStyle.examples.length)];

  const prompt = `Create a social media comment on this fitness post:

Post Title: ${post.title}
Post Content: ${post.content}
Post Author: ${post.author}

The comment should:
- Be in a ${selectedStyle.name} style
- Be engaging and supportive
- Relate to the specific exercise or content mentioned
- Feel natural and conversational
- Be 1-2 sentences long
- Not be too technical or instructional
- Match the tone of a fitness app comment
- Be unique and not copy the example exactly
- Don't use emojis

Example style:
"${example}"

Additional context:
- The commenter is a fitness enthusiast
- The comment should feel authentic and personal
- Keep it casual and friendly

Return the response in the following JSON format:
{"content": "string"}`;

  const result = await model.generateContent(prompt);
  const content = result.response.text();

  // Parse the JSON response
  let commentData: { content: string };
  try {
    const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
    commentData = JSON.parse(cleanContent);
  } catch (error) {
    console.error('Failed to parse comment data:', error);
    throw new Error('Invalid comment data format');
  }

  return {
    post_id: post.id,
    content: commentData.content,
    author: profile.display_name,
    user_id: profile.user_id
  };
}

async function saveComment(comment: Comment): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO comments (post_id, content, author, user_id)
       VALUES ($1, $2, $3, $4)`,
      [comment.post_id, comment.content, comment.author, comment.user_id]
    );
    console.log('Comment saved successfully');
  } catch (error) {
    console.error('Error saving comment:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function generateAndSaveComment(): Promise<void> {
  try {
    const profile = await getRandomProfile();
    const post = await getRandomPost(profile.user_id);
    
    const comment = await generateComment(post, profile);
    await saveComment(comment);
    console.log(`Successfully generated and saved comment for post ${post.id}`);
  } catch (error) {
    console.error('Error in generateAndSaveComment:', error);
    throw error;
  }
}

// Example usage
async function main() {
  try {
    await generateAndSaveComment();
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

export { generateAndSaveComment }; 