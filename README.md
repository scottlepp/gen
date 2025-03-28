# Exercise Content Generator

This project uses Google's Gemini AI to generate exercise-related content and images, storing them in a PostgreSQL database.

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL database
- Google Gemini API key

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
   - Copy `.env.example` to `.env`
   - Fill in your database credentials and Google API key

3. Create the database table:
```sql
CREATE TABLE posts (
    id integer DEFAULT nextval('posts_id_seq'::regclass) NOT NULL,
    title character varying(255) NOT NULL,
    content text NOT NULL,
    image_url character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    author character varying(100) DEFAULT 'Anonymous'::character varying,
    user_id text DEFAULT 'TBD'::text NOT NULL
);
```

## Usage

To generate content for a specific exercise:

```typescript
import { generateAndSaveExercise } from './src/exerciseGenerator';

// Generate content for squats
await generateAndSaveExercise('Squats');
```

## Building

To compile TypeScript to JavaScript:

```bash
npm run build
```

## Running

To run the compiled JavaScript:

```bash
npm start
```

## Note

This project uses Google's Gemini AI for content generation. The image generation part is currently a placeholder - you'll need to implement actual image generation and storage based on your requirements. 