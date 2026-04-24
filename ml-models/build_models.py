#!/usr/bin/env python3
"""
PROMPT Genie — Master ML Model Build Script
============================================
Trains, exports, and activates all TF.js models used by the NestJS backend.

Models built
------------
  fraud/            Fraud-detection neural network      (7 features → probability)
  pricing/          Dynamic surge-pricing regressor     (5 features → surge norm)
  recommendations/  User–item relevance scorer          (10 features → probability)
  discount/         Product discount optimiser          (5 features → discount norm)

Each model is exported as a TF.js LayersModel (model.json + weight shards) that
the backend's AITensorflowService auto-scans and loads at startup.
A features.json manifest is written alongside each model.json.

Usage
-----
  # From the orionstack-backend--main/ directory:
  python ml-models/build_models.py

  # Optional flags:
  python ml-models/build_models.py --epochs 50 --samples 30000
  python ml-models/build_models.py --env /custom/path/.env

Requirements
------------
  pip install tensorflow tensorflowjs numpy

Model calling patterns (TypeScript)
------------------------------------
  // After backend restart, AITensorflowService logs:
  //   "TensorFlow: 4 model(s) preloaded from ./ml-models"

  // Fraud:
  const r = await tfService.predict('fraud', [[
    Math.log(amount + 1) / Math.log(100_000),   // amount_log_norm
    Math.min(hourlyCount / 20, 1),               // hourly_count_norm
    Math.min(amount / avgAmount / 10, 1),        // amount_ratio_norm
    isHighRiskMethod ? 1 : 0,
    isRoundNumber ? 1 : 0,
    isLateNight ? 1 : 0,
    isDuplicatePattern ? 1 : 0,
  ]]);
  const fraudProbability = r.values[0][0];       // 0-1

  // Pricing:
  const r = await tfService.predict('pricing', [[
    demandFactor / 5,
    supplyFactor / 5,
    Math.sin(2 * Math.PI * hour / 24),
    Math.cos(2 * Math.PI * hour / 24),
    isWeekend ? 1 : 0,
  ]]);
  const surgeMultiplier = r.values[0][0] * 2.5 + 1.0;  // 1.0–3.5

  // Recommendations:
  const r = await tfService.predict('recommendations', [[...userVec5, ...itemVec5]]);
  const relevanceScore = r.values[0][0];         // 0-1

  // Discount:
  const r = await tfService.predict('discount', [[
    Math.min(price / 1000, 1),
    Math.min(daysSinceLastSale / 90, 1),
    Math.min(viewCount / 500, 1),
    conversionRate,
    Math.min(stockLevel / 1000, 1),
  ]]);
  const recommendedDiscount = r.values[0][0] * 0.5;  // 0.0–0.50
"""

import os
import re
import sys
import json
import shutil
import argparse

# ─── Dependency check ───────────────────────────────────────────────────────────

def _check_deps():
    missing = []
    for pkg in ('tensorflow', 'tensorflowjs', 'numpy'):
        try:
            __import__(pkg)
        except ImportError:
            missing.append(pkg)
    if missing:
        print(f"\n[!] Missing Python packages: {', '.join(missing)}")
        print(f"    Install with:\n      pip install {' '.join(missing)}\n")
        sys.exit(1)

_check_deps()

import numpy as np            # noqa: E402
import tensorflow as tf       # noqa: E402
import tensorflowjs as tfjs   # noqa: E402

# ─── Paths & defaults ──────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))   # ml-models/
ENV_FILE   = os.path.join(SCRIPT_DIR, '..', '.env')

SEED       = 42
N_SAMPLES  = 20_000
EPOCHS     = 30
BATCH_SIZE = 256

np.random.seed(SEED)
tf.random.set_seed(SEED)

# ─── Shared helpers ────────────────────────────────────────────────────────────

def _header(title: str) -> None:
    bar = '═' * 62
    print(f"\n{bar}\n  {title}\n{bar}")


