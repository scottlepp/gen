import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Initialize database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

interface Post {
  id: number;
  title: string;
  content: string;
  author: string;
  user_id: string;
}

interface Profile {
  user_id: string;
  display_name: string;
}

async function getRandomProfile(): Promise<Profile> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT user_id, display_name
      FROM profiles
      WHERE user_id LIKE '%-gen'
      ORDER BY RANDOM()
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      throw new Error('No generated profiles found');
    }

    return result.rows[0];
  } finally {
    client.release();
  }
}

async function getRandomPost(excludeUserId: string): Promise<Post> {
  const client = await pool.connect();
  try {
    // First, let's check how many posts we're skipping and why
    const statsResult = await client.query(`
      WITH post_stats AS (
        SELECT 
          COUNT(*) as total_posts,
          COUNT(*) FILTER (WHERE p.created_at < NOW() - INTERVAL '24 hours') as too_old,
          COUNT(*) FILTER (WHERE p.user_id = $1) as own_posts,
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 
            FROM likes l 
            WHERE l.post_id = p.id 
            AND l.user_id = $1
          )) as already_liked
        FROM posts p
        WHERE p.created_at >= NOW() - INTERVAL '24 hours'
      )
      SELECT * FROM post_stats
    `, [excludeUserId]);

    const stats = statsResult.rows[0];
    console.log('Post Statistics:');
    console.log(`- Total posts in last 24 hours: ${stats.total_posts}`);
    console.log(`- Skipped (too old): ${stats.too_old}`);
    console.log(`- Skipped (own posts): ${stats.own_posts}`);
    console.log(`- Skipped (already liked): ${stats.already_liked}`);

    const result = await client.query(`
      SELECT p.id, p.title, p.content, p.author, p.user_id
      FROM posts p
      WHERE p.created_at >= NOW() - INTERVAL '24 hours'
      AND p.user_id != $1
      AND NOT EXISTS (
        SELECT 1 
        FROM likes l 
        WHERE l.post_id = p.id 
        AND l.user_id = $1
      )
      ORDER BY RANDOM()
      LIMIT 1
    `, [excludeUserId]);

    if (result.rows.length === 0) {
      console.log('No eligible posts found for liking');
      throw new Error('No recent posts found without likes');
    }

    const row = result.rows[0];
    console.log(`Selected post for liking:`);
    console.log(`- Title: "${row.title}"`);
    console.log(`- Author: ${row.author}`);
    console.log(`- Content: "${row.content.substring(0, 100)}..."`);

    return {
      id: row.id,
      title: row.title,
      content: row.content,
      author: row.author,
      user_id: row.user_id
    };
  } finally {
    client.release();
  }
}

async function saveLike(postId: number, userId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO likes (post_id, user_id)
       VALUES ($1, $2)`,
      [postId, userId]
    );
    console.log('Like saved successfully');
  } catch (error) {
    console.error('Error saving like:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function generateAndSaveLike(): Promise<void> {
  try {
    const profile = await getRandomProfile();
    const post = await getRandomPost(profile.user_id);
    
    await saveLike(post.id, profile.user_id);
    console.log(`Successfully generated and saved like for post ${post.id} by ${profile.display_name}`);
  } catch (error) {
    console.error('Error in generateAndSaveLike:', error);
    throw error;
  }
}

// Example usage
async function main() {
  try {
    await generateAndSaveLike();
  } catch (error) {
    console.error('Main error:', error);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

export { generateAndSaveLike }; 