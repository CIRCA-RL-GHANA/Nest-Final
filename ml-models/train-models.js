#!/usr/bin/env node
'use strict';
/**
 * PROMPT Genie — ML Model Training Script (Node.js / tfjs-node)
 * ==============================================================
 * Trains all 4 TF.js models using @tensorflow/tfjs-node and exports them
 * as LayersModel format (model.json + weight shards) ready for the
 * NestJS AITensorflowService to load at startup.
 *
 * Models built
 * ------------
 *   fraud/           Fraud-detection neural net      (7 features → probability)
 *   pricing/         Dynamic surge-pricing regressor (5 features → surge norm)
 *   recommendations/ User–item relevance scorer      (10 features → probability)
 *   discount/        Product discount optimiser      (5 features → discount norm)
 *
 * Usage
 * -----
 *   # From the orionstack-backend--main/ directory:
 *   node ml-models/train-models.js
 *
 *   # Or via npm:
 *   npm run build:models
 *
 * Called automatically during Docker image build (builder stage).
 * Replaces any placeholder model files created by simulate_models.ps1.
 *
 * Requirements
 * ------------
 *   @tensorflow/tfjs-node (already in package.json dependencies)
 *
 * Architecture per model
 * ----------------------
 *   fraud         : Dense(32,relu) → BatchNorm → Dropout(0.2) → Dense(16,relu) → Dense(8,relu) → Dense(1,sigmoid)
 *   pricing       : Dense(32,relu) → BatchNorm → Dense(16,relu) → Dense(8,relu) → Dense(1,sigmoid)
 *   recommendations: Dense(64,relu) → BatchNorm → Dropout(0.25) → Dense(32,relu) → Dense(16,relu) → Dense(1,sigmoid)
 *   discount      : Dense(32,relu) → BatchNorm → Dense(16,relu) → Dense(8,relu) → Dense(1,sigmoid)
 */

const path = require('path');
const fs = require('fs');
const { performance } = require('perf_hooks');

// ── Load tfjs-node ─────────────────────────────────────────────────────────
let tf;
try {
  tf = require('@tensorflow/tfjs-node');
} catch (err) {
  console.error('\n[ERROR] @tensorflow/tfjs-node not found.');
  console.error('  Run: npm install   (from orionstack-backend--main/)');
  console.error('  Or:  npm run build:models  after npm ci\n');
  process.exit(1);
}

// ── Config ─────────────────────────────────────────────────────────────────
const ML_DIR    = __dirname;            // ml-models/
const N_SAMPLES = 20_000;
const EPOCHS    = 30;
const BATCH_SIZE = 256;

