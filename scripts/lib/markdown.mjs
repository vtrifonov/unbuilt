export const DECLARATION_RE = /^- \*\*([A-Z]{2,8})-([1-9][0-9]*)\*\* \((MUST|SHOULD|MAY)\) (\S.*)$/;
export const RETIRED_RE = /^- \*\*([A-Z]{2,8})-([1-9][0-9]*)\*\* retired: (\S.*)$/;
export const ATTEMPT_RE = /^\s*[-*+]\s+\*\*([A-Za-z]{2,8})-(\d+)\*\*(.*)$/;
export const CITATION_RE = /\b([A-Z]{2,8})-([1-9][0-9]*)\b/g;

export function blankCommentsAndFences(text) {
  const out = [];
  let fence = null;
  let inComment = false;
  for (const line of text.split("\n")) {
    if (fence) {
      out.push("");
      if (line.trimStart().startsWith(fence.ch.repeat(fence.len))) fence = null;
      continue;
    }
    if (!inComment) {
      const m = /^\s*(`{3,}|~{3,})/.exec(line);
      if (m) {
        fence = { ch: m[1][0], len: m[1].length };
        out.push("");
        continue;
      }
    }
    let kept = "";
    let i = 0;
    while (i < line.length) {
      if (inComment) {
        const j = line.indexOf("-->", i);
        if (j < 0) break;
        inComment = false;
        i = j + 3;
      } else {
        const j = line.indexOf("<!--", i);
        if (j < 0) {
          kept += line.slice(i);
          break;
        }
        kept += line.slice(i, j);
        inComment = true;
        i = j + 4;
      }
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
  prose.split("\n").forEach((raw, idx) => {
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
  prose.split("\n").forEach((line, idx) => {
    for (const m of line.matchAll(CITATION_RE)) {
      if (!known.has(m[1])) continue;
      citations.push({ id: `${m[1]}-${m[2]}`, prefix: m[1], num: Number(m[2]), line: idx + 1, column: m.index + 1 });
    }
  });
  return citations;
}

export function findScenarioSections(prose) {
  const starts = [];
  prose.split("\n").forEach((line, idx) => {
    const m = /^## (.+)$/.exec(line);
    if (m) starts.push({ title: m[1].trim(), startLine: idx + 1 });
  });
  const last = countLines(prose);
  return starts.map((s, i) => ({ title: s.title, startLine: s.startLine, endLine: i + 1 < starts.length ? starts[i + 1].startLine - 1 : last }));
}
