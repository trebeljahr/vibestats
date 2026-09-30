// Extract lines-of-code (LOC) deltas from a single line of a Claude Code
// transcript JSONL file.
//
// Input shape: Claude Code stores per-session JSONL streams at
//   ~/.vibestats/snapshots/<DATE>/projects[-archive]/<projectDir>/*.jsonl
// where each line is an event with `{type, message, timestamp, sessionId, ...}`.
// Code-mutation events are `type: 'user'` events whose `toolUseResult` field
// is a structured object that the matching `assistant`/`tool_use` block named
// `Edit` / `Write` / `MultiEdit`.
//
// This module is *deliberately oblivious* to the assistant-side tool_use block
// (so it doesn't need a two-pass file walk). Instead it identifies a mutation
// purely from the *result* shape:
//   - Has `toolUseResult.filePath` + `toolUseResult.structuredPatch`  → Edit / Write-update / MultiEdit
//   - Has `toolUseResult.type === 'create'`                            → Write-create
// Other tool results (Bash stdout, Read text payloads, Task rollups, etc.) are
// returned as `null` and the caller skips them.
//
// We intentionally count `userModified: true` events the same as normal edits.
// In that schema, Claude *proposed* the edit and the user altered it before
// saving — the patch numbers we read already reflect the final saved diff, so
// dropping the row would under-count the user's actual save. Consumers who
// want to flag these separately can re-read the field themselves; this module
// just returns the LOC numbers.

const path = require('path');

/**
 * Walk a structuredPatch array and tally + / - line counts. Defensive against
 * unified-diff *header* lines like `+++ b/foo` or `--- a/foo` that should not
 * appear inside Claude's `structuredPatch.lines` (the file headers live in the
 * surrounding `oldStart` / `newStart` metadata) — if we ever see one we skip
 * it rather than counting it as a real +/- line.
 */
function countStructuredPatch(structuredPatch) {
  let additions = 0;
  let deletions = 0;
  if (!Array.isArray(structuredPatch)) return { additions, deletions };
  for (const hunk of structuredPatch) {
    if (!hunk || !Array.isArray(hunk.lines)) continue;
    for (const line of hunk.lines) {
      if (typeof line !== 'string') continue;
      // Skip unified-diff file headers if they ever leak into a hunk.
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (line.startsWith('+')) additions++;
      else if (line.startsWith('-')) deletions++;
      // Lines starting with ' ' (context) or anything else: skip.
    }
  }
  return { additions, deletions };
}

/**
 * Extract LOC info from a single parsed JSON event line.
 *
 * @param {object} jsonLine - parsed JSON object (one JSONL row)
 * @param {object} options
 * @param {string} options.projectDir - snapshot subdir name, e.g.
 *   '-Users-rico-projects-foo'. Used verbatim as the `project` key so it
 *   joins cleanly with cwd-manifest / project-aliases.
 * @param {string} [options.fileMtime] - ISO string fallback for `day` when the
 *   event has no `timestamp` (rare, but JSONL streams sometimes start with a
 *   meta line that has none).
 * @returns {null | {day, project, sessionId, filePath, additions, deletions}}
 */
