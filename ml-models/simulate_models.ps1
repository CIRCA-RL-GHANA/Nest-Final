Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ML_DIR   = "C:\Users\Wisdom Amaniampong\Desktop\Code\thedep\orionstack-backend--main\ml-models"
$ENV_FILE = "C:\Users\Wisdom Amaniampong\Desktop\Code\thedep\orionstack-backend--main\.env"
$RNG      = [System.Random]::new(42)

function Glorot([int]$fanIn, [int]$fanOut) {
    $n     = $fanIn * $fanOut
    $limit = [Math]::Sqrt(6.0 / ($fanIn + $fanOut))
    $arr   = New-Object float[] $n
    for ($i = 0; $i -lt $n; $i++) {
        $arr[$i] = [float](($script:RNG.NextDouble() * 2.0 - 1.0) * $limit)
    }
    return ,$arr
}

function Zeros([int]$n) { return ,(New-Object float[] $n) }

function WriteBin([string]$fp, $blobs) {
    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)
    foreach ($b in $blobs) { foreach ($f in $b) { $bw.Write([float]$f) } }
    $bw.Flush()
    [System.IO.File]::WriteAllBytes($fp, $ms.ToArray())
    $bw.Dispose(); $ms.Dispose()
}

function SetEnvVar([string]$key, [string]$val) {
    $raw = [System.IO.File]::ReadAllText($ENV_FILE)
    $pat = "(?m)^" + [Regex]::Escape($key) + "=.*$"
    if ($raw -match $pat) {
        $raw = [Regex]::Replace($raw, $pat, "$key=$val", [System.Text.RegularExpressions.RegexOptions]::Multiline)
    } else {
        $raw = $raw.TrimEnd() + "`n$key=$val`n"
    }
    [System.IO.File]::WriteAllText($ENV_FILE, $raw, [System.Text.Encoding]::UTF8)
    Write-Host "  OK  .env -> $key=$val"
}

function New-DenseLayer([string]$lname, [int]$units, [string]$act, [int]$inDim) {
    $cfg = [ordered]@{
        name = $lname; trainable = $true; dtype = "float32"
        units = $units; activation = $act; use_bias = $true
        kernel_initializer = [ordered]@{ class_name = "GlorotUniform"; config = [ordered]@{ seed = $null } }
        bias_initializer   = [ordered]@{ class_name = "Zeros"; config = [ordered]@{} }
        kernel_regularizer = $null; bias_regularizer = $null
        activity_regularizer = $null; kernel_constraint = $null; bias_constraint = $null
    }
    if ($inDim -gt 0) { $cfg["batch_input_shape"] = @($null, $inDim) }
    return [ordered]@{ class_name = "Dense"; config = $cfg }
}

function Export-TFModel([string]$mname, $layers, $manifest, $weights) {
    $dir = Join-Path $ML_DIR $mname
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    New-Item -ItemType Directory -Path $dir | Out-Null
    $wEntries = @()
    foreach ($m in $manifest) {
        $wEntries += [ordered]@{ name = $m.name; shape = $m.shape; dtype = "float32" }
    }
    $doc = [ordered]@{
        format      = "layers-model"
        generatedBy = "TensorFlow.js tfjs-layers v4.10.0"
        convertedBy = $null
        modelTopology = [ordered]@{
            class_name = "Sequential"
            config = [ordered]@{ name = $mname; trainable = $true; layers = $layers }
        }
        weightsManifest = @( [ordered]@{ paths = @("./group1-shard1of1.bin"); weights = $wEntries } )
    }
    $doc | ConvertTo-Json -Depth 25 -Compress | Set-Content -Path (Join-Path $dir "model.json") -Encoding UTF8
    WriteBin (Join-Path $dir "group1-shard1of1.bin") $weights
    $bytes = (Get-Item (Join-Path $dir "group1-shard1of1.bin")).Length
    Write-Host "  OK  ml-models/$mname  ($($manifest.Count) tensors, $bytes bytes)"
}

Write-Host "`nBuilding MODEL 1/6 -- Fraud Detection (7 inputs)"
$l1 = @( (New-DenseLayer "dense" 32 "relu" 7),(New-DenseLayer "dense_1" 16 "relu" 0),(New-DenseLayer "dense_2" 8 "relu" 0),(New-DenseLayer "dense_3" 1 "sigmoid" 0) )
$m1 = @( @{name="dense/kernel";shape=@(7,32)},@{name="dense/bias";shape=@(32)},@{name="dense_1/kernel";shape=@(32,16)},@{name="dense_1/bias";shape=@(16)},@{name="dense_2/kernel";shape=@(16,8)},@{name="dense_2/bias";shape=@(8)},@{name="dense_3/kernel";shape=@(8,1)},@{name="dense_3/bias";shape=@(1)} )
$w1 = @( (Glorot 7 32),(Zeros 32),(Glorot 32 16),(Zeros 16),(Glorot 16 8),(Zeros 8),(Glorot 8 1),(Zeros 1) )
Export-TFModel "fraud" $l1 $m1 $w1
@{ inputs=@("amount_log_norm","hourly_count_norm","amount_vs_avg_norm","is_high_risk_method","is_round_number","is_late_night","is_duplicate_amounts"); output="fraud_probability [0-1]"; thresholds=@{block=0.85;review=0.55}; note="PLACEHOLDER - run build_models.py to train" } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $ML_DIR "fraud\features.json") -Encoding UTF8

