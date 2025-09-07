import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { buildSystemPrompt, stripFences } from '@/lib/prompt';

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

async function translateOnce(prompt: string, text: string) {
  const res = await callWithRetry(() => client.chat.completions.create({
    model: MODEL_TRANSLATE,
    temperature: 0,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: text },
    ],
    response_format: { type: 'text' as const },
  }));
  return res.choices[0]?.message?.content ?? '';
}

async function translateWithSplit(prompt: string, text: string, maxChars = 4000): Promise<string> {
  if (text.length <= maxChars) {
    const out = await translateOnce(prompt, text);
    if (out.trim() === 'TRUNCATED') {
      // Fallback: split in half and translate parts
      const mid = Math.floor(text.length / 2);
      const a = await translateWithSplit(prompt, text.slice(0, mid), maxChars);
      const b = await translateWithSplit(prompt, text.slice(mid), maxChars);
      return a + '\n' + b;
    }
    return stripFences(out);
  }
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) parts.push(text.slice(i, i + maxChars));
  const outs: string[] = [];
  for (const p of parts) outs.push(await translateWithSplit(prompt, p, maxChars));
  return outs.join('\n');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { chunk, srcLang, tgtLang, oldDom, newDom, curFrom, curTo, curLbl, removeConvertBlocks } = body as Record<string, any>;
    if (!chunk || !srcLang || !tgtLang) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    const prompt = buildSystemPrompt(srcLang, tgtLang, oldDom, newDom, curFrom, curTo, curLbl, !!removeConvertBlocks);
    const out = await translateWithSplit(prompt, chunk, 6000);
    return NextResponse.json({ out });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}

