"""WordPress HTML Translator – Streamlit app (limit-safe + v.1.1)

Features
────────
• Chunked, retry-safe translation RU/EN → EN/DE/ES/FR/TR  
• Domain & currency shortcode swap, **optional removal of [convert] blocks**  
• Optional QA pass (with back-off)  
• **English target extras:** no em-dashes; plain style; metric → imperial **and keep both**  
• **Non-English target extras when source is English:** drop imperial; output **metric only**

Run locally
───────────
export OPENAI_API_KEY=…  # required
pip install streamlit openai tiktoken
streamlit run wp_html_translator.py
"""

from __future__ import annotations

import time
from typing import List

import streamlit as st

try:
    import tiktoken  # type: ignore
except ImportError:
    st.error("Install tiktoken: pip install tiktoken")
    raise

from openai import OpenAI, RateLimitError

# ─────────────────────────── Config ────────────────────────────

MODEL_PREF_TRANSLATE = "gpt-4-1-mini"   # falls back to gpt-4o
MODEL_PREF_QA        = "gpt-4-1"
MODEL_FALLBACK       = "gpt-4o"
TOKEN_LIMIT          = 32_000          # context for gpt-4o
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
                        cur_from: str, cur_to: str, cur_label: str,
                        remove_convert_blocks: bool) -> str:
    common = f"""
You are a professional translator.
Translate the USER-supplied HTML from {src} to {tgt}.
Preserve ALL HTML tags, attributes, IDs, classes, comments and short-codes – edit only text nodes.
Replace image/video domain '{old_domain}' → '{new_domain}'.
"""

    # Currency handling
    if remove_convert_blocks:
        common += """
CURRENCY / SHORTCODES
• Remove every `[convert …]` shortcode entirely **together with** the immediately following currency word(s) and any adjoining parentheses.
• After removal, ensure the sentence reads naturally (fix stray spaces/punctuation). Do not insert a replacement number.
"""
    else:
        common += f"""
CURRENCY / SHORTCODES
• Inside any `[convert …]` shortcode, change `to="{cur_from}"` → `to="{cur_to}"` and replace the trailing currency word with '{cur_label}'.
"""

    # English target extras
    if tgt.lower().startswith("english"):
        common += """
ENGLISH TARGET – STYLE & UNITS
• Avoid em-dashes (—). Replace with normal dash (–) or a comma.
• Write in plain, everyday US English; short sentences, no academic phrasing.
• Convert metric to imperial **and keep both**:
  – distance: km → mi; m → ft; cm → in  (e.g. “10 km (6 mi)”)  
  – area: sq km → sq mi  
  – speed: km/h → mph  
  – weight: kg → lb; g → oz  
  – temperature: °C → °F (e.g. “20 °C (68 °F)”)  
• Round sensibly (km→mi to whole; m→ft to nearest 10 ft if >300 ft, else 1 ft). Do **not** change currencies beyond the shortcode rules above.
"""

    # Non‑English target + English source: drop imperial, output metric only
    if (src.lower().startswith("english")) and (not tgt.lower().startswith("english")):
        common += """
NON‑ENGLISH TARGET WHEN SOURCE IS ENGLISH – UNITS
• If the source uses imperial (mi, miles, ft, in, °F, mph, lb, oz), convert to metric equivalents and output **metric only** (km, m, cm, °C, km/h, kg, g). Do not include imperial in parentheses.
• Keep HTML unchanged.
"""

    common += """
OUTPUT
• Return **raw HTML only** – no extra wrappers, no markdown fences.
• If output would be truncated, respond with TRUNCATED.
"""
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
    qa_prompt = f"""You are a bilingual proof-reader. List mistranslations or omissions between SOURCE ({src_lang}) and TARGET ({tgt_lang}). If all good, reply 'No issues found.'"""
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
st.title("📝 WP HTML Translator – Localisation & retries")

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

remove_convert_blocks = st.checkbox("Remove [convert] currency shortcodes (delete the whole parentheses/label)", value=False)
run_qa = st.checkbox("Run QA pass", value=True)

if st.button("Translate"):
    if not html_in.strip():
        st.warning("Paste HTML first.")
        st.stop()
    if src_lang == tgt_lang:
        st.warning("Source and target are the same – nothing to translate.")
        st.stop()

    prompt = build_system_prompt(src_lang, tgt_lang, old_dom, new_dom, cur_from, cur_to, cur_lbl, remove_convert_blocks)
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
        with st.spinner("Proof-reading…"):
            report = qa_pass(html_in, full_out, src_lang, tgt_lang)
        st.text_area("QA suggestions", report, height=200)

    st.success("Done ✅")
    st.text_area("Output HTML", full_out, height=400)
    st.download_button("💾 Download HTML", full_out, file_name=f"translated_{tgt_lang.lower()}.html", mime="text/html")