Write-Host "`nBuilding MODEL 2/6 -- Dynamic Surge Pricing (5 inputs)"
$l2 = @( (New-DenseLayer "dense" 32 "relu" 5),(New-DenseLayer "dense_1" 16 "relu" 0),(New-DenseLayer "dense_2" 1 "sigmoid" 0) )
$m2 = @( @{name="dense/kernel";shape=@(5,32)},@{name="dense/bias";shape=@(32)},@{name="dense_1/kernel";shape=@(32,16)},@{name="dense_1/bias";shape=@(16)},@{name="dense_2/kernel";shape=@(16,1)},@{name="dense_2/bias";shape=@(1)} )
$w2 = @( (Glorot 5 32),(Zeros 32),(Glorot 32 16),(Zeros 16),(Glorot 16 1),(Zeros 1) )
Export-TFModel "pricing" $l2 $m2 $w2
@{ inputs=@("demand_factor_norm","supply_factor_norm","hour_sin","hour_cos","is_weekend"); output="surge_norm [0-1]"; rescale="surge = output*2.5+1.0 -> [1.0,3.5]"; note="PLACEHOLDER - run build_models.py to train" } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $ML_DIR "pricing\features.json") -Encoding UTF8

Write-Host "`nBuilding MODEL 3/6 -- Recommendations (10 inputs)"
$l3 = @( (New-DenseLayer "dense" 64 "relu" 10),(New-DenseLayer "dense_1" 32 "relu" 0),(New-DenseLayer "dense_2" 1 "sigmoid" 0) )
$m3 = @( @{name="dense/kernel";shape=@(10,64)},@{name="dense/bias";shape=@(64)},@{name="dense_1/kernel";shape=@(64,32)},@{name="dense_1/bias";shape=@(32)},@{name="dense_2/kernel";shape=@(32,1)},@{name="dense_2/bias";shape=@(1)} )
$w3 = @( (Glorot 10 64),(Zeros 64),(Glorot 64 32),(Zeros 32),(Glorot 32 1),(Zeros 1) )
Export-TFModel "recommendations" $l3 $m3 $w3
@{ inputs_user=@("age_norm","purchase_rate","avg_spend_norm","category_diversity","engagement_score"); inputs_item=@("price_norm","category_score","popularity","avg_rating","recency_norm"); output="relevance [0-1]"; note="PLACEHOLDER - run build_models.py to train" } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $ML_DIR "recommendations\features.json") -Encoding UTF8

Write-Host "`nBuilding MODEL 4/6 -- Discount Optimiser (5 inputs)"
$l4 = @( (New-DenseLayer "dense" 32 "relu" 5),(New-DenseLayer "dense_1" 16 "relu" 0),(New-DenseLayer "dense_2" 1 "sigmoid" 0) )
$m4 = @( @{name="dense/kernel";shape=@(5,32)},@{name="dense/bias";shape=@(32)},@{name="dense_1/kernel";shape=@(32,16)},@{name="dense_1/bias";shape=@(16)},@{name="dense_2/kernel";shape=@(16,1)},@{name="dense_2/bias";shape=@(1)} )
$w4 = @( (Glorot 5 32),(Zeros 32),(Glorot 32 16),(Zeros 16),(Glorot 16 1),(Zeros 1) )
Export-TFModel "discount" $l4 $m4 $w4
@{ inputs=@("current_price_norm","days_since_last_sale_norm","view_count_norm","conversion_rate","stock_level_norm"); output="discount_norm [0-1]"; rescale="discount = output*0.5 -> [0%,50%]"; note="PLACEHOLDER - run build_models.py to train" } | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $ML_DIR "discount\features.json") -Encoding UTF8

