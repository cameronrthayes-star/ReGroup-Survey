#!/usr/bin/env node
/**
 * Frontend regression guard — run with: npm run check
 *
 * Checks every .js file under js/ for:
 *   1. ES-module syntax errors  (node --input-type=module --check)
 *   2. Typographic / smart quotes that can be mis-used as JS delimiters
 *   3. U+FFFD replacement characters and common double-encoded UTF-8 (mojibake)
 *
 * Exit 1 = hard syntax errors found.
 * Exit 0 = clean (warnings are advisory only).
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS_DIR = path.join(ROOT, 'js');

// ── helpers ──────────────────────────────────────────────────────────────────

function walkJs(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    if (fs.statSync(fp).isDirectory()) out.push(...walkJs(fp));
    else if (fp.endsWith('.js')) out.push(fp);
  }
  return out.sort();
}

function rel(fp) { return path.relative(ROOT, fp).replace(/\\/g, '/'); }

// ── check 1: ES-module syntax ─────────────────────────────────────────────────
// node --input-type=module --check reads stdin as an ES module and exits non-zero
// on any SyntaxError without executing the code or resolving imports.

function syntaxCheck(src) {
  const r = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: src,
    encoding: 'utf8',
    timeout: 15000,
  });
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || 'unknown error')
      .split('\n')
      .find(l => l.includes('SyntaxError') || l.includes('error'))
      || (r.stderr || '').trim().split('\n')[0];
    return (msg || 'parse error').trim();
  }
  return null;
}

// ── check 2: typographic quote characters ────────────────────────────────────
// U+2018/2019 left/right single quotation marks
// U+201C/201D left/right double quotation marks
// These were the original root cause — used as JS string delimiters.

const CURLY = [
  ['‘', 'U+2018 LEFT SINGLE QUOTATION MARK'],
  ['’', 'U+2019 RIGHT SINGLE QUOTATION MARK'],
  ['“', 'U+201C LEFT DOUBLE QUOTATION MARK'],
  ['”', 'U+201D RIGHT DOUBLE QUOTATION MARK'],
];

function curlyQuoteScan(src) {
  const hits = [];
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    for (const [ch, name] of CURLY) {
      if (line.includes(ch)) {
        hits.push({ line: i + 1, name, ctx: line.trim().slice(0, 100) });
      }
    }
  });
  return hits;
}

// ── check 3: replacement characters and mojibake ─────────────────────────────
// U+FFFD appears when a file is read with the wrong encoding.
// U+00E2 in a JS source file almost always signals double-encoded UTF-8
// (e.g. em-dash U+2014 stored as UTF-8 bytes E2 80 94, then re-encoded).
// These are cosmetically broken but can wrap a quote byte in edge cases.

function mojibakeScan(src) {
  const hits = [];
  const lines = src.split('\n');
  // U+FFFD (replacement character)
  const reFFD = new RegExp('�', 'u');
  // U+00E2 — appears whenever a multi-byte UTF-8 sequence was double-encoded
  const reE2 = new RegExp('â', 'u');

  lines.forEach((line, i) => {
    if (reFFD.test(line)) {
      hits.push({ line: i + 1, label: 'U+FFFD replacement character (corrupted UTF-8)', ctx: line.trim().slice(0, 100) });
    } else if (reE2.test(line)) {
      hits.push({ line: i + 1, label: 'mojibake U+00E2 sequence (double-encoded UTF-8)', ctx: line.trim().slice(0, 100) });
    }
  });
  return hits;
}

// ── main ─────────────────────────────────────────────────────────────────────

const files = walkJs(JS_DIR);
let syntaxErrors = 0;
let curlyWarnings = 0;
let mojiWarnings = 0;

console.log(`Checking ${files.length} files in ${rel(JS_DIR)}/\n`);

// ── 1. Syntax ─────────────────────────────────────────────────────────────────
console.log('=== SYNTAX (ES module parse) ===');
for (const fp of files) {
  const src = fs.readFileSync(fp, 'utf8');
  const err = syntaxCheck(src);
  if (err) {
    console.log(`  FAIL  ${rel(fp)}\n        ${err}`);
    syntaxErrors++;
  } else {
    console.log(`  OK    ${rel(fp)}`);
  }
}
console.log('');

// ── 2. Curly quotes ───────────────────────────────────────────────────────────
console.log('=== TYPOGRAPHIC QUOTES ===');
let anyCurly = false;
for (const fp of files) {
  const src = fs.readFileSync(fp, 'utf8');
  const hits = curlyQuoteScan(src);
  if (hits.length) {
    for (const h of hits) {
      console.log(`  WARN  ${rel(fp)}:${h.line}  [${h.name}]`);
      console.log(`        ${h.ctx}`);
      curlyWarnings++;
    }
    anyCurly = true;
  }
}
if (!anyCurly) console.log('  OK    none found');
console.log('');

// ── 3. Mojibake ───────────────────────────────────────────────────────────────
console.log('=== MOJIBAKE / REPLACEMENT CHARS ===');
let anyMoji = false;
for (const fp of files) {
  const src = fs.readFileSync(fp, 'utf8');
  const hits = mojibakeScan(src);
  if (hits.length) {
    console.log(`  WARN  ${rel(fp)}  (${hits.length} line${hits.length > 1 ? 's' : ''})`);
    hits.slice(0, 3).forEach(h =>
      console.log(`        line ${h.line}: ${h.label}`)
    );
    if (hits.length > 3) console.log(`        ... and ${hits.length - 3} more`);
    mojiWarnings += hits.length;
    anyMoji = true;
  }
}
if (!anyMoji) console.log('  OK    none found');
console.log('');

// ── summary ───────────────────────────────────────────────────────────────────
console.log('=== SUMMARY ===');
console.log(`  Files checked:  ${files.length}`);
console.log(`  Syntax errors:  ${syntaxErrors}`);
console.log(`  Quote warnings: ${curlyWarnings}`);
console.log(`  Mojibake lines: ${mojiWarnings} (advisory - existing corruption in string content)`);

if (syntaxErrors > 0) {
  console.error('\nFAILED - fix syntax errors before committing.\n');
  process.exit(1);
} else if (curlyWarnings > 0) {
  console.log('\nPassed with quote warnings - review and escape or replace.\n');
  process.exit(0);
} else {
  console.log('\nAll checks passed.\n');
  process.exit(0);
}
