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

interface Profile {
  id: number;
  user_id: string;
  display_name: string;
}

async function getRandomProfiles(count: number = 5): Promise<Profile[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT id, user_id, display_name
      FROM profiles p
      WHERE p.user_id LIKE '%-m-g' 
         OR p.user_id LIKE '%-f-g'
         OR p.user_id LIKE '%_m_g'
         OR p.user_id LIKE '%_f_g'
      ORDER BY RANDOM()
      LIMIT $1
    `, [count]);

    if (result.rows.length === 0) {
      throw new Error('No generated profiles found');
    }

    return result.rows;
  } finally {
    client.release();
  }
}

async function getProfileInterests(profileId: number): Promise<number[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT interest_id
      FROM profile_interests
      WHERE profile_id = $1
    `, [profileId]);
    
    return result.rows.map(row => row.interest_id);
  } finally {
    client.release();
  }
}

async function findUsersWithSimilarInterests(
  profileId: number, 
  userId: string, 
  interestIds: number[], 
  limit: number = 10
): Promise<Profile[]> {
  if (interestIds.length === 0) {
    return [];
  }

  const client = await pool.connect();
  try {
    // Find profiles that share at least one interest with the current profile
    // and are not already being followed by the current profile
    const result = await client.query(`
      SELECT p.id, p.user_id, p.display_name
      FROM profiles p
      JOIN profile_interests pi ON p.id = pi.profile_id
      WHERE pi.interest_id = ANY($1)
      AND p.id != $2
      AND p.user_id != $3
      AND NOT EXISTS (
        SELECT 1 FROM followers 
        WHERE follower_id = $3 
        AND following_id = p.user_id
      )
      GROUP BY p.id, p.user_id, p.display_name
      ORDER BY COUNT(DISTINCT pi.interest_id) DESC, RANDOM()
      LIMIT $4
    `, [interestIds, profileId, userId, limit]);

    return result.rows;
  } finally {
    client.release();
  }
}

async function createFollowerRelationship(followerId: string, followingId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO followers (follower_id, following_id)
      VALUES ($1, $2)
      ON CONFLICT (follower_id, following_id) DO NOTHING
    `, [followerId, followingId]);
    
    console.log(`User ${followerId} is now following ${followingId}`);
  } catch (error) {
    console.error('Error creating follower relationship:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function generateFollowersForUser(profile: Profile): Promise<void> {
  try {
    console.log(`Processing user: ${profile.display_name} (${profile.user_id})`);
    
    // Get the user's interests
    const interestIds = await getProfileInterests(profile.id);
    console.log(`User has ${interestIds.length} interests`);
    
    if (interestIds.length === 0) {
      console.log('User has no interests, skipping');
      return;
    }
    
    // Find users with similar interests
    const similarUsers = await findUsersWithSimilarInterests(
      profile.id, 
      profile.user_id, 
      interestIds,
      10
    );
    
    console.log(`Found ${similarUsers.length} users with similar interests`);
    
    // Create follower relationships
    for (const similarUser of similarUsers) {
      await createFollowerRelationship(profile.user_id, similarUser.user_id);
    }
    
    console.log(`Created ${similarUsers.length} new follower relationships for ${profile.display_name}`);
  } catch (error) {
    console.error(`Error generating followers for user ${profile.user_id}:`, error);
  }
}

async function generateFollowers(): Promise<void> {
  try {
    // Get 5 random profiles
    const profiles = await getRandomProfiles(5);
    console.log(`Selected ${profiles.length} random profiles for follower generation`);
    
    // Process each profile
    for (const profile of profiles) {
      await generateFollowersForUser(profile);
    }
    
    console.log('Follower generation complete');
  } catch (error) {
    console.error('Error in generateFollowers:', error);
    throw error;
  }
}

async function main() {
  try {
    await generateFollowers();
    console.log('Follower generation completed successfully');
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

export { generateFollowers }; 