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

import os
import sqlite3
import time
import json
import hashlib
import random
from datetime import datetime
from typing import List, Optional, Tuple

import streamlit as st

try:
    import tiktoken  # type: ignore
except ImportError:
    st.error("Install tiktoken: pip install tiktoken")
    raise

from openai import OpenAI, RateLimitError
try:
    from openai import APIError, APIConnectionError
except Exception:  # older SDKs
    APIError = Exception  # type: ignore
    APIConnectionError = Exception  # type: ignore

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

# Persistence (SQLite) -----------------------------------------

DB_PATH = os.path.join(os.path.dirname(__file__), "translations.db")


def init_db() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS translations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cache_key TEXT UNIQUE,
                src_lang TEXT,
                tgt_lang TEXT,
                old_domain TEXT,
                new_domain TEXT,
                cur_from TEXT,
                cur_to TEXT,
                cur_label TEXT,
                remove_convert_blocks INTEGER,
                run_qa INTEGER,
                model_translate TEXT,
                model_qa TEXT,
                html_in TEXT,
                html_out TEXT,
                qa_report TEXT,
                created_at TEXT
            )
            """
        )


def compute_cache_key(
    html_in: str,
    src_lang: str,
    tgt_lang: str,
    old_dom: str,
    new_dom: str,
    cur_from: str,
    cur_to: str,
    cur_lbl: str,
    remove_convert_blocks: bool,
    run_qa: bool,
    model_translate: str,
    model_qa: str,
) -> str:
    payload = {
        "html_in": html_in,
        "src_lang": src_lang,
        "tgt_lang": tgt_lang,
        "old_dom": old_dom,
        "new_dom": new_dom,
        "cur_from": cur_from,
        "cur_to": cur_to,
        "cur_lbl": cur_lbl,
        "remove_convert_blocks": remove_convert_blocks,
        "run_qa": run_qa,
        "model_translate": model_translate,
        "model_qa": model_qa,
    }
    data = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def save_translation(
    cache_key: str,
    html_in: str,
    html_out: str,
    qa_report: Optional[str],
    params: Tuple[str, str, str, str, str, str, str, bool, bool, str, str],
) -> None:
    (
        src_lang,
        tgt_lang,
        old_dom,
        new_dom,
        cur_from,
        cur_to,
        cur_lbl,
        remove_convert_blocks,
        run_qa,
        model_translate,
        model_qa,
    ) = params
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT INTO translations (
                cache_key, src_lang, tgt_lang, old_domain, new_domain,
                cur_from, cur_to, cur_label, remove_convert_blocks, run_qa,
                model_translate, model_qa, html_in, html_out, qa_report, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
                html_out=excluded.html_out,
                qa_report=excluded.qa_report,
                created_at=excluded.created_at
            """,
            (
                cache_key,
                src_lang,
                tgt_lang,
                old_dom,
                new_dom,
                cur_from,
                cur_to,
                cur_lbl,
                1 if remove_convert_blocks else 0,
                1 if run_qa else 0,
                model_translate,
                model_qa,
                html_in,
                html_out,
                qa_report or "",
                datetime.utcnow().isoformat(timespec="seconds") + "Z",
            ),
        )


def get_translation_by_key(cache_key: str) -> Optional[Tuple[str, str]]:
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(
            "SELECT html_out, qa_report FROM translations WHERE cache_key = ?",
            (cache_key,),
        )
        row = cur.fetchone()
        if row:
            return row[0], row[1]
    return None


def list_recent(limit: int = 50) -> List[Tuple[str, str, str, str]]:
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(
            """
            SELECT cache_key, tgt_lang, created_at, src_lang
            FROM translations
            ORDER BY datetime(created_at) DESC
            LIMIT ?
            """,
            (limit,),
        )
        return [(r[0], r[1], r[2], r[3]) for r in cur.fetchall()]


def strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        # Remove starting fence with optional language
        t = t.split("\n", 1)[1] if "\n" in t else ""
    if t.endswith("```"):
        t = t.rsplit("\n", 1)[0]
    return t.strip()


# OpenAI call helpers ------------------------------------------

def with_retry(func, *args, **kwargs):
    for attempt in range(MAX_RETRIES):
        try:
            return func(*args, **kwargs)
        except (RateLimitError, APIError, APIConnectionError):
            sleep_s = (2 ** attempt) + random.uniform(0, 0.5)
            time.sleep(sleep_s)
        except Exception:
            # Non-transient; rethrow
            raise
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
    return strip_fences(out)


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

init_db()

