// One-shot migration: hash any plaintext user.password values with bcrypt.
// Usage: MONGODB_URI=... node scripts/migrate-passwords.js
import bcrypt from 'bcryptjs';
import { connectDb, getDb } from '../src/db.js';

await connectDb();
const db = getDb();
const cursor = db.collection('users').find({ password: { $exists: true, $ne: null } });

let scanned = 0, upgraded = 0, skipped = 0;
for await (const user of cursor) {
  scanned++;
  if (/^\$2[aby]\$/.test(user.password)) { skipped++; continue; }
  const hashed = await bcrypt.hash(user.password, 10);
  await db.collection('users').updateOne({ _id: user._id }, { $set: { password: hashed } });
  upgraded++;
  console.log(`upgraded: ${user.phone || user._id}`);
}

console.log(`\nDone. scanned=${scanned} upgraded=${upgraded} skipped=${skipped}`);
process.exit(0);
