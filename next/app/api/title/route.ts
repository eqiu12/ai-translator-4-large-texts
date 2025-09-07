import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { stripFences } from '@/lib/prompt';

const MODEL_TRANSLATE = process.env.MODEL_PREF_TRANSLATE || 'gpt-4o-mini';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const runtime = 'edge';
export const maxDuration = 60;

async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try { return await fn(); } catch (e) {
      if (attempt >= 5) throw e;
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 100 + Math.random() * 200));
      attempt++;
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { htmlIn, tgtLang } = body as Record<string, any>;
    if (!htmlIn || !tgtLang) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    const prompt = `You will receive an HTML fragment. Create a very short, human-friendly title (max 8 words) summarizing the content to help identify it in a list. Keep it in ${tgtLang}. Do not include HTML tags or quotes.`;
    const res = await callWithRetry(() => client.chat.completions.create({
      model: MODEL_TRANSLATE,
      temperature: 0.2,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: htmlIn.slice(0, 4000) },
      ],
      response_format: { type: 'text' as const },
    }));
    const title = stripFences(res.choices[0]?.message?.content ?? '').slice(0, 120);
    return NextResponse.json({ title });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}


