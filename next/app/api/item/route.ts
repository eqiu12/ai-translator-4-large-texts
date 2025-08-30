import { NextRequest, NextResponse } from 'next/server';
import { getByKey, removeByKey } from '@/lib/storage';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get('key');
    if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 });
    const item = await getByKey(key);
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ htmlOut: item.htmlOut, qaReport: item.qaReport });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get('key');
    if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 });
    await removeByKey(key);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}

