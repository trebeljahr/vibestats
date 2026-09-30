// loc-codex.js — Extract per-file lines-of-code changes from a Codex rollout JSONL event.
//
// Codex's edit primitive is `payload.type === 'custom_tool_call'` with `payload.name === 'apply_patch'`.
// `payload.input` carries the raw v4-style patch text:
//
//   *** Begin Patch
//   *** Update File: <path>
//   @@ ... @@
//    context line
//   -removed
//   +added
//   *** Add File: <path>
//   +new content
//   *** Delete File: <path>
//   *** End Patch
//
// A single apply_patch can touch multiple files. This module extracts one
// `{ day, sessionId, filePath, additions, deletions, op }` row per touched file.
//
//   op === 'update' — counted from -/+ lines in the patch body
//   op === 'add'    — every '+' line counts as an addition; deletions = 0
//   op === 'delete' — empty body; additions = 0, deletions = 0 (file-event marker)
//
// No npm deps. CommonJS.

'use strict';

const SECTION_RE = /^\*\*\* (Update|Add|Delete) File: (.+)$/;

/**
 * Extract per-file LOC entries from a single parsed JSONL event.
 *
 * @param {object} jsonLine - parsed JSON object from a codex-sessions/*.jsonl line
 * @param {object} [options]
 * @param {string} [options.fileMtime] - ISO string fallback for `day` if event has no timestamp
 * @param {object} [options.sessionMeta] - session-level meta (e.g. { id, cwd, workdir })
 * @returns {Array<{ day: string, sessionId: string|null, filePath: string, additions: number, deletions: number, op: 'update'|'add'|'delete' }>}
 */
function extractLocFromCodexLine(jsonLine, options) {
  if (!jsonLine || typeof jsonLine !== 'object') return [];
  const payload = jsonLine.payload;
  if (!payload || typeof payload !== 'object') return [];
  if (payload.type !== 'custom_tool_call') return [];
  if (payload.name !== 'apply_patch') return [];
  if (payload.status !== 'completed') return [];

  const input = typeof payload.input === 'string' ? payload.input : '';
  if (!input) return [];

  const opts = options || {};
  const fileMtime = opts.fileMtime || '';
  const sessionMeta = opts.sessionMeta || null;

  // Day: prefer the event's top-level timestamp; fall back to options.fileMtime.
  let day = null;
  const ts = jsonLine.timestamp;
  if (typeof ts === 'string' && ts.length >= 10) {
    day = ts.slice(0, 10);
  } else if (typeof fileMtime === 'string' && fileMtime.length >= 10) {
    day = fileMtime.slice(0, 10);
  }
  if (!day) return [];

  const sessionId = sessionMeta && typeof sessionMeta.id === 'string' ? sessionMeta.id : null;

  // Resolve relative file paths against the session's cwd/workdir when available.
  const baseDir =
    sessionMeta && typeof sessionMeta.cwd === 'string' ? sessionMeta.cwd :
    sessionMeta && typeof sessionMeta.workdir === 'string' ? sessionMeta.workdir :
    null;

  const lines = input.split('\n');
  const out = [];
  let current = null;

  const flush = () => {
    if (current) out.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Section header — flush prior accumulator, start a new one.
    const m = line.match(SECTION_RE);
    if (m) {
      flush();
      const kind = m[1]; // 'Update' | 'Add' | 'Delete'
      const rawPath = m[2].trim();
      const filePath = resolvePath(rawPath, baseDir);
      const op = kind === 'Update' ? 'update' : kind === 'Add' ? 'add' : 'delete';
      current = { day, sessionId, filePath, additions: 0, deletions: 0, op };
      continue;
    }

    // Outside a section: skip Begin/End Patch and anything else.
    if (!current) continue;

    // Inside a section.
    // Hunk separators and any other '*** ' directive — skip.
    if (line.startsWith('@@')) continue;
    if (line.startsWith('*** ')) {
      // End Patch (or unknown directive) — close out current and stop processing
      // until the next section header.
      flush();
      continue;
    }

    if (current.op === 'delete') {
      // Delete File body is empty per spec; nothing to count.
      continue;
    }

    if (current.op === 'add') {
      // Every '+' line is an addition; deletions stays 0.
      if (line.length > 0 && line.charCodeAt(0) === 43 /* '+' */) {
        current.additions++;
      }
      continue;
    }

    // op === 'update'
    if (line.length > 0) {
      const c = line.charCodeAt(0);
      if (c === 43 /* '+' */) current.additions++;
      else if (c === 45 /* '-' */) current.deletions++;
      // ' ' (context) and other lines are ignored.
    }
  }

  flush();
  return out;
}