st.set_page_config(page_title="WP HTML Translator", layout="wide")
st.title("📝 WP HTML Translator – Localisation & retries")

if "output_html" not in st.session_state:
    st.session_state.output_html = ""
if "qa_report" not in st.session_state:
    st.session_state.qa_report = ""

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

with st.sidebar:
    st.header("History")
    use_cache = st.checkbox("Use cached translation if available", value=True)
    recent = list_recent(50)
    labels = [f"{i+1:02d}. {tgt} @ {created} (src: {src})" for i, (_, tgt, created, src) in enumerate(recent)]
    selected_idx = st.selectbox("Recent translations", list(range(len(labels))), format_func=lambda i: labels[i] if labels else "—", index=0 if labels else 0)
    selected_key = recent[selected_idx][0] if recent else None
    if st.button("Load selected to Output") and selected_key:
        loaded = get_translation_by_key(selected_key)
        if loaded:
            st.session_state.output_html, st.session_state.qa_report = loaded[0], loaded[1]
            st.success("Loaded saved translation into Output.")

if st.button("Translate"):
    try:
        if not html_in.strip():
            st.warning("Paste HTML first.")
            st.stop()
        if src_lang == tgt_lang:
            st.warning("Source and target are the same – nothing to translate.")
            st.stop()

        cache_key = compute_cache_key(
            html_in,
            src_lang,
            tgt_lang,
            old_dom,
            new_dom,
            cur_from,
            cur_to,
            cur_lbl,
            remove_convert_blocks,
            run_qa,
            MODEL_TRANSLATE,
            MODEL_QA,
        )

        if use_cache:
            cached = get_translation_by_key(cache_key)
            if cached:
                st.info("Loaded from cache.")
                st.session_state.output_html, st.session_state.qa_report = cached[0], cached[1]
            else:
                prompt = build_system_prompt(src_lang, tgt_lang, old_dom, new_dom, cur_from, cur_to, cur_lbl, remove_convert_blocks)
                parts  = split_html(html_in)

                st.info(f"Translating {len(parts)} chunk(s)…")
                prog = st.progress(0.)
                out_parts: List[str] = []
                for i, part in enumerate(parts, 1):
                    with st.spinner(f"Chunk {i}/{len(parts)}…"):
                        out_parts.append(translate_chunk(part, prompt))
                    prog.progress(i / len(parts))

                full_out = strip_fences("\n".join(out_parts))
                qa_text = ""
                if run_qa:
                    st.subheader("QA pass")
                    with st.spinner("Proof-reading…"):
                        qa_text = qa_pass(html_in, full_out, src_lang, tgt_lang)
                    st.text_area("QA suggestions", qa_text, height=200)

                st.session_state.output_html = full_out
                st.session_state.qa_report = qa_text

                save_translation(
                    cache_key,
                    html_in,
                    st.session_state.output_html,
                    st.session_state.qa_report,
                    (
                        src_lang,
                        tgt_lang,
                        old_dom,
                        new_dom,
                        cur_from,
                        cur_to,
                        cur_lbl,
                        remove_convert_blocks,
                        run_qa,
                        MODEL_TRANSLATE,
                        MODEL_QA,
                    ),
                )
                st.success("Saved translation.")
        else:
            prompt = build_system_prompt(src_lang, tgt_lang, old_dom, new_dom, cur_from, cur_to, cur_lbl, remove_convert_blocks)
            parts  = split_html(html_in)

            st.info(f"Translating {len(parts)} chunk(s)…")
            prog = st.progress(0.)
            out_parts: List[str] = []
            for i, part in enumerate(parts, 1):
                with st.spinner(f"Chunk {i}/{len(parts)}…"):
                    out_parts.append(translate_chunk(part, prompt))
                prog.progress(i / len(parts))

            full_out = strip_fences("\n".join(out_parts))
            qa_text = ""
            if run_qa:
                st.subheader("QA pass")
                with st.spinner("Proof-reading…"):
                    qa_text = qa_pass(html_in, full_out, src_lang, tgt_lang)
                st.text_area("QA suggestions", qa_text, height=200)

            st.session_state.output_html = full_out
            st.session_state.qa_report = qa_text

            st.success("Done ✅")
    except ValueError as e:
        st.error(str(e))
    except Exception as e:
        st.error(f"Translation failed: {e}")

st.text_area("Output HTML", st.session_state.output_html, height=400)
if st.session_state.output_html:
    st.download_button("💾 Download HTML", st.session_state.output_html, file_name=f"translated_{tgt_lang.lower()}.html", mime="text/html")
