export const DECLARATION_RE = /^- \*\*([A-Z]{2,8})-([1-9][0-9]*)\*\* \((MUST|SHOULD|MAY)\) (\S.*)$/;
export const RETIRED_RE = /^- \*\*([A-Z]{2,8})-([1-9][0-9]*)\*\* retired: (\S.*)$/;
export const ATTEMPT_RE = /^\s*[-*+]\s+\*\*([A-Za-z]{2,8})-(\d+)\*\*(.*)$/;
export const CITATION_RE = /\b([A-Z]{2,8})-([1-9][0-9]*)\b/g;

// CRLF files: drop the \r so `.*$`-style patterns match; line counts are unchanged.
const toLf = (text) => text.replace(/\r\n/g, "\n");

// CommonMark edges (spec amendment 8f): a backtick fence opener's info string cannot contain a backtick,
// a closing fence is fence characters plus optional whitespace only, and an unterminated `<!--` is literal text.
function fenceOpener(line) {
  const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m || (m[1][0] === "`" && m[2].includes("`"))) return null;
  return { ch: m[1][0], len: m[1].length };
}

function closesFence(line, fence) {
  const m = /^\s*(`+|~+)[ \t]*$/.exec(line);
  return m !== null && m[1][0] === fence.ch && m[1].length >= fence.len;
}

// Backtick code spans on one line: a run of n backticks closed by the next run of exactly n.
function codeSpans(line) {
  const runs = [...line.matchAll(/`+/g)].map((m) => [m.index, m[0].length]);
  const spans = [];
  for (let a = 0; a < runs.length; a++) {
    const b = runs.findIndex((r, k) => k > a && r[1] === runs[a][1]);
    if (b < 0) continue;
    spans.push([runs[a][0], runs[b][0] + runs[b][1]]);
    a = b;
  }
  return spans;
}

const isBlank = (line) => /^[ \t]*$/.test(line);

// Spec amendment 8f (recheck 2): a `<!--` at line start (up to three spaces) is an HTML block that runs to the
// next line containing `-->`; any other `<!--` opens a comment only if `-->` follows within its paragraph
// (before the next blank line); a `<!--` inside a code span on its line is literal; unterminated is literal.
function opensComment(lines, k, j, atLineStart) {
  if (lines[k].indexOf("-->", j + 4) >= 0) return true;
  for (let m = k + 1; m < lines.length; m++) {
    if (!atLineStart && isBlank(lines[m])) return false;
    if (lines[m].includes("-->")) return true;
  }
  return false;
}

export function blankCommentsAndFences(text) {
  const lines = toLf(text).split("\n");
  const out = [];
  let fence = null;
  let inComment = false;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    if (fence) {
      out.push("");
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    if (!inComment) {
      const opener = fenceOpener(line);
      if (opener) {
        fence = opener;
        out.push("");
        continue;
      }
    }
    const spans = codeSpans(line);
    let kept = "";
    let i = 0;
    while (i < line.length) {
      if (inComment) {
        const j = line.indexOf("-->", i);
        if (j < 0) break;
        inComment = false;
        i = j + 3;
        continue;
      }
      let j = line.indexOf("<!--", i);
      while (j >= 0) {
        const at = j;
        const span = spans.find(([s, e]) => s < at && at < e);
        const open = !span && opensComment(lines, k, j, i === 0 && /^ {0,3}$/.test(line.slice(0, j)));
        if (open) break;
        j = line.indexOf("<!--", span ? span[1] : j + 1);
      }
      if (j < 0) {
        kept += line.slice(i);
        break;
      }
      kept += line.slice(i, j);
      inComment = true;
      i = j + 4;
    }
    out.push(kept);
  }
  return out.join("\n");
}

export function countLines(text) {
  if (text === "") return 0;
  const breaks = text.split("\n").length - 1;
  return text.endsWith("\n") ? breaks : breaks + 1;
}

export function countWords(text) {
  return text.split(/\s+/).filter((w) => w !== "").length;
}

function exactOf(raw) {
  let m = DECLARATION_RE.exec(raw);
  if (m) {
    return { id: `${m[1]}-${m[2]}`, prefix: m[1], num: Number(m[2]), modality: m[3], retired: false, inferred: m[4].startsWith("(inferred)"), text: m[4] };
  }
  m = RETIRED_RE.exec(raw);
  if (m) {
    return { id: `${m[1]}-${m[2]}`, prefix: m[1], num: Number(m[2]), modality: null, retired: true, inferred: false, text: m[3] };
  }
  return null;
}

export function findAttempts(prose, knownPrefixes) {
  const known = new Set(knownPrefixes.map((p) => p.toLowerCase()));
  const attempts = [];
  toLf(prose).split("\n").forEach((raw, idx) => {
    const m = ATTEMPT_RE.exec(raw);
    if (!m) return;
    const rest = m[3];
    const lead = rest.trimStart();
    const hasModality = /^\((must|should|may)\)/i.test(lead);
    const retiredLead = /^retired\b:?/i.test(lead);
    const retiredShaped = retiredLead || /^\s*\((MUST|SHOULD|MAY)\)\s*retired\s*\.?\s*$/i.test(rest);
    if (!(known.has(m[1].toLowerCase()) || hasModality || retiredLead)) return;
    attempts.push({
      line: idx + 1,
      raw,
      prefix: m[1],
      num: Number(m[2]),
      rest,
      indented: /^\s/.test(raw),
      bullet: /[-*+]/.exec(raw)[0],
      hasModality,
      retiredShaped,
      exact: exactOf(raw),
    });
  });
  return attempts;
}

export function findCitations(prose, knownPrefixes) {
  const known = new Set(knownPrefixes);
  const citations = [];
  toLf(prose).split("\n").forEach((line, idx) => {
    for (const m of line.matchAll(CITATION_RE)) {
      if (!known.has(m[1])) continue;
      citations.push({ id: `${m[1]}-${m[2]}`, prefix: m[1], num: Number(m[2]), line: idx + 1, column: m.index + 1 });
    }
  });
  return citations;
}

export function findScenarioSections(text) {
  const prose = toLf(text);
  const starts = [];
  prose.split("\n").forEach((line, idx) => {
    const m = /^## (.+)$/.exec(line);
    if (m) starts.push({ title: m[1].trim(), startLine: idx + 1 });
  });
  const last = countLines(prose);
  return starts.map((s, i) => ({ title: s.title, startLine: s.startLine, endLine: i + 1 < starts.length ? starts[i + 1].startLine - 1 : last }));
}