def _export_model(model: tf.keras.Model, name: str) -> str:
    """Export a Keras model to TF.js LayersModel format under SCRIPT_DIR/<name>/."""
    out_dir = os.path.join(SCRIPT_DIR, name)
    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)
    tfjs.converters.save_keras_model(model, out_dir)

    model_json_path = os.path.join(out_dir, 'model.json')
    if not os.path.exists(model_json_path):
        raise RuntimeError(f"TF.js export failed — {model_json_path} not found")

    with open(model_json_path) as f:
        meta = json.load(f)
    shard_count = len(meta.get('weightsManifest', [{}])[0].get('paths', []))
    print(f"  ✓  Exported  ml-models/{name}/model.json  +  {shard_count} weight shard(s)")
    return out_dir


def _write_features(out_dir: str, name: str, meta: dict) -> None:
    path = os.path.join(out_dir, 'features.json')
    with open(path, 'w') as f:
        json.dump(meta, f, indent=2)
    print(f"  ✓  Feature manifest → ml-models/{name}/features.json")


def _update_env(env_path: str, key: str, value: str) -> None:
    """Set or create a key=value line in an .env file (in-place, safe)."""
    abs_path = os.path.abspath(env_path)
    if not os.path.exists(abs_path):
        print(f"  [!]  .env not found at {abs_path} — skipping activation step")
        return
    with open(abs_path, 'r', encoding='utf-8') as f:
        content = f.read()
    pattern     = rf'^{re.escape(key)}=.*$'
    replacement = f'{key}={value}'
    if re.search(pattern, content, re.MULTILINE):
        content = re.sub(pattern, replacement, content, flags=re.MULTILINE)
    else:
        content = content.rstrip('\n') + f'\n{key}={value}\n'
    with open(abs_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"  ✓  .env updated  →  {key}={value}")


# ══════════════════════════════════════════════════════════════════════════════
# MODEL 1 — FRAUD DETECTION
# ══════════════════════════════════════════════════════════════════════════════
# Feature vector (7):
#   0  amount_log_norm        log(amount + 1) / log(100_000)     continuous [0-1]
#   1  hourly_count_norm      recent_txn_count / 20              continuous [0-1]
#   2  amount_vs_avg_norm     (txn_amount / user_avg) capped 10, /10   [0-1]
#   3  is_high_risk_method    virtual_card / prepaid / gift_card  binary
#   4  is_round_number        amount % 100 == 0 AND amount >= 1000  binary
#   5  is_late_night          hour in [1, 5]                     binary
#   6  is_duplicate_amounts   last 5 amounts identical           binary
# Output: fraud_probability [0-1]
# Thresholds: block ≥ 0.85, review ≥ 0.55  (matches ai-fraud.service.ts)
# ══════════════════════════════════════════════════════════════════════════════

