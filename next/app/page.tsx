"use client";

import { useState, useMemo } from "react";

type HistoryItem = {
  key: string;
  tgt: string;
  src: string;
  createdAt: string;
};

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
  const [runQa, setRunQa] = useState(true);

  async function fetchHistory() {
    const r = await fetch("/api/history");
    if (r.ok) {
      const data = await r.json();
      setHist(data.items ?? []);
    }
  }

  async function translate() {
    setLoading(true);
    setQaReport("");
    try {
      const r = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          htmlIn,
          srcLang,
          tgtLang,
          oldDom,
          newDom,
          curFrom,
          curTo,
          curLbl,
          removeConvertBlocks: removeConvert,
          runQa,
          useCache,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setHtmlOut(data.htmlOut || "");
      setQaReport(data.qaReport || "");
      fetchHistory();
    } catch (e: any) {
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

  useMemo(() => {
    fetchHistory();
  }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', height: '100vh' }}>
      <aside style={{ borderRight: '1px solid #ddd', padding: 16, overflowY: 'auto' }}>
        <h3>History</h3>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={useCache} onChange={e => setUseCache(e.target.checked)} />
          Use cache if available
        </label>
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {hist.length === 0 && <div>No items</div>}
          {hist.map((h) => (
            <button key={h.key} onClick={() => loadItem(h.key)} style={{ textAlign: 'left' }}>
              {h.tgt} @ {h.createdAt} (src: {h.src})
            </button>
          ))}
        </div>
      </aside>
      <main style={{ padding: 16, overflow: 'auto' }}>
        <h1>WP HTML Translator</h1>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label>Input HTML</label>
            <textarea value={htmlIn} onChange={e => setHtmlIn(e.target.value)} style={{ width: '100%', height: 300 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              <div>
                <label>Source language</label>
                <select value={srcLang} onChange={e => setSrcLang(e.target.value)}>
                  <option>Russian</option>
                  <option>English</option>
                </select>
              </div>
              <div>
                <label>Target language</label>
                <select value={tgtLang} onChange={e => setTgtLang(e.target.value)}>
                  <option>English</option>
                  <option>German</option>
                  <option>Spanish</option>
                  <option>French</option>
                  <option>Turkish</option>
                </select>
              </div>
              <div>
                <label>Old image domain</label>
                <input value={oldDom} onChange={e => setOldDom(e.target.value)} />
              </div>
              <div>
                <label>New image domain</label>
                <input value={newDom} onChange={e => setNewDom(e.target.value)} />
              </div>
              <div>
                <label>Currency shortcode FROM</label>
                <input value={curFrom} onChange={e => setCurFrom(e.target.value)} />
              </div>
              <div>
                <label>Currency shortcode TO</label>
                <input value={curTo} onChange={e => setCurTo(e.target.value)} />
              </div>
              <div>
                <label>Currency label</label>
                <input value={curLbl} onChange={e => setCurLbl(e.target.value)} />
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={removeConvert} onChange={e => setRemoveConvert(e.target.checked)} />
                Remove [convert] shortcodes
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={runQa} onChange={e => setRunQa(e.target.checked)} />
                Run QA pass
              </label>
            </div>
            <button onClick={translate} disabled={loading} style={{ marginTop: 12 }}>
              {loading ? 'Translating…' : 'Translate'}
            </button>
          </div>
          <div>
            <label>Output HTML</label>
            <textarea value={htmlOut} onChange={e => setHtmlOut(e.target.value)} style={{ width: '100%', height: 300 }} />
            <label>QA suggestions</label>
            <textarea value={qaReport} onChange={e => setQaReport(e.target.value)} style={{ width: '100%', height: 160 }} />
          </div>
        </div>
      </main>
    </div>
  );
}

