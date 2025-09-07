import { NextRequest, NextResponse } from 'next/server';
import { save } from '@/lib/storage';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { key, srcLang, tgtLang, title, oldDom, newDom, curFrom, curTo, curLbl, removeConvertBlocks, runQa, htmlIn, htmlOut, qaReport, createdAt } = body as Record<string, any>;
    if (!key || !srcLang || !tgtLang || !htmlIn) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    await save({ key, srcLang, tgtLang, title: title || '', oldDom: oldDom || '', newDom: newDom || '', curFrom: curFrom || '', curTo: curTo || '', curLbl: curLbl || '', removeConvertBlocks: !!removeConvertBlocks, runQa: !!runQa, htmlIn, htmlOut: htmlOut || '', qaReport: qaReport || '', createdAt: createdAt || new Date().toISOString() });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}