def build_fraud_model() -> tf.keras.Model:
    _header("MODEL 1 / 4 — Fraud Detection")

    n = N_SAMPLES

    # Feature distributions (match real-world skew)
    amount_log   = np.random.beta(2, 5, n)
    hourly_norm  = np.random.beta(1.5, 8, n)
    ratio_norm   = np.random.exponential(0.3, n).clip(0, 1)
    is_risky     = np.random.binomial(1, 0.08, n).astype(float)
    is_round     = np.random.binomial(1, 0.12, n).astype(float)
    is_late      = np.random.binomial(1, 0.07, n).astype(float)
    is_dup       = np.random.binomial(1, 0.05, n).astype(float)

    X = np.column_stack([amount_log, hourly_norm, ratio_norm,
                         is_risky, is_round, is_late, is_dup])

    # Labels: reproduce the heuristic from ai-fraud.service.ts
    velocity_risk  = np.where(hourly_norm > 0.5, 0.5 + (hourly_norm - 0.5) * 0.5, 0.0)
    anomaly_risk   = np.where(ratio_norm  > 0.5, 0.4 + (ratio_norm  - 0.5) * 0.2, 0.0)
    late_high      = is_late * np.where(amount_log > 0.4, 1.0, 0.0)

    raw = (velocity_risk + anomaly_risk
           + is_risky * 0.40
           + is_round * 0.20
           + late_high * 0.30
           + is_dup * 0.60)

    y = np.clip(raw * 0.65 + np.random.normal(0, 0.05, n), 0, 1)
    y_label = (y > 0.55).astype(float)

    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(7,), name='fraud_input'),
        tf.keras.layers.Dense(32, activation='relu'),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.Dense(16, activation='relu'),
        tf.keras.layers.Dense(8,  activation='relu'),
        tf.keras.layers.Dense(1,  activation='sigmoid', name='fraud_probability'),
    ], name='fraud')

    model.compile(
        optimizer=tf.keras.optimizers.Adam(0.001),
        loss='binary_crossentropy',
        metrics=['accuracy', tf.keras.metrics.AUC(name='auc')],
    )

    print(f"  Samples   : {n:,}   ({int(y_label.sum()):,} fraud  /  {int((1-y_label).sum()):,} legit)")
    model.fit(X, y_label, epochs=EPOCHS, batch_size=BATCH_SIZE, validation_split=0.15, verbose=0)

    loss, acc, auc = model.evaluate(X, y_label, verbose=0)
    print(f"  Results   : loss={loss:.4f}  accuracy={acc:.4f}  AUC={auc:.4f}")

    out_dir = _export_model(model, 'fraud')
    _write_features(out_dir, 'fraud', {
        "features": [
            "amount_log_norm — log(amount+1) / log(100000)",
            "hourly_count_norm — recent_txn_count / 20",
            "amount_vs_avg_norm — (txn_amount / user_avg, capped 10) / 10",
            "is_high_risk_method — 1=virtual_card/prepaid/gift_card",
            "is_round_number — 1=amount%100==0 AND amount>=1000",
            "is_late_night — 1=hour in [1,5]",
            "is_duplicate_amounts — 1=last 5 identical",
        ],
        "output": "fraud_probability [0-1]",
        "thresholds": {"block": 0.85, "review": 0.55},
        "typescript_snippet": (
            "const r = await tfService.predict('fraud', [[\n"
            "  Math.log(amount + 1) / Math.log(100_000),\n"
            "  Math.min(hourlyCount / 20, 1),\n"
            "  Math.min(amount / avgAmount / 10, 1),\n"
            "  isHighRiskMethod ? 1 : 0,\n"
            "  isRoundNumber ? 1 : 0,\n"
            "  isLateNight ? 1 : 0,\n"
            "  isDuplicatePattern ? 1 : 0,\n"
            "]]);\n"
            "const fraudProbability = r.values[0][0]; // 0-1"
        ),
    })
    return model


# ══════════════════════════════════════════════════════════════════════════════
# MODEL 2 — DYNAMIC SURGE PRICING
# ══════════════════════════════════════════════════════════════════════════════
# Feature vector (5):
#   0  demand_factor_norm   raw_demand   / 5          continuous [0-1]
#   1  supply_factor_norm   raw_supply   / 5          continuous [0-1]
#   2  hour_sin             sin(2π * hour / 24)       continuous [-1, 1]
#   3  hour_cos             cos(2π * hour / 24)       continuous [-1, 1]
#   4  is_weekend           1=Sat/Sun                 binary
# Output: surge_norm [0-1]  →  surge_multiplier = output × 2.5 + 1.0  →  [1.0, 3.5]
# Matches computeSurgeMultiplier() in ai-pricing.service.ts
# ══════════════════════════════════════════════════════════════════════════════

