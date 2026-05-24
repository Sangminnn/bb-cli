#!/usr/bin/env node
// Polls /api/orchestrator/pending on the difit server and, when a "바로 리뷰"
// (reviewRequested) thread appears, dispatches it to a headless `claude -p`
// process and posts the response back to /api/orchestrator/reply.
//
// Run alongside `pnpm dev` (auto-started by scripts/dev.js) or standalone:
//   API_URL=http://127.0.0.1:4711 node scripts/orchestrator-watcher.js
//
// Tuning:
//   CLAUDE_MODEL                  — opus (default) | sonnet | haiku | full model id
//   CLAUDE_BIN                    — path to the claude CLI (default: claude on PATH)
//   CLAUDE_CWD                    — working dir for the claude child (default: /tmp).
//                                   Neutral cwd avoids project CLAUDE.md auto-discovery.
//   WATCHER_USE_SESSION_RESUME    — 'false' to fall back to A-mode (full history every call).
//                                   Default 'true' = B-mode (--session-id + delta prompt).
//   WATCHER_FILE_WINDOW           — lines kept around the commented range (default 100).
//   WATCHER_FILE_FULL_BYTES       — files <= this size sent in full (default 8192).
//
// Effort is auto-picked from the count of user (non-Agent) messages in the thread:
//   1-2 → low, 3-5 → medium, 6+ → high
//
// Isolation: claude is invoked with --system-prompt (project reviewer prompt),
// --setting-sources "", --strict-mcp-config (empty), and --disable-slash-commands so
// the user's global ~/.claude/CLAUDE.md, OMC instructions, hooks, MCP, and skills do
// not contaminate the review output. OAuth login is preserved (we do NOT use --bare).
// We add --add-dir <repo> so the model's Read tool can open image attachments.

import { spawn, spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { setTimeout as delay } from 'timers/promises';

const POLL_INTERVAL_MS = Number(process.env.ORCHESTRATOR_POLL_MS) || 2000;
const REQUEST_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? process.env.CLAUDE_TIMEOUT_MS) || 5 * 60 * 1000;
const FILE_WINDOW_LINES = Number(process.env.WATCHER_FILE_WINDOW) || 100;
const FILE_FULL_BYTES = Number(process.env.WATCHER_FILE_FULL_BYTES) || 8192;

const AGENT_PROVIDER_REQUEST = (process.env.DIFIT_AGENT_PROVIDER || 'claude').toLowerCase();
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'opus';
const PI_BIN = process.env.PI_BIN || 'pi';
const PI_MODEL = process.env.PI_MODEL || process.env.DIFIT_AGENT_MODEL;
const CODEX_BIN = process.env.CODEX_BIN || 'codex';
const CODEX_MODEL = process.env.CODEX_MODEL || process.env.DIFIT_AGENT_MODEL;
const CUSTOM_AGENT_COMMAND = process.env.DIFIT_AGENT_COMMAND;
const REVIEW_METADATA = loadReviewMetadata(process.env.BB_REVIEW_METADATA_PATH);

// Neutral cwd avoids project instruction auto-discovery contaminating the run.
// Provider-specific defaults preserve OAuth/keychain auth while keeping cwd stable.
const AGENT_CWD = process.env.AGENT_CWD || process.env.CLAUDE_CWD || '/tmp';

const REVIEWER_SYSTEM_PROMPT = [
  'You are a senior code reviewer responding inside a difit local review session.',
  'Reply with a concrete, actionable review of the code in question. Match the language the reviewer wrote in (Korean if they wrote Korean).',
  'Do not greet, do not summarise the file - go directly into the review point(s).',
  'Keep the reply under ~2000 characters unless the issue truly demands more.',
  'Output only the reply body, no preamble, no acknowledgements, no closing remarks.',
  "Line numbers and '>' markers in code blocks are context only — never include them when quoting code in your reply.",
  'Source code shown is the current working tree at the HEAD sha noted in the prompt. Line numbers may differ slightly from the diff snapshot the reviewer saw.',
  'You have repository read access: the prompt declares a Repository root path, and that path is also exposed via --add-dir. Use the Read, Glob, and Grep tools against that root (absolute paths) to inspect callers, related files, type definitions, or surrounding context whenever the snippet alone is insufficient — default cwd is /tmp, so always use absolute paths rooted at the Repository root. Do not say you cannot access the source; check first.',
  "Image attachments are listed by absolute path. Use the Read tool on those paths to view their contents (Claude Code's Read recognizes images as multimodal).",
  'When proposing a concrete code fix that should replace the commented snippet, wrap the replacement in a ```suggestion``` code block (literal English fence keyword) containing only the replacement for the commented range — no surrounding context, no line-number prefixes, no `>` markers. The viewer renders an Apply button that overwrites the snippet in place when the original matches exactly once. For changes that span beyond the snippet or touch multiple files, write prose instead.',
].join('\n');