// ── Seeded PRNG (mulberry32) ───────────────────────────────────────────────
let _s = 42;
function rand() {
  _s += 0x6d2b79f5;
  let t = _s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Box-Muller normal sample */
function randn() {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Marsaglia-Tsang gamma sampler */
function gammaSample(alpha) {
  if (alpha < 1) {
    return gammaSample(alpha + 1) * Math.pow(rand(), 1 / alpha);
  }
  const d = alpha - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      x = randn();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    const x2 = x * x;
    if (u < 1 - 0.0331 * x2 * x2) return d * v;
    if (Math.log(u) < 0.5 * x2 + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Beta(a, b) sample via ratio of two gamma samples */
function betaSample(a, b) {
  const ga = gammaSample(a);
  const gb = gammaSample(b);
  return ga / (ga + gb);
}

/** Fill Float32Array(n) with Beta(a, b) samples */
function betaArray(a, b, n) {
  const arr = new Float32Array(n);
  for (let i = 0; i < n; i++) arr[i] = betaSample(a, b);
  return arr;
}

/** Fill Float32Array(n) with Exponential(scale) samples clipped to [0, 1] */
function exponentialClipped(scale, n) {
  const arr = new Float32Array(n);
  for (let i = 0; i < n; i++) arr[i] = Math.min(-scale * Math.log(rand() + 1e-10), 1.0);
  return arr;
}

/** Fill Float32Array(n) with Bernoulli(p) samples */
function bernoulliArray(p, n) {
  const arr = new Float32Array(n);
  for (let i = 0; i < n; i++) arr[i] = rand() < p ? 1.0 : 0.0;
  return arr;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function header(title) {
  const bar = '═'.repeat(62);
  console.log(`\n${bar}\n  ${title}\n${bar}`);
}

function writeFeatures(modelDir, name, meta) {
  const p = path.join(modelDir, 'features.json');
  fs.writeFileSync(p, JSON.stringify(meta, null, 2), 'utf8');
  console.log(`  ✓  Feature manifest → ml-models/${name}/features.json`);
}

async function saveModel(model, name) {
  const outDir = path.join(ML_DIR, name);
  // Ensure directory exists (remove stale files first if present)
  if (fs.existsSync(outDir)) {
    fs.readdirSync(outDir).forEach((f) => fs.rmSync(path.join(outDir, f), { force: true }));
  } else {
    fs.mkdirSync(outDir, { recursive: true });
  }
  await model.save(`file://${outDir}`);
  // Verify
  const modelJson = path.join(outDir, 'model.json');
  if (!fs.existsSync(modelJson)) throw new Error(`Save failed — ${modelJson} not created`);
  const meta = JSON.parse(fs.readFileSync(modelJson, 'utf8'));
  const shards = (meta.weightsManifest?.[0]?.paths ?? []).length;
  console.log(`  ✓  Exported  ml-models/${name}/model.json  +  ${shards} weight shard(s)`);
  return outDir;
}

// ══════════════════════════════════════════════════════════════════════════
// MODEL 1 — FRAUD DETECTION
// ══════════════════════════════════════════════════════════════════════════
async function buildFraud() {
  header('MODEL 1 / 4 — Fraud Detection');

  const n = N_SAMPLES;

  // Feature distributions matching real-world transaction skew
  const amountLog  = betaArray(2, 5, n);          // log-normalised transaction amount
  const hourlyNorm = betaArray(1.5, 8, n);         // recent tx count / 20 (right-skewed)
  const ratioNorm  = exponentialClipped(0.3, n);   // amount vs user avg (right-skewed)
  const isRisky    = bernoulliArray(0.08, n);       // high-risk payment method
  const isRound    = bernoulliArray(0.12, n);       // round-number pattern
  const isLate     = bernoulliArray(0.07, n);       // late-night (1-5h)
  const isDup      = bernoulliArray(0.05, n);       // duplicate amount sequence

  const X = new Float32Array(n * 7);
  const y = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    X[i * 7 + 0] = amountLog[i];
    X[i * 7 + 1] = hourlyNorm[i];
    X[i * 7 + 2] = ratioNorm[i];
    X[i * 7 + 3] = isRisky[i];
    X[i * 7 + 4] = isRound[i];
    X[i * 7 + 5] = isLate[i];
    X[i * 7 + 6] = isDup[i];

    // Reproduce ai-fraud.service.ts risk heuristic
    const velocityRisk = hourlyNorm[i] > 0.5 ? 0.5 + (hourlyNorm[i] - 0.5) * 0.5 : 0;
    const anomalyRisk  = ratioNorm[i]  > 0.5 ? 0.4 + (ratioNorm[i]  - 0.5) * 0.2 : 0;
    const lateHigh     = isLate[i] * (amountLog[i] > 0.4 ? 1 : 0);
    const raw = velocityRisk + anomalyRisk
              + isRisky[i] * 0.40 + isRound[i] * 0.20
              + lateHigh * 0.30  + isDup[i] * 0.60;
    const prob = Math.min(1, Math.max(0, raw * 0.65 + randn() * 0.05));
    y[i] = prob > 0.55 ? 1 : 0;
  }

  const fraudCount = y.reduce((s, v) => s + v, 0);
  console.log(`  Samples   : ${n.toLocaleString()}   (${fraudCount} fraud  /  ${n - fraudCount} legit)`);

  const model = tf.sequential({ name: 'fraud' });
  model.add(tf.layers.dense({ units: 32, activation: 'relu', inputShape: [7], name: 'dense' }));
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: 16, activation: 'relu', name: 'dense_1' }));
  model.add(tf.layers.dense({ units: 8,  activation: 'relu', name: 'dense_2' }));
  model.add(tf.layers.dense({ units: 1,  activation: 'sigmoid', name: 'fraud_probability' }));
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy'],
  });

  const xT = tf.tensor2d(X, [n, 7]);
  const yT = tf.tensor2d(y, [n, 1]);
  const t0 = performance.now();
  const history = await model.fit(xT, yT, {
    epochs: EPOCHS,
    batchSize: BATCH_SIZE,
    validationSplit: 0.15,
    verbose: 0,
  });
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  const lastEpoch = history.history;
  const finalLoss = lastEpoch.loss[lastEpoch.loss.length - 1].toFixed(4);
  const finalAcc  = lastEpoch.acc
    ? lastEpoch.acc[lastEpoch.acc.length - 1].toFixed(4)
    : (lastEpoch.accuracy?.[lastEpoch.accuracy.length - 1] ?? 0).toFixed(4);
  console.log(`  Results   : loss=${finalLoss}  accuracy=${finalAcc}  time=${elapsed}s`);
  xT.dispose(); yT.dispose();

  const outDir = await saveModel(model, 'fraud');
  model.dispose();

  writeFeatures(outDir, 'fraud', {
    features: [
      'amount_log_norm — log(amount+1) / log(100000)',
      'hourly_count_norm — recent_txn_count / 20',
      'amount_vs_avg_norm — (txn_amount / user_avg, capped 10) / 10',
      'is_high_risk_method — 1=virtual_card/prepaid/gift_card',
      'is_round_number — 1=amount%100==0 AND amount>=1000',
      'is_late_night — 1=hour in [1,5]',
      'is_duplicate_amounts — 1=last 5 identical',
    ],
    output: 'fraud_probability [0-1]',
    thresholds: { block: 0.85, review: 0.55 },
    architecture: 'Dense(32,relu) → BatchNorm → Dropout(0.2) → Dense(16,relu) → Dense(8,relu) → Dense(1,sigmoid)',
    trained_samples: n,
    epochs: EPOCHS,
    typescript_snippet:
      "const r = await tfService.predict('fraud', [[\n" +
      '  Math.log(amount + 1) / Math.log(100_000),\n' +
      '  Math.min(hourlyCount / 20, 1),\n' +
      '  Math.min(amount / avgAmount / 10, 1),\n' +
      '  isHighRiskMethod ? 1 : 0,\n' +
      '  isRoundNumber ? 1 : 0,\n' +
      '  isLateNight ? 1 : 0,\n' +
      '  isDuplicatePattern ? 1 : 0,\n' +
      ']]);\n' +
      'const fraudProbability = r.values[0][0]; // 0-1',
  });
}

