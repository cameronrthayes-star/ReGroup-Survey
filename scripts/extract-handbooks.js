/**
 * extract-handbooks.js
 * One-time local script to extract text chunks from TJC handbook PDFs.
 * Uses the Anthropic API with the pdf-beta to OCR image-based pages.
 *
 * Usage:
 *   node --env-file=.env.local scripts/extract-handbooks.js \
 *     --type=staff \
 *     --pdf=/path/to/handbook.pdf \
 *     [--version=2025] \
 *     [--model=claude-haiku-4-5-20251001] \
 *     [--out=local-output/handbook-chunks-draft.json] \
 *     [--page-batch=15] \
 *     [--dry-run]
 *
 * Required env vars (in .env.local):
 *   ANTHROPIC_API_KEY=sk-ant-...
 *
 * Options:
 *   --type          "staff" or "volunteer"  (required)
 *   --pdf           Absolute or relative path to the PDF file  (required)
 *   --version       Handbook version label (default: 2025)
 *   --model         Anthropic model (default: claude-haiku-4-5-20251001)
 *   --out           Output JSON path (default: local-output/handbook-chunks-draft.json)
 *   --pages         Override total page count (use when auto-detection is wrong)
 *   --page-batch    Pages per API call (default: 15; increase for short PDFs, decrease for long ones)
 *   --dry-run       Validate inputs and estimate cost without calling the API
 *
 * Output file schema (one item per chunk):
 *   {
 *     handbookType:    "staff" | "volunteer",
 *     handbookVersion: "2025",
 *     pageNumber:      <integer>,
 *     sectionTitle:    "<string>",
 *     chunkText:       "<string>",
 *     sourceCitation:  "<string>",
 *     chunkIndex:      <integer>,
 *     approved:        false
 *   }
 *
 * ⚠️  WARNING: This script sends handbook PDF content to the Anthropic API.
 *     The handbooks may contain internal HR and policy content.
 *     Confirm this is acceptable under your organization's data policy before running.
 *     Anthropic does not use API inputs for training by default.
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

// ─── Arg parsing ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') { args.dryRun = true; continue; }
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] ?? true;
  }
  return args;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_BETA    = 'pdfs-2024-09-25';
const DEFAULT_MODEL     = 'claude-haiku-4-5-20251001';
const DEFAULT_VERSION   = '2025';
const DEFAULT_OUT       = 'local-output/handbook-chunks-draft.json';
const DEFAULT_PAGE_BATCH = 15;

// Rough token estimate per PDF page (image-based, 300 output tokens = ~200 words of JSON)
const EST_INPUT_TOKENS_PER_PAGE  = 1800;  // image rendering
const EST_OUTPUT_TOKENS_PER_PAGE = 350;   // structured JSON per page

// Anthropic input pricing (per million tokens) — haiku-4-5 rates
const COST_INPUT_PER_MTOK  = 0.80;
const COST_OUTPUT_PER_MTOK = 4.00;

// ─── Extraction prompt builder ────────────────────────────────────────────────

function buildExtractionPrompt(handbookType, startPage, endPage, totalPages) {
  const label = handbookType === 'staff' ? 'Employee' : 'Volunteer';
  return `You are extracting text from a TJC (Transformative Justice Community) internal ${label} Handbook PDF.

Extract pages ${startPage} to ${endPage} (of ${totalPages} total pages).

Return ONLY a JSON array — no markdown, no explanation, no code fences.
Each element represents one logical section or policy topic found on those pages.

Each element must have exactly these three fields:
  "page"    — integer, the page number where this section begins
  "section" — string, the section heading or topic name (e.g. "Welcome Message", "Drug-Free Workplace Policy")
  "text"    — string, the complete verbatim text of that section

Rules:
- Extract ALL visible text from pages ${startPage}–${endPage}; do not skip any content
- One element per distinct section; if a section spans multiple pages use the starting page
- If a section continues from a previous page, append "(cont.)" to the section name
- If no heading is visible, use the nearest preceding heading or "General"
- Do not paraphrase, summarize, or omit words — copy the actual text
- Minimum 20 words of text per element; merge very short items with adjacent content
- Begin your response immediately with [ and end with ] — nothing else`;
}

// ─── Anthropic API call ───────────────────────────────────────────────────────

async function callAnthropicExtract(apiKey, model, pdfBase64, prompt, maxTokens = 8000) {
  const client = new Anthropic({ apiKey });

  const response = await client.beta.messages.create({
    model,
    max_tokens: maxTokens,
    betas: [ANTHROPIC_BETA],
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
        },
        { type: 'text', text: prompt }
      ]
    }]
  });

  return response;
}

// ─── PDF page count (best-effort without external deps) ──────────────────────

function estimatePageCount(pdfBuffer) {
  const text = pdfBuffer.toString('latin1');

  // Strategy 1: /Count N in the root Pages dictionary — most reliable
  // Take the maximum value found; in page trees the root /Count is the total
  const countMatches = [...text.matchAll(/\/Count\s+(\d+)/g)];
  if (countMatches.length > 0) {
    const counts = countMatches.map(m => parseInt(m[1], 10)).filter(n => n > 0);
    const maxCount = Math.max(...counts);
    if (maxCount > 0) return maxCount;
  }

  // Strategy 2: count /Type /Page entries (uncompressed streams only)
  const pageMatches = text.match(/\/Type\s*\/Page[^s]/g);
  if (pageMatches && pageMatches.length > 0) return pageMatches.length;

  return null;
}

// ─── Chunk builder ────────────────────────────────────────────────────────────

function buildChunks(rawItems, handbookType, handbookVersion, chunkIndexOffset = 0) {
  const label = handbookType === 'staff'
    ? `TJC Employee Handbook ${handbookVersion}`
    : `TJC Volunteer Handbook ${handbookVersion}`;

  return rawItems.map((item, i) => ({
    handbookType,
    handbookVersion,
    pageNumber:     Number(item.page) || 0,
    sectionTitle:   String(item.section || 'General').trim(),
    chunkText:      String(item.text || '').trim(),
    sourceCitation: `${label}, p. ${item.page} — ${String(item.section || 'General').trim()}`,
    chunkIndex:     chunkIndexOffset + i,
    approved:       false
  }));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  // ── Validate required args ──
  if (!args.type || !['staff', 'volunteer'].includes(args.type)) {
    console.error('Error: --type=staff or --type=volunteer is required.');
    process.exit(1);
  }
  if (!args.pdf) {
    console.error('Error: --pdf=<path> is required.');
    process.exit(1);
  }

  const handbookType    = args.type;
  const handbookVersion = args['version'] || DEFAULT_VERSION;
  const model           = args['model']   || DEFAULT_MODEL;
  const outPath         = args['out']     || DEFAULT_OUT;
  const pageBatch       = parseInt(args['page-batch'] || DEFAULT_PAGE_BATCH, 10);
  const dryRun          = !!args.dryRun;
  const pdfPath         = path.resolve(args.pdf);
  const apiKey          = process.env.ANTHROPIC_API_KEY;

  console.log('\n=== TJC Handbook Extraction Script ===');
  console.log(`Handbook type   : ${handbookType}`);
  console.log(`PDF path        : ${pdfPath}`);
  console.log(`Model           : ${model}`);
  console.log(`Version         : ${handbookVersion}`);
  console.log(`Output file     : ${outPath}`);
  console.log(`Pages per call  : ${pageBatch}`);
  console.log(`Dry run         : ${dryRun}`);

  // ── Security warning ──
  console.log('\n⚠️  WARNING: This script will send handbook PDF content to the Anthropic API.');
  console.log('   The handbooks may contain internal HR and policy content.');
  console.log('   Anthropic does not use API inputs for model training by default.');
  console.log('   Confirm this is acceptable before proceeding.\n');

  // ── Validate PDF ──
  if (!existsSync(pdfPath)) {
    console.error(`Error: PDF not found at: ${pdfPath}`);
    process.exit(1);
  }
  let pdfBuffer;
  try {
    pdfBuffer = await fs.readFile(pdfPath);
  } catch (e) {
    console.error(`Error reading PDF: ${e.message}`);
    process.exit(1);
  }
  const pdfSizeMB = (pdfBuffer.length / 1024 / 1024).toFixed(2);
  if (pdfBuffer.length > 32 * 1024 * 1024) {
    console.error(`Error: PDF is ${pdfSizeMB} MB — Anthropic limit is 32 MB. Please compress the PDF first.`);
    process.exit(1);
  }
  console.log(`PDF size        : ${pdfSizeMB} MB`);

  // ── Estimate page count ──
  const pagesOverride   = args['pages'] ? parseInt(args['pages'], 10) : null;
  const estimatedPages  = pagesOverride || estimatePageCount(pdfBuffer);
  const pageLabel       = pagesOverride
    ? `${pagesOverride} (manual override)`
    : estimatedPages ? `~${estimatedPages} (auto-detected)` : 'unknown';
  console.log(`Estimated pages : ${pageLabel}`);

  // ── Cost estimate ──
  const totalPages = estimatedPages || 30;
  const numBatches = Math.ceil(totalPages / pageBatch);
  const estInputTok  = numBatches * (totalPages / numBatches) * EST_INPUT_TOKENS_PER_PAGE * numBatches;
  const estOutputTok = totalPages * EST_OUTPUT_TOKENS_PER_PAGE;
  const estCost = (
    (estInputTok  / 1_000_000) * COST_INPUT_PER_MTOK +
    (estOutputTok / 1_000_000) * COST_OUTPUT_PER_MTOK
  ).toFixed(4);

  const pdfBase64      = pdfBuffer.toString('base64');
  const base64SizeMB   = (pdfBase64.length / 1024 / 1024).toFixed(2);
  const actualInputTok = Math.ceil(pdfBase64.length / 4 * 1.35);

  console.log(`\nCost estimate   : ~$${estCost} USD (${numBatches} API call${numBatches > 1 ? 's' : ''})`);
  console.log(`Base64 payload  : ${base64SizeMB} MB per call`);
  console.log(`Est. input tok  : ~${(actualInputTok * numBatches).toLocaleString()} total`);

  if (dryRun) {
    console.log('\n[Dry run] All checks passed. No API calls made. Remove --dry-run to extract.\n');
    process.exit(0);
  }

  // ── Validate API key (not needed for dry-run) ──
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY is not set. Add it to .env.local and run with:');
    console.error('  node --env-file=.env.local scripts/extract-handbooks.js ...');
    process.exit(1);
  }
  if (!apiKey.startsWith('sk-ant-')) {
    console.warn('Warning: ANTHROPIC_API_KEY does not look like a valid Anthropic key (expected sk-ant-...)');
  }

  // ── Create output directory ──
  const outDir = path.dirname(path.resolve(outPath));
  await fs.mkdir(outDir, { recursive: true });

  // ── Check for existing output ──
  if (existsSync(outPath)) {
    console.log(`\nNotice: Output file already exists: ${outPath}`);
    console.log('It will be overwritten with fresh extraction results.');
  }

  // ── Extract in page batches ──
  console.log(`\nStarting extraction (${numBatches} batch${numBatches > 1 ? 'es' : ''})...\n`);

  const allChunksRaw = [];
  let totalUsage = { input_tokens: 0, output_tokens: 0 };

  for (let batch = 0; batch < numBatches; batch++) {
    const startPage = batch * pageBatch + 1;
    const endPage   = Math.min((batch + 1) * pageBatch, totalPages);
    const prompt    = buildExtractionPrompt(handbookType, startPage, endPage, totalPages);

    console.log(`Batch ${batch + 1}/${numBatches}: pages ${startPage}–${endPage}...`);

    let result;
    try {
      result = await callAnthropicExtract(apiKey, model, pdfBase64, prompt, 8000);
    } catch (e) {
      console.error(`\nAPI error on batch ${batch + 1}: ${e.message}`);
      if (allChunksRaw.length > 0) {
        console.log(`Partial results (${allChunksRaw.length} raw items) are NOT saved due to incomplete extraction.`);
      }
      process.exit(1);
    }

    if (result.usage) {
      totalUsage.input_tokens  += result.usage.input_tokens  || 0;
      totalUsage.output_tokens += result.usage.output_tokens || 0;
    }

    const stopReason = result.stop_reason;
    const rawText    = (result.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();

    if (stopReason === 'max_tokens') {
      console.warn(`  ⚠️  Batch ${batch + 1} hit the output token limit — some content may be missing.`);
      console.warn(`     Try reducing --page-batch to ${Math.max(5, pageBatch - 5)} and re-running.`);
    }

    // ── Parse JSON from Claude's response ──
    let rawItems = [];
    try {
      // Claude sometimes wraps with ```json ... ``` despite instructions — strip it
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      rawItems = JSON.parse(cleaned);
      if (!Array.isArray(rawItems)) throw new Error('Response is not a JSON array');
    } catch (e) {
      console.error(`\nFailed to parse JSON from batch ${batch + 1}: ${e.message}`);
      console.error('Raw response (first 500 chars):');
      console.error(rawText.slice(0, 500));
      console.error('\nTip: Retry this batch or check the model output above.');
      process.exit(1);
    }

    console.log(`  ✓ ${rawItems.length} sections extracted`);
    allChunksRaw.push(...rawItems);
  }

  // ── Build structured chunk array ──
  const chunks = buildChunks(allChunksRaw, handbookType, handbookVersion);

  // ── Filter out empty chunks ──
  const validChunks   = chunks.filter(c => c.chunkText.length >= 20);
  const skippedChunks = chunks.length - validChunks.length;
  if (skippedChunks > 0) {
    console.log(`\nSkipped ${skippedChunks} chunk(s) with fewer than 20 characters of text.`);
  }

  // ── Write output ──
  await fs.writeFile(outPath, JSON.stringify(validChunks, null, 2), 'utf8');

  // ── Summary ──
  const actualCost = (
    (totalUsage.input_tokens  / 1_000_000) * COST_INPUT_PER_MTOK +
    (totalUsage.output_tokens / 1_000_000) * COST_OUTPUT_PER_MTOK
  ).toFixed(4);

  console.log('\n=== Extraction Complete ===');
  console.log(`Chunks extracted : ${validChunks.length}`);
  console.log(`Chunks skipped   : ${skippedChunks} (too short)`);
  console.log(`Input tokens     : ${totalUsage.input_tokens.toLocaleString()}`);
  console.log(`Output tokens    : ${totalUsage.output_tokens.toLocaleString()}`);
  console.log(`Actual cost      : ~$${actualCost} USD`);
  console.log(`Output file      : ${outPath}`);
  console.log('\nNext step: Review the draft JSON, then run:');
  console.log('  node --env-file=.env.local scripts/approve-handbook-chunks.js\n');

  // ── Type breakdown ──
  const byType = {};
  for (const c of validChunks) {
    byType[c.handbookType] = (byType[c.handbookType] || 0) + 1;
  }
  console.log('Chunks by type:');
  for (const [type, count] of Object.entries(byType)) {
    console.log(`  ${type}: ${count}`);
  }
  console.log();
}

main().catch(e => {
  console.error('\nFatal:', e.message);
  process.exit(1);
});
