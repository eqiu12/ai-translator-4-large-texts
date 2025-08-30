export function buildSystemPrompt(
  src: string,
  tgt: string,
  oldDomain: string,
  newDomain: string,
  curFrom: string,
  curTo: string,
  curLabel: string,
  removeConvertBlocks: boolean
): string {
  let common = `\nYou are a professional translator.\nTranslate the USER-supplied HTML from ${src} to ${tgt}.\nPreserve ALL HTML tags, attributes, IDs, classes, comments and short-codes – edit only text nodes.\nReplace image/video domain '${oldDomain}' → '${newDomain}'.\n`;

  if (removeConvertBlocks) {
    common += `\nCURRENCY / SHORTCODES\n• Remove every \`[convert …]\` shortcode entirely **together with** the immediately following currency word(s) and any adjoining parentheses.\n• After removal, ensure the sentence reads naturally (fix stray spaces/punctuation). Do not insert a replacement number.\n`;
  } else {
    common += `\nCURRENCY / SHORTCODES\n• Inside any \`[convert …]\` shortcode, change \`to="${curFrom}"\` → \`to="${curTo}"\` and replace the trailing currency word with '${curLabel}'.\n`;
  }

  if (tgt.toLowerCase().startsWith("english")) {
    common += `\nENGLISH TARGET – STYLE & UNITS\n• Avoid em-dashes (—). Replace with normal dash (–) or a comma.\n• Write in plain, everyday US English; short sentences, no academic phrasing.\n• Convert metric to imperial **and keep both**:\n  – distance: km → mi; m → ft; cm → in  (e.g. “10 km (6 mi)”)  \n  – area: sq km → sq mi  \n  – speed: km/h → mph  \n  – weight: kg → lb; g → oz  \n  – temperature: °C → °F (e.g. “20 °C (68 °F)”)  \n• Round sensibly (km→mi to whole; m→ft to nearest 10 ft if >300 ft, else 1 ft). Do **not** change currencies beyond the shortcode rules above.\n`;
  }

  if (src.toLowerCase().startsWith("english") && !tgt.toLowerCase().startsWith("english")) {
    common += `\nNON‑ENGLISH TARGET WHEN SOURCE IS ENGLISH – UNITS\n• If the source uses imperial (mi, miles, ft, in, °F, mph, lb, oz), convert to metric equivalents and output **metric only** (km, m, cm, °C, km/h, kg, g). Do not include imperial in parentheses.\n• Keep HTML unchanged.\n`;
  }

  common += `\nOUTPUT\n• Return **raw HTML only** – no extra wrappers, no markdown fences.\n• If output would be truncated, respond with TRUNCATED.\n`;
  return common;
}

export function stripFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.split("\n", 1)[1] ?? "";
  }
  if (t.endsWith("```")) {
    const idx = t.lastIndexOf("\n");
    if (idx !== -1) t = t.slice(0, idx);
  }
  return t.trim();
}

