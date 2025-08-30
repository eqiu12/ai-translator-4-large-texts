import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { buildSystemPrompt, stripFences } from '@/lib/prompt';
import { splitHtmlByChars } from '@/lib/chunk';
import { computeKey, getByKey, save } from '@/lib/storage';

const MODEL_TRANSLATE = process.env.MODEL_PREF_TRANSLATE || 'gpt-4o-mini';
const MODEL_QA = process.env.MODEL_PREF_QA || 'gpt-4o';

const TOKEN_LIMIT = 32000;
const SAFETY_MARGIN = 0.5;

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e: any) {
      if (attempt >= 5) throw e;
      const wait = Math.pow(2, attempt) * 100 + Math.random() * 200;
      await new Promise(r => setTimeout(r, wait));
      attempt++;
    }
  }
}

async function translateChunk(chunk: string, prompt: string) {
  const res = await callWithRetry(() => client.chat.completions.create({
    model: MODEL_TRANSLATE,
    temperature: 0,
    top_p: 0,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: chunk },
    ],
    response_format: { type: 'text' as const },
  }));
  const out = res.choices[0]?.message?.content ?? '';
  if (out.trim() === 'TRUNCATED') throw new Error('Chunk too large – lower SAFETY_MARGIN.');
  return stripFences(out);
}

async function qaPass(srcHtml: string, tgtHtml: string, srcLang: string, tgtLang: string) {
  const qaPrompt = `You are a bilingual proof-reader. List mistranslations or omissions between SOURCE (${srcLang}) and TARGET (${tgtLang}). If all good, reply 'No issues found.'`;
  const res = await callWithRetry(() => client.chat.completions.create({
    model: MODEL_QA,
    temperature: 0,
    top_p: 0,
    messages: [
      { role: 'system', content: qaPrompt },
      { role: 'user', content: `SOURCE:\n${srcHtml}\n\nTARGET:\n${tgtHtml}` },
    ],
  }));
  return (res.choices[0]?.message?.content ?? '').trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      htmlIn,
      srcLang,
      tgtLang,
      oldDom,
      newDom,
      curFrom,
      curTo,
      curLbl,
      removeConvertBlocks,
      runQa,
      useCache,
    } = body as Record<string, any>;

    if (!htmlIn || !srcLang || !tgtLang) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

    const prompt = buildSystemPrompt(srcLang, tgtLang, oldDom, newDom, curFrom, curTo, curLbl, !!removeConvertBlocks);
    const key = computeKey({ htmlIn, srcLang, tgtLang, oldDom, newDom, curFrom, curTo, curLbl, removeConvertBlocks: !!removeConvertBlocks, runQa: !!runQa, MODEL_TRANSLATE, MODEL_QA });

    if (useCache) {
      const cached = await getByKey(key);
      if (cached) {
        return NextResponse.json({ htmlOut: cached.htmlOut, qaReport: cached.qaReport, key });
      }
    }

    const parts = splitHtmlByChars(htmlIn, TOKEN_LIMIT, SAFETY_MARGIN);
    const chunks: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const out = await translateChunk(parts[i], prompt);
      chunks.push(out);
    }
    const full = stripFences(chunks.join('\n'));
    let report = '';
    if (runQa) {
      report = await qaPass(htmlIn, full, srcLang, tgtLang);
    }

    await save({
      key,
      srcLang,
      tgtLang,
      oldDom,
      newDom,
      curFrom,
      curTo,
      curLbl,
      removeConvertBlocks: !!removeConvertBlocks,
      runQa: !!runQa,
      htmlIn,
      htmlOut: full,
      qaReport: report,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ htmlOut: full, qaReport: report, key });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}