def build_pricing_model() -> tf.keras.Model:
    _header("MODEL 2 / 4 — Dynamic Surge Pricing")

    n = N_SAMPLES

    demand   = np.random.exponential(1.2, n).clip(0, 5)
    supply   = np.random.exponential(1.5, n).clip(0.1, 5)
    hours    = np.random.randint(0, 24, n).astype(float)
    is_wknd  = np.random.binomial(1, 2 / 7, n).astype(float)

    X = np.column_stack([
        demand / 5,
        supply / 5,
        np.sin(2 * np.pi * hours / 24),
        np.cos(2 * np.pi * hours / 24),
        is_wknd,
    ])

    # Reproduce computeSurgeMultiplier() logic exactly
    ratio = np.where(supply > 0, demand / supply, 1.0)
    surge = np.ones(n)
    surge = np.where(ratio > 2.0, np.minimum(3.5, 1.0 + (ratio - 1.0) * 0.8), surge)
    surge = np.where((ratio > 1.5) & (ratio <= 2.0),
                     np.minimum(2.0, 1.0 + (ratio - 1.0) * 0.6), surge)
    surge = np.where((ratio > 1.0) & (ratio <= 1.5),
                     1.0 + (ratio - 1.0) * 0.3, surge)

    is_peak = ((hours >= 7)  & (hours <= 9)) | ((hours >= 17) & (hours <= 20))
    is_late = (hours >= 23) | (hours <= 4)
    surge = np.where(is_peak,         surge * 1.25, surge)
    surge = np.where(is_late,         surge * 1.15, surge)
    surge = np.where(is_wknd == 1,    surge * 1.10, surge)
    surge = np.clip(surge, 1.0, 3.5)

    # Normalise to [0-1] for sigmoid output
    y = (surge - 1.0) / 2.5
    y = np.clip(y + np.random.normal(0, 0.02, n), 0, 1)

    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(5,), name='pricing_input'),
        tf.keras.layers.Dense(32, activation='relu'),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.Dense(16, activation='relu'),
        tf.keras.layers.Dense(8,  activation='relu'),
        tf.keras.layers.Dense(1,  activation='sigmoid', name='surge_norm'),
    ], name='pricing')

    model.compile(
        optimizer=tf.keras.optimizers.Adam(0.001),
        loss='mse',
        metrics=['mae'],
    )

    print(f"  Samples   : {n:,}   surge range [{surge.min():.2f} – {surge.max():.2f}]")
    model.fit(X, y, epochs=EPOCHS, batch_size=BATCH_SIZE, validation_split=0.15, verbose=0)

    loss, mae = model.evaluate(X, y, verbose=0)
    print(f"  Results   : MSE={loss:.5f}  MAE (surge units)={mae * 2.5:.4f}")

    out_dir = _export_model(model, 'pricing')
    _write_features(out_dir, 'pricing', {
        "features": [
            "demand_factor_norm — raw_demand / 5",
            "supply_factor_norm — raw_supply / 5",
            "hour_sin — sin(2π × hour / 24)",
            "hour_cos — cos(2π × hour / 24)",
            "is_weekend — 1=Sat/Sun",
        ],
        "output": "surge_norm [0-1]",
        "rescale": "surge_multiplier = output × 2.5 + 1.0  →  range [1.0, 3.5]",
        "typescript_snippet": (
            "const r = await tfService.predict('pricing', [[\n"
            "  demandFactor / 5,\n"
            "  supplyFactor / 5,\n"
            "  Math.sin(2 * Math.PI * hour / 24),\n"
            "  Math.cos(2 * Math.PI * hour / 24),\n"
            "  isWeekend ? 1 : 0,\n"
            "]]);\n"
            "const surgeMultiplier = r.values[0][0] * 2.5 + 1.0; // 1.0–3.5"
        ),
    })
    return model


# ══════════════════════════════════════════════════════════════════════════════
# MODEL 3 — RECOMMENDATIONS (user–item relevance)
# ══════════════════════════════════════════════════════════════════════════════
# Feature vector (10):
#   0-4  user_vec (5D normalised):
#          [age_norm, purchase_rate, avg_spend_norm, category_diversity, engagement_score]
#   5-9  item_vec (5D normalised):
#          [price_norm, category_score, popularity, avg_rating, recency_norm]
# Output: relevance_probability [0-1]
# Approximates the blended content + collaborative approach in
# ai-recommendations.service.ts (60% collaborative / 40% content)
# ══════════════════════════════════════════════════════════════════════════════

