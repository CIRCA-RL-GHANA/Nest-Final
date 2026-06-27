import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';

const TEST_PHONE = '+233244000001';
const TEST_USERNAME = 'testuser';
const TEST_WIRE_ID = '@testuser';
const TEST_PASSWORD = 'Test123!@#';
const TEST_NAME = 'Alex Morgan';

async function seed() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');

  const dataSource = new DataSource({
    type: 'postgres',
    url,
    ssl: url.includes('neon.tech') ? { rejectUnauthorized: false } : false,
    entities: [path.resolve(__dirname, '../../**/*.entity{.ts,.js}')],
    synchronize: false,
    logging: false,
  });

  console.log('🌱 Connecting…');
  await dataSource.initialize();
  console.log('✅ Connected\n');

  const qr = dataSource.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();

  try {
    // 1. Test user
    let [user] = await qr.query(
      `SELECT id FROM users WHERE "phoneNumber" = $1 LIMIT 1`, [TEST_PHONE]);
    if (user) {
      console.log(`ℹ️  Test user exists: ${user.id}`);
    } else {
      const hash = await bcrypt.hash(TEST_PASSWORD, 12);
      [user] = await qr.query(
        `INSERT INTO users ("phoneNumber","socialUsername","wireId","passwordHash","otpVerified","biometricVerified")
         VALUES ($1,$2,$3,$4,true,false) RETURNING id`,
        [TEST_PHONE, TEST_USERNAME, TEST_WIRE_ID, hash]);
      console.log(`✅ Test user: ${user.id}`);
    }
    const userId: string = user.id;

    // 2. Entity
    let [entity] = await qr.query(
      `SELECT id FROM entities WHERE "ownerId"=$1 AND type='Individual' LIMIT 1`, [userId]);
    if (entity) {
      console.log(`ℹ️  Entity exists: ${entity.id}`);
    } else {
      [entity] = await qr.query(
        `INSERT INTO entities (type,"wireId","socialUsername","ownerId",name,"phoneNumber",verified)
         VALUES ('Individual',$1,$2,$3,$4,$5,true) RETURNING id`,
        [TEST_WIRE_ID, TEST_USERNAME, userId, TEST_NAME, TEST_PHONE]);
      console.log(`✅ Entity: ${entity.id}`);
    }
    const entityId: string = entity.id;

    // 3. Profile
    const [existProfile] = await qr.query(
      `SELECT id FROM profiles WHERE "userId"=$1 LIMIT 1`, [userId]);
    if (existProfile) {
      console.log(`ℹ️  Profile exists: ${existProfile.id}`);
    } else {
      const [profile] = await qr.query(
        `INSERT INTO profiles ("userId","entityId","publicName",bio,"mfaVerified")
         VALUES ($1,$2,$3,$4,false) RETURNING id`,
        [userId, entityId, TEST_NAME, 'Development test account.']);
      console.log(`✅ Profile: ${profile.id}`);
    }

    // 4. Wallet
    const [existWallet] = await qr.query(
      `SELECT id FROM wallets WHERE "userId"=$1 LIMIT 1`, [userId]);
    if (!existWallet) {
      await qr.query(
        `INSERT INTO wallets ("userId",balance,currency,status) VALUES ($1,24430.00,'USD','ACTIVE')`,
        [userId]);
      console.log('✅ Wallet ($24,430.00)');
    } else {
      console.log('ℹ️  Wallet exists');
    }

    // 5. QPoints
    const [existQP] = await qr.query(
      `SELECT id FROM qpoints WHERE "userId"=$1 LIMIT 1`, [userId]);
    if (!existQP) {
      await qr.query(
        `INSERT INTO qpoints ("userId",balance,"totalEarned",status,"expiryDate")
         VALUES ($1,1248,1248,'ACTIVE',NOW()+'1 year'::interval)`,
        [userId]);
      console.log('✅ QPoints (1,248)');
    } else {
      console.log('ℹ️  QPoints exist');
    }

    // 6. Back-fill profiles for any verified users missing one
    const orphans = await qr.query(
      `SELECT u.id, u."phoneNumber", u."socialUsername", u."wireId"
       FROM users u LEFT JOIN profiles p ON p."userId"=u.id
       WHERE p.id IS NULL AND u."otpVerified"=true AND u."phoneNumber"!=$1`,
      [TEST_PHONE]);

    for (const u of orphans) {
      let [ent] = await qr.query(
        `SELECT id FROM entities WHERE "ownerId"=$1 LIMIT 1`, [u.id]);
      if (!ent) {
        const wid = u.wireId ?? `@u${u.id.slice(0,8)}`;
        const uname = u.socialUsername ?? `u${u.id.slice(0,8)}`;
        [ent] = await qr.query(
          `INSERT INTO entities (type,"wireId","socialUsername","ownerId","phoneNumber",verified)
           VALUES ('Individual',$1,$2,$3,$4,false) RETURNING id`,
          [wid, uname, u.id, u.phoneNumber]);
      }
      await qr.query(
        `INSERT INTO profiles ("userId","entityId","publicName","mfaVerified")
         VALUES ($1,$2,$3,false) ON CONFLICT DO NOTHING`,
        [u.id, ent.id, u.socialUsername ?? 'User']);
      console.log(`✅ Back-filled profile for ${u.phoneNumber}`);
    }

    await qr.commitTransaction();
    console.log('\n✨ Seed done!');
    console.log('─────────────────────────────');
    console.log(`Phone:    ${TEST_PHONE}`);
    console.log(`Password: ${TEST_PASSWORD}`);
    console.log('─────────────────────────────');
  } catch (err) {
    await qr.rollbackTransaction();
    throw err;
  } finally {
    await qr.release();
    await dataSource.destroy();
  }
}

seed().catch(err => { console.error('💥', err); process.exit(1); });