// ══════════════════════════════════════════════════════════════════════════
// MODEL 2 — DYNAMIC SURGE PRICING
// ══════════════════════════════════════════════════════════════════════════
async function buildPricing() {
  header('MODEL 2 / 4 — Dynamic Surge Pricing');

  const n = N_SAMPLES;

  const demand  = new Float32Array(n);
  const supply  = new Float32Array(n);
  const hours   = new Float32Array(n);
  const isWknd  = bernoulliArray(2 / 7, n);

  for (let i = 0; i < n; i++) {
    // demand ~ Exponential(1.2).clip(0, 5)
    demand[i] = Math.min(-1.2 * Math.log(rand() + 1e-10), 5);
    // supply ~ Exponential(1.5).clip(0.1, 5)
    supply[i] = Math.max(0.1, Math.min(-1.5 * Math.log(rand() + 1e-10), 5));
    hours[i]  = Math.floor(rand() * 24);
  }

  const X = new Float32Array(n * 5);
  const y = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const h = hours[i];
    X[i * 5 + 0] = demand[i] / 5;
    X[i * 5 + 1] = supply[i] / 5;
    X[i * 5 + 2] = Math.sin(2 * Math.PI * h / 24);
    X[i * 5 + 3] = Math.cos(2 * Math.PI * h / 24);
    X[i * 5 + 4] = isWknd[i];

    // Reproduce computeSurgeMultiplier() from ai-pricing.service.ts
    const ratio = demand[i] / supply[i];
    let surge = 1.0;
    if      (ratio > 2.0) surge = Math.min(3.5, 1.0 + (ratio - 1.0) * 0.8);
    else if (ratio > 1.5) surge = Math.min(2.0, 1.0 + (ratio - 1.0) * 0.6);
    else if (ratio > 1.0) surge = 1.0 + (ratio - 1.0) * 0.3;

    const isPeak = (h >= 7 && h <= 9) || (h >= 17 && h <= 20);
    const isLate = h >= 23 || h <= 4;
    if (isPeak)     surge *= 1.25;
    if (isLate)     surge *= 1.15;
    if (isWknd[i])  surge *= 1.10;
    surge = Math.min(3.5, surge);

    // Normalise to [0,1] for sigmoid output
    y[i] = Math.min(1, Math.max(0, (surge - 1.0) / 2.5 + randn() * 0.02));
  }

  const avgSurge = Array.from(y).reduce((s, v) => s + v * 2.5 + 1, 0) / n;
  console.log(`  Samples   : ${n.toLocaleString()}   avg surge=${avgSurge.toFixed(3)}`);

  const model = tf.sequential({ name: 'pricing' });
  model.add(tf.layers.dense({ units: 32, activation: 'relu', inputShape: [5], name: 'dense' }));
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.dense({ units: 16, activation: 'relu', name: 'dense_1' }));
  model.add(tf.layers.dense({ units: 8,  activation: 'relu', name: 'dense_2' }));
  model.add(tf.layers.dense({ units: 1,  activation: 'sigmoid', name: 'surge_norm' }));
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'meanSquaredError',
    metrics: ['mae'],
  });

  const xT = tf.tensor2d(X, [n, 5]);
  const yT = tf.tensor2d(y, [n, 1]);
  const t0 = performance.now();
  const history = await model.fit(xT, yT, {
    epochs: EPOCHS,
    batchSize: BATCH_SIZE,
    validationSplit: 0.15,
    verbose: 0,
  });
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  const lastEpoch = history.history;
  const finalLoss = lastEpoch.loss[lastEpoch.loss.length - 1].toFixed(5);
  const finalMae  = (lastEpoch.mae?.[lastEpoch.mae.length - 1]
    ?? lastEpoch.mean_absolute_error?.[lastEpoch.mean_absolute_error.length - 1]
    ?? 0).toFixed(4);
  console.log(`  Results   : MSE=${finalLoss}  MAE(surge units)=${(parseFloat(finalMae) * 2.5).toFixed(4)}  time=${elapsed}s`);
  xT.dispose(); yT.dispose();

  const outDir = await saveModel(model, 'pricing');
  model.dispose();

  writeFeatures(outDir, 'pricing', {
    features: [
      'demand_factor_norm — raw_demand / 5',
      'supply_factor_norm — raw_supply / 5',
      'hour_sin — sin(2π × hour / 24)',
      'hour_cos — cos(2π × hour / 24)',
      'is_weekend — 1=Sat/Sun',
    ],
    output: 'surge_norm [0-1]',
    rescale: 'surge_multiplier = output × 2.5 + 1.0  →  range [1.0, 3.5]',
    architecture: 'Dense(32,relu) → BatchNorm → Dense(16,relu) → Dense(8,relu) → Dense(1,sigmoid)',
    trained_samples: n,
    epochs: EPOCHS,
    typescript_snippet:
      "const r = await tfService.predict('pricing', [[\n" +
      '  demandFactor / 5,\n' +
      '  supplyFactor / 5,\n' +
      '  Math.sin(2 * Math.PI * hour / 24),\n' +
      '  Math.cos(2 * Math.PI * hour / 24),\n' +
      '  isWeekend ? 1 : 0,\n' +
      ']]);\n' +
      'const surgeMultiplier = r.values[0][0] * 2.5 + 1.0; // 1.0–3.5',
  });
}