// Plan mode is triggered when the user clicks [직접 수정] on a thread. The agent
// must output a strict JSON plan (no Edit/Write tools yet — only Read/Glob/Grep);
// the viewer renders a diff preview so the user can approve before apply.
const PLAN_SYSTEM_PROMPT = [
  'You are a senior code editor producing a *direct edit plan* for a difit local review session.',
  'You have read access to the repository through Read/Glob/Grep tools (the Repository root is in the prompt and exposed via --add-dir; use absolute paths because default cwd is /tmp).',
  'You DO NOT have write access — your only output is a JSON plan that the user will explicitly approve before any file is modified.',
  'Investigate the conversation, the commented file, and any related files. Identify EVERY line range that must change to address the discussion (including non-contiguous lines and other files in the same repo).',
  'Output a single fenced JSON block — and nothing else. No prose, no commentary, no markdown outside the fence.',
  'JSON shape:',
  '```json',
  '{',
  '  "summary": "<one-paragraph plain-text summary of what the plan does and why>",',
  '  "items": [',
  '    {',
  '      "id": "<short unique slug like fix-1>",',
  '      "filePath": "<path relative to the Repository root, never absolute>",',
  '      "startLine": <integer, 1-indexed inclusive>,',
  '      "endLine": <integer, 1-indexed inclusive, ≥ startLine>,',
  '      "expectedOriginal": "<exact current content of lines startLine..endLine joined by \\\\n — used to detect drift>",',
  '      "replacement": "<new content that replaces those lines, joined by \\\\n; may be empty string to delete>",',
  '      "description": "<one-line reason for this specific edit>"',
  '    }',
  '  ]',
  '}',
  '```',
  'Strict rules:',
  '- expectedOriginal MUST exactly match the file content at the given range (verify with Read first; the server rejects mismatches).',
  '- Ranges within the same file must NOT overlap.',
  '- Use the Repository root path from the prompt to construct absolute paths when Reading; in the JSON use only relative paths.',
  '- Do not include line numbers or `>` markers inside expectedOriginal/replacement strings.',
  '- If you cannot produce a safe plan, output {"summary": "<reason>", "items": []} — never guess.',
].join('\n');

// threadId → { sessionId, lastMtimeMs, lastFilePath }
const threadSessionMap = new Map();

const apiUrl = (process.env.API_URL || process.argv[2] || '').replace(/\/$/, '');
const AGENT_PROVIDER = resolveAgentProvider();
const USE_SESSION_RESUME =
  process.env.WATCHER_USE_SESSION_RESUME !== 'false' && AGENT_PROVIDER.supportsSessionResume;

if (!apiUrl) {
  console.error(
    '[orchestrator] API_URL is required. Pass via env or as the first argument.\n' +
      '  Example: API_URL=http://127.0.0.1:4711 node scripts/orchestrator-watcher.js',
  );
  process.exit(1);
}

const inFlight = new Set();
const cooldownUntil = new Map();
const DISPATCH_COOLDOWN_MS = 3000;
let stopped = false;

const initialParentPid = process.ppid;
setInterval(() => {
  try {
    process.kill(initialParentPid, 0);
  } catch {
    console.error('[orchestrator] parent process gone, shutting down');
    process.exit(0);
  }
}, 1000).unref();

function isUserMessage(message) {
  return (message.author || 'Unknown') !== 'Agent';
}