function extractLocFromClaudeLine(jsonLine, options) {
  if (!jsonLine || typeof jsonLine !== 'object') return null;
  const tur = jsonLine.toolUseResult;
  if (!tur || typeof tur !== 'object') return null;

  const projectDir = options && options.projectDir;
  const fileMtime = options && options.fileMtime;

  let additions = 0;
  let deletions = 0;
  let filePath = null;

  if (tur.type === 'create') {
    // Write-create: structuredPatch is `[]`, the body is in `tur.content`.
    if (typeof tur.content !== 'string' || tur.content.length === 0) return null;
    filePath = tur.filePath || null;
    // splitlines-style count: a final trailing newline shouldn't add a phantom
    // empty line. `'a\nb\n'.split('\n')` → ['a','b',''] — drop the trailing
    // empty when the content ends with `\n`.
    const parts = tur.content.split('\n');
    if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
    additions = parts.length;
    deletions = 0;
  } else if (tur.filePath && Array.isArray(tur.structuredPatch) && tur.structuredPatch.length > 0) {
    // Edit / Write-update / MultiEdit (anything that produced a structuredPatch).
    filePath = tur.filePath;
    const counts = countStructuredPatch(tur.structuredPatch);
    additions = counts.additions;
    deletions = counts.deletions;
  } else if (tur.filePath && tur.structuredPatch !== undefined &&
             (typeof tur.oldString === 'string' || typeof tur.newString === 'string')) {
    // Rare fallback: structuredPatch missing/empty but oldString/newString
    // present (≈2 in 15k events in the observed snapshot). Approximate the
    // diff by counting newlines on each side independently.
    filePath = tur.filePath;
    const oldLines = typeof tur.oldString === 'string'
      ? tur.oldString.split('\n').length
      : 0;
    const newLines = typeof tur.newString === 'string'
      ? tur.newString.split('\n').length
      : 0;
    additions = newLines;
    deletions = oldLines;
  } else {
    // Not a code-mutation event (Bash result, Read payload, Task/Agent rollup,
    // TodoWrite, WebFetch, etc.). The caller will count these elsewhere if it
    // cares; here we just decline.
    return null;
  }

  // No filePath means we can't attribute the change — bail rather than emit a
  // ghost row. (Write-create with no filePath is malformed JSON.)
  if (!filePath) return null;

  // Day bucket — UTC truncation of the ISO timestamp. Caller can re-bucket
  // by local TZ if it wants; the snapshot is timezone-naive on disk.
  let day = null;
  if (typeof jsonLine.timestamp === 'string' && jsonLine.timestamp.length >= 10) {
    day = jsonLine.timestamp.slice(0, 10);
  } else if (typeof fileMtime === 'string' && fileMtime.length >= 10) {
    day = fileMtime.slice(0, 10);
  } else {
    return null;
  }

  return {
    day,
    project: projectDir || null,
    sessionId: jsonLine.sessionId || null,
    filePath,
    additions,
    deletions,
  };
}

/**
 * Bump an aggregator object in place using a single parsed event line.
 *
 * @param {object} jsonLine - parsed JSON object (one JSONL row)
 * @param {string} projectDir - snapshot subdir name
 * @param {string} [fileMtime] - ISO fallback
 * @param {object} agg - aggregator with shape:
 *   {
 *     perDay: Map<day, {additions, deletions, files: Set<string>}>,
 *     perProject: Map<name, {additions, deletions, files: Set<string>}>,
 *     totalAdditions: number,
 *     totalDeletions: number,
 *     totalFiles: Set<string>,
 *   }
 */
function aggregateLocFromLine(jsonLine, projectDir, fileMtime, agg) {
  const loc = extractLocFromClaudeLine(jsonLine, { projectDir, fileMtime });
  if (!loc) return;
  if (!agg) return;

  // per-day
  if (agg.perDay instanceof Map) {
    let bucket = agg.perDay.get(loc.day);
    if (!bucket) {
      bucket = { additions: 0, deletions: 0, files: new Set() };
      agg.perDay.set(loc.day, bucket);
    }
    bucket.additions += loc.additions;
    bucket.deletions += loc.deletions;
    if (loc.filePath) bucket.files.add(loc.filePath);
  }

  // per-project
  if (agg.perProject instanceof Map && loc.project) {
    let bucket = agg.perProject.get(loc.project);
    if (!bucket) {
      bucket = { additions: 0, deletions: 0, files: new Set() };
      agg.perProject.set(loc.project, bucket);
    }
    bucket.additions += loc.additions;
    bucket.deletions += loc.deletions;
    if (loc.filePath) bucket.files.add(loc.filePath);
  }

  // totals
  if (typeof agg.totalAdditions === 'number') agg.totalAdditions += loc.additions;
  if (typeof agg.totalDeletions === 'number') agg.totalDeletions += loc.deletions;
  if (agg.totalFiles instanceof Set && loc.filePath) agg.totalFiles.add(loc.filePath);
}

module.exports = {
  extractLocFromClaudeLine,
  aggregateLocFromLine,
  // Exported for unit testing.
  countStructuredPatch,
};
