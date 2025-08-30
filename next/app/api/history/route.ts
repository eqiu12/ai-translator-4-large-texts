import { NextResponse } from 'next/server';
import { listRecent } from '@/lib/storage';

export async function GET() {
  try {
    const items = await listRecent(50);
    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}