function pickEffort(thread) {
  const userMessageCount = (thread.messages || []).filter(isUserMessage).length;
  if (userMessageCount >= 6) return 'high';
  if (userMessageCount >= 3) return 'medium';
  return 'low';
}

function getCommentedLineRange(position) {
  if (!position || position.kind === 'file') return null;
  if (typeof position.line === 'number') {
    return { start: position.line, end: position.line };
  }
  if (position.line && typeof position.line === 'object') {
    return { start: position.line.start, end: position.line.end };
  }
  return null;
}

// Pick an outer fence whose backtick run is longer than any run inside `content`.
// CommonMark closes a fenced code block only on a fence of equal-or-greater length.
function pickFenceLength(content) {
  let longestRun = 0;
  let currentRun = 0;
  for (const ch of content) {
    if (ch === '`') {
      currentRun += 1;
      if (currentRun > longestRun) longestRun = currentRun;
    } else {
      currentRun = 0;
    }
  }
  return Math.max(3, longestRun + 1);
}

function makeFence(content) {
  return '`'.repeat(pickFenceLength(content));
}

function renderLineWindow(content, range, byteSize) {
  const fileLines = content.split('\n');
  const totalLines = fileLines.length;
  const padWidth = String(totalLines).length;

  let startLine = 1;
  let endLine = totalLines;
  let windowed = false;
  if (byteSize > FILE_FULL_BYTES && range) {
    const desiredStart = Math.max(1, range.start - FILE_WINDOW_LINES);
    const desiredEnd = Math.min(totalLines, range.end + FILE_WINDOW_LINES);
    if (desiredStart > 1 || desiredEnd < totalLines) {
      windowed = true;
      startLine = desiredStart;
      endLine = desiredEnd;
    }
  }

  const rendered = [];
  if (windowed && startLine > 1) {
    rendered.push(`... (lines 1-${startLine - 1} hidden) ...`);
  }
  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    const text = fileLines[lineNumber - 1] ?? '';
    const inRange = range && lineNumber >= range.start && lineNumber <= range.end;
    const marker = inRange ? '>' : ' ';
    const numberLabel = String(lineNumber).padStart(padWidth, ' ');
    rendered.push(`${marker} ${numberLabel} | ${text}`);
  }
  if (windowed && endLine < totalLines) {
    rendered.push(`... (lines ${endLine + 1}-${totalLines} hidden) ...`);
  }
  return { rendered: rendered.join('\n'), windowed, startLine, endLine, totalLines };
}

function appendCodeContext(lines, thread) {
  lines.push(`File: ${thread.filePath ?? '(unknown)'}`);

  const position = thread.position;
  if (position?.kind === 'file') {
    lines.push('Scope: file-level comment');
  } else if (position) {
    const side = position.side ? ` (${position.side})` : '';
    if (typeof position.line === 'number') {
      lines.push(`Line: ${position.line}${side}`);
    } else if (position.line && typeof position.line === 'object') {
      lines.push(`Lines: ${position.line.start}-${position.line.end}${side}`);
    }
  }

  const commentedRange = getCommentedLineRange(position);
  const lang = thread.codeSnapshot?.language || '';
  const ctx = thread.fileContext;

  if (ctx?.kind === 'text' && typeof ctx.content === 'string') {
    const byteSize = Buffer.byteLength(ctx.content, 'utf-8');
    const { rendered, windowed, startLine, endLine, totalLines } = renderLineWindow(
      ctx.content,
      commentedRange,
      byteSize,
    );
    lines.push('');
    if (windowed) {
      lines.push(
        `File window L${startLine}-L${endLine} of ${totalLines} (commented range marked with '>'):`,
      );
    } else if (commentedRange) {
      lines.push(
        `Full file (lines marked with '>' are the commented range L${commentedRange.start}-L${commentedRange.end}):`,
      );
    } else {
      lines.push('Full file:');
    }
    const fence = makeFence(rendered);
    lines.push(fence + lang);
    lines.push(rendered);
    lines.push(fence);

    if (thread.codeSnapshot?.content) {
      lines.push('');
      lines.push('Commented snippet (extracted from the diff):');
      const snippetFence = makeFence(thread.codeSnapshot.content);
      lines.push(snippetFence + lang);
      lines.push(thread.codeSnapshot.content);
      lines.push(snippetFence);
    }
    return;
  }

  if (ctx?.kind === 'image') {
    lines.push('');
    lines.push(
      `File is an image. Use the Read tool on this absolute path to view it: ${ctx.absolutePath}`,
    );
    return;
  }

  if (ctx?.kind === 'binary') {
    lines.push('');
    lines.push(`Binary file: ${thread.filePath} (cannot be embedded; reason=${ctx.reason})`);
  }

  if (thread.codeSnapshot?.content) {
    lines.push('');
    lines.push('Code under review:');
    const snippetFence = makeFence(thread.codeSnapshot.content);
    lines.push(snippetFence + lang);
    lines.push(thread.codeSnapshot.content);
    lines.push(snippetFence);
  }
}