// ══════════════════════════════════════════════════════════════════════════
// MODEL 3 — RECOMMENDATIONS (user–item relevance)
// ══════════════════════════════════════════════════════════════════════════
async function buildRecommendations() {
  header('MODEL 3 / 4 — Recommendations (User–Item Relevance)');

  const n = N_SAMPLES;

  const X = new Float32Array(n * 10);
  const y = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    // Approximate Dirichlet(1,1,1,1,1) via normalised exponentials
    const uRaw = Array.from({ length: 5 }, () => -Math.log(rand() + 1e-10));
    const uSum = uRaw.reduce((a, b) => a + b, 0);
    const iRaw = Array.from({ length: 5 }, () => -Math.log(rand() + 1e-10));
    const iSum = iRaw.reduce((a, b) => a + b, 0);

    for (let j = 0; j < 5; j++) {
      X[i * 10 + j]     = uRaw[j] / uSum;
      X[i * 10 + 5 + j] = iRaw[j] / iSum;
    }

    // Label: category alignment × item quality × user engagement
    const u3 = X[i * 10 + 3]; // category_diversity
    const i1 = X[i * 10 + 6]; // category_score
    const catMatch  = 1 - Math.abs(u3 - i1);
    const quality   = X[i * 10 + 7] * 0.4 + X[i * 10 + 8] * 0.4 + X[i * 10 + 9] * 0.2;
    const engagement = X[i * 10 + 4]; // engagement_score
    const rawScore   = catMatch * 0.5 + quality * 0.3 + engagement * 0.2;
    const prob = Math.min(1, Math.max(0, rawScore + randn() * 0.08));
    y[i] = prob > 0.52 ? 1 : 0;
  }

  const positives = y.reduce((s, v) => s + v, 0);
  console.log(`  Samples   : ${n.toLocaleString()}   (${positives} positive  /  ${n - positives} negative)`);

  const model = tf.sequential({ name: 'recommendations' });
  model.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [10], name: 'dense' }));
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.dropout({ rate: 0.25 }));
  model.add(tf.layers.dense({ units: 32, activation: 'relu', name: 'dense_1' }));
  model.add(tf.layers.dense({ units: 16, activation: 'relu', name: 'dense_2' }));
  model.add(tf.layers.dense({ units: 1,  activation: 'sigmoid', name: 'relevance_score' }));
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy'],
  });

  const xT = tf.tensor2d(X, [n, 10]);
  const yT = tf.tensor2d(y, [n, 1]);
  const t0 = performance.now();
  const history = await model.fit(xT, yT, {
    epochs: EPOCHS,
    batchSize: BATCH_SIZE,
    validationSplit: 0.15,
    verbose: 0,
  });
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  const lastEpoch = history.history;
  const finalLoss = lastEpoch.loss[lastEpoch.loss.length - 1].toFixed(4);
  const finalAcc  = lastEpoch.acc
    ? lastEpoch.acc[lastEpoch.acc.length - 1].toFixed(4)
    : (lastEpoch.accuracy?.[lastEpoch.accuracy.length - 1] ?? 0).toFixed(4);
  console.log(`  Results   : loss=${finalLoss}  accuracy=${finalAcc}  time=${elapsed}s`);
  xT.dispose(); yT.dispose();

  const outDir = await saveModel(model, 'recommendations');
  model.dispose();

  writeFeatures(outDir, 'recommendations', {
    features: {
      'user_vec (indices 0-4)': [
        'age_norm',
        'purchase_rate',
        'avg_spend_norm',
        'category_diversity',
        'engagement_score',
      ],
      'item_vec (indices 5-9)': [
        'price_norm',
        'category_score',
        'popularity',
        'avg_rating',
        'recency_norm',
      ],
    },
    output: 'relevance_probability [0-1]',
    architecture: 'Dense(64,relu) → BatchNorm → Dropout(0.25) → Dense(32,relu) → Dense(16,relu) → Dense(1,sigmoid)',
    note: 'All feature values must be normalised to [0-1] before inference.',
    trained_samples: n,
    epochs: EPOCHS,
    typescript_snippet:
      "const r = await tfService.predict('recommendations', [[...userVec5, ...itemVec5]]);\n" +
      'const relevanceScore = r.values[0][0]; // 0-1',
  });
}

