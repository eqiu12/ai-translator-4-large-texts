"""WordPress HTML Translator – Streamlit app (limit‑safe + EN localisation)

Features
────────
• Chunked, retry‑safe translation RU/EN → DE/ES/FR/TR/EN  
• Domain & currency shortcode swap
• Optional QA pass (with back‑off)
• **Extra localisation when target = English:**
  – Replace em‑dash (—) with normal dash (–) or comma  
  – Use plain, non‑academic grammar  
  – Convert metric lengths, areas, speeds & temps to imperial **and keep both units**

Run locally
───────────
export OPENAI_API_KEY=…  # required
pip install streamlit openai tiktoken
streamlit run wp_html_translator.py
"""

from __future__ import annotations

import re, time
from typing import List

import streamlit as st

try:
    import tiktoken  # type: ignore
except ImportError:
    st.error("Install tiktoken: pip install tiktoken")
    raise

from openai import OpenAI, RateLimitError

# ─────────────────────────── Config ────────────────────────────

MODEL_PREF_TRANSLATE = "gpt-4-1-mini"   # falls back to gpt‑4o
MODEL_PREF_QA        = "gpt-4-1"
MODEL_FALLBACK       = "gpt-4o"
TOKEN_LIMIT          = 32_000          # context for gpt‑4o
SAFETY_MARGIN        = 0.5             # ≤16k tokens per chunk
MAX_RETRIES          = 5

client = OpenAI()
enc    = tiktoken.encoding_for_model(MODEL_FALLBACK)

# ─────────────────────────── Helpers ───────────────────────────

def ensure_model(name: str, fallback: str) -> str:
    try:
        client.models.retrieve(name)
        return name
    except Exception:
        return fallback

MODEL_TRANSLATE = ensure_model(MODEL_PREF_TRANSLATE, MODEL_FALLBACK)
MODEL_QA        = ensure_model(MODEL_PREF_QA, MODEL_FALLBACK)


# Dynamic prompt builder ---------------------------------------------------

def build_system_prompt(src: str, tgt: str, old_domain: str, new_domain: str,
                        cur_from: str, cur_to: str, cur_label: str) -> str:
    common = f"""
You are a professional translator.
Translate the USER‑supplied HTML from {src} to {tgt}.
Preserve ALL HTML tags, attributes, IDs, classes, comments and short‑codes – edit only text nodes.
Replace image/video domain '{old_domain}' → '{new_domain}'.
Inside [convert …] short‑codes: change to="{cur_from}" → to="{cur_to}" and replace the trailing currency word with '{cur_label}'.
Return **raw HTML only** – no extra wrappers. If output would be truncated respond with TRUNCATED.
"""

    if tgt.lower().startswith("english"):
        extra = """
EXTRA RULES FOR ENGLISH TARGET
• Avoid em‑dashes (—). Replace with normal dash (–) or comma as suits simple grammar.
• Write in plain, everyday US English; short sentences, no academic phrasing.
• Convert metric measurements to imperial and keep **both**:
  – length & distance: km → mi, m → ft, cm → in  (e.g. "10 km (6 mi)")
  – area: sq km → sq mi
  – speed: km/h → mph
  – weight: kg → lb, g → oz
  – temperature: °C → °F (e.g. "20 °C (68 °F)")
  Round converted numbers sensibly (km→mi to whole number; meters→feet to nearest 10 ft if >300 ft, otherwise 1 ft). Do **not** recalculate currency.
"""
        common += extra
    return common


# Chunking -----------------------------------------------------

def split_html(html: str, limit: int = TOKEN_LIMIT, margin: float = SAFETY_MARGIN) -> List[str]:
    safe = int(limit * margin)
    ids  = enc.encode(html)
    chunks, cur = [], []
    for tok in ids:
        cur.append(tok)
        if len(cur) >= safe:
            chunks.append(enc.decode(cur))
            cur = []
    if cur:
        chunks.append(enc.decode(cur))
    return chunks

# OpenAI call helpers ------------------------------------------

def with_retry(func, *args, **kwargs):
    for attempt in range(MAX_RETRIES):
        try:
            return func(*args, **kwargs)
        except RateLimitError:
            time.sleep(2 ** attempt)
    raise RuntimeError("OpenAI call failed after retries.")


def translate_chunk(chunk: str, prompt: str) -> str:
    out = with_retry(
        client.chat.completions.create,
        model=MODEL_TRANSLATE,
        messages=[{"role": "system", "content": prompt},
                  {"role": "user",   "content": chunk}],
        temperature=0,
        top_p=0,
        response_format={"type": "text"}
    ).choices[0].message.content
    if out.strip() == "TRUNCATED":
        raise ValueError("Chunk too large – lower SAFETY_MARGIN.")
    return out


def qa_pass(src_html: str, tgt_html: str, src_lang: str, tgt_lang: str) -> str:
    qa_prompt = f"""You are a bilingual proof‑reader. List mistranslations or omissions between SOURCE ({src_lang}) and TARGET ({tgt_lang}). If all good, reply 'No issues found.'"""
    return with_retry(
        client.chat.completions.create,
        model=MODEL_QA,
        messages=[
            {"role": "system", "content": qa_prompt},
            {"role": "user",   "content": f"SOURCE:\n{src_html}\n\nTARGET:\n{tgt_html}"}
        ],
        temperature=0,
        top_p=0
    ).choices[0].message.content.strip()

# ─────────────────────────── UI ────────────────────────────

st.set_page_config(page_title="WP HTML Translator", layout="wide")
st.title("📝 WP HTML Translator – EN localisation & retries")

html_in = st.text_area("Input HTML", height=400)
col1, col2 = st.columns(2)
with col1:
    src_lang = st.selectbox("Source language", ["Russian", "English"])
    old_dom  = st.text_input("Old image domain", "https://samokatus.ru/wp-content/uploads/2025/07")
    cur_from = st.text_input("Currency shortcode FROM", "rub")
with col2:
    tgt_lang = st.selectbox("Target language", ["English", "German", "Spanish", "French", "Turkish"])
    new_dom  = st.text_input("New image domain", "https://tripsteer.co/wp-content/uploads/2025/07")
    cur_to   = st.text_input("Currency shortcode TO", "usd")
    cur_lbl  = st.text_input("Currency label", "USD")

run_qa = st.checkbox("Run QA pass", value=True)

if st.button("Translate"):
    if not html_in.strip():
        st.warning("Paste HTML first.")
        st.stop()
    if src_lang == tgt_lang:
        st.warning("Source and target are the same – nothing to translate.")
        st.stop()

    prompt = build_system_prompt(src_lang, tgt_lang, old_dom, new_dom, cur_from, cur_to, cur_lbl)
    parts  = split_html(html_in)

    st.info(f"Translating {len(parts)} chunk(s)…")
    prog = st.progress(0.)
    out_parts: List[str] = []
    for i, part in enumerate(parts, 1):
        with st.spinner(f"Chunk {i}/{len(parts)}…"):
            out_parts.append(translate_chunk(part, prompt))
        prog.progress(i / len(parts))

    full_out = "\n".join(out_parts)

    if run_qa:
        st.subheader("QA pass")
        with st.spinner("Proof‑reading…"):
            report = qa_pass(html_in, full_out, src_lang, tgt_lang)
        st.text_area("QA suggestions", report, height=200)

    st.success("Done ✅")
    st.text_area("Output HTML", full_out, height=400)
    st.download_button("💾 Download HTML", full_out, file_name=f"translated_{tgt_lang.lower()}.html", mime="text/html")