function extractAttachmentRelativePaths(text) {
  if (typeof text !== 'string') return [];
  const matches = [];
  const pattern = /!\[[^\]]*\]\((\.difit-attachments\/[^)\s]+)\)/g;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    matches.push(m[1]);
  }
  return matches;
}

function collectAttachmentAbsolutePaths(thread, attachmentsDir, repositoryPath) {
  if (!repositoryPath) return [];
  const seen = new Set();
  const absolutePaths = [];
  for (const message of thread.messages || []) {
    for (const rel of extractAttachmentRelativePaths(message.body)) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      const abs = resolvePath(repositoryPath, rel);
      if (attachmentsDir && !abs.startsWith(attachmentsDir)) continue;
      absolutePaths.push(abs);
    }
  }
  return absolutePaths;
}

function appendAttachmentSection(lines, attachments) {
  if (attachments.length === 0) return;
  lines.push('');
  lines.push('Image attachments to read (use the Read tool on each absolute path):');
  for (const abs of attachments) {
    lines.push(`- ${abs}`);
  }
}

function loadReviewMetadata(path) {
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.warn(`[orchestrator] failed to load review metadata: ${error.message}`);
    return null;
  }
}

function appendReviewMetadata(lines, metadata) {
  if (!metadata || typeof metadata !== 'object') return;
  lines.push('Pull Request Context:');
  if (metadata.provider) lines.push(`Provider: ${metadata.provider}`);
  if (metadata.workspace || metadata.repo) lines.push(`Repository: ${metadata.workspace ?? '?'}/${metadata.repo ?? '?'}`);
  if (metadata.prId) lines.push(`PR: #${metadata.prId}`);
  if (metadata.title) lines.push(`Title: ${metadata.title}`);
  if (metadata.description) lines.push(`Description: ${String(metadata.description).replace(/\s+/g, ' ').trim()}`);
  if (metadata.state) lines.push(`State: ${metadata.state}`);
  if (metadata.sourceBranch || metadata.destinationBranch) lines.push(`Branches: ${metadata.sourceBranch ?? '?'} -> ${metadata.destinationBranch ?? '?'}`);
  if (metadata.author) lines.push(`Author: ${metadata.author}`);
  if (metadata.url) lines.push(`URL: ${metadata.url}`);
  if (Array.isArray(metadata.changedFiles) && metadata.changedFiles.length > 0) {
    lines.push('Changed files:');
    for (const file of metadata.changedFiles.slice(0, 100)) {
      const path = file?.path ?? '(unknown)';
      const status = file?.status ? ` ${file.status}` : '';
      const additions = typeof file?.additions === 'number' ? ` +${file.additions}` : '';
      const deletions = typeof file?.deletions === 'number' ? ` -${file.deletions}` : '';
      lines.push(`- ${path}${status}${additions}${deletions}`);
    }
    if (metadata.changedFiles.length > 100) {
      lines.push(`- ... ${metadata.changedFiles.length - 100} more files omitted`);
    }
  }
  lines.push('');
}

