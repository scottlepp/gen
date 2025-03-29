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
  id?: number;
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

async function getRandomComment(): Promise<{ comment: Comment; post: Post }> {
  const client = await pool.connect();
  try {
    // First, let's check how many comments we're skipping and why
    const statsResult = await client.query(`
      WITH comment_stats AS (
        SELECT 
          COUNT(*) as total_comments,
          COUNT(*) FILTER (WHERE c.created_at < NOW() - INTERVAL '24 hours') as too_old,
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 
            FROM comments c2 
            WHERE c2.post_id = c.post_id 
            AND c2.created_at > c.created_at
            AND c2.created_at >= NOW() - INTERVAL '24 hours'
          )) as already_replied,
          COUNT(*) FILTER (WHERE c.user_id = p.user_id) as self_comments,
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1
            FROM comments c3
            WHERE c3.post_id = c.post_id
            AND c3.user_id = p.user_id
            AND c3.created_at > c.created_at
          )) as author_already_replied,
          COUNT(*) FILTER (WHERE c.user_id LIKE '%-gen') as generated_user_comments
        FROM comments c
        JOIN posts p ON c.post_id = p.id
        WHERE c.created_at >= NOW() - INTERVAL '24 hours'
      )
      SELECT * FROM comment_stats
    `);

    const stats = statsResult.rows[0];
    console.log('Comment Statistics:');
    console.log(`- Total comments in last 24 hours: ${stats.total_comments}`);
    console.log(`- Skipped (too old): ${stats.too_old}`);
    console.log(`- Skipped (already replied): ${stats.already_replied}`);
    console.log(`- Skipped (self comments): ${stats.self_comments}`);
    console.log(`- Skipped (author already replied): ${stats.author_already_replied}`);
    console.log(`- Skipped (generated users): ${stats.generated_user_comments}`);

    const result = await client.query(`
      WITH recent_comments AS (
        SELECT c.id, c.post_id, c.content, c.author, c.user_id, p.title, p.content as post_content, p.author as post_author, p.user_id as post_user_id
        FROM comments c
        JOIN posts p ON c.post_id = p.id
        WHERE c.created_at >= NOW() - INTERVAL '24 hours'
        AND NOT EXISTS (
          SELECT 1 
          FROM comments c2 
          WHERE c2.post_id = c.post_id 
          AND c2.created_at > c.created_at
          AND c2.created_at >= NOW() - INTERVAL '24 hours'
        )
        AND c.user_id != p.user_id
        AND NOT EXISTS (
          SELECT 1
          FROM comments c3
          WHERE c3.post_id = c.post_id
          AND c3.user_id = p.user_id
          AND c3.created_at > c.created_at
        )
        AND c.user_id NOT LIKE '%-gen'  -- Exclude comments from generated users
      )
      SELECT * FROM recent_comments
      ORDER BY RANDOM()
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      console.log('No eligible comments found for reply');
      throw new Error('No recent comments found without replies');
    }

    const row = result.rows[0];
    console.log(`Selected comment for reply:`);
    console.log(`- Post: "${row.title}"`);
    console.log(`- Comment by: ${row.author}`);
    console.log(`- Comment content: "${row.content}"`);
    console.log(`- Post author: ${row.post_author}`);

    return {
      comment: {
        id: row.id,
        post_id: row.post_id,
        content: row.content,
        author: row.author,
        user_id: row.user_id
      },
      post: {
        id: row.post_id,
        title: row.title,
        content: row.post_content,
        author: row.post_author,
        user_id: row.post_user_id
      }
    };
  } finally {
    client.release();
  }
}

async function getPostAuthor(postId: number): Promise<{ user_id: string; display_name: string }> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT p.user_id, p.author as display_name
      FROM posts p
      WHERE p.id = $1
    `, [postId]);

    if (result.rows.length === 0) {
      throw new Error('Post author not found');
    }

    return result.rows[0];
  } finally {
    client.release();
  }
}