def build_recommendations_model() -> tf.keras.Model:
    _header("MODEL 3 / 4 — Recommendations (User–Item Relevance)")

    n = N_SAMPLES

    user_vec = np.random.dirichlet(np.ones(5), n)
    item_vec = np.random.dirichlet(np.ones(5), n)
    X = np.column_stack([user_vec, item_vec])

    # Category alignment + item quality + user engagement → interaction label
    cat_match   = 1 - np.abs(user_vec[:, 3] - item_vec[:, 1])
    quality     = item_vec[:, 2] * 0.4 + item_vec[:, 3] * 0.4 + item_vec[:, 4] * 0.2
    engagement  = user_vec[:, 4]

    raw_score = cat_match * 0.5 + quality * 0.3 + engagement * 0.2
    y = (np.clip(raw_score + np.random.normal(0, 0.08, n), 0, 1) > 0.52).astype(float)

    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(10,), name='rec_input'),
        tf.keras.layers.Dense(64, activation='relu'),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.Dropout(0.25),
        tf.keras.layers.Dense(32, activation='relu'),
        tf.keras.layers.Dense(16, activation='relu'),
        tf.keras.layers.Dense(1,  activation='sigmoid', name='relevance_score'),
    ], name='recommendations')

    model.compile(
        optimizer=tf.keras.optimizers.Adam(0.001),
        loss='binary_crossentropy',
        metrics=['accuracy', tf.keras.metrics.AUC(name='auc')],
    )

    print(f"  Samples   : {n:,}   ({int(y.sum()):,} positive  /  {int((1-y).sum()):,} negative)")
    model.fit(X, y, epochs=EPOCHS, batch_size=BATCH_SIZE, validation_split=0.15, verbose=0)

    loss, acc, auc = model.evaluate(X, y, verbose=0)
    print(f"  Results   : loss={loss:.4f}  accuracy={acc:.4f}  AUC={auc:.4f}")

    out_dir = _export_model(model, 'recommendations')
    _write_features(out_dir, 'recommendations', {
        "features": {
            "user_vec (indices 0-4)": [
                "age_norm",
                "purchase_rate",
                "avg_spend_norm",
                "category_diversity",
                "engagement_score",
            ],
            "item_vec (indices 5-9)": [
                "price_norm",
                "category_score",
                "popularity",
                "avg_rating",
                "recency_norm",
            ],
        },
        "output": "relevance_probability [0-1]",
        "note": "All feature values must be normalised to [0-1] before inference.",
        "typescript_snippet": (
            "const r = await tfService.predict('recommendations', "
            "[[...userVec5, ...itemVec5]]);\n"
            "const relevanceScore = r.values[0][0]; // 0-1"
        ),
    })
    return model


# ══════════════════════════════════════════════════════════════════════════════
# MODEL 4 — DISCOUNT OPTIMISATION
# ══════════════════════════════════════════════════════════════════════════════
# Feature vector (5):
#   0  current_price_norm      price / 1000  (capped 0-1)
#   1  days_since_sale_norm    days  /  90   (capped 0-1)
#   2  view_count_norm         views / 500   (capped 0-1)
#   3  conversion_rate         0-1 (no scaling needed)
#   4  stock_level_norm        stock / 1000  (capped 0-1)
# Output: discount_norm [0-1]  →  recommended_discount = output × 0.5  →  [0%, 50%]
# Mirrors recommendDiscount() in ai-pricing.service.ts
# ══════════════════════════════════════════════════════════════════════════════

