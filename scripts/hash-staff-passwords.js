/**
 * hash-staff-passwords.js
 *
 * Migrates staff login credentials from plaintext Firestore fields to bcrypt hashes.
 *
 * For each staff record:
 *   already-hashed  — passwordHash present, no plaintext password: skip
 *   hash-custom     — password field exists and is non-empty: hash it
 *   hash-default    — password field absent or empty: derive firstName+1234, hash it,
 *                     set requiresPasswordReset: true
 *
 * After migration every staff record will have:
 *   passwordHash         (bcrypt, work factor 12)
 *   passwordMigratedAt   (ISO timestamp)
 *   NO plaintext password field
 *   requiresPasswordReset: true  (hash-default records only)
 *
 * Usage:
 *   node --env-file=.env.local scripts/hash-staff-passwords.js           # dry run (default)
 *   node --env-file=.env.local scripts/hash-staff-passwords.js --apply   # write to Firestore
 *
 * Required env vars (in .env.local):
 *   FIREBASE_SERVICE_ACCOUNT_JSON=<stringified service account JSON>
 *   -- OR --
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * WARNING: Uses Firebase Admin SDK — bypasses Firestore security rules.
 * WARNING: Run dry run first and review output before using --apply.
 * WARNING: Target project: regroup-elite-squad
 */

import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import bcrypt from 'bcryptjs';

const FIRESTORE_PROJECT = 'regroup-elite-squad';
const STAFF_COLLECTION  = 'staff';
const BCRYPT_ROUNDS     = 12;

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { apply: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--apply') { args.apply = true; }
  }
  return args;
}

// ─── Name helpers (mirrors app.js / utils.js) ─────────────────────────────────

function firstNameOf(name) {
  return (name || '').trim().split(/\s+/)[0] || '';
}

function deriveDefaultPassword(name) {
  return firstNameOf(name) + '1234';
}

// ─── Firebase Admin loader ────────────────────────────────────────────────────

async function loadFirebaseAdmin() {
  try {
    const { default: admin } = await import('firebase-admin');
    return admin;
  } catch {
    console.error('\nError: firebase-admin is not installed.');
    console.error('Run: npm install');
    process.exit(1);
  }
}

async function initFirestore(admin) {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    let credential;
    try {
      credential = JSON.parse(saJson);
    } catch {
      console.error('Error: FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.');
      process.exit(1);
    }
    admin.initializeApp({ credential: admin.credential.cert(credential), projectId: FIRESTORE_PROJECT });
    return { db: admin.firestore(), FieldValue: admin.firestore.FieldValue, method: 'FIREBASE_SERVICE_ACCOUNT_JSON' };
  }

  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (saPath) {
    if (!existsSync(saPath)) {
      console.error(`Error: GOOGLE_APPLICATION_CREDENTIALS file not found: ${saPath}`);
      process.exit(1);
    }
    let credential;
    try {
      credential = JSON.parse(await fs.readFile(saPath, 'utf8'));
    } catch (e) {
      console.error(`Error reading service account file: ${e.message}`);
      process.exit(1);
    }
    admin.initializeApp({ credential: admin.credential.cert(credential), projectId: FIRESTORE_PROJECT });
    return { db: admin.firestore(), FieldValue: admin.firestore.FieldValue, method: `GOOGLE_APPLICATION_CREDENTIALS (${saPath})` };
  }

  console.error('\nError: No Firebase credentials found.');
  console.error('Set one of the following in .env.local:');
  console.error('  FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}');
  console.error('  -- or --');
  console.error('  GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json');
  process.exit(1);
}

// ─── Classify a staff record ──────────────────────────────────────────────────

