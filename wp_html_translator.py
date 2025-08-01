"""WordPress HTML Translator – Streamlit app

Paste a big HTML article (RU or EN), pick a target language (DE/ES/FR/TR/EN) and
get fully-translated HTML back with:
  • domain swap (e.g. samokatus.ru → tripsteer.co)
  • currency shortcode swap (rub → usd → label USD)
  • safe chunking + truncation guard
  • optional QA pass that flags mistranslations

Run:
    export OPENAI_API_KEY=...  # required
    pip install streamlit openai tiktoken
    streamlit run wp_html_translator.py
"""

from pathlib import Path
from typing import List

import re
import streamlit as st

try:
    import tiktoken  # type: ignore
except ImportError:
    st.error("❌ Install 'tiktoken' first: pip install tiktoken")
    raise

from openai import OpenAI

# ------------- Model & token helpers -------------------------------------------------
MODEL_TRANSLATE_DEFAULT = "gpt-4o"  # safe default available to every paid account
MODEL_QA_DEFAULT = "gpt-4o"
TOKEN_LIMIT = 32_000  # gpt-4o-128k has more, but 32k is safe for mini
SAFETY_MARGIN = 0.85  # 15 % headroom

enc = tiktoken.encoding_for_model(MODEL_TRANSLATE_DEFAULT)
client = OpenAI()


def count_tokens(text: str) -> int:
    """Approximate tokens for the given model."""
    return len(enc.encode(text))


# ------------- Prompt builders --------------------------------------------------------

def build_system_prompt(src_lang: str, tgt_lang: str, old_domain: str, new_domain: str,
                        currency_from: str, currency_to: str, currency_label: str) -> str:
    return f"""
You are a professional native-level translator.

TASK:
Translate every {src_lang} text node in the USER-supplied HTML into natural, idiomatic {tgt_lang}.
Never shorten, summarise, or change meaning.

STRUCTURAL RULES:
• Preserve ALL HTML tags, attributes, inline styles, comments, IDs, classes, widths, heights, anchor names and shortcodes exactly as written.
• Keep indentation and line breaks exactly as in the input.
• Output raw HTML only – no markdown, no extra text.

SEARCH-AND-REPLACE RULES:
1. Change only the domain prefix in image/video URLs:
   '{old_domain}' → '{new_domain}'
2. In [convert …] shortcodes:
   – replace to="{currency_from}" with to="{currency_to}"
   – replace the trailing currency word (рублей, руб., RUR, etc.) with '{currency_label}'

QUALITY:
• Temperature 0, top_p 0 for deterministic output.
• If output would be truncated, respond ONLY with the word TRUNCATED so the caller can retry with smaller chunks.
"""


# ------------- Chunking ---------------------------------------------------------------

def split_html_into_chunks(html: str, max_tokens: int = TOKEN_LIMIT, safety: float = SAFETY_MARGIN) -> List[str]:
    """Split HTML into safe chunks respecting token limits."""
    safe_limit = int(max_tokens * safety)
    tokens = enc.encode(html)

    chunks, current = [], []
    for tok in tokens:
        current.append(tok)
        if len(current) >= safe_limit:
            chunks.append(enc.decode(current))
            current = []
    if current:
        chunks.append(enc.decode(current))
    return chunks


# ------------- Translation ------------------------------------------------------------

def ensure_model_available(name: str, fallback: str) -> str:
    """Return `name` if accessible to this key, else fallback."""
    try:
        client.models.retrieve(name)
        return name
    except Exception:
        return fallback

MODEL_TRANSLATE = ensure_model_available("gpt-4-1-mini", MODEL_TRANSLATE_DEFAULT)
MODEL_QA = ensure_model_available("gpt-4-1", MODEL_QA_DEFAULT)


def translate_chunk(chunk: str, system_prompt: str) -> str:
    resp = client.chat.completions.create(
        model=MODEL_TRANSLATE,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": chunk}
        ],
        temperature=0,
        top_p=0,
        response_format={"type": "text"}
    )
    out = resp.choices[0].message.content
    if out.strip() == "TRUNCATED":
        raise ValueError("Chunk too large – try smaller split.")
    return out


# ------------- QA check ---------------------------------------------------------------

def qa_check(original: str, translation: str, src_lang: str, tgt_lang: str) -> str:
    qa_prompt = f"""
You are a bilingual proof-reader.
Compare the {src_lang} original and its {tgt_lang} translation.
Spot mistranslations, omissions or meaning shifts.
Output a numbered list: original sentence → suggested correction. If none, reply 'No issues found.'
"""
    resp = client.chat.completions.create(
        model=MODEL_QA,
        messages=[
            {"role": "system", "content": qa_prompt},
            {"role": "user", "content": f"ORIGINAL:\n{original}\n\nTRANSLATION:\n{translation}"}
        ],
        temperature=0,
        top_p=0
    )
    return resp.choices[0].message.content.strip()


# ------------- Streamlit UI -----------------------------------------------------------

st.set_page_config(page_title="WP HTML Translator", layout="wide")
st.title("📝 WordPress HTML Translator (GPT-powered)")

st.markdown("Paste your HTML post and get a fully translated version with domain & currency swaps.")

html_input = st.text_area("Input HTML", height=400)

col1, col2 = st.columns(2)
with col1:
    src_lang = st.selectbox("Source language", ["Russian", "English"])
    old_domain = st.text_input("Old image domain", "https://samokatus.ru/wp-content/uploads/2025/07")
    currency_from = st.text_input("Currency shortcode FROM", "rub")
with col2:
    tgt_lang = st.selectbox("Target language", ["German", "Spanish", "French", "Turkish", "English"])
    new_domain = st.text_input("New image domain", "https://tripsteer.co/wp-content/uploads/2025/07")
    currency_to = st.text_input("Currency shortcode TO", "usd")
    currency_label = st.text_input("Currency label", "USD")

run_qa = st.checkbox("Run QA pass (extra pennies, recommended)", value=True)

if st.button("Translate"):
    if not html_input.strip():
        st.warning("Please paste some HTML first.")
        st.stop()

    if src_lang == tgt_lang:
        st.warning("Source and target languages are the same. Nothing to translate!")
        st.stop()

    system_prompt = build_system_prompt(src_lang, tgt_lang,
                                        old_domain, new_domain,
                                        currency_from, currency_to, currency_label)

    chunks = split_html_into_chunks(html_input)
    st.info(f"Splitting into {len(chunks)} chunk(s)…")

    translated_chunks = []
    progress = st.progress(0.0)
    for idx, ch in enumerate(chunks, start=1):
        with st.spinner(f"Translating chunk {idx}/{len(chunks)}…"):
            translated = translate_chunk(ch, system_prompt)
            translated_chunks.append(translated)
            progress.progress(idx / len(chunks))

    full_translation = "\n".join(translated_chunks)

    # Optional QA pass
    if run_qa:
        st.subheader("QA Report")
        with st.spinner("Running QA pass…"):
            report = qa_check(html_input, full_translation, src_lang, tgt_lang)
        st.text_area("QA suggestions", value=report, height=200)

    st.success("Translation complete!")

    # Show result & download
    st.subheader("Translated HTML")
    st.text_area("Output HTML", value=full_translation, height=400)

    file_name = f"translated_{tgt_lang.lower()}.html"
    st.download_button("💾 Download HTML", data=full_translation, file_name=file_name, mime="text/html")