function appendSourceLine(lines, headSha, repositoryPath) {
  if (repositoryPath) {
    lines.push(`Repository root: ${repositoryPath}`);
  }
  if (headSha) {
    lines.push(`Source: working tree at HEAD ${headSha}`);
  } else {
    lines.push('Source: current working tree (HEAD sha unavailable)');
  }
  lines.push('');
}

// A-mode: full history injected into prompt every call (no session reuse).
// Reviewer instructions live in --system-prompt (REVIEWER_SYSTEM_PROMPT),
// so the stdin prompt only carries code context + conversation.
function buildPromptFull(thread, headSha, attachments, repositoryPath) {
  const lines = [];
  appendReviewMetadata(lines, REVIEW_METADATA);
  appendSourceLine(lines, headSha, repositoryPath);
  appendCodeContext(lines, thread);
  appendAttachmentSection(lines, attachments);

  if (Array.isArray(thread.messages) && thread.messages.length > 0) {
    lines.push('');
    lines.push('Conversation so far (oldest first):');
    for (const message of thread.messages) {
      const author = message.author || 'Unknown';
      lines.push(`- ${author}: ${message.body}`);
    }
  }

  lines.push('');
  lines.push('Write the Agent reply now.');
  return lines.join('\n');
}

// B-mode: send only the latest user turn. On the first call, also include
// code context (one-time per session). Reviewer instructions are in --system-prompt.
// If the file mtime changed since the last turn, re-inject the file window.
function buildPromptDelta(
  thread,
  { isFirstCall, mtimeChanged, headSha, attachments, repositoryPath },
) {
  const lines = [];

  if (isFirstCall) {
    appendReviewMetadata(lines, REVIEW_METADATA);
    appendSourceLine(lines, headSha, repositoryPath);
    appendCodeContext(lines, thread);
    appendAttachmentSection(lines, attachments);
    lines.push('');
  } else if (mtimeChanged) {
    lines.push('File changed since the previous turn. Refreshed window:');
    appendCodeContext(lines, thread);
    appendAttachmentSection(lines, attachments);
    lines.push('');
  } else if (attachments.length > 0) {
    appendAttachmentSection(lines, attachments);
    lines.push('');
  }

  const latestUserMessage = [...(thread.messages || [])].reverse().find(isUserMessage);
  if (latestUserMessage) {
    lines.push(latestUserMessage.body);
  }

  lines.push('');
  lines.push(
    isFirstCall
      ? 'Write the Agent reply now.'
      : 'Continue the review based on this latest message.',
  );
  return lines.join('\n');
}

function getCurrentMtime(repositoryPath, filePath) {
  if (!repositoryPath || !filePath) return null;
  try {
    const stats = statSync(resolvePath(repositoryPath, filePath));
    return stats.mtimeMs;
  } catch {
    return null;
  }
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return !result.error;
}

function resolveAgentProvider() {
  if (AGENT_PROVIDER_REQUEST === 'none' || AGENT_PROVIDER_REQUEST === 'off') {
    return { name: 'none', supportsSessionResume: false, run: async () => '' };
  }

  if (AGENT_PROVIDER_REQUEST === 'custom') {
    if (!CUSTOM_AGENT_COMMAND) {
      throw new Error('DIFIT_AGENT_COMMAND is required when DIFIT_AGENT_PROVIDER=custom');
    }
    return { name: 'custom', supportsSessionResume: false, run: runCustomAgent };
  }

  if (AGENT_PROVIDER_REQUEST === 'pi') {
    return { name: 'pi', supportsSessionResume: false, run: runPiAgent };
  }

  if (AGENT_PROVIDER_REQUEST === 'codex') {
    return { name: 'codex', supportsSessionResume: false, run: runCodexAgent };
  }

  if (AGENT_PROVIDER_REQUEST === 'auto') {
    if (commandExists(PI_BIN)) return { name: 'pi', supportsSessionResume: false, run: runPiAgent };
    if (commandExists(CLAUDE_BIN)) return { name: 'claude', supportsSessionResume: true, run: runClaudeAgent };
    if (commandExists(CODEX_BIN)) return { name: 'codex', supportsSessionResume: false, run: runCodexAgent };
    return { name: 'none', supportsSessionResume: false, run: async () => '' };
  }

  return { name: 'claude', supportsSessionResume: true, run: runClaudeAgent };
}

