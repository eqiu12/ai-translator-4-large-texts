# WP HTML Translator – Next.js on Vercel

This is a Next.js port of the Streamlit app with API routes and persistent storage.

## Stack
- Next.js 14 (App Router)
- OpenAI Node SDK
- Vercel KV (Redis) for persistence, with local in-memory fallback

## Getting started (local)

1. cd next
2. Create .env.local and set OPENAI_API_KEY (KV optional)
3. npm install
4. npm run dev

Visit http://localhost:3000

## Environment

- OPENAI_API_KEY: your key
- KV_REST_API_URL, KV_REST_API_TOKEN: from Vercel KV (optional locally)
- MODEL_PREF_TRANSLATE (default gpt-4o-mini)
- MODEL_PREF_QA (default gpt-4o)

## Deploy to Vercel

1. Push repo to GitHub
2. Import to Vercel, set `next/` as the root directory
3. Add env vars (OPENAI_API_KEY, KV_* from Vercel KV add-on)
4. Deploy

## Notes
- The app chunks by characters with a safety margin; refine to HTML-aware chunking if needed.
- Cache key includes inputs and model names; identical requests are instantly served from KV.