def build_discount_model() -> tf.keras.Model:
    _header("MODEL 4 / 4 — Discount Optimisation")

    n = N_SAMPLES

    price_norm  = np.random.beta(2, 3, n)
    days_norm   = np.random.exponential(0.2, n).clip(0, 1)
    views_norm  = np.random.beta(1.5, 4, n)
    conv_rate   = np.random.beta(1.5, 10, n)
    stock_norm  = np.random.beta(3, 2, n)

    X = np.column_stack([price_norm, days_norm, views_norm, conv_rate, stock_norm])

    # Reproduce recommendDiscount() logic
    discount = np.zeros(n)
    discount = np.where((views_norm > 0.10) & (conv_rate < 0.02), discount + 0.10, discount)
    discount = np.where((days_norm > 0.33)  & (stock_norm > 0.50), discount + 0.15, discount)
    discount = np.where((price_norm > 0.50) & (days_norm > 0.11),  discount + 0.05, discount)

    y = np.clip(discount / 0.5, 0, 1)
    y = np.clip(y + np.random.normal(0, 0.03, n), 0, 1)

    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(5,), name='discount_input'),
        tf.keras.layers.Dense(32, activation='relu'),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.Dense(16, activation='relu'),
        tf.keras.layers.Dense(8,  activation='relu'),
        tf.keras.layers.Dense(1,  activation='sigmoid', name='discount_norm'),
    ], name='discount')

    model.compile(
        optimizer=tf.keras.optimizers.Adam(0.001),
        loss='mse',
        metrics=['mae'],
    )

    print(f"  Samples   : {n:,}   avg discount={float((y * 0.5).mean()):.1%}")
    model.fit(X, y, epochs=EPOCHS, batch_size=BATCH_SIZE, validation_split=0.15, verbose=0)

    loss, mae = model.evaluate(X, y, verbose=0)
    print(f"  Results   : MSE={loss:.5f}  MAE (discount units)={mae * 0.5:.4f}")

    out_dir = _export_model(model, 'discount')
    _write_features(out_dir, 'discount', {
        "features": [
            "current_price_norm — price / 1000  (capped 0-1)",
            "days_since_last_sale_norm — days / 90  (capped 0-1)",
            "view_count_norm — views / 500  (capped 0-1)",
            "conversion_rate — 0-1  (no scaling)",
            "stock_level_norm — stock / 1000  (capped 0-1)",
        ],
        "output": "discount_norm [0-1]",
        "rescale": "recommended_discount = output × 0.5  →  range [0%, 50%]",
        "typescript_snippet": (
            "const r = await tfService.predict('discount', [[\n"
            "  Math.min(price / 1000, 1),\n"
            "  Math.min(daysSinceLastSale / 90, 1),\n"
            "  Math.min(viewCount / 500, 1),\n"
            "  conversionRate,\n"
            "  Math.min(stockLevel / 1000, 1),\n"
            "]]);\n"
            "const recommendedDiscount = r.values[0][0] * 0.5; // 0.0–0.50"
        ),
    })
    return model


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main() -> None:
    global EPOCHS, N_SAMPLES

    parser = argparse.ArgumentParser(
        description='Build and export all PROMPT Genie TF.js ML models',
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument('--env',     default=None,      help='Path to .env file')
    parser.add_argument('--epochs',  type=int, default=EPOCHS,    help='Training epochs per model')
    parser.add_argument('--samples', type=int, default=N_SAMPLES, help='Synthetic training samples')
    args = parser.parse_args()

    EPOCHS    = args.epochs
    N_SAMPLES = args.samples
    env_path  = args.env or ENV_FILE

    _header("PROMPT Genie — Master ML Model Build Script")
    print(f"  Models dir   : {SCRIPT_DIR}")
    print(f"  .env target  : {os.path.abspath(env_path)}")
    print(f"  TF version   : {tf.__version__}")
    print(f"  TF.js version: {tfjs.__version__}")
    print(f"  Samples/model: {N_SAMPLES:,}")
    print(f"  Epochs/model : {EPOCHS}")

    # ── Train & export all four models ──────────────────────────────────────
    build_fraud_model()
    build_pricing_model()
    build_recommendations_model()
    build_discount_model()

    # ── Verify exports ──────────────────────────────────────────────────────
    _header("Verifying exports")
    all_ok = True
    for name in ('fraud', 'pricing', 'recommendations', 'discount'):
        path   = os.path.join(SCRIPT_DIR, name, 'model.json')
        exists = os.path.exists(path)
        print(f"  {'✓' if exists else '✗ MISSING'}  ml-models/{name}/model.json")
        if not exists:
            all_ok = False

    if not all_ok:
        print("\n[error] One or more exports failed — .env will NOT be modified")
        sys.exit(1)

    # ── Update .env ─────────────────────────────────────────────────────────
    _header("Activating TensorFlow in .env")
    _update_env(env_path, 'TENSORFLOW_ENABLED', 'true')
    _update_env(env_path, 'ML_MODEL_PATH',      './ml-models')

    # ── Done ────────────────────────────────────────────────────────────────
    _header("All done")
    print("""  4 models built, exported, and activated.

  Restart the backend to load them:
    docker-compose restart api
    # OR for local dev:
    npm run start:dev

  On startup AITensorflowService will log:
    TensorFlow.js x.x.x (tfjs-node CPU) initialised
    TensorFlow: 4 model(s) preloaded from "./ml-models"

  Next steps:
    1. Wire predict() calls into ai-fraud.service.ts, ai-pricing.service.ts, etc.
       using the TypeScript snippets in each features.json.
    2. Once you have real labelled data, re-run this script — it will overwrite
       the synthetic models with trained versions.
    3. To retrain a single model, comment out the others in main().
""")


if __name__ == '__main__':
    main()