function runAgentProcess(label, command, args, prompt, { cwd = AGENT_CWD } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`${label} timed out after ${REQUEST_TIMEOUT_MS}ms`));
    }, REQUEST_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${label} exited with ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(stdout.trim());
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function runClaudeAgent(
  prompt,
  { effort, sessionId, addDir, isFirstCall = true, systemPrompt = REVIEWER_SYSTEM_PROMPT } = {},
) {
  // Isolation flags:
  //   --system-prompt              → replace default system prompt (no CLAUDE.md hierarchy injected)
  //   --setting-sources ""         → skip user/project/local settings
  //   --strict-mcp-config + empty  → no MCP servers
  //   --disable-slash-commands     → no skill auto-resolution
  //   --add-dir <repo>             → grant Read tool access to the repo (for image attachments)
  // OAuth/keychain auth is preserved (only --bare disables that).
  const args = [
    '-p',
    '--model',
    CLAUDE_MODEL,
    '--system-prompt',
    systemPrompt,
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--disable-slash-commands',
  ];
  if (addDir) {
    args.push('--add-dir', addDir);
  }
  if (effort) {
    args.push('--effort', effort);
  }
  if (sessionId) {
    // First call creates a new session; later calls resume the same session.
    // Reusing --session-id on an existing session triggers "already in use" error.
    if (isFirstCall) {
      args.push('--session-id', sessionId);
    } else {
      args.push('--resume', sessionId);
    }
  }
  return runAgentProcess('claude', CLAUDE_BIN, args, prompt);
}

function runPiAgent(prompt, { systemPrompt = REVIEWER_SYSTEM_PROMPT } = {}) {
  const args = [
    '-p',
    '--no-session',
    '--no-tools',
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--no-context-files',
    '--system-prompt',
    systemPrompt,
  ];
  if (PI_MODEL) {
    args.push('--model', PI_MODEL);
  }
  return runAgentProcess('pi', PI_BIN, args, prompt);
}

function runCodexAgent(prompt, { systemPrompt = REVIEWER_SYSTEM_PROMPT } = {}) {
  const args = ['exec', '--skip-git-repo-check'];
  if (CODEX_MODEL) {
    args.push('--model', CODEX_MODEL);
  }
  args.push(`${systemPrompt}\n\n${prompt}`);
  return runAgentProcess('codex', CODEX_BIN, args, '');
}

function runCustomAgent(prompt) {
  return runAgentProcess('custom-agent', CUSTOM_AGENT_COMMAND, [], prompt);
}

async function postReply(threadId, body) {
  const response = await fetch(`${apiUrl}/api/orchestrator/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, body, author: 'Agent' }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`reply POST failed: ${response.status} ${text}`);
  }
  return response.json();
}

async function postPlan(threadId, summary, items) {
  const response = await fetch(`${apiUrl}/api/orchestrator/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, summary, items }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`plan POST failed: ${response.status} ${text}`);
  }
  return response.json();
}

// Plan responses are expected as a single ```json fenced block. Strip the fence
// and parse — fall back to scanning for the first {...} object if the model
// produced extra prose (CommonMark-aware extraction is overkill here).
function parsePlanResponse(raw) {
  const trimmed = raw.trim();
  let jsonText = trimmed;

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim();
  } else {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonText = trimmed.slice(firstBrace, lastBrace + 1);
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return { ok: false, error: `plan response is not valid JSON: ${error.message}` };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'plan response is not an object' };
  }
  const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
  const items = Array.isArray(parsed.items) ? parsed.items : null;
  if (!items) {
    return { ok: false, error: 'plan.items must be an array' };
  }
  return { ok: true, summary, items };
}

