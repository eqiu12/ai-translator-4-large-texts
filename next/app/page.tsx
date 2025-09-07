"use client";

import { useState, useRef, useEffect } from "react";
export const dynamic = 'force-dynamic';

type HistoryItem = { key: string; tgt: string; src: string; title?: string; createdAt: string };

export default function Home() {
  const [htmlIn, setHtmlIn] = useState("");
  const [htmlOut, setHtmlOut] = useState("");
  const [qaReport, setQaReport] = useState("");
  const [loading, setLoading] = useState(false);
  const [useCache, setUseCache] = useState(true);
  const [hist, setHist] = useState<HistoryItem[]>([]);

  const [srcLang, setSrcLang] = useState("Russian");
  const [tgtLang, setTgtLang] = useState("English");
  const [oldDom, setOldDom] = useState("https://samokatus.ru/wp-content/uploads/2025/07");
  const [newDom, setNewDom] = useState("https://tripsteer.co/wp-content/uploads/2025/07");
  const [curFrom, setCurFrom] = useState("rub");
  const [curTo, setCurTo] = useState("usd");
  const [curLbl, setCurLbl] = useState("USD");
  const [removeConvert, setRemoveConvert] = useState(false);
  const [runQa, setRunQa] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastAddedKeyRef = useRef<string | null>(null);

  async function fetchHistory() {
    const r = await fetch("/api/history");
    if (r.ok) setHist((await r.json()).items ?? []);
  }

  async function translate() {
    setLoading(true);
    setQaReport("");
    try {
      // Optimistically add a placeholder history item so a new tab appears immediately
      const tempKey = `pending:${Date.now()}`;
      lastAddedKeyRef.current = tempKey;
      setHist((prev) => [{ key: tempKey, tgt: tgtLang, src: srcLang, createdAt: new Date().toISOString() }, ...prev]);

      // Generate a short title upfront (non-blocking)
      let title = '';
      try {
        const tr = await fetch('/api/title', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ htmlIn, tgtLang }) });
        if (tr.ok) title = (await tr.json()).title || '';
      } catch {}

      const r = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ htmlIn, srcLang, tgtLang, oldDom, newDom, curFrom, curTo, curLbl, removeConvertBlocks: removeConvert, runQa: false, useCache, dryRun: true }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      const cacheKey = data.key || `ad-hoc-${Date.now()}`;

      // Split locally by simple slices to avoid timeouts; ~3k chars per chunk
      const approx = 3000;
      const localParts: string[] = [];
      for (let i = 0; i < htmlIn.length; i += approx) localParts.push(htmlIn.slice(i, i + approx));

      const outParts: string[] = new Array(localParts.length);
      // Limit concurrency to 2
      const concurrency = 2;
      let idx = 0;
      async function worker() {
        while (true) {
          const myIdx = idx++;
          if (myIdx >= localParts.length) break;
          const p = localParts[myIdx];
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 50_000);
          const rr = await fetch('/api/translate/chunk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chunk: p, srcLang, tgtLang, oldDom, newDom, curFrom, curTo, curLbl, removeConvertBlocks: removeConvert }), signal: controller.signal });
          clearTimeout(timeout);
          if (!rr.ok) throw new Error(await rr.text());
          const jd = await rr.json();
          outParts[myIdx] = jd.out || '';
        }
      }
      const workers = Array.from({ length: Math.min(concurrency, localParts.length) }, () => worker());
      await Promise.all(workers);
      const full = outParts.join('\n');
      setHtmlOut(full);

      let report = '';
      if (runQa) {
        if ((htmlIn.length + full.length) > 20000) {
          // Chunked QA: first, middle, last
          const sections: Array<[string, string]> = [];
          const qPartsIn: string[] = [];
          const qPartsOut: string[] = [];
          for (let i = 0; i < htmlIn.length; i += approx) qPartsIn.push(htmlIn.slice(i, i + approx));
          for (let i = 0; i < full.length; i += approx) qPartsOut.push(full.slice(i, i + approx));
          const pick = (arr: string[]) => arr.length >= 3 ? [0, Math.floor(arr.length / 2), arr.length - 1] : [0];
          const idxs = Array.from(new Set([...pick(qPartsIn), ...pick(qPartsOut)]));
          const partsReports: string[] = [];
          for (const iSec of idxs) {
            const si = qPartsIn[iSec] || '';
            const so = qPartsOut[iSec] || '';
            const qr = await fetch('/api/qa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ src: si, tgt: so, srcLang, tgtLang }) });
            if (qr.ok) {
              const rj = await qr.json();
              const sec = rj.report || '';
              if (sec && sec !== 'No issues found.') partsReports.push(`[Section ${iSec + 1}]\n${sec}`);
            }
          }
          report = partsReports.length ? partsReports.join('\n\n') : 'No issues found.';
        } else {
          const qr = await fetch('/api/qa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ src: htmlIn, tgt: full, srcLang, tgtLang }) });
          if (qr.ok) report = (await qr.json()).report || '';
        }
        setQaReport(report);
      }

      // Save result now so history updates immediately
      await fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: cacheKey, srcLang, tgtLang, title, oldDom, newDom, curFrom, curTo, curLbl, removeConvertBlocks: removeConvert, runQa, htmlIn, htmlOut: full, qaReport: report, createdAt: new Date().toISOString() }) });
      await fetchHistory();
      setHist((prev) => prev.filter((h) => !h.key.startsWith('pending:')));
    } catch (e: any) {
      // Remove the optimistic placeholder if request fails
      setHist((prev) => prev.filter((h) => !h.key.startsWith('pending:')));
      alert(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadItem(key: string) {
    const r = await fetch(`/api/item?key=${encodeURIComponent(key)}`);
    if (r.ok) {
      const data = await r.json();
      setHtmlOut(data.htmlOut || "");
      setQaReport(data.qaReport || "");
    }
  }

  useEffect(() => { fetchHistory(); }, []);

  useEffect(() => {
    // Auto-scroll to top where the newest item is added
    if (listRef.current && lastAddedKeyRef.current) {
      listRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      lastAddedKeyRef.current = null;
    }
  }, [hist.length]);

  function formatTime(iso: string) {
    try {
      const d = new Date(iso);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      return `${dd}.${mm}, ${hh}:${mi}`;
    } catch { return iso; }
  }

  async function onDelete(key: string) {
    try {
      const r = await fetch(`/api/item?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text());
      setHist(prev => prev.filter(h => h.key !== key));
    } catch (e: any) {
      alert(e.message || String(e));
    }
  }

  return (
    <div className="app-grid">
      <aside className="sidebar">
        <div className="brand">WP HTML Translator</div>
        <label className="toggle">
          <input type="checkbox" checked={useCache} onChange={e => setUseCache(e.target.checked)} />
          Use cache if available
        </label>
        <div className="history" ref={listRef}>
          {hist.length === 0 && <div className="muted">No items</div>}
          {hist.map((h) => (
            <div key={h.key} className="history-item glass" style={{ padding: 0 }}>
              <div className="history-item-row" style={{ padding: '10px 12px' }}>
                <button onClick={() => loadItem(h.key)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                  {h.key.startsWith('pending:') && <span className="spinner" />}
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {h.title ? h.title : h.tgt} <span style={{ color: '#a4a8b4' }}>(src: {h.src})</span>
                  </div>
                </button>
                <div className="history-item-meta">{formatTime(h.createdAt)}</div>
                {!h.key.startsWith('pending:') && (
                  <button onClick={() => onDelete(h.key)} className="btn" title="Delete" style={{ height: 28, padding: '0 8px' }}>×</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </aside>
      <main className="main">
        <div className="row-2">
          <section className="panel glass">
            <h3 className="section-title">Input</h3>
            <label>Input HTML</label>
            <textarea className="textarea" value={htmlIn} onChange={e => setHtmlIn(e.target.value)} />

            <div className="controls">
              <div>
                <label>Source language</label>
                <select className="select" value={srcLang} onChange={e => setSrcLang(e.target.value)}>
                  <option>Russian</option>
                  <option>English</option>
                </select>
              </div>
              <div>
                <label>Target language</label>
                <select className="select" value={tgtLang} onChange={e => setTgtLang(e.target.value)}>
                  <option>English</option>
                  <option>German</option>
                  <option>Spanish</option>
                  <option>French</option>
                  <option>Turkish</option>
                </select>
              </div>
              <div>
                <label>Old image domain</label>
                <input className="input" value={oldDom} onChange={e => setOldDom(e.target.value)} />
              </div>
              <div>
                <label>New image domain</label>
                <input className="input" value={newDom} onChange={e => setNewDom(e.target.value)} />
              </div>
              <div>
                <label>Currency shortcode FROM</label>
                <input className="input" value={curFrom} onChange={e => setCurFrom(e.target.value)} />
              </div>
              <div>
                <label>Currency shortcode TO</label>
                <input className="input" value={curTo} onChange={e => setCurTo(e.target.value)} />
              </div>
              <div>
                <label>Currency label</label>
                <input className="input" value={curLbl} onChange={e => setCurLbl(e.target.value)} />
              </div>
              <label className="toggle">
                <input type="checkbox" checked={removeConvert} onChange={e => setRemoveConvert(e.target.checked)} />
                Remove [convert] shortcodes
              </label>
              <label className="toggle">
                <input type="checkbox" checked={runQa} onChange={e => setRunQa(e.target.checked)} />
                Run QA pass
              </label>
            </div>

            <button className="btn btn-primary" onClick={translate} disabled={loading} style={{ marginTop: 12 }}>
              {loading ? 'Translating…' : 'Translate'}
            </button>
          </section>
          <section className="panel glass">
            <h3 className="section-title">Output</h3>
            <label>Output HTML</label>
            <textarea className="textarea" value={htmlOut} onChange={e => setHtmlOut(e.target.value)} />
            <label>QA suggestions</label>
            <textarea className="textarea" style={{ minHeight: 140 }} value={qaReport} onChange={e => setQaReport(e.target.value)} />
          </section>
        </div>
      </main>
    </div>
  );
}

