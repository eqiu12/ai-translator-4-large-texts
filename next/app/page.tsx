"use client";

import { useState, useMemo, useRef, useEffect } from "react";

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

      const r = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ htmlIn, srcLang, tgtLang, oldDom, newDom, curFrom, curTo, curLbl, removeConvertBlocks: removeConvert, runQa, useCache }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setHtmlOut(data.htmlOut || "");
      setQaReport(data.qaReport || "");
      // Refresh history and remove any pending placeholders
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

  useMemo(() => { fetchHistory(); }, []);

  useEffect(() => {
    // Auto-scroll to top where the newest item is added
    if (listRef.current && lastAddedKeyRef.current) {
      listRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      lastAddedKeyRef.current = null;
    }
  }, [hist.length]);

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
            <button key={h.key} onClick={() => loadItem(h.key)} className="history-item glass">
              <div className="history-item-row">
                <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {h.key.startsWith('pending:') && <span className="spinner" />}
                  {h.title ? h.title : h.tgt} <span style={{ color: '#a4a8b4' }}>(src: {h.src})</span>
                </div>
                <div className="history-item-meta">{h.createdAt}</div>
              </div>
            </button>
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