function classifyRecord(data) {
  const hasHash      = typeof data.passwordHash === 'string' && data.passwordHash.length > 0;
  const hasPlaintext = typeof data.password === 'string' && data.password.length > 0;

  // Only skip if hash exists AND no plaintext password remains to be removed
  if (hasHash && !hasPlaintext) return 'already-hashed';
  if (hasPlaintext)              return 'hash-custom';
  return 'hash-default';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args   = parseArgs(process.argv);
  const dryRun = !args.apply;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Staff Password Migration — bcrypt (work factor 12)');
  console.log(`  Project:  ${FIRESTORE_PROJECT} / ${STAFF_COLLECTION}`);
  console.log(`  Mode:     ${dryRun ? 'DRY RUN — no writes will occur' : 'APPLY — writing to Firestore'}`);
  console.log('═══════════════════════════════════════════════════════════════');

  const admin = await loadFirebaseAdmin();
  const { db, FieldValue, method } = await initFirestore(admin);
  console.log(`  Auth:     ${method}\n`);

  let snapshot;
  try {
    snapshot = await db.collection(STAFF_COLLECTION).get();
  } catch (e) {
    console.error(`Error fetching staff collection: ${e.message}`);
    process.exit(1);
  }

  if (snapshot.empty) {
    console.log('No staff records found. Nothing to do.');
    process.exit(0);
  }

  console.log(`Found ${snapshot.size} staff record(s).\n`);
  console.log(`${'Name'.padEnd(32)}  Action`);
  console.log(`${'────'.padEnd(32)}  ────────────────────────────────────────`);

  const counts = { total: 0, customHashed: 0, defaultHashed: 0, alreadyHashed: 0, errors: 0 };
  const problems = [];
  const now = new Date().toISOString();

  for (const docSnap of snapshot.docs) {
    counts.total++;
    const data   = docSnap.data();
    const name   = (data.name || '').trim() || `(unnamed — id: ${docSnap.id})`;
    const action = classifyRecord(data);

    if (action === 'already-hashed') {
      console.log(`${name.padEnd(32)}  already-hashed (skipped)`);
      counts.alreadyHashed++;
      continue;
    }

    if (action === 'hash-custom') {
      if (dryRun) {
        console.log(`${name.padEnd(32)}  hash-custom [dry run]`);
        counts.customHashed++;
        continue;
      }
      try {
        const hash   = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
        const update = {
          passwordHash:       hash,
          password:           FieldValue.delete(),
          passwordMigratedAt: now,
        };
        await docSnap.ref.update(update);
        console.log(`${name.padEnd(32)}  hash-custom ✓`);
        counts.customHashed++;
      } catch (e) {
        console.log(`${name.padEnd(32)}  ERROR: ${e.message}`);
        counts.errors++;
        problems.push({ name, action: 'hash-custom', error: e.message });
      }
      continue;
    }

    // hash-default
    if (dryRun) {
      console.log(`${name.padEnd(32)}  hash-default [dry run] → requiresPasswordReset: true`);
      counts.defaultHashed++;
      continue;
    }
    try {
      const derived = deriveDefaultPassword(data.name || '');
      const hash    = await bcrypt.hash(derived, BCRYPT_ROUNDS);
      const update  = {
        passwordHash:          hash,
        passwordMigratedAt:    now,
        requiresPasswordReset: true,
      };
      // Remove the empty password field if it exists
      if (Object.prototype.hasOwnProperty.call(data, 'password')) {
        update.password = FieldValue.delete();
      }
      await docSnap.ref.update(update);
      console.log(`${name.padEnd(32)}  hash-default ✓ → requiresPasswordReset: true`);
      counts.defaultHashed++;
    } catch (e) {
      console.log(`${name.padEnd(32)}  ERROR: ${e.message}`);
      counts.errors++;
      problems.push({ name, action: 'hash-default', error: e.message });
    }
  }

  // ─── Summary ─────────────────────────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Summary');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total staff:              ${counts.total}`);
  console.log(`  Custom passwords hashed:  ${counts.customHashed}`);
  console.log(`  Default passwords hashed: ${counts.defaultHashed}`);
  console.log(`  Already hashed (skipped): ${counts.alreadyHashed}`);
  console.log(`  Errors:                   ${counts.errors}`);

  if (dryRun) {
    console.log('');
    console.log('  This was a dry run. No writes were made to Firestore.');
    console.log('  To apply:');
    console.log('    node --env-file=.env.local scripts/hash-staff-passwords.js --apply');
  }

  if (problems.length > 0) {
    console.log('\n  Problems encountered:');
    for (const p of problems) {
      console.log(`    ${p.name}  [${p.action}]  ${p.error}`);
    }
  }

  console.log('═══════════════════════════════════════════════════════════════');
  process.exit(counts.errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('\nFatal error:', e.message);
  process.exit(1);
});
