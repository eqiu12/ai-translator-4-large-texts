import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { buildSystemPrompt, stripFences } from '@/lib/prompt';

const MODEL_TRANSLATE = process.env.MODEL_PREF_TRANSLATE || 'gpt-4o-mini';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
    const { chunk, srcLang, tgtLang, oldDom, newDom, curFrom, curTo, curLbl, removeConvertBlocks } = body as Record<string, any>;
    if (!chunk || !srcLang || !tgtLang) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    const prompt = buildSystemPrompt(srcLang, tgtLang, oldDom, newDom, curFrom, curTo, curLbl, !!removeConvertBlocks);
    const res = await callWithRetry(() => client.chat.completions.create({
      model: MODEL_TRANSLATE,
      temperature: 0,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: chunk },
      ],
      response_format: { type: 'text' as const },
    }));
    const content = res.choices[0]?.message?.content ?? '';
    if (content.trim() === 'TRUNCATED') return NextResponse.json({ error: 'Chunk too large' }, { status: 400 });
    return NextResponse.json({ out: stripFences(content) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}

