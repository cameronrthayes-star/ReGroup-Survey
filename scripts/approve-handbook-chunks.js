/**
 * approve-handbook-chunks.js
 * Reviews extracted handbook chunks and writes approved ones to Firestore.
 * Uses Firebase Admin SDK (bypasses Firestore security rules).
 *
 * Usage:
 *   node --env-file=.env.local scripts/approve-handbook-chunks.js \
 *     [--input=local-output/handbook-chunks-draft.json] \
 *     [--collection=handbookChunks] \
 *     [--dry-run]
 *
 * Required env vars (in .env.local):
 *   FIREBASE_SERVICE_ACCOUNT_JSON=<stringified service account JSON>
 *   -- OR --
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Options:
 *   --input        Path to draft JSON file (default: local-output/handbook-chunks-draft.json)
 *   --collection   Firestore collection name (default: handbookChunks)
 *   --dry-run      Validate and show what would be written; no Firestore writes
 *
 * ⚠️  WARNING: This script writes to Firestore project: regroup-elite-squad
 *     Review each chunk carefully before approving.
 *     The handbooks may contain internal HR and policy content.
 *     Do not approve chunks containing personal employee information.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_INPUT      = 'local-output/handbook-chunks-draft.json';
const DEFAULT_COLLECTION = 'handbookChunks';
const FIRESTORE_PROJECT  = 'regroup-elite-squad';

// Required fields on every chunk before approval
const REQUIRED_CHUNK_FIELDS = [
  'handbookType',
  'handbookVersion',
  'pageNumber',
  'sectionTitle',
  'chunkText',
  'sourceCitation',
  'chunkIndex'
];

// ─── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') { args.dryRun = true; continue; }
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] ?? true;
  }
  return args;
}

// ─── Readline prompt ─────────────────────────────────────────────────────────

// Single shared interface so piped stdin is not consumed on first close.
let _rl = null;
function getRL() {
  if (!_rl) _rl = createInterface({ input: process.stdin, output: process.stdout });
  return _rl;
}
function closeRL() { if (_rl) { _rl.close(); _rl = null; } }

function prompt(question) {
  return new Promise(resolve => {
    getRL().question(question, answer => resolve(answer.trim()));
  });
}

// ─── Chunk validation ─────────────────────────────────────────────────────────

function validateChunks(chunks) {
  const errors = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    for (const field of REQUIRED_CHUNK_FIELDS) {
      if (c[field] === undefined || c[field] === null || c[field] === '') {
        errors.push(`Chunk[${i}] (chunkIndex=${c.chunkIndex ?? '?'}): missing required field "${field}"`);
      }
    }
    if (!['staff', 'volunteer'].includes(c.handbookType)) {
      errors.push(`Chunk[${i}]: handbookType must be "staff" or "volunteer", got "${c.handbookType}"`);
    }
    if (typeof c.pageNumber !== 'number' || c.pageNumber < 0) {
      errors.push(`Chunk[${i}]: pageNumber must be a non-negative integer`);
    }
    if (typeof c.chunkIndex !== 'number') {
      errors.push(`Chunk[${i}]: chunkIndex must be a number`);
    }
    if (typeof c.chunkText === 'string' && c.chunkText.length < 20) {
      errors.push(`Chunk[${i}]: chunkText too short (${c.chunkText.length} chars; minimum 20)`);
    }
  }
  return errors;
}

// ─── Chunk summary ────────────────────────────────────────────────────────────

function summarizeChunks(chunks) {
  const byType = {};
  for (const c of chunks) {
    byType[c.handbookType] = (byType[c.handbookType] || 0) + 1;
  }
  return byType;
}

// ─── Firebase Admin loader ────────────────────────────────────────────────────

async function loadFirebaseAdmin() {
  try {
    const { default: admin } = await import('firebase-admin');
    return admin;
  } catch (e) {
    console.error('\nError: firebase-admin is not installed.');
    console.error('Run: npm install  (to install devDependencies)');
    process.exit(1);
  }
}

async function initFirestore(admin) {
  // Option 1: FIREBASE_SERVICE_ACCOUNT_JSON env var (JSON string)
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    let credential;
    try {
      credential = JSON.parse(saJson);
    } catch (e) {
      console.error('Error: FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.');
      process.exit(1);
    }
    admin.initializeApp({
      credential: admin.credential.cert(credential),
      projectId: FIRESTORE_PROJECT
    });
    return { db: admin.firestore(), method: 'FIREBASE_SERVICE_ACCOUNT_JSON env var' };
  }

  // Option 2: GOOGLE_APPLICATION_CREDENTIALS file path
  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (saPath) {
    if (!existsSync(saPath)) {
      console.error(`Error: GOOGLE_APPLICATION_CREDENTIALS file not found: ${saPath}`);
      process.exit(1);
    }
    let credential;
    try {
      const raw = await fs.readFile(saPath, 'utf8');
      credential = JSON.parse(raw);
    } catch (e) {
      console.error(`Error reading service account file: ${e.message}`);
      process.exit(1);
    }
    admin.initializeApp({
      credential: admin.credential.cert(credential),
      projectId: FIRESTORE_PROJECT
    });
    return { db: admin.firestore(), method: `GOOGLE_APPLICATION_CREDENTIALS: ${saPath}` };
  }

  console.error('\nError: No Firebase credentials found.');
  console.error('Set one of the following in .env.local:');
  console.error('');
  console.error('  FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}');
  console.error('  -- or --');
  console.error('  GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json');
  console.error('');
  console.error('Download a service account key from:');
  console.error('  Firebase Console → Project Settings → Service Accounts → Generate new private key');
  process.exit(1);
}

// ─── Firestore write ──────────────────────────────────────────────────────────

async function writeChunksToFirestore(db, collection, chunks, approverName, dryRun) {
  const now = new Date().toISOString();
  const results = { written: 0, failed: 0, errors: [] };

  console.log(`\n${dryRun ? '[Dry run] Would write' : 'Writing'} ${chunks.length} chunks to ${FIRESTORE_PROJECT}/${collection}...`);

  // Use batched writes (max 500 per batch)
  const BATCH_SIZE = 499;
  const batches = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    batches.push(chunks.slice(i, i + BATCH_SIZE));
  }

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const batchLabel = batches.length > 1 ? ` (batch ${bi + 1}/${batches.length})` : '';

    if (dryRun) {
      for (const chunk of batch) {
        const docId = `${chunk.handbookType}_${chunk.handbookVersion}_${String(chunk.chunkIndex).padStart(4, '0')}`;
        console.log(`  [dry-run] Would write: ${collection}/${docId}`);
        console.log(`    sectionTitle : ${chunk.sectionTitle}`);
        console.log(`    pageNumber   : ${chunk.pageNumber}`);
        console.log(`    textLength   : ${chunk.chunkText.length} chars`);
      }
      results.written += batch.length;
      continue;
    }

    const writeBatch = db.batch();
    for (const chunk of batch) {
      const docId = `${chunk.handbookType}_${chunk.handbookVersion}_${String(chunk.chunkIndex).padStart(4, '0')}`;
      const ref = db.collection(collection).doc(docId);
      writeBatch.set(ref, {
        ...chunk,
        approved:    true,
        approvedAt:  now,
        approvedBy:  approverName,
        lastUpdated: now
      });
    }

    try {
      await writeBatch.commit();
      console.log(`  ✓ Batch ${bi + 1}${batchLabel}: ${batch.length} chunks written`);
      results.written += batch.length;
    } catch (e) {
      console.error(`  ✗ Batch ${bi + 1}${batchLabel} failed: ${e.message}`);
      results.failed  += batch.length;
      results.errors.push(e.message);
    }
  }

  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args       = parseArgs(process.argv);
  const inputPath  = path.resolve(args['input']      || DEFAULT_INPUT);
  const collection = args['collection'] || DEFAULT_COLLECTION;
  const dryRun     = !!args.dryRun;
  const cliApprover = args['approver'] || null;  // --approver="Name" skips name prompt
  const cliYes      = !!args['yes'];             // --yes skips confirmation prompt

  console.log('\n=== TJC Handbook Chunk Approval Script ===');
  console.log(`Input file      : ${inputPath}`);
  console.log(`Firestore proj  : ${FIRESTORE_PROJECT}`);
  console.log(`Collection      : ${collection}`);
  console.log(`Dry run         : ${dryRun}`);

  // ── Security warning ──
  console.log('\n⚠️  WARNING: This script writes handbook chunks to Firestore project: regroup-elite-squad');
  console.log('   The handbooks may contain internal HR and policy content.');
  console.log('   Do not approve chunks containing personal employee information.');

  // ── Load input ──
  if (!existsSync(inputPath)) {
    console.error(`\nError: Input file not found: ${inputPath}`);
    console.error('Run the extraction script first:');
    console.error('  npm run extract:staff   -- --pdf=/path/to/staff-handbook.pdf');
    console.error('  npm run extract:volunteer -- --pdf=/path/to/volunteer-handbook.pdf');
    process.exit(1);
  }

  let chunks;
  try {
    const raw = await fs.readFile(inputPath, 'utf8');
    chunks = JSON.parse(raw);
  } catch (e) {
    console.error(`\nError reading/parsing input file: ${e.message}`);
    process.exit(1);
  }

  if (!Array.isArray(chunks) || chunks.length === 0) {
    console.error('\nError: Input file does not contain a non-empty JSON array.');
    process.exit(1);
  }

  // ── Validate chunks ──
  console.log(`\nLoaded ${chunks.length} chunks from draft file.`);
  const errors = validateChunks(chunks);
  if (errors.length > 0) {
    console.error('\nValidation errors found in draft file:');
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error('\nFix the draft file before approving. Extraction may need to be re-run.');
    process.exit(1);
  }
  console.log('✓ All chunks pass schema validation.');

  // ── Summary ──
  const summary = summarizeChunks(chunks);
  console.log('\nChunks by type:');
  for (const [type, count] of Object.entries(summary)) {
    console.log(`  ${type}: ${count}`);
  }

  // ── Preview first 3 chunks ──
  console.log('\n--- Preview (first 3 chunks) ---');
  for (const c of chunks.slice(0, 3)) {
    console.log(`\n[Chunk ${c.chunkIndex}] ${c.sectionTitle} (p.${c.pageNumber})`);
    console.log(`  ${c.chunkText.slice(0, 200)}${c.chunkText.length > 200 ? '...' : ''}`);
    console.log(`  Citation: ${c.sourceCitation}`);
  }
  if (chunks.length > 3) {
    console.log(`\n  ... and ${chunks.length - 3} more chunks (review the full file before approving)`);
  }
  console.log('\n--- End preview ---');

  // ── Approver name ──
  let approverName;
  if (!dryRun) {
    console.log('\nYou are about to write these chunks to Firestore.');
    console.log(`Target: ${FIRESTORE_PROJECT}/${collection}`);

    if (cliApprover) {
      approverName = cliApprover;
      console.log(`\nApprover (from --approver flag): "${approverName}"`);
    } else {
      approverName = await prompt('\nEnter your name (will be stored as approvedBy): ');
    }
    if (!approverName || approverName.length < 2) {
      console.error('Error: Approver name is required (minimum 2 characters).');
      process.exit(1);
    }

    // ── Explicit confirmation ──
    console.log(`\nAbout to write ${chunks.length} chunks as approved by "${approverName}"`);
    console.log(`to Firestore project: ${FIRESTORE_PROJECT}, collection: ${collection}`);

    if (cliYes) {
      console.log('[--yes flag set] Skipping interactive confirmation.');
    } else {
      const confirm = await prompt('\nType "yes" to confirm and write to Firestore, or anything else to cancel: ');
      closeRL();
      if (confirm.toLowerCase() !== 'yes') {
        console.log('\nCancelled. No data was written.');
        process.exit(0);
      }
    }
  } else {
    approverName = 'dry-run-user';
    console.log('\n[Dry run mode] Skipping approver prompt and Firestore writes.');
  }

  // ── Load Firebase Admin (skipped in dry-run) ──
  let db = null;
  if (!dryRun) {
    const admin = await loadFirebaseAdmin();
    const init  = await initFirestore(admin);
    db = init.db;
    console.log(`\nFirebase Admin initialized via: ${init.method}`);
  }

  // ── Write to Firestore (or simulate in dry-run) ──
  const results = await writeChunksToFirestore(db, collection, chunks, approverName, dryRun);

  // ── Summary ──
  console.log('\n=== Approval Complete ===');
  if (dryRun) {
    console.log(`[Dry run] Would have written : ${results.written} chunks`);
    console.log('No data was written to Firestore.');
    console.log('\nTo run for real, omit the --dry-run flag:');
    console.log('  npm run approve-chunks');
  } else {
    console.log(`Chunks written  : ${results.written}`);
    console.log(`Chunks failed   : ${results.failed}`);
    if (results.errors.length > 0) {
      console.log('\nErrors:');
      for (const e of results.errors) console.log(`  ✗ ${e}`);
      if (results.failed > 0) {
        console.error('\nSome chunks failed to write. Check your Firestore rules and credentials.');
        process.exit(1);
      }
    }
    if (results.written > 0) {
      console.log(`\nChunks are now live in: ${FIRESTORE_PROJECT}/${collection}`);
      console.log('The chatbot can retrieve them by handbookType and chunkIndex.');
    }
  }
  console.log();

  process.exit(0);
}

main().catch(e => {
  console.error('\nFatal:', e.message);
  process.exit(1);
});