async function generateReply(comment: Comment, post: Post, author: { user_id: string; display_name: string }): Promise<Comment> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  // Randomly select a reply style
  const replyStyles = [
    {
      name: "appreciative",
      examples: [
        "Thanks for the support! 🙏 Really means a lot! 💪",
        "Appreciate the kind words! 🙌 Let's keep pushing! 🔥",
        "Thank you! Your encouragement helps! 🌟",
        "Your support means everything! 🙏 Let's crush it! 💪",
        "Grateful for your kind words! 🙌 Keep the energy coming! ⚡️"
      ]
    },
    {
      name: "engaging",
      examples: [
        "Would love to hear your experience with this! 💭",
        "What's your favorite variation of this? 🤔",
        "How long have you been doing this? 💪",
        "What's your go-to warm-up for this? 🔥",
        "Any tips for increasing the intensity? 💪"
      ]
    },
    {
      name: "friendly",
      examples: [
        "You're awesome! Thanks for the motivation! ⚡️",
        "Love the energy! Let's keep each other accountable! 💫",
        "You get it! Thanks for the support! 🎯",
        "Your positivity is contagious! 🌟 Keep spreading it! 💫",
        "This community is the best! Thanks for being part of it! 🤝"
      ]
    },
    {
      name: "technical",
      examples: [
        "Thanks! I'll try that variation next time! 💡",
        "Appreciate the tip! Will definitely incorporate that! 🎯",
        "Great suggestion! I'll give it a shot! 💪",
        "That's a game-changer! Can't wait to try it! 🎯",
        "Your form tips are always spot-on! 💪"
      ]
    },
    {
      name: "motivational",
      examples: [
        "Your progress is inspiring! Keep pushing! 🚀",
        "We're all in this together! Let's crush it! 💪",
        "Your dedication is contagious! 🔥",
        "This is what community is about! 🙌",
        "You're making amazing progress! Keep going! ⭐️"
      ]
    },
    {
      name: "personal",
      examples: [
        "Totally relate to what you're saying! 💯",
        "Been there! Your advice is spot-on! 🙌",
        "This hits home! Thanks for sharing! 💫",
        "Your journey is inspiring! 🌟",
        "We're on the same wavelength! 💪"
      ]
    },
    {
      name: "celebratory",
      examples: [
        "Let's celebrate this win! 🎉",
        "You're crushing it! 🏆",
        "This is amazing progress! 🌟",
        "Way to go! 🎯",
        "You're on fire! 🔥"
      ]
    }
  ];

  const selectedStyle = replyStyles[Math.floor(Math.random() * replyStyles.length)];
  const example = selectedStyle.examples[Math.floor(Math.random() * selectedStyle.examples.length)];

  const prompt = `Create a reply to this comment on a fitness post:

Post Title: ${post.title}
Post Content: ${post.content}
Original Comment: ${comment.content}
Comment Author: ${comment.author}

The reply should:
- Be in a ${selectedStyle.name} style
- Tag the comment author using @${comment.author}
- Be engaging and friendly
- Relate to the specific exercise or content mentioned
- Include relevant emojis
- Feel natural and conversational
- Be 1-2 sentences long
- Not be too technical or instructional
- Match the tone of a fitness app comment
- Be unique and not copy the example exactly

Example style:
"${example}"

Additional context:
- The replier is the post author
- The reply should feel authentic and personal
- Use appropriate emojis that match the style
- Keep it casual and friendly

Return the response in the following JSON format:
{"content": "string"}`;

  const result = await model.generateContent(prompt);
  const content = result.response.text();

  // Parse the JSON response
  let replyData: { content: string };
  try {
    const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
    replyData = JSON.parse(cleanContent);
  } catch (error) {
    console.error('Failed to parse reply data:', error);
    throw new Error('Invalid reply data format');
  }

  return {
    post_id: post.id,
    content: replyData.content,
    author: author.display_name,
    user_id: author.user_id
  };
}

async function saveReply(reply: Comment): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO comments (post_id, content, author, user_id)
       VALUES ($1, $2, $3, $4)`,
      [reply.post_id, reply.content, reply.author, reply.user_id]
    );
    console.log('Reply saved successfully');
  } catch (error) {
    console.error('Error saving reply:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function generateAndSaveReply(): Promise<void> {
  try {
    const { comment, post } = await getRandomComment();
    const author = await getPostAuthor(post.id);
    
    const reply = await generateReply(comment, post, author);
    await saveReply(reply);
    console.log(`Successfully generated and saved reply to comment ${comment.id}`);
  } catch (error) {
    console.error('Error in generateAndSaveReply:', error);
    throw error;
  }
}

// Example usage
async function main() {
  try {
    await generateAndSaveReply();
  } catch (error) {
    console.error('Main error:', error);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

export { generateAndSaveReply }; 