// ══════════════════════════════════════════════════════════════════════════
// MODEL 4 — DISCOUNT OPTIMISATION
// ══════════════════════════════════════════════════════════════════════════
async function buildDiscount() {
  header('MODEL 4 / 4 — Discount Optimisation');

  const n = N_SAMPLES;

  const priceNorm = betaArray(2, 3, n);
  const daysNorm  = exponentialClipped(0.2, n);
  const viewsNorm = betaArray(1.5, 4, n);
  const convRate  = betaArray(1.5, 10, n);
  const stockNorm = betaArray(3, 2, n);

  const X = new Float32Array(n * 5);
  const y = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    X[i * 5 + 0] = priceNorm[i];
    X[i * 5 + 1] = daysNorm[i];
    X[i * 5 + 2] = viewsNorm[i];
    X[i * 5 + 3] = convRate[i];
    X[i * 5 + 4] = stockNorm[i];

    // Reproduce recommendDiscount() from ai-pricing.service.ts
    let discount = 0;
    if (viewsNorm[i] > 0.10 && convRate[i] < 0.02)   discount += 0.10;  // low conversion
    if (daysNorm[i]  > 0.33 && stockNorm[i] > 0.50)  discount += 0.15;  // stale + high stock
    if (priceNorm[i] > 0.50 && daysNorm[i]  > 0.11)  discount += 0.05;  // price premium + slow

    y[i] = Math.min(1, Math.max(0, discount / 0.5 + randn() * 0.03));
  }

  const avgDiscount = Array.from(y).reduce((s, v) => s + v * 0.5, 0) / n;
  console.log(`  Samples   : ${n.toLocaleString()}   avg discount=${(avgDiscount * 100).toFixed(1)}%`);

  const model = tf.sequential({ name: 'discount' });
  model.add(tf.layers.dense({ units: 32, activation: 'relu', inputShape: [5], name: 'dense' }));
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.dense({ units: 16, activation: 'relu', name: 'dense_1' }));
  model.add(tf.layers.dense({ units: 8,  activation: 'relu', name: 'dense_2' }));
  model.add(tf.layers.dense({ units: 1,  activation: 'sigmoid', name: 'discount_norm' }));
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'meanSquaredError',
    metrics: ['mae'],
  });

  const xT = tf.tensor2d(X, [n, 5]);
  const yT = tf.tensor2d(y, [n, 1]);
  const t0 = performance.now();
  const history = await model.fit(xT, yT, {
    epochs: EPOCHS,
    batchSize: BATCH_SIZE,
    validationSplit: 0.15,
    verbose: 0,
  });
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  const lastEpoch = history.history;
  const finalLoss = lastEpoch.loss[lastEpoch.loss.length - 1].toFixed(5);
  const finalMae  = (lastEpoch.mae?.[lastEpoch.mae.length - 1]
    ?? lastEpoch.mean_absolute_error?.[lastEpoch.mean_absolute_error.length - 1]
    ?? 0).toFixed(4);
  console.log(`  Results   : MSE=${finalLoss}  MAE(discount units)=${(parseFloat(finalMae) * 0.5).toFixed(4)}  time=${elapsed}s`);
  xT.dispose(); yT.dispose();

  const outDir = await saveModel(model, 'discount');
  model.dispose();

  writeFeatures(outDir, 'discount', {
    features: [
      'current_price_norm — price / 1000  (capped 0-1)',
      'days_since_last_sale_norm — days / 90  (capped 0-1)',
      'view_count_norm — views / 500  (capped 0-1)',
      'conversion_rate — 0-1  (no scaling)',
      'stock_level_norm — stock / 1000  (capped 0-1)',
    ],
    output: 'discount_norm [0-1]',
    rescale: 'recommended_discount = output × 0.5  →  range [0%, 50%]',
    architecture: 'Dense(32,relu) → BatchNorm → Dense(16,relu) → Dense(8,relu) → Dense(1,sigmoid)',
    trained_samples: n,
    epochs: EPOCHS,
    typescript_snippet:
      "const r = await tfService.predict('discount', [[\n" +
      '  Math.min(price / 1000, 1),\n' +
      '  Math.min(daysSinceLastSale / 90, 1),\n' +
      '  Math.min(viewCount / 500, 1),\n' +
      '  conversionRate,\n' +
      '  Math.min(stockLevel / 1000, 1),\n' +
      ']]);\n' +
      'const recommendedDiscount = r.values[0][0] * 0.5; // 0.0–0.50',
  });
}

