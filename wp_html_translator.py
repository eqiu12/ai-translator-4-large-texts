"""WordPress HTML Translator – Streamlit app (rate‑limit safe)

Paste a big HTML article (RU or EN) and get a fully‑translated version in
German, Spanish, French, Turkish, **or English** with:
  • domain swap (samokatus.ru → tripsteer.co)
  • currency shortcode swap (rub → usd → label USD)
  • safe chunking + retry/back‑off so you stay within default OpenAI RPM/TPM
  • optional QA pass with its own retry logic

Run locally:
    export OPENAI_API_KEY=…
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

# ──────────────────────────── Config ─────────────────────────────

MODEL_PREF_TRANSLATE = "gpt-4-1-mini"   # fallback to gpt-4o if not enabled
MODEL_PREF_QA        = "gpt-4-1"
MODEL_FALLBACK       = "gpt-4o"
TOKEN_LIMIT          = 32_000          # gpt‑4o max context
SAFETY_MARGIN        = 0.5             # 50 % of context per chunk
MAX_RETRIES          = 5              # for 429 back‑off

client = OpenAI()
enc    = tiktoken.encoding_for_model(MODEL_FALLBACK)

# ──────────────────────────── Helpers ────────────────────────────

def ensure_model(name: str, fallback: str) -> str:
    try:
        client.models.retrieve(name)
        return name
    except Exception:
        return fallback

MODEL_TRANSLATE = ensure_model(MODEL_PREF_TRANSLATE, MODEL_FALLBACK)
MODEL_QA        = ensure_model(MODEL_PREF_QA, MODEL_FALLBACK)


def build_system_prompt(src: str, tgt: str, old_domain: str, new_domain: str,
                        cur_from: str, cur_to: str, cur_label: str) -> str:
    return f"""
You are a professional native‑level translator.
Translate every {src} text node in the USER HTML into natural, idiomatic {tgt}.
Preserve *all* HTML tags, attributes, comments, and short‑codes.
Replace image/video domain '{old_domain}' → '{new_domain}'.
In [convert …] short‑codes: change to="{cur_from}" → to="{cur_to}", and change the trailing currency word to '{cur_label}'.
Return **raw HTML only**. If output would be truncated, reply TRUNCATED.
"""


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


def translate_once(chunk: str, prompt: str) -> str:
    return client.chat.completions.create(
        model=MODEL_TRANSLATE,
        messages=[{"role": "system", "content": prompt},
                  {"role": "user",   "content": chunk}],
        temperature=0,
        top_p=0,
        response_format={"type": "text"}
    ).choices[0].message.content


def translate_chunk(chunk: str, prompt: str) -> str:
    for attempt in range(MAX_RETRIES):
        try:
            out = translate_once(chunk, prompt)
            if out.strip() == "TRUNCATED":
                raise ValueError("Chunk too large – lower SAFETY_MARGIN.")
            return out
        except RateLimitError:
            time.sleep(2 ** attempt)  # exponential back‑off
    raise RuntimeError("Translation failed after retries.")


def qa_pass(source: str, target: str, src_lang: str, tgt_lang: str) -> str:
    qa_prompt = f"""
You are a bilingual proof‑reader.
Find mistranslations, omissions, or meaning shifts between SOURCE ({src_lang}) and TARGET ({tgt_lang}).
Return a numbered list; if none found, reply 'No issues found.'
"""

    for attempt in range(MAX_RETRIES):
        try:
            return client.chat.completions.create(
                model=MODEL_QA,
                messages=[
                    {"role": "system", "content": qa_prompt},
                    {"role": "user",   "content": f"SOURCE:\n{source}\n\nTARGET:\n{target}"}
                ],
                temperature=0,
                top_p=0
            ).choices[0].message.content.strip()
        except RateLimitError:
            time.sleep(2 ** attempt)
    return "QA aborted after too many retries."  # graceful fallback

# ──────────────────────────── Streamlit UI ───────────────────────

st.set_page_config(page_title="WP HTML Translator", layout="wide")
st.title("📝 WordPress HTML Translator – Limit‑Safe")

html_in = st.text_area("Input HTML", height=400)
col1, col2 = st.columns(2)
with col1:
    src_lang = st.selectbox("Source language", ["Russian", "English"])
    old_dom  = st.text_input("Old image domain", "https://samokatus.ru/wp-content/uploads/2025/07")
    cur_from = st.text_input("Currency shortcode FROM", "rub")
with col2:
    tgt_lang = st.selectbox("Target language", ["German", "Spanish", "French", "Turkish", "English"])
    new_dom  = st.text_input("New image domain", "https://tripsteer.co/wp-content/uploads/2025/07")
    cur_to   = st.text_input("Currency shortcode TO", "usd")
    cur_lbl  = st.text_input("Currency label", "USD")

run_qa = st.checkbox("Run QA pass", value=True)

if st.button("Translate"):
    if not html_in.strip():
        st.warning("Paste HTML first.")
        st.stop()
    if src_lang == tgt_lang:
        st.warning("Source and target are the same – nothing to do.")
        st.stop()

    prompt = build_system_prompt(src_lang, tgt_lang, old_dom, new_dom, cur_from, cur_to, cur_lbl)
    parts  = split_html(html_in)

    st.info(f"Translating {len(parts)} chunk(s) sequentially…")
    prog = st.progress(0.0)
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

    st.success("Translation finished ✅")
    st.text_area("Output HTML", full_out, height=400)
    st.download_button("💾 Download", full_out, file_name=f"translated_{tgt_lang.lower()}.html", mime="text/html")