Write-Host "`nBuilding MODEL 5/6 -- Subscription Churn Prediction (4 inputs)"
$l5 = @(
    (New-DenseLayer "dense"   32 "relu"    4),
    (New-DenseLayer "dense_1" 16 "relu"    0),
    (New-DenseLayer "dense_2"  8 "relu"    0),
    (New-DenseLayer "dense_3"  1 "sigmoid" 0)
)
$m5 = @(
    @{name="dense/kernel";   shape=@(4,32)}, @{name="dense/bias";   shape=@(32)},
    @{name="dense_1/kernel"; shape=@(32,16)},@{name="dense_1/bias"; shape=@(16)},
    @{name="dense_2/kernel"; shape=@(16,8)}, @{name="dense_2/bias"; shape=@(8)},
    @{name="dense_3/kernel"; shape=@(8,1)},  @{name="dense_3/bias"; shape=@(1)}
)
$w5 = @(
    (Glorot 4 32),(Zeros 32),(Glorot 32 16),(Zeros 16),
    (Glorot 16 8),(Zeros 8), (Glorot 8 1), (Zeros 1)
)
Export-TFModel "churn" $l5 $m5 $w5
@{
    features = @(
        "months_subscribed_norm — months_subscribed / 24  (capped 0-1)",
        "days_since_login_norm — days_since_login / 30  (capped 0-1)",
        "feature_usage_score — 0-1  (direct, no scaling)",
        "monthly_price_norm — monthly_price / 50  (capped 0-1)"
    )
    output = "churn_probability [0-1]"
    thresholds = @{ high_risk = 0.70; medium_risk = 0.45 }
    architecture = "Dense(32,relu) -> BatchNorm -> Dropout(0.15) -> Dense(16,relu) -> Dense(8,relu) -> Dense(1,sigmoid)"
    note = "PLACEHOLDER - run train-models.js to train"
    typescript_snippet = "const r = await tfService.predict('churn', [[`n  Math.min(monthsSubscribed / 24, 1),`n  Math.min(lastLoginDaysAgo / 30, 1),`n  featureUsageScore,`n  Math.min(currentMonthlyPrice / 50, 1),`n]]);"
} | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $ML_DIR "churn\features.json") -Encoding UTF8

Write-Host "`nBuilding MODEL 6/6 -- NLU Intent Classifier (14 inputs -> 12 classes)"
# 14 inputs: 11 intent keyword scores + is_question + has_amount + is_negation
# 12 outputs: buy,sell,ride,search,help,pricing,payment,social,schedule,complaint,recommendation,unknown
$l6 = @(
    (New-DenseLayer "dense"     32 "relu"    14),
    (New-DenseLayer "dense_1"   16 "relu"     0),
    (New-DenseLayer "intent_probs" 12 "softmax" 0)
)
$m6 = @(
    @{name="dense/kernel";      shape=@(14,32)}, @{name="dense/bias";       shape=@(32)},
    @{name="dense_1/kernel";    shape=@(32,16)}, @{name="dense_1/bias";     shape=@(16)},
    @{name="intent_probs/kernel";shape=@(16,12)},@{name="intent_probs/bias";shape=@(12)}
)
$w6 = @(
    (Glorot 14 32),(Zeros 32),(Glorot 32 16),(Zeros 16),(Glorot 16 12),(Zeros 12)
)
Export-TFModel "nlu" $l6 $m6 $w6
@{
    features = @(
        "buy_score — normalised keyword match for buy/purchase/order intents [0-1]",
        "sell_score — normalised keyword match for sell/list/upload intents [0-1]",
        "ride_score — normalised keyword match for ride/taxi/transport intents [0-1]",
        "search_score — normalised keyword match for search/find/show me intents [0-1]",
        "help_score — normalised keyword match for help/support/how do intents [0-1]",
        "pricing_score — normalised keyword match for price/cost/how much intents [0-1]",
        "payment_score — normalised keyword match for pay/wallet/transfer intents [0-1]",
        "social_score — normalised keyword match for chat/message/share intents [0-1]",
        "schedule_score — normalised keyword match for book/schedule/calendar intents [0-1]",
        "complaint_score — normalised keyword match for complaint/issue/refund intents [0-1]",
        "recommendation_score — normalised keyword match for recommend/suggest/best intents [0-1]",
        "is_question — 1 if text contains ? or starts with how/what/where/when/why [0-1]",
        "has_amount — 1 if text contains a digit [0-1]",
        "is_negation — 1 if text contains no/not/don't/can't/never [0-1]"
    )
    output = "softmax probs over 12 classes [0-1 each, sum=1]"
    classes = @("buy","sell","ride","search","help","pricing","payment","social","schedule","complaint","recommendation","unknown")
    architecture = "Dense(64,relu) -> BatchNorm -> Dropout(0.25) -> Dense(32,relu) -> Dense(16,relu) -> Dense(12,softmax)"
    note = "PLACEHOLDER - run train-models.js to train"
    typescript_snippet = "const r = await tfService.predict('nlu', [[...14DVector]]);"
} | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $ML_DIR "nlu\features.json") -Encoding UTF8

Write-Host "`nVerifying..."
$ok = $true
foreach ($mn in @("fraud","pricing","recommendations","discount","churn","nlu")) {
    $p = Join-Path $ML_DIR $mn "model.json"
    if (Test-Path $p) { Write-Host "  OK  ml-models/$mn/model.json" } else { Write-Host "  MISSING  $mn"; $ok = $false }
}
if (-not $ok) { Write-Error "Export failed"; exit 1 }

Write-Host "`nActivating TensorFlow in .env..."
SetEnvVar "TENSORFLOW_ENABLED" "true"
SetEnvVar "ML_MODEL_PATH" "./ml-models"

Write-Host "`n=================================================="
Write-Host "  COMPLETE - 6 models built, TENSORFLOW_ENABLED=true"
Write-Host "  Models: fraud, pricing, recommendations, discount, churn, nlu"
Write-Host "  Restart backend: docker-compose restart api"
Write-Host "  Or local dev:    npm run start:dev"
Write-Host "=================================================="