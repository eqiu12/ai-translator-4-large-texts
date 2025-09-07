import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const MODEL_QA = process.env.MODEL_PREF_QA || 'gpt-4o';
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
    const { src, tgt, srcLang, tgtLang } = body as Record<string, any>;
    if (!src || !tgt) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    const qaPrompt = `You are a bilingual proof-reader. List mismatches between SOURCE (${srcLang}) and TARGET (${tgtLang}). If all good, reply 'No issues found.'`;
    const res = await callWithRetry(() => client.chat.completions.create({
      model: MODEL_QA,
      temperature: 0,
      messages: [
        { role: 'system', content: qaPrompt },
        { role: 'user', content: `SOURCE:\n${src}\n\nTARGET:\n${tgt}` },
      ],
    }));
    return NextResponse.json({ report: (res.choices[0]?.message?.content ?? '').trim() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}

