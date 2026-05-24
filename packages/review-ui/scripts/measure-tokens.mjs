#!/usr/bin/env node
// One-shot measurement: stdin payload bytes for A-mode vs B-mode prompts.
//
// Mirrors the prompt-build logic in scripts/orchestrator-watcher.js. If you
// edit the watcher's prompt builders, edit this script in lockstep.
//
// Usage:
//   node scripts/measure-tokens.mjs [filePath] [lineNumber] [turns]
//
// Defaults: src/client/App.test.tsx, line 517, 5 turns

import { readFileSync } from 'fs';

const FILE_WINDOW_LINES = Number(process.env.WATCHER_FILE_WINDOW) || 100;
const FILE_FULL_BYTES = Number(process.env.WATCHER_FILE_FULL_BYTES) || 8192;

const REVIEWER_SYSTEM_PROMPT = [
  'You are a senior code reviewer responding inside a difit local review session.',
  'Reply with a concrete, actionable review of the code in question. Match the language the reviewer wrote in (Korean if they wrote Korean).',
  'Do not greet, do not summarise the file - go directly into the review point(s).',
  'Keep the reply under ~2000 characters unless the issue truly demands more.',
  'Output only the reply body, no preamble, no acknowledgements, no closing remarks.',
  "Line numbers and '>' markers in code blocks are context only — never include them when quoting code in your reply.",
  'Source code shown is the current working tree at the HEAD sha noted in the prompt. Line numbers may differ slightly from the diff snapshot the reviewer saw.',
  "Image attachments are listed by absolute path. Use the Read tool on those paths to view their contents (Claude Code's Read recognizes images as multimodal).",
].join('\n');

const isUserMessage = (message) => (message.author || 'Unknown') !== 'Agent';

const pickFenceLength = (content) => {
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
};

const makeFence = (content) => '`'.repeat(pickFenceLength(content));

const getCommentedLineRange = (position) => {
  if (!position || position.kind === 'file') return null;
  if (typeof position.line === 'number') {
    return { start: position.line, end: position.line };
  }
  if (position.line && typeof position.line === 'object') {
    return { start: position.line.start, end: position.line.end };
  }
  return null;
};

const renderLineWindow = (content, range, byteSize) => {
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
};

const appendCodeContext = (lines, thread) => {
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
};

const appendAttachmentSection = (lines, attachments) => {
  if (attachments.length === 0) return;
  lines.push('');
  lines.push('Image attachments to read (use the Read tool on each absolute path):');
  for (const abs of attachments) {
    lines.push(`- ${abs}`);
  }
};

const appendSourceLine = (lines, headSha) => {
  if (headSha) {
    lines.push(`Source: working tree at HEAD ${headSha}`);
  } else {
    lines.push('Source: current working tree (HEAD sha unavailable)');
  }
  lines.push('');
};

const buildPromptFull = (thread, headSha, attachments) => {
  const lines = [];
  appendSourceLine(lines, headSha);
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
};

const buildPromptDelta = (thread, { isFirstCall, mtimeChanged, headSha, attachments }) => {
  const lines = [];

  if (isFirstCall) {
    appendSourceLine(lines, headSha);
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
};

const filePath = process.argv[2] || 'src/client/App.test.tsx';
const lineNumber = Number(process.argv[3]) || 517;
const turnCount = Number(process.argv[4]) || 5;

const content = readFileSync(filePath, 'utf-8');
const fileBytes = Buffer.byteLength(content, 'utf-8');
const totalLines = content.split('\n').length;

const SAMPLE_USER_MESSAGES = [
  '이건 어떤 의도가 있던거지',
  '너는 이 코드맥락을 모르는건지 ?',
  '이 라인의 변경의 이유를 설명해줄래',
  '이제는 맥락 이해가 가? 이 코드의 근거나 근처 코드들말이야',
  '구체적인 권장 코드도 보여줘',
  '이 변경이 다른 테스트에도 영향을 주나?',
  '회귀 위험은 없는지 정리해줘',
];

const sampleAgentReply = (i) =>
  `Turn ${i} agent reply. `.repeat(40) +
  '\n\n핵심 권장사항:\n- ' +
  ['항목 1 — 의도 단언으로 좁히기', '항목 2 — fetch 모킹 영속화', '항목 3 — teardown 위치'].join(
    '\n- ',
  ) +
  '\n';

const thread = {
  threadId: 'measure-thread',
  filePath,
  position: { kind: 'line', line: lineNumber, side: 'right' },
  messages: [],
  codeSnapshot: null,
  fileContext: { kind: 'text', content },
};

const headSha = 'abcdef1234567890';

const fmtBytes = (n) => `${n.toLocaleString()}B`;
const pad = (s, w) => String(s).padStart(w);

const systemPromptBytes = Buffer.byteLength(REVIEWER_SYSTEM_PROMPT, 'utf-8');

console.log('=== Token / stdin payload measurement ===');
console.log(`File:           ${filePath}`);
console.log(`File size:      ${fmtBytes(fileBytes)} (${totalLines} lines)`);
console.log(`Comment line:   L${lineNumber}`);
console.log(`Window:         ±${FILE_WINDOW_LINES} lines (full if file ≤ ${fmtBytes(FILE_FULL_BYTES)})`);
console.log(`SystemPrompt:   ${fmtBytes(systemPromptBytes)} (constant per call, both modes)`);
console.log(`Turns:          ${turnCount}`);
console.log('');

console.log('Per-turn stdin payload (excludes --system-prompt flag size):');
console.log('Turn │ A-mode stdin │ B-mode stdin │ Δ per turn │ A-cum   │ B-cum');
console.log('─────┼──────────────┼──────────────┼────────────┼─────────┼─────────');

let aCum = 0;
let bCum = 0;

for (let turn = 1; turn <= turnCount; turn += 1) {
  thread.messages.push({
    author: 'User',
    body: SAMPLE_USER_MESSAGES[(turn - 1) % SAMPLE_USER_MESSAGES.length],
  });

  const aPrompt = buildPromptFull(thread, headSha, []);
  const bPrompt = buildPromptDelta(thread, {
    isFirstCall: turn === 1,
    mtimeChanged: false,
    headSha,
    attachments: [],
  });

  const aBytes = Buffer.byteLength(aPrompt, 'utf-8');
  const bBytes = Buffer.byteLength(bPrompt, 'utf-8');
  const delta = aBytes - bBytes;
  aCum += aBytes;
  bCum += bBytes;

  console.log(
    `${pad(turn, 4)} │ ${pad(fmtBytes(aBytes), 12)} │ ${pad(fmtBytes(bBytes), 12)} │ ${pad(fmtBytes(delta), 10)} │ ${pad(fmtBytes(aCum), 7)} │ ${pad(fmtBytes(bCum), 7)}`,
  );

  thread.messages.push({ author: 'Agent', body: sampleAgentReply(turn) });
}

console.log('');
console.log(`A-mode total stdin: ${fmtBytes(aCum)}`);
console.log(`B-mode total stdin: ${fmtBytes(bCum)}`);

const reductionPct = ((1 - bCum / aCum) * 100).toFixed(1);
const ratio = (aCum / bCum).toFixed(1);
console.log(`Reduction:          ${reductionPct}%  (A is ${ratio}× B)`);
console.log('');
console.log('Notes:');
console.log('  - bytes-on-wire only; Anthropic prompt cache may bill cached prefix at ~10%.');
console.log('  - system prompt is sent every call in both modes; not included in the table.');
console.log('  - measurement assumes file mtime unchanged across turns (no re-injection).');