function buildPlanPrompt(thread, headSha, attachments, repositoryPath) {
  const lines = [];
  appendReviewMetadata(lines, REVIEW_METADATA);
  appendSourceLine(lines, headSha, repositoryPath);
  appendCodeContext(lines, thread);
  appendAttachmentSection(lines, attachments);

  if (Array.isArray(thread.messages) && thread.messages.length > 0) {
    lines.push('');
    lines.push('Conversation so far (oldest first):');
    for (const message of thread.messages) {
      const author = message.author || 'Unknown';
      lines.push(`- ${author}: ${message.body}`);
    }
  }

  lines.push('');
  lines.push(
    'The reviewer has approved running an automated direct edit. Output the JSON edit plan now (single fenced ```json block, no prose).',
  );
  return lines.join('\n');
}

async function fetchPending() {
  const response = await fetch(`${apiUrl}/api/orchestrator/pending?context=full`);
  if (!response.ok) {
    throw new Error(`pending GET failed: ${response.status}`);
  }
  return response.json();
}

async function handlePending(thread, sharedContext) {
  const dispatchMode = thread.mode === 'plan' ? 'plan' : 'review';
  const fingerprint = `${thread.threadId}:${dispatchMode}`;
  if (inFlight.has(fingerprint)) {
    return;
  }
  const cooldownEnd = cooldownUntil.get(fingerprint);
  if (cooldownEnd && Date.now() < cooldownEnd) {
    return;
  }
  inFlight.add(fingerprint);

  const effort = pickEffort(thread);
  const userMessageCount = (thread.messages || []).filter(isUserMessage).length;
  const { headSha, attachmentsDir, repositoryPath } = sharedContext;
  const attachments = collectAttachmentAbsolutePaths(thread, attachmentsDir, repositoryPath);

  if (dispatchMode === 'plan') {
    console.log(
      `[orchestrator] dispatching thread=${thread.threadId} file=${thread.filePath} mode=plan effort=${effort} userMsgCount=${userMessageCount} attachments=${attachments.length}`,
    );
    const startTime = Date.now();
    try {
      const prompt = buildPlanPrompt(thread, headSha, attachments, repositoryPath);
      const raw = await AGENT_PROVIDER.run(prompt, {
        effort,
        sessionId: randomUUID(),
        addDir: repositoryPath,
        isFirstCall: true,
        systemPrompt: PLAN_SYSTEM_PROMPT,
      });
      const elapsedMs = Date.now() - startTime;
      if (!raw) {
        throw new Error('claude returned empty reply');
      }
      const parsed = parsePlanResponse(raw);
      if (!parsed.ok) {
        await postReply(
          thread.threadId,
          `직접 수정 계획 생성에 실패했습니다: ${parsed.error}\n\n에이전트 응답:\n\n${raw.slice(0, 1500)}`,
        );
        console.error(
          `[orchestrator] plan parse failed thread=${thread.threadId} effort=${effort} elapsed=${elapsedMs}ms reason=${parsed.error}`,
        );
        return;
      }
      if (parsed.items.length === 0) {
        await postReply(
          thread.threadId,
          `직접 수정 계획을 생성하지 못했습니다.\n\n사유: ${parsed.summary || '(미상)'}`,
        );
        console.log(
          `[orchestrator] plan empty thread=${thread.threadId} elapsed=${elapsedMs}ms summary="${parsed.summary}"`,
        );
        return;
      }
      try {
        await postPlan(thread.threadId, parsed.summary, parsed.items);
        console.log(
          `[orchestrator] posted plan thread=${thread.threadId} effort=${effort} items=${parsed.items.length} elapsed=${elapsedMs}ms`,
        );
      } catch (postErr) {
        await postReply(
          thread.threadId,
          `직접 수정 계획 검증에 실패했습니다: ${postErr.message}\n\n응답을 일반 답변으로 전달합니다:\n\n${raw.slice(0, 1500)}`,
        );
        console.error(
          `[orchestrator] postPlan failed thread=${thread.threadId} elapsed=${elapsedMs}ms:`,
          postErr.message,
        );
      }
    } catch (error) {
      const elapsedMs = Date.now() - startTime;
      console.error(
        `[orchestrator] plan failed thread=${thread.threadId} effort=${effort} elapsed=${elapsedMs}ms:`,
        error.message,
      );
      try {
        await postReply(
          thread.threadId,
          `직접 수정 계획 생성 중 오류가 발생했습니다: ${error.message}\n\n다시 시도해 주세요.`,
        );
      } catch (postError) {
        console.error('[orchestrator] plan error reply also failed:', postError.message);
      }
    } finally {
      inFlight.delete(fingerprint);
      cooldownUntil.set(fingerprint, Date.now() + DISPATCH_COOLDOWN_MS);
    }
    return;
  }

  const mode = USE_SESSION_RESUME ? 'session' : 'full';

  console.log(
    `[orchestrator] dispatching thread=${thread.threadId} file=${thread.filePath} mode=${mode} effort=${effort} userMsgCount=${userMessageCount} attachments=${attachments.length}`,
  );

  const startTime = Date.now();

  try {
    let prompt;
    let sessionId;
    let isFirstCall = true;

    if (USE_SESSION_RESUME) {
      const existing = threadSessionMap.get(thread.threadId);
      isFirstCall = !existing;
      const currentMtime = getCurrentMtime(repositoryPath, thread.filePath);
      const mtimeChanged =
        !isFirstCall &&
        currentMtime !== null &&
        existing.lastMtimeMs !== null &&
        currentMtime !== existing.lastMtimeMs;

      if (isFirstCall) {
        sessionId = randomUUID();
      } else {
        sessionId = existing.sessionId;
      }
      threadSessionMap.set(thread.threadId, {
        sessionId,
        lastMtimeMs: currentMtime,
        lastFilePath: thread.filePath,
      });

      prompt = buildPromptDelta(thread, {
        isFirstCall,
        mtimeChanged,
        headSha,
        attachments,
        repositoryPath,
      });
    } else {
      prompt = buildPromptFull(thread, headSha, attachments, repositoryPath);
    }

    const reply = await AGENT_PROVIDER.run(prompt, {
      effort,
      sessionId,
      addDir: repositoryPath,
      isFirstCall,
      systemPrompt: REVIEWER_SYSTEM_PROMPT,
    });
    const elapsedMs = Date.now() - startTime;

    if (!reply) {
      throw new Error('claude returned empty reply');
    }
    await postReply(thread.threadId, reply);
    console.log(
      `[orchestrator] posted reply thread=${thread.threadId} mode=${mode} effort=${effort} userMsgCount=${userMessageCount} elapsed=${elapsedMs}ms`,
    );
  } catch (error) {
    const elapsedMs = Date.now() - startTime;
    console.error(
      `[orchestrator] failed thread=${thread.threadId} mode=${mode} effort=${effort} elapsed=${elapsedMs}ms:`,
      error.message,
    );
    try {
      await postReply(
        thread.threadId,
        `Agent failed to generate a reply: ${error.message}\n\nPlease try clicking 바로 리뷰 again.`,
      );
    } catch (postError) {
      console.error('[orchestrator] error reply also failed:', postError.message);
    }
  } finally {
    inFlight.delete(fingerprint);
    cooldownUntil.set(fingerprint, Date.now() + DISPATCH_COOLDOWN_MS);
  }
}

async function main() {
  console.log(
    `[orchestrator] watching ${apiUrl} every ${POLL_INTERVAL_MS}ms (provider=${AGENT_PROVIDER.name}, mode=${USE_SESSION_RESUME ? 'session' : 'full'}, window=${FILE_WINDOW_LINES})`,
  );
  while (!stopped) {
    try {
      const data = await fetchPending();
      if (data.pendingCount > 0) {
        const sharedContext = {
          headSha: data.headSha ?? null,
          attachmentsDir: data.attachmentsDir ?? null,
          repositoryPath: data.repositoryPath ?? null,
        };
        for (const thread of data.pending) {
          handlePending(thread, sharedContext).catch((err) => {
            console.error('[orchestrator] unhandled error:', err);
          });
        }
      }
    } catch (error) {
      if (!stopped) {
        console.error('[orchestrator] poll error:', error.message);
      }
    }
    await delay(POLL_INTERVAL_MS);
  }
}

function shutdown() {
  if (stopped) return;
  stopped = true;
  console.log('[orchestrator] shutting down');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((error) => {
  console.error('[orchestrator] fatal:', error);
  process.exit(1);
});