// Resolve a patch-section path against a base dir.
// Absolute paths (leading '/') are returned as-is. Relative paths join with
// baseDir using a simple normalisation that doesn't require Node's `path`
// module — keeps the function trivially testable.
function resolvePath(p, baseDir) {
  if (!p) return p;
  if (p.charAt(0) === '/') return p;
  if (!baseDir) return p;
  const base = baseDir.endsWith('/') ? baseDir.slice(0, -1) : baseDir;
  return base + '/' + p;
}

/**
 * Aggregator wrapper mirroring loc-claude.js's shape.
 *
 * Mutates `agg` in place. Expected `agg` shape:
 *   {
 *     perDay: Map<day, { additions, deletions, files: Set<string> }>,
 *     perProject: Map<projectName, { additions, deletions, files: Set<string>, days: Set<string> }>,
 *     perFile: Map<filePath, { additions, deletions, op, day }>,
 *     totals: { additions, deletions, filesTouched: Set<string> }
 *   }
 *
 * Callers that pass a sparser `agg` get only the buckets they initialised
 * populated — missing maps/sets are skipped silently.
 *
 * @param {object} jsonLine
 * @param {string} fileMtime - ISO string fallback for the day
 * @param {string} projectName - already-derived project key (e.g. from cwd-to-key)
 * @param {object} agg - aggregator state to mutate
 */
function aggregateLocFromLine(jsonLine, fileMtime, projectName, agg) {
  if (!agg || typeof agg !== 'object') return;

  // Pull session meta off `agg` if the caller stashed it there, otherwise we
  // can't resolve relative paths — but extraction still works for absolute ones.
  const sessionMeta = agg._sessionMeta || null;

  const entries = extractLocFromCodexLine(jsonLine, { fileMtime, sessionMeta });
  if (!entries.length) return;

  for (const e of entries) {
    if (agg.perDay instanceof Map) {
      let d = agg.perDay.get(e.day);
      if (!d) {
        d = { additions: 0, deletions: 0, files: new Set() };
        agg.perDay.set(e.day, d);
      }
      d.additions += e.additions;
      d.deletions += e.deletions;
      if (d.files instanceof Set) d.files.add(e.filePath);
    }

    if (projectName && agg.perProject instanceof Map) {
      let p = agg.perProject.get(projectName);
      if (!p) {
        p = { additions: 0, deletions: 0, files: new Set(), days: new Set() };
        agg.perProject.set(projectName, p);
      }
      p.additions += e.additions;
      p.deletions += e.deletions;
      if (p.files instanceof Set) p.files.add(e.filePath);
      if (p.days instanceof Set) p.days.add(e.day);
    }

    if (agg.perFile instanceof Map) {
      let f = agg.perFile.get(e.filePath);
      if (!f) {
        f = { additions: 0, deletions: 0, op: e.op, day: e.day };
        agg.perFile.set(e.filePath, f);
      }
      f.additions += e.additions;
      f.deletions += e.deletions;
      // Last-write-wins for op/day — delete after update still reads as delete.
      f.op = e.op;
      f.day = e.day;
    }

    if (agg.totals && typeof agg.totals === 'object') {
      agg.totals.additions = (agg.totals.additions || 0) + e.additions;
      agg.totals.deletions = (agg.totals.deletions || 0) + e.deletions;
      if (agg.totals.filesTouched instanceof Set) agg.totals.filesTouched.add(e.filePath);
    }
  }
}

module.exports = {
  extractLocFromCodexLine,
  aggregateLocFromLine,
};