// ══════════════════════════════════════════════════════════════════════════
// MODEL 5 — SUBSCRIPTION CHURN PREDICTION
// ══════════════════════════════════════════════════════════════════════════
// Feature vector (4):
//   0  months_subscribed_norm  months_subscribed / 24  (capped 0-1)
//   1  days_since_login_norm   days_since_login / 30   (capped 0-1)
//   2  feature_usage_score     0-1 (direct, no scaling)
//   3  monthly_price_norm      monthly_price / 50      (capped 0-1)
// Output: churn_probability [0-1]
// Thresholds: high_risk ≥ 0.70, medium_risk ≥ 0.45
// Mirrors suggestRetentionDiscount() churn risk logic in ai-pricing.service.ts
// ══════════════════════════════════════════════════════════════════════════
async function buildChurn() {
  header('MODEL 5 / 5 — Subscription Churn Prediction');

  const n = N_SAMPLES;

  // Feature distributions matching subscription lifecycle patterns
  const monthsNorm   = betaArray(2, 3, n);          // newer subscribers more common
  const loginDaysNorm = exponentialClipped(0.15, n); // most users logged in recently
  const usageScore   = betaArray(2, 5, n);           // right-skewed (most have low usage)
  const priceNorm    = betaArray(1.5, 4, n);         // price distribution

  const X = new Float32Array(n * 4);
  const y = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    X[i * 4 + 0] = monthsNorm[i];
    X[i * 4 + 1] = loginDaysNorm[i];
    X[i * 4 + 2] = usageScore[i];
    X[i * 4 + 3] = priceNorm[i];

    // Reproduce churn risk heuristic from ai-pricing.service.ts:
    //   churnRisk = (lastLoginDaysAgo > 14 ? 0.3 : 0)
    //             + (featureUsageScore < 0.3 ? 0.25 : 0)
    //             + (monthsSubscribed < 3 ? 0.2 : 0)
    const lastLoginDaysAgo = loginDaysNorm[i] * 30;  // un-normalise for logic
    const monthsSubscribed = monthsNorm[i] * 24;
    const featureUsage     = usageScore[i];

    const churnRisk =
      (lastLoginDaysAgo > 14 ? 0.3 : 0) +
      (featureUsage < 0.3 ? 0.25 : 0) +
      (monthsSubscribed < 3 ? 0.2 : 0) +
      (priceNorm[i] > 0.8 ? 0.1 : 0); // high price sensitivity

    y[i] = Math.min(1, Math.max(0, churnRisk + randn() * 0.05));
  }

  const highRisk = Array.from(y).filter((v) => v >= 0.7).length;
  const medRisk  = Array.from(y).filter((v) => v >= 0.45 && v < 0.7).length;
  console.log(`  Samples   : ${n.toLocaleString()}   (${highRisk} high-risk  /  ${medRisk} medium-risk  /  ${n - highRisk - medRisk} low-risk)`);

  const model = tf.sequential({ name: 'churn' });
  model.add(tf.layers.dense({ units: 32, activation: 'relu', inputShape: [4], name: 'dense' }));
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.dropout({ rate: 0.15 }));
  model.add(tf.layers.dense({ units: 16, activation: 'relu', name: 'dense_1' }));
  model.add(tf.layers.dense({ units: 8,  activation: 'relu', name: 'dense_2' }));
  model.add(tf.layers.dense({ units: 1,  activation: 'sigmoid', name: 'churn_probability' }));
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'meanSquaredError',
    metrics: ['mae'],
  });

  const xT = tf.tensor2d(X, [n, 4]);
  const yT = tf.tensor2d(y, [n, 1]);
  const t0 = performance.now();
  const history = await model.fit(xT, yT, {
    epochs: EPOCHS,
    batchSize: BATCH_SIZE,
    validationSplit: 0.15,
    verbose: 0,
  });
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  const lastEpoch = history.history;
  const finalLoss = lastEpoch.loss[lastEpoch.loss.length - 1].toFixed(5);
  const finalMae  = (lastEpoch.mae?.[lastEpoch.mae.length - 1]
    ?? lastEpoch.mean_absolute_error?.[lastEpoch.mean_absolute_error.length - 1]
    ?? 0).toFixed(4);
  console.log(`  Results   : MSE=${finalLoss}  MAE=${finalMae}  time=${elapsed}s`);
  xT.dispose(); yT.dispose();

  const outDir = await saveModel(model, 'churn');
  model.dispose();

  writeFeatures(outDir, 'churn', {
    features: [
      'months_subscribed_norm — months_subscribed / 24  (capped 0-1)',
      'days_since_login_norm — days_since_login / 30  (capped 0-1)',
      'feature_usage_score — 0-1  (direct, no scaling)',
      'monthly_price_norm — monthly_price / 50  (capped 0-1)',
    ],
    output: 'churn_probability [0-1]',
    thresholds: { high_risk: 0.70, medium_risk: 0.45 },
    architecture: 'Dense(32,relu) → BatchNorm → Dropout(0.15) → Dense(16,relu) → Dense(8,relu) → Dense(1,sigmoid)',
    trained_samples: n,
    epochs: EPOCHS,
    typescript_snippet:
      "const r = await tfService.predict('churn', [[\n" +
      '  Math.min(monthsSubscribed / 24, 1),\n' +
      '  Math.min(lastLoginDaysAgo / 30, 1),\n' +
      '  featureUsageScore,\n' +
      '  Math.min(currentMonthlyPrice / 50, 1),\n' +
      ']]);\n' +
      'const churnProbability = r.values[0][0]; // 0-1 (≥0.70 = high risk)',
  });
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════
async function main() {
  const bar = '═'.repeat(62);
  console.log(`\n${bar}`);
  console.log('  PROMPT Genie — ML Model Training (Node.js / tfjs-node)');
  console.log(bar);
  console.log(`  TF.js version  : ${tf.version.tfjs}`);
  console.log(`  Models dir     : ${ML_DIR}`);
  console.log(`  Samples/model  : ${N_SAMPLES.toLocaleString()}`);
  console.log(`  Epochs/model   : ${EPOCHS}`);

  const t0 = performance.now();

  await buildFraud();
  await buildPricing();
  await buildRecommendations();
  await buildDiscount();
  await buildChurn();

  const totalSec = ((performance.now() - t0) / 1000).toFixed(1);

  // Verify all outputs
  console.log('\n── Verification ──────────────────────────────────────────');
  let ok = true;
  for (const name of ['fraud', 'pricing', 'recommendations', 'discount', 'churn']) {
    const mj = path.join(ML_DIR, name, 'model.json');
    const fj = path.join(ML_DIR, name, 'features.json');
    const mjOk = fs.existsSync(mj);
    const fjOk = fs.existsSync(fj);
    console.log(`  ${mjOk && fjOk ? '✓' : '✗'}  ml-models/${name}/model.json  +  features.json`);
    if (!mjOk || !fjOk) ok = false;
  }

  if (!ok) {
    console.error('\n[ERROR] One or more models failed to export correctly.');
    process.exit(1);
  }

  console.log(`\n${bar}`);
  console.log(`  COMPLETE — 5 models trained & exported in ${totalSec}s`);
  console.log('  Backend will auto-load models on next restart.');
  console.log('  Restart: docker-compose restart api  |  npm run start:dev');
  console.log(`${bar}\n`);
}

main().catch((err) => {
  console.error('\n[FATAL] Training failed:', err.message ?? err);
  process.exit(1);
});
