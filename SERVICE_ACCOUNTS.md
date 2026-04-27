# PROMPT Genie — External Service Accounts & Operations Guide

> **Pedantic reference** — every section is derived directly from the source code.
> Where a code file is the authority, the path is cited inline.
> Do not paraphrase this document; it is meant to be exact.

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Complete User Journeys](#2-complete-user-journeys)
   - 2.1 New User Registration
   - 2.2 Entity (Business) Creation & Onboarding
   - 2.3 Ride Request (Rider POV)
   - 2.4 Ride Acceptance (Driver POV)
   - 2.5 Marketplace Order
   - 2.6 Q Points Transactions (Business Ledger)
   - 2.7 Q Points Market — Cash-In (Buying QP with Fiat)
   - 2.8 Q Points Market — Cash-Out (Selling QP for Fiat)
   - 2.9 Subscription Activation & Monthly Billing
   - 2.10 Social Feed & HeyYa
   - 2.11 Real-Time Chat
   - 2.12 Financial Planner
   - 2.13 File Upload
3. [Service Account Setup](#3-service-account-setup)
   - 3.1 PostgreSQL 15
   - 3.2 Redis 7
   - 3.3 JWT & Encryption Secrets (self-generated)
   - 3.4 Twilio (SMS / OTP)
   - 3.5 SendGrid (Email)
   - 3.6 AWS S3 (File Storage)
   - 3.7 Google Maps API
   - 3.8 OpenAI API
   - 3.9 Paystack (Primary Payment Facilitator)
   - 3.10 Flutterwave (Alternative Payment Facilitator)
   - 3.11 Sentry (Error Tracking)
   - 3.12 AI Liquidity Manager (Internal — operational config only)
4. [Master `.env` Checklist](#4-master-env-checklist)
5. [Startup Order](#5-startup-order)
6. [90-Day Rotation Calendar](#6-90-day-rotation-calendar)

---

## 1. Platform Overview

PROMPT Genie is a **multi-tenant, multi-domain platform** with six verticals running
inside a single NestJS 10 monolith:

| Vertical | Modules |
|---|---|
| Identity & IAM | `users`, `auth`, `entities`, `entity-profiles` |
| Ride-Hailing | `rides`, `vehicles`, `places`, `go` |
| Marketplace | `orders`, `products`, `favorites`, `wishlist` |
| Financials | `wallets`, `payments`, `qpoints`, `revenue`, `statement`, `planner` |
| Q Points Exchange | `qpoints/market` (order book, settlement, AI market-maker) |
| Social & Comms | `social`, `calendar`, gateway (`chat`) |
| Platform | `subscriptions`, `health`, `files`, `ai` |

**Currency model:**  
`1 Q Point = $1.00 USD` at all times (pegged, fixed — see `order-book.service.ts:FIXED_QP_PRICE`).  
Total supply: **500 trillion QP** held initially by the AI participant user
(`market-balance.service.ts:QPOINTS_TOTAL_SUPPLY`).

**Revenue model (from `subscription-plan.entity.ts`):**

| Tier | Cost | Features |
|---|---|---|
| Free | 0 QP/staff/month | Core tools only |
| Basic | 4 QP/staff/month | Core business management |
| Professional | 8 QP/staff/month | Basic + branded social features |
| Enterprise | 12 QP/staff/month | Professional + marketing + analytics |

First calendar month for every new business entity: **free trial** — fee waived,
all Enterprise features unlocked, **zero** free transaction quota (every
order immediately incurs the $0.02 transaction fee).

Per-transaction platform fee: **$0.02 QP** after the first 100 free transactions
per calendar month (`revenue.service.ts:TRANSACTION_FEE_QP`, `FREE_TX_QUOTA`).

---

## 2. Complete User Journeys

### 2.1 New User Registration

**Actors:** Unauthenticated mobile/web client.

```
Client                           API                         Twilio
  │                               │                             │
  ├─POST /api/v1/users/register──►│                             │
  │  { phoneNumber, socialUsername│                             │
  │    wireId, password, ... }    │                             │
  │                               ├─ Uniqueness checks ────────►│
  │                               │  (phoneNumber, socialUsername, wireId)
  │                               ├─ Create users row           │
  │                               │  passwordHash via bcrypt    │
  │                               │  (BCRYPT_ROUNDS=12)         │
  │                               ├─ Generate 6-digit OTP ─────►│
  │                               │  store in otps table        │  SMS delivered
  │                               │  type='sms'                 │  to phoneNumber
  │◄──{ userId, message }─────────┤                             │
  │                               │                             │
  ├─POST /api/v1/users/verify-otp►│                             │
  │  { phoneNumber, code }        │                             │
  │                               ├─ Find latest OTP for phone  │
  │                               ├─ Check: not verified,       │
  │                               │  not expired, attempts < 5  │
  │                               ├─ SET users.otpVerified=true │
  │◄──{ message: "OTP verified" }─┤                             │
  │                               │                             │
  ├─POST /api/v1/users/biometric─►│   (optional, post-OTP)      │
  │  { userId, biometricStatus }  │                             │
  │                               ├─ Requires otpVerified=true  │
  │                               ├─ SET biometricVerified       │
  │◄──{ message }─────────────────┤                             │
  │                               │                             │
  ├─POST /api/v1/auth/login───────►│                             │
  │  { identifier, password }     │                             │
  │  identifier = phoneNumber     │                             │
  │            OR socialUsername  │                             │
  │                               ├─ Lookup by phoneNumber OR   │
  │                               │  socialUsername             │
  │                               ├─ bcrypt.compare(password)   │
  │                               ├─ HARD BLOCK if !otpVerified │
  │                               │  → 400 BadRequestException  │
  │                               ├─ Sign accessToken (JWT_SECRET│
  │                               │  exp: JWT_EXPIRES_IN=7d)    │
  │                               ├─ Sign refreshToken          │
  │                               │  (JWT_REFRESH_SECRET        │
  │                               │  exp: JWT_REFRESH_EXPIRES_IN│
  │                               │  =30d)                      │
  │◄──{ user, tokens }────────────┤                             │
```

**Code authority:** `users.service.ts:register`, `users.service.ts:verifyOtp`,
`auth.service.ts:login`.

**Twilio dependency:** `users.service.ts:sendOtpSms` checks
`TWILIO_ACCOUNT_SID.startsWith('AC')`. If the credential check fails, the OTP
is generated and stored in the DB but **not delivered** — the function logs a
warning and returns. The user can verify from the DB only in this case.
**In production, Twilio must be configured or registration is permanently
broken** (login is blocked at `auth.service.ts:70–74` until `otpVerified=true`).

**OTP parameters (from `configuration.ts:security`):**

| Var | Default | Meaning |
|---|---|---|
| `OTP_EXPIRY_MINUTES` | `5` | OTP valid window |
| `OTP_MAX_ATTEMPTS` | `5` (stored in `otp.maxAttempts`) | Lock after N failures |
| `BCRYPT_ROUNDS` | `12` | Password hash cost |

**Resend OTP:** `POST /api/v1/users/resend-otp { phoneNumber }` — auto-creates
a stub user record if the phone number has never been registered before
(`users.service.ts:resendOtp`).

---

### 2.2 Entity (Business) Creation & Onboarding

**Actors:** Authenticated user (OWNER role required for subsequent operations).

```
POST /api/v1/entities
  Body: { type: "Individual"|"Other", wireId, socialUsername, name?, otherEntityType? }
  → Creates entities row (EntityProfile)
  → ownerId = req.user.id

POST /api/v1/users/set-pin
  Body: { userId, entityId, pin }
  → Creates staff row: role=OWNER, pinHash=bcrypt(pin)
  → PIN stored hashed via Staff.hashPin() BeforeInsert hook

POST /api/v1/subscriptions
  Body: { planId, entityId, targetType, targetId, staffCount }
  → Activates SubscriptionAssignment
  → First activation ever: free trial (fee=0, all features unlocked)
  → Subsequent months: deducts pricePerStaffQPoints × staffCount from
    entity's QPointAccount balance
  → Records revenue via RevenueService.recordSubscriptionRevenue()

POST /api/v1/users/assign-staff
  Body: { adminId, userId, entityId, role, pin, isBranch?, posId?, branchId? }
  → Admin must hold ADMINISTRATOR (entity) or BRANCH_MANAGER (branch) role
  → Valid entity roles: ADMINISTRATOR, SOCIAL_OFFICER, RESPONSE_OFFICER, MONITOR
  → Valid branch roles: BRANCH_MANAGER, SOCIAL_OFFICER, RESPONSE_OFFICER,
                        MONITOR, DRIVER
```

**Code authority:** `entities.service.ts`, `users.service.ts:setPin`,
`users.service.ts:assignStaffRole`, `subscriptions.service.ts:activateSubscription`.

---

### 2.3 Ride Request (Rider POV)

```
POST /api/v1/rides
  Body: { rideType, pickupLocation: {lat,lng}, dropoffLocation: {lat,lng},
          scheduledPickupTime?, voiceNoteUrl?, notes? }

  Internal steps:
  1. Haversine distance calculation (rides.service.ts:calculateDistance)
  2. AI dynamic fare:
       AIPricingService.computeRidePrice({
         baseDistance,
         pickupLat/Lng, dropoffLat/Lng,
         rideType,
         requestedAt: now
       })
       Formula:
         baseFare     = $5.00 (flat)
         distanceFare = distance_km × $2.50/km
         timeFare     = estimatedMins × $0.35/min
         surgeFee     = (surgeMultiplier - 1) × (baseFare+distanceFare+timeFare)
         platformFee  = gross × 8%
         finalPrice   = gross + platformFee
       Surge multipliers:
         demand/supply > 2.0  → up to 3.5×
         peak hours 7–9, 17–20 → ×1.25
         weekend              → ×1.10
         late night 23–04     → ×1.15
         hard cap: 3.5×
  3. Generate riderPIN (6-digit) and driverPIN (6-digit)
  4. Generate rideNumber = RIDE-{year}-{00001-99999}
  5. Create Ride (status=REQUESTED)

  Returns: { id, rideNumber, estimatedFare, riderPIN, driverPIN, ... }

GET /api/v1/rides/:id/tracking
  → RideTracking records (GPS breadcrumbs), max 50 latest

POST /api/v1/rides/:id/wait-time/start  { userId, reason? }
  → Creates WaitTimeTracking, chargePerMinute=0.5 QP

POST /api/v1/rides/:id/wait-time/:wt_id/end
  → waitMinutes = ceil((endTime - startTime) / 60_000)
  → totalCharge = waitMinutes × 0.5 QP
  → Adds to ride.waitTimeCharges

POST /api/v1/rides/:id/feedback
  Body: { rideId, revieweeId, rating, comment?, tags? }
  → Stores RideFeedback

POST /api/v1/rides/:id/sos
  Body: { rideId, message? }
  → Records RideSOSAlert (status=ACTIVE)
  → Emits structured critical log (ingested by Sentry / DataDog)
  → Uses latest GPS tracking point as location

POST /api/v1/rides/referral
  Body: { referrerId, refereeId }
  → Creates RideReferral (status=PENDING, 30-day expiry)
  → On POST /api/v1/rides/referral/:id/complete { rideId }:
       Referrer credited 100 QP via QPointsTransactionService.deposit()
       Referee credited 50 QP via QPointsTransactionService.deposit()
```

**Code authority:** `rides.service.ts`.

---

### 2.4 Ride Acceptance (Driver POV)

```
PUT /api/v1/rides/:id/assign-driver
  Body: { driverId, vehicleId }
  → Ride must be in status=REQUESTED
  → Sets status=DRIVER_ASSIGNED

PUT /api/v1/rides/:id/status
  Body: { status }
  Status transitions and side-effects:
    DRIVER_ARRIVED  → sets ride.driverArrivedAt = now
    RIDE_STARTED    → sets ride.rideStartedAt = now
    RIDE_COMPLETED  → sets ride.rideCompletedAt = now
                      ride.finalFare = estimatedFare + waitTimeCharges

POST /api/v1/rides/:id/verify-driver-pin
  Body: { pin }
  → Compares plain-text pin against ride.driverPIN
  → Sets ride.driverPINVerified = true on match
  (Note: driverPIN is stored plain-text on the Ride entity; it is
  a one-time challenge code, not a bcrypt hash)

POST /api/v1/rides/:id/verify-rider-pin
  Body: { pin }
  → Same pattern for ride.riderPIN / ride.riderPINVerified

POST /api/v1/rides/:id/tracking
  Body: { lat, lng }
  → Stores RideTracking point
  → Calculates distanceToDestination (Haversine) to dropoffLocation
  → etaMinutes = ceil(distanceToDestination × 2)
```

**Code authority:** `rides.service.ts:assignDriver`, `updateRideStatus`,
`verifyDriverPIN`, `verifyRiderPIN`, `trackRide`.

---

### 2.5 Marketplace Order

```
POST /api/v1/orders
  Body: {
    items: [{ productId, quantity }],
    paymentMethod,
    deliveryAddress,
    notes?
  }

  Internal steps:
  1. Fetch each product via ProductsService.getProductById()
     unitPrice = product.discountedPrice ?? product.price
  2. subtotal   = sum(unitPrice × quantity)
     deliveryFee = 5 (flat)
     tax         = subtotal × 7.5%
     total       = subtotal + deliveryFee + tax
  3. AI fraud check: AIFraudService.scoreTransaction({
       userId: buyerId, amount: total, currency: 'NGN',
       paymentMethod: dto.paymentMethod
     })
     → blocked=true  → 400 "Order declined due to suspicious activity"
     → reviewFlag=true → logs warning, continues
  4. Deduct from buyer's QPointAccount via QPointsTransactionService
  5. Create Order (status=PENDING) + OrderItems
  6. Charge transaction fee via RevenueService.chargeTransactionFee(
       entityId, orderRef, isFreeTrial
     )
     → First 100 orders/month: free
     → Trial entities: fee on every order (freeQuota=0)
     → After quota: deducts 0.02 QP from entity's QPointAccount

PUT /api/v1/orders/:id/status
  Body: { status }
  Status values: PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED
                        └──────────────────────────────────────► CANCELLED

POST /api/v1/orders/:id/return
  Body: { reason, items? }
  → Creates ReturnRequest (status=PENDING)

PUT /api/v1/orders/:id/return/:returnId/status
  Body: { status: APPROVED|REJECTED|COMPLETED }

POST /api/v1/orders/:id/fulfillment
  Body: { ... }
  → Creates FulfillmentSession (status=PENDING)
```

**Code authority:** `orders.service.ts:createOrder`.

---

### 2.6 Q Points Transactions (Business Ledger)

These are **entity-level QP transactions** (not the market exchange). Used for
business-to-business transfers, deposits, and withdrawals recorded in the
double-entry `general_ledger`.

```
POST /api/v1/qpoints/transactions/deposit
  Body: { accountId, amount, paymentReference, metadata? }
  Headers: x-device-fingerprint (optional)

  Internal steps:
  1. AIFraudService.scoreTransaction() — multi-signal risk scoring:
       • Velocity breach (≥10 txns/hour)
       • Amount anomaly (>5× user average)
       • High-risk payment method (virtual_card, prepaid, gift_card)
       • Round number (amount % 100 == 0 && amount ≥ 1000)
       • Late night (01:00–05:00) high-value (>500)
       • Duplicate amount pattern (≥5 identical recent amounts)
     Composite score = max×0.6 + mean×0.4
     reviewFlag threshold  = 0.55  (AI_FRAUD_REVIEW_THRESHOLD)
     blocked threshold     = 0.85  (AI_FRAUD_BLOCK_THRESHOLD)
  2. Log BehaviorLog (behaviorType=TRANSACTION_ATTEMPT)
  3. AML thresholds (qpoints-transaction.service.ts constants):
       HIGH_VALUE_THRESHOLD            = 5000 QP
       DAILY_VELOCITY_THRESHOLD        = 10000 QP
       MAX_DAILY_TRANSACTIONS          = 20
       RAPID_TRANSACTION_WINDOW_MINUTES = 5
       MAX_TRANSACTIONS_IN_WINDOW       = 5
  4. Begin TypeORM QueryRunner transaction
  5. Create QPointTransaction (status=FLAGGED if requiresApproval, else COMPLETED)
  6. If not flagged: update QPointAccount.balance, create double-entry JournalEntries
  7. If flagged: create FraudLog, do NOT update balance (pending review)

POST /api/v1/qpoints/transactions/transfer
  Body: { sourceAccountId, destinationAccountId, amount, description? }
  → Same fraud/AML pipeline
  → Deducts from source, credits destination atomically
  → Creates two JournalEntries (DEBIT source, CREDIT destination)

POST /api/v1/qpoints/transactions/withdraw
  Body: { accountId, amount, description? }
  → Same fraud/AML pipeline
  → Deducts from account balance

GET /api/v1/qpoints/transactions
  Query: { accountId?, type?, status?, startDate?, endDate?, limit?, offset? }

POST/PUT /api/v1/qpoints/transactions/review-fraud
  Body: { transactionId, action: APPROVE|REJECT, notes? }
  → reviewer = req.user.id or 'system'
  → If APPROVE: executes the balance update that was held
  → If REJECT:  marks transaction FAILED, no balance change
```

**Code authority:** `qpoints-transaction.service.ts`, `ai-fraud.service.ts`.

---

### 2.7 Q Points Market — Cash-In (Buying QP with Fiat)

**Prerequisites:** User must have registered a payment facilitator account via
`POST /api/v1/qpoints/payment/register` (see Journey 2.8 preamble). The AI
Liquidity Manager must be running (`AI_MARKET_ENABLED=true`) to ensure sell
orders exist for matching.

```
POST /api/v1/qpoints/cashin
  Body: { quantity }   ← number of QP to buy (= $quantity USD to spend)

  Internal (OrderBookService.marketBuy):
  1. Creates a BUY limit order at FIXED_QP_PRICE ($1.00)
  2. _matchOrders() runs price-time priority matching:
     → Finds open SELL orders at price ≤ $1.00
     → No self-trade (o.user_id != uid)
     → Row-level lock (pessimistic_write) prevents race conditions
     → Fills as many matching sell orders as needed
     → For each fill: creates QPointTrade record
     → Updates buyer and seller order.filledQuantity
     → Marks counter-order as FILLED when fully consumed
  3. For each trade:
     → MarketBalanceService.adjustBalance(buyer, +fillQty, "trade_<id>")
     → MarketBalanceService.adjustBalance(seller, -fillQty, "trade_<id>")
     → SettlementService.createSettlement(trade, buyerId, sellerId, fillQty×price)
       → Creates two QPointSettlement records (DEBIT buyer, CREDIT seller)
       → PaymentFacilitatorService.transfer(buyerId, sellerId, cashAmount, tradeId)
          [Paystack]:
            POST https://api.paystack.co/transfer {
              source: 'balance',        ← platform's Paystack balance pays
              amount: cashAmount × 100, ← in kobo
              recipient: seller's stored recipient_code,
              reason: "QP trade settlement ref:<tradeId>",
              reference: tradeId,
              currency: NGN
            }
          [Flutterwave]:
            POST https://api.flutterwave.com/v3/transfers {
              account_bank: bankCode,
              account_number: accountNumber,
              amount: cashAmount,
              currency: NGN,
              reference: tradeId,
              callback_url: PAYMENT_FACILITATOR_WEBHOOK_URL
            }
       → On success: both settlement records → COMPLETED, stores transferId
       → On failure: both records → FAILED, notifies buyer + seller via
                     MarketNotificationService.notifyUser()
     → RevenueService.recordTradeRevenue() (0.02 QP per trade)
     → MarketNotificationService notifies buyer and seller

  Returns: { order, trades: [...] }
```

---

### 2.8 Q Points Market — Cash-Out (Selling QP for Fiat)

**Prerequisites (MUST be done once before first cash-out):**

```
POST /api/v1/qpoints/payment/register
  Body: {
    provider: "paystack",           ← or "flutterwave"
    email: "user@example.com",
    accountNumber: "0690000031",    ← user's bank account number
    bankCode: "044",                ← CBN bank code (Nigeria)
    accountName: "Jane Doe",        ← required for Paystack
    type: "nuban"                   ← or "mobile_money", "basa"
  }

  Internal (PaymentFacilitatorService.registerUserAccount):
  [Paystack]:
    POST https://api.paystack.co/transferrecipient {
      type: "nuban",
      name: accountName,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: NGN,
      metadata: { userId, email }
    }
    → stores recipient_code (e.g. "RCP_xxxxxxxxxx") in facilitator_accounts
      (userId, provider) — UNIQUE constraint

  [Flutterwave]:
    POST https://api.flutterwave.com/v3/accounts/resolve {
      account_number: accountNumber,
      account_bank: bankCode
    }
    → verifies account exists
    → stores "bankCode|accountNumber" composite in facilitator_accounts

  Returns: { success, provider, externalId }

  Error if not registered: "User <id> has no <provider> facilitator account.
  Please complete payment onboarding first."
  (thrown at PaymentFacilitatorService._getFacilitatorAccountId)
```

Cash-out flow:

```
POST /api/v1/qpoints/cashout
  Body: { quantity }   ← number of QP to sell

  Internal (OrderBookService.marketSell):
  1. Checks seller's market balance: balance < quantity → 400
  2. Creates SELL order at FIXED_QP_PRICE ($1.00)
  3. _matchOrders() finds open BUY orders (price ≥ $1.00)
  4. Same settlement pipeline as cash-in (seller receives fiat)
```

**Limit orders (for users who want a specific price level):**

```
POST /api/v1/qpoints/orders
  Body: { type: "buy"|"sell", quantity }
  → price is always overridden to FIXED_QP_PRICE ($1.00)

DELETE /api/v1/qpoints/orders/:orderId
  → Only the order owner can cancel
  → Order must be status=OPEN

GET /api/v1/qpoints/orders         → aggregated order book depth (20 levels each side)
GET /api/v1/qpoints/orders/open    → authenticated user's open orders
GET /api/v1/qpoints/trades         → trade history (?limit=20&offset=0)
GET /api/v1/qpoints/market         → { lastPrice, volume24h, spreadPercent, bestBid, bestAsk }
GET /api/v1/qpoints/balance        → authenticated user's market QP balance
GET /api/v1/qpoints/notifications  → market notifications
POST /api/v1/qpoints/notifications/read  → mark as read
```

**Code authority:** `order-book.service.ts`, `settlement.service.ts`,
`payment-facilitator.service.ts`, `market-balance.service.ts`,
`market-notification.service.ts`.

---

### 2.9 Subscription Activation & Monthly Billing

```
GET /api/v1/subscriptions/plans
  → Returns all active SubscriptionPlan records

POST /api/v1/subscriptions
  Body: { planId, entityId, targetType: "Entity"|"Branch",
          targetId, staffCount }
  Auth: JWT required, userId = activating user

  Billing rules (subscriptions.service.ts:activateSubscription):
  1. Is this plan Free? → no charge, activate immediately.
  2. Is this the entity's very first subscription ever?
     (no prior SubscriptionAssignment for targetId) →
     FREE TRIAL:
       • monthlyCost = 0 (waived)
       • All features = Enterprise-level
       • Free transaction quota = 0 (every order costs $0.02 immediately)
  3. Subsequent activations:
     monthlyCost = plan.pricePerStaffQPoints × staffCount
     (or plan.monthlyCostQPoints for legacy flat-fee plans)
     → Deduct from entity's QPointAccount (must have sufficient balance)
     → Creates SubscriptionAssignment (activated=true)
     → RevenueService.recordSubscriptionRevenue(entityId, monthlyCost, staffCount)

GET /api/v1/subscriptions          → user's active subscriptions
GET /api/v1/subscriptions/:id      → specific assignment
DELETE /api/v1/subscriptions/:id   → cancel subscription
```

**Booster points:** Each plan allocates `boosterPointsAllocation` QP per
billing cycle to the entity's `BoosterPointsAccount` for marketing campaigns.

---

### 2.10 Social Feed & HeyYa

```
POST /api/v1/social/heyya
  Body: { recipientId, message? }
  → Creates HeyYaRequest (status=PENDING)
  → senderId from JWT or query param ?senderId=

PATCH /api/v1/social/heyya/:id/respond
  Body: { accept: true|false }
  → Marks ACCEPTED or REJECTED

POST /api/v1/social/updates
  Body: { content, visibility: "public"|"followers"|"private", mediaUrl? }
  → Creates Update (social post)

GET /api/v1/social/updates
  Query: { userId?, visibility?, limit?, offset? }

POST /api/v1/social/updates/:id/comments
  Body: { content }
  → Creates UpdateComment

POST /api/v1/social/engagements
  Body: { targetId, targetType: "update"|"comment", type: "like"|"love"|... }
  → Creates Engagement (upserts per user+target)

POST /api/v1/social/messages
  Body: { sessionId, content, mediaUrl? }
  → Creates ChatMessage (also available via WebSocket — see 2.11)

GET /api/v1/social/messages/:sessionId
  → Returns chat history for a session
```

**Code authority:** `social.controller.ts`, `social.service.ts`.

---

### 2.11 Real-Time Chat (WebSocket)

The chat gateway runs at `wss://api.genieinprompt.app/chat` (Socket.IO namespace).

```
Connection:
  client.handshake.auth.token = JWT access token
  OR Authorization: Bearer <token>
  → Server verifies JWT (JWT_SECRET)
  → Disconnects immediately if token missing or invalid

Events (client → server):
  join_session  { sessionId }
    → socket joins room `session:${sessionId}`

  send_message  { sessionId, content, mediaUrl? }
    → ChatService.sendMessage(senderId, sessionId, content, mediaUrl)
    → Emits `new_message` to all sockets in `session:${sessionId}`

  typing        { sessionId }
    → Broadcasts `user_typing` to room (except sender)

  mark_read     { sessionId }
    → Marks all messages in session as read for this user

Events (server → client):
  new_message   { id, sessionId, senderId, content, createdAt }
  user_typing   { userId, sessionId }
  message_read  { sessionId, userId }
```

**CORS origins** for Socket.IO: `CORS_ORIGIN.split(',')` — must include your
frontend domain.

**Code authority:** `chat.gateway.ts`, `social/services/chat.service.ts`.

---

### 2.12 Financial Planner

```
POST /api/v1/planner/transactions
  Body: { type: "income"|"expense", amount, category, date, description? }
  → Stores PlannerTransaction for authenticated user

GET /api/v1/planner/transactions
GET /api/v1/planner/transactions/type/:type   (income | expense)
GET /api/v1/planner/transactions/month        ?year=2025&month=4

GET /api/v1/planner/insights
  → AIInsightsService.analyseFinancials(incomeTransactions, expenseTransactions)
  → Returns array of FinancialInsight:
      { type: "trend"|"anomaly"|"forecast"|"recommendation"|"alert",
        title, body, impact: "positive"|"negative"|"neutral",
        confidence, metadata? }

GET /api/v1/planner/forecast
  → AIInsightsService.forecastRevenue(transactions)
  → Returns { next7Days, next30Days, trend: "up"|"down"|"flat", confidence }

GET /api/v1/planner/spending-patterns
  → AIInsightsService.analyseSpendingPatterns(expenses)
  → Returns { topCategories, avgDailySpend, avgWeeklySpend,
               highestSingleExpense, largestCategory }
```

**Code authority:** `planner.controller.ts`, `planner.service.ts`,
`ai-insights.service.ts`.

---

### 2.13 File Upload

```
POST /api/v1/files/upload/:folder
  Multipart: file field name = "file"
  Path param: folder = "avatars" | "documents" | "receipts" | "attachments"

  Allowed types and size limits (file.service.ts:validateFile):
    avatars:     image/jpeg, image/png, image/webp       → 5 MB
    documents:   application/pdf, application/msword      → 20 MB
    receipts:    image/jpeg, image/png                    → 10 MB
    attachments: image/jpeg, image/png, video/mp4, application/pdf → 50 MB

  S3 key format: {folder}/{userId}/{timestamp}-{uuid}
  ACL: private (always)
  Metadata on S3 object: original-filename, uploaded-by

  Returns: { fileId, key, url (presigned, 1h), size, type, uploadedAt }

GET /api/v1/files/:key/url
  → Returns a fresh 1-hour presigned GET URL

DELETE /api/v1/files/:key
  → DeleteObjectCommand to S3

POST /api/v1/files/classify
  Body: { filename }
  → AINlpService.extractKeywords(filename) for keyword extraction
  → Regex matching: avatar|profile → avatars, receipt|invoice → receipts,
    doc|contract|report → documents, else → attachments
  → Returns { folder, keywords }
```

**Ownership extraction:** `FileService.getFileMetadata(key)` parses the second
path segment of the S3 key as `userId`. No separate FileMetadata DB table
exists yet — the key encodes ownership.

**Code authority:** `file.service.ts`, `files/controllers/`.

---

## 3. Service Account Setup

---

### 3.1 PostgreSQL 15

**What the app uses it for:**  
Every entity in the system. Row-level locking (`SELECT … FOR UPDATE` via
TypeORM `pessimistic_write`) is used in:
- `WalletsService.addBalance` / `deductBalance`
- `MarketBalanceService.adjustBalance`
- `OrderBookService._matchOrders`
- `RevenueService.chargeTransactionFee`

The `facilitator_accounts` table has a composite unique index:
`(userId, provider)` — a user can register with both Paystack and Flutterwave
independently.

**Step 1 — Install**

```bash
sudo apt update && sudo apt install -y postgresql-15 postgresql-client-15
sudo systemctl enable postgresql && sudo systemctl start postgresql
```

**Step 2 — Create role and database**

```bash
sudo -u postgres psql
```
```sql
CREATE ROLE promptgenie_app LOGIN PASSWORD 'use_openssl_rand_hex_32';
CREATE DATABASE promptgenie_prod OWNER promptgenie_app;
REVOKE ALL ON DATABASE promptgenie_prod FROM PUBLIC;
GRANT CONNECT, CREATE ON DATABASE promptgenie_prod TO promptgenie_app;
\q
```

**Step 3 — `pg_hba.conf` (restrict to app container IP)**

```
# /etc/postgresql/15/main/pg_hba.conf
host    promptgenie_prod    promptgenie_app    <app_container_ip>/32    scram-sha-256
```

```bash
sudo systemctl reload postgresql
```

**Step 4 — Disable public network listen**

```
# /etc/postgresql/15/main/postgresql.conf
listen_addresses = '127.0.0.1'
```

**Step 5 — Environment variables**

| Variable | Value | Code source |
|---|---|---|
| `DB_HOST` | `postgres` (Docker service name) | `configuration.ts:database.host` |
| `DB_PORT` | `5432` | `configuration.ts:database.port` |
| `DB_USERNAME` | `promptgenie_app` | `configuration.ts:database.username` |
| `DB_PASSWORD` | *(generated)* | `configuration.ts:database.password` |
| `DB_NAME` | `promptgenie_prod` | `configuration.ts:database.name` |
| `DB_SYNCHRONIZE` | `false` — **never true in production** | `configuration.ts:database.synchronize` |
| `DB_MIGRATIONS_RUN` | `true` | `data-source.ts` |
| `DB_SSL` | `true` for cloud/remote hosts | `configuration.ts:database.ssl` |
| `DB_LOGGING` | `false` (set `true` for debug) | `configuration.ts:database.logging` |
| `DB_POOL_MAX` | `20` | Pool connection cap |

**Step 6 — Run migrations before first start**

```bash
npm run migration:run:prod
# Runs: node -r ./register-paths.js node_modules/typeorm/cli.js migration:run -d dist/database/data-source.js
```

**Step 7 — Seed the AI participant user**

The AI Liquidity Manager requires a specific UUID in the DB:

```bash
npm run seed
```

Verify:
```sql
SELECT id, balance FROM qpoint_market_balances
WHERE user_id = '00000000-0000-0000-0000-000000000001';
```

The row must exist with a substantial QP balance (the genesis supply holder).
If missing, the AI manager silently skips every cron run.

**Operational procedures:**
- **Password rotation:** `ALTER USER promptgenie_app PASSWORD 'new';` → update
  `DB_PASSWORD` → rolling restart of app container.
- **Connection pool alert:** Query `pg_stat_activity` — alert if count >
  `DB_POOL_MAX` (20).
- **Backup:** pg_dump cron controlled by `BACKUP_ENABLED=true`,
  `BACKUP_SCHEDULE=0 2 * * *`, `BACKUP_S3_BUCKET=promptgenie-backups`.

---

### 3.2 Redis 7

**What the app uses it for (four distinct purposes):**

| Purpose | Controlled by | Notes |
|---|---|---|
| HTTP response caching | `REDIS_TTL=86400` | 24h default |
| Bull job queues (email, SMS, reports, cleanup) | `QUEUE_REDIS_HOST` | Queues stall silently if Redis is down |
| Session storage | `SESSION_SECRET` / express-session | `REDIS_SESSION_TTL=86400` |
| Socket.IO pub/sub adapter | `SOCKETIO_REDIS_HOST` | Multi-instance chat coordination |

**Step 1 — Install**

```bash
sudo apt install -y redis-server
```

**Step 2 — `/etc/redis/redis.conf`**

```
requirepass <openssl rand -hex 40>
bind 127.0.0.1
protected-mode yes
maxmemory 512mb
maxmemory-policy allkeys-lru
tcp-keepalive 300
```

**Step 3 — Enable and test**

```bash
sudo systemctl enable redis && sudo systemctl restart redis
redis-cli -a your_password ping   # → PONG
```

**Step 4 — Environment variables**

| Variable | Value | Code source |
|---|---|---|
| `REDIS_HOST` | `redis` (Docker service name) | `configuration.ts:redis.host` |
| `REDIS_PORT` | `6379` | `configuration.ts:redis.port` |
| `REDIS_PASSWORD` | *(generated)* | `configuration.ts:redis.password` |
| `REDIS_DB` | `0` | `configuration.ts:redis.db` |
| `REDIS_TTL` | `86400` | Cache TTL in seconds |
| `REDIS_SESSION_TTL` | `86400` | Session TTL |
| `QUEUE_REDIS_HOST` | `redis` | Bull queue host |
| `QUEUE_REDIS_PORT` | `6379` | Bull queue port |
| `QUEUE_REDIS_PASSWORD` | *(same as REDIS_PASSWORD)* | Bull auth |
| `QUEUE_CONCURRENCY` | `5` | Concurrent job processors |
| `SOCKETIO_REDIS_HOST` | `redis` | Socket.IO adapter |
| `SOCKETIO_REDIS_PORT` | `6379` | Socket.IO adapter |

**Step 5 — Verify queue connectivity via health endpoint**

```
GET /api/v1/health
```

Look for `"redis": { "status": "up" }` in the response.

**Operational procedures:**
- **Stalled queue diagnostic:** `redis-cli -a pw LLEN bull:email:wait`
- **Rotation:** Update `requirepass` → restart Redis → update
  `REDIS_PASSWORD` + `QUEUE_REDIS_PASSWORD` → restart app.
- **Controlling which queues are active:**
  `PROCESS_EMAILS=true`, `PROCESS_SMS=true`, `PROCESS_REPORTS=true`,
  `PROCESS_CLEANUP=true`, `PROCESS_SYNC=true`.

---

### 3.3 JWT & Encryption Secrets (self-generated)

**What the app uses them for:**

| Secret | Used in | Rotation impact |
|---|---|---|
| `JWT_SECRET` | `auth.service.ts:generateTokens` signs access tokens; `JwtAuthGuard` validates them on every authenticated request | All active sessions invalidated immediately |
| `JWT_REFRESH_SECRET` | `auth.service.ts:generateTokens` signs refresh tokens; verified at `POST /auth/refresh` | All refresh tokens invalidated; users must re-login |
| `SESSION_SECRET` | express-session cookie signing | All sessions invalidated |
| `PIN_ENCRYPTION_KEY` | Ride PINs (riderPIN, driverPIN) AES-256-CBC encryption | **Corrupts all existing encrypted PINs** — requires migration |
| `PIN_ENCRYPTION_IV` | IV for the above | Same as above |

**JWT payload** (hardcoded in `auth.service.ts:generateTokens`):
```typescript
{ sub: user.id, phoneNumber, socialUsername, wireId }
```

**Step 1 — Generate all secrets**

```bash
# JWT access token secret — 512-bit entropy
openssl rand -hex 64   # → JWT_SECRET

# JWT refresh token secret — MUST differ from JWT_SECRET
openssl rand -hex 64   # → JWT_REFRESH_SECRET

# Session secret
openssl rand -hex 64   # → SESSION_SECRET

# AES-256-CBC PIN encryption key — EXACTLY 32 hex characters
openssl rand -hex 16   # → PIN_ENCRYPTION_KEY

# AES-256-CBC IV — EXACTLY 16 hex characters
openssl rand -hex 8    # → PIN_ENCRYPTION_IV
```

**Step 2 — Environment variables**

| Variable | Format | Code source |
|---|---|---|
| `JWT_SECRET` | 64-char hex | `configuration.ts:jwt.secret` |
| `JWT_EXPIRES_IN` | `7d` | `configuration.ts:jwt.expiresIn` |
| `JWT_REFRESH_SECRET` | 64-char hex (different from JWT_SECRET) | `configuration.ts:jwt.refreshSecret` |
| `JWT_REFRESH_EXPIRES_IN` | `30d` | `configuration.ts:jwt.refreshExpiresIn` |
| `SESSION_SECRET` | 64-char hex | express-session |
| `PIN_ENCRYPTION_KEY` | exactly 32 hex chars | ride PIN AES encryption |
| `PIN_ENCRYPTION_IV` | exactly 16 hex chars | ride PIN AES IV |
| `PIN_ALGORITHM` | `aes-256-cbc` | Do not change |
| `BCRYPT_ROUNDS` | `12` | `configuration.ts:security.bcryptRounds` |

**⚠ Critical constraint on PIN keys:**  
`rides.service.ts` stores `riderPIN` and `driverPIN` as plain 6-digit strings
on the `Ride` entity (no encryption in the current schema). The
`PIN_ENCRYPTION_KEY` / `PIN_ENCRYPTION_IV` / `PIN_ALGORITHM` variables are
used by the `SetPinDto` flow for **staff PINs** stored in the `staff` table via
bcrypt hash. Changing `BCRYPT_ROUNDS` after staff records exist does not break
existing PINs (bcrypt stores the rounds in the hash); increasing it slows
login proportionally at next hash.

---

### 3.4 Twilio (SMS / OTP)

**What the app uses it for:**  
OTP delivery during registration (`users.service.ts:sendOtpSms`). This is a
**hard login dependency** — `auth.service.ts:70–74` throws
`400 BadRequestException('Phone number not verified')` if `user.otpVerified`
is `false`. Every user must receive an OTP SMS to log in. There is no bypass.

**OTP message text** (exact string from `users.service.ts:sendOtpSms`):
> `Your PROMPT Genie verification code is: {otp}. Valid for 10 minutes. Never share this code with anyone.`

Note: the message says "10 minutes" but `OTP_EXPIRY_MINUTES=5` by default — if
you want the message to match behaviour, set `OTP_EXPIRY_MINUTES=10` or update
the message text.

**Step 1 — Create account**

1. Go to [https://www.twilio.com/try-twilio](https://www.twilio.com/try-twilio).
2. Enter name, email, password.
3. Verify your own phone number via the code Twilio sends you.
4. Onboarding questions: "OTP/Verification", "Node.js", "For work".

**Step 2 — Copy credentials**

1. Go to [https://console.twilio.com](https://console.twilio.com).
2. Under **Account Info**:
   - **Account SID** → `TWILIO_ACCOUNT_SID` (format: `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)
   - Click the eye icon next to **Auth Token** → `TWILIO_AUTH_TOKEN`

**Step 3 — Get a phone number capable of SMS**

1. Console → **Phone Numbers → Manage → Buy a Number**.
2. Filter: Country **United States**, Capabilities: **SMS** checked.
3. Select → **Buy** (~$1.15/month).
4. Copy the number in E.164 format → `TWILIO_PHONE_NUMBER=+1XXXXXXXXXX`.

**Step 4 — Enable Ghana and Nigeria (your primary markets)**

1. Console → **Messaging → Settings → Geo Permissions**.
2. Search **Nigeria** → toggle **ON**.
3. Search **Ghana** → toggle **ON**.
4. Save changes.

**Step 5 — Upgrade from trial (removes the verified-numbers-only restriction)**

1. Console → top-right → **Upgrade**.
2. Enter credit card, add ≥ $20 credit.

**Step 6 — Enable 2FA on the Twilio console account**

Console → **Account → General Settings → Two-Factor Authentication → Enable**.

**Step 7 — Environment variables**

| Variable | Value | Code source |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | `configuration.ts:sms.twilioAccountSid` (also checked directly in `users.service.ts:sendOtpSms` with `startsWith('AC')`) |
| `TWILIO_AUTH_TOKEN` | *(your auth token)* | `configuration.ts:sms.twilioAuthToken` |
| `TWILIO_PHONE_NUMBER` | `+1XXXXXXXXXX` | `configuration.ts:sms.twilioPhoneNumber` (checked with `startsWith('+')`) |
| `SMS_ENABLED` | `true` | Feature flag |
| `SMS_PROVIDER` | `twilio` | Provider selector |
| `SMS_RATE_LIMIT` | `3` | Max sends per window |
| `SMS_RATE_LIMIT_WINDOW` | `3600` | 1 hour (seconds) |
| `OTP_LENGTH` | `6` | 6-digit codes |
| `OTP_EXPIRY_MINUTES` | `5` | `configuration.ts:security.otpExpiryMinutes` |

**Credential guard in code:**  
`users.service.ts:sendOtpSms` checks:
```typescript
if (!accountSid?.startsWith('AC') || !authToken || !fromNumber?.startsWith('+')) {
  this.logger.warn(`Twilio credentials not configured…`);
  return;   // ← OTP NOT sent; silently stored in DB only
}
```
This means a misconfigured credential is invisible in the API response. Verify
delivery via the Twilio Console → **Monitor → Logs → Messaging**.

**Operational procedures:**
- **Deliverability issue:** Check console → **Monitor → Logs → Messaging**
  for `30006` (landline), `30034` (trial restriction), `21211` (invalid number).
- **Ghana number format:** `+233XXXXXXXXX` (country code `233` followed by
  9 digits, no leading zero).
- **Nigeria number format:** `+234XXXXXXXXXX` (country code `234` followed by
  10 digits, no leading zero).
- **Auth Token rotation:** Console → **Account → API Keys & Tokens → Rotate
  Auth Token** → old token immediately invalidated → update `.env` → restart app.
- **Cost alert:** Console → **Billing → Manage Usage Triggers** → alert at $50.

---

### 3.5 SendGrid (Email)

**What the app uses it for:**  
Transactional email via `@sendgrid/mail` (v8.1.6). Three Dynamic Templates
are loaded from environment variables:
- `EMAIL_WELCOME_TEMPLATE_ID` — welcome email on registration
- `EMAIL_FORGOT_PASSWORD_TEMPLATE_ID` — password reset link
- `EMAIL_ORDER_CONFIRMATION_TEMPLATE_ID` — order placed confirmation

Jobs are processed by Bull queue when `PROCESS_EMAILS=true`.
From address `noreply@genieinprompt.app` must be domain-authenticated or
emails land in spam.

**Step 1 — Create account**

1. Go to [https://sendgrid.com/free/](https://sendgrid.com/free/).
2. Sign up with email and password.
3. Verify your email address.
4. Onboarding: company name = `PROMPT Genie`, website = `https://genieinprompt.app`,
   role = "Developer", use case = "Transactional email".

**Step 2 — Create a Restricted API Key**

1. Dashboard → **Settings → API Keys → Create API Key**.
2. Name: `promptgenie-prod-mail`.
3. **Restricted Access** → expand **Mail Send** → set to **Full Access**.
4. Leave everything else as **No Access**.
5. Click **Create & View**.
6. Copy the key immediately (shown once) → `SENDGRID_API_KEY=SG.xxxxxxxxxx`.

**Step 3 — Domain Authentication**

1. Dashboard → **Settings → Sender Authentication → Authenticate Your Domain**.
2. DNS host: select your provider (Cloudflare, Route53, GoDaddy, etc.).
3. Domain: `genieinprompt.app`.
4. SendGrid provides 3 CNAME records. Add them to your DNS exactly as shown.
5. Click **Verify**. Also add `noreply@genieinprompt.app` as a verified sender.

**Step 4 — Create Dynamic Templates**

All three templates use SendGrid **Dynamic Templates** with Handlebars syntax.

**Template 1: Welcome**
- Name: `PROMPT Genie — Welcome`
- Variables used: `{{firstName}}`, `{{appName}}`, `{{supportEmail}}`
- After saving, copy ID (format `d-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`) → `EMAIL_WELCOME_TEMPLATE_ID`

**Template 2: Forgot Password**
- Name: `PROMPT Genie — Password Reset`
- Variables used: `{{resetLink}}`, `{{expiresIn}}`, `{{firstName}}`
- Copy ID → `EMAIL_FORGOT_PASSWORD_TEMPLATE_ID`

**Template 3: Order Confirmation**
- Name: `PROMPT Genie — Order Confirmation`
- Variables used: `{{orderId}}`, `{{orderTotal}}`, `{{currency}}`, `{{orderDate}}`, `{{items}}`
- Copy ID → `EMAIL_ORDER_CONFIRMATION_TEMPLATE_ID`

**Step 5 — Environment variables**

| Variable | Value | Code source |
|---|---|---|
| `SENDGRID_API_KEY` | `SG.xxxxxxxxxx` | `configuration.ts:email.sendgridApiKey` |
| `EMAIL_FROM` | `noreply@genieinprompt.app` | `configuration.ts:email.from` |
| `EMAIL_FROM_NAME` | `PROMPT Genie` | `configuration.ts:email.fromName` |
| `EMAIL_SUPPORT` | `support@genieinprompt.app` | Template variable |
| `EMAIL_WELCOME_TEMPLATE_ID` | `d-xxxxxxxx` | Queue processor |
| `EMAIL_FORGOT_PASSWORD_TEMPLATE_ID` | `d-xxxxxxxx` | Queue processor |
| `EMAIL_ORDER_CONFIRMATION_TEMPLATE_ID` | `d-xxxxxxxx` | Queue processor |
| `PROCESS_EMAILS` | `true` | Enables Bull email queue processor |

**Operational procedures:**
- **Check delivery:** Dashboard → **Activity → Email Activity** → search recipient.
- **Bounce handling:** If bounce spike occurs, check DNS authentication via
  **Settings → Sender Authentication**.
- **Key rotation:** Create new restricted key → update `SENDGRID_API_KEY` →
  restart app → delete old key in dashboard.
- **Volume limits:** Free = 100/day; Essentials = 50,000/month.
  Upgrade before launch to avoid delivery failures.

---

### 3.6 AWS S3

**What the app uses it for:**  
`FileService` (`file.service.ts`) uses `@aws-sdk/client-s3` v3 with
`@aws-sdk/s3-request-presigner`. The bucket (`AWS_S3_BUCKET`) holds user files.
A separate bucket (`BACKUP_S3_BUCKET`) stores pg_dump backups.

Every file is uploaded with `ACL: 'private'`. The only public access mechanism
is a time-limited presigned URL (default `expiresIn=3600` seconds = 1 hour),
generated by `FileService.getSignedUrl`.

S3 key format: `{folder}/{userId}/{timestamp}-{uuid}`. Ownership is derived by
splitting on `/` and taking index 1 (`FileService.getFileMetadata`).

**Step 1 — Create AWS account**

1. Go to [https://aws.amazon.com](https://aws.amazon.com) → **Create Account**.
2. Use a group email such as `aws-admin@genieinprompt.app`.
3. Account name: `promptgenie-prod`.
4. Complete credit card verification and phone verification.
5. Support plan: **Basic** (free).

**Step 2 — Immediately secure the root account**

1. Log in as root → **My Security Credentials → MFA → Activate MFA**.
2. Use a hardware key (YubiKey) or TOTP (Google Authenticator).
3. After MFA is set, **never use root credentials for any operation**.

**Step 3 — Create an IAM admin user for yourself**

1. **IAM → Users → Create user** → name: `aws-admin-yourname`.
2. Enable console access, attach policy: **AdministratorAccess**.
3. Download CSV. Log out of root. Log in as this user for all subsequent steps.

**Step 4 — Create the application IAM user (minimal permissions)**

1. **IAM → Users → Create user** → name: `promptgenie-prod-app`.
2. No console access.
3. Create inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "UserFileOps",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::promptgenie-uploads-prod/*"
    },
    {
      "Sid": "UserFileBucketList",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::promptgenie-uploads-prod"
    },
    {
      "Sid": "BackupWrite",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::promptgenie-backups/*"
    },
    {
      "Sid": "BackupBucketList",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::promptgenie-backups"
    }
  ]
}
```

4. **Security credentials → Create access key** → Use case: **Application running outside AWS**.
5. Copy **Access Key ID** and **Secret Access Key** (shown once).

**Step 5 — Create the two S3 buckets**

*Bucket 1: User uploads*

1. **S3 → Create bucket** → name: `promptgenie-uploads-prod`.
2. Region: `us-east-1` (must match `AWS_REGION`).
3. Object Ownership: **ACLs disabled** (ACL is set in code but IAM policies
   govern access — the `ACL: 'private'` in `PutObjectCommand` is redundant
   but harmless when ACLs are disabled).
4. **Block all public access**: all four checkboxes checked.
5. Versioning: disabled.
6. Default encryption: SSE-S3 (`AES256`).
7. Create bucket.

*Bucket 2: Backups*

1. Name: `promptgenie-backups`.
2. Same region.
3. Block all public access: checked.
4. **Versioning: enabled** (protects backup history).
5. Default encryption: SSE-S3.
6. Create bucket.

**Step 6 — Lifecycle policy on backups bucket**

`promptgenie-backups` → **Management → Lifecycle rules → Create rule**:
- Rule name: `expire-old-backups`
- Scope: All objects
- Action: Expire current versions → Days: `30` (matches `BACKUP_RETENTION_DAYS=30`)

**Step 7 — CORS on uploads bucket**

`promptgenie-uploads-prod` → **Permissions → CORS**:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedOrigins": [
      "https://genieinprompt.app",
      "https://www.genieinprompt.app"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

**Step 8 — Environment variables**

| Variable | Value | Code source |
|---|---|---|
| `AWS_REGION` | `us-east-1` | `file.service.ts:S3Client.region` |
| `AWS_ACCESS_KEY_ID` | `AKIAxxxxxxxxxx` | `file.service.ts:S3Client.credentials.accessKeyId` |
| `AWS_SECRET_ACCESS_KEY` | *(secret key)* | `file.service.ts:S3Client.credentials.secretAccessKey` |
| `AWS_S3_BUCKET` | `promptgenie-uploads-prod` | `file.service.ts:this.bucket` (also falls back to `process.env.AWS_S3_BUCKET || 'promptgenie-files'`) |
| `BACKUP_S3_BUCKET` | `promptgenie-backups` | Backup cron job |
| `BACKUP_ENABLED` | `true` | Backup scheduler |
| `BACKUP_RETENTION_DAYS` | `30` | Lifecycle rule must match |
| `BACKUP_ENCRYPTION` | `true` | pg_dump encrypted backup |

**Operational procedures:**
- **IAM key rotation (every 90 days):** Create new key → deploy → deactivate
  old → 24 h later delete old.
- **Presigned URL TTL:** Files served via 1-hour presigned URLs. Clients
  caching URLs longer than 1 hour will receive `403 AccessDenied`. Client
  must re-fetch a fresh URL from `GET /files/:key/url`.
- **Billing alert:** **Billing → Budgets** → alert at $50/month.

---

### 3.7 Google Maps API

**What the app uses it for:**  
`GOOGLE_MAPS_API_KEY` is consumed by the rides module for geocoding pickup
and dropoff addresses. Currently feature-flagged (`GOOGLE_MAPS_ENABLED=false`).

Note: the AI pricing service (`ai-pricing.service.ts`) computes distances using
its own Haversine implementation, not the Maps API. Google Maps is used for
**address resolution and display**, not fare calculation.

**Step 1 — Create a Google Cloud project**

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com).
2. Sign in with `admin@genieinprompt.app` (Google Workspace account).
3. **Select project → New Project** → name: `promptgenie-prod`.
4. Enable billing: **Billing → Link a billing account** → add credit card.

**Step 2 — Enable APIs**

**APIs & Services → Library** — enable:
- **Maps JavaScript API** (frontend map rendering)
- **Geocoding API** (address → lat/lng)
- **Places API** (pickup/dropoff autocomplete)
- **Directions API** (route display, optional)

**Step 3 — Create a restricted API key**

1. **APIs & Services → Credentials → Create Credentials → API Key**.
2. Edit the key → name: `promptgenie-prod-maps`.
3. **Application restrictions → HTTP referrers**:
   - `https://genieinprompt.app/*`
   - `https://www.genieinprompt.app/*`
   - `https://api.genieinprompt.app/*`
4. **API restrictions → Restrict key** → select only the APIs enabled above.
5. Save. Copy key → `GOOGLE_MAPS_API_KEY=AIzaxxxxxxxx`.

**Step 4 — Environment variables**

| Variable | Value | Code source |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | `AIzaxxxxxxxx` | `configuration.ts:googleMaps.apiKey` |
| `GOOGLE_MAPS_ENABLED` | `false` → `true` when ride feature launches | Feature flag |
| `MAX_RIDE_SEARCH_RADIUS_KM` | `50` | Ride request search radius |

**Operational procedures:**
- **Quota monitoring:** **APIs & Services → Dashboard** → check daily usage per API.
- **`REQUEST_DENIED` error:** Usually means the key restriction blocks the
  calling origin — verify HTTP referrer whitelist includes all calling domains.

---

### 3.8 OpenAI API

**What the app uses it for:**  
`AI_MODEL=gpt-4o-mini` via `AI_BASE_URL=https://api.openai.com/v1`.

Active AI services that call the OpenAI API:
- `AINlpService` — keyword extraction (`file.service.ts:classifyFileAI`,
  `statement.service.ts`, `users.service.ts:getAIUserInsights`)
- `AIInsightsService` — financial analysis, revenue forecasting (`planner`)
- `AIRecommendationsService` — product, feed, subscription recommendations
- `WorkflowOrchestratorService` — structured task decomposition

`AI_ENABLED=true` by default. `TENSORFLOW_ENABLED=false` — TensorFlow model
path exists (`ML_MODEL_PATH=./ml-models`) but the ML pipeline is disabled.

**Step 1 — Create account**

1. Go to [https://platform.openai.com/signup](https://platform.openai.com/signup).
2. Sign up with email or Google account.
3. Verify phone number.

**Step 2 — Add billing**

1. **Billing → Add payment method** → credit/debit card.
2. Set **Hard limit**: `$100/month`.
3. Set **Soft limit**: `$75/month`.
4. Add initial credit: ≥ $20.

**Step 3 — Create project and API key**

1. Top-left dropdown → **Create new project** → name: `promptgenie-prod`.
2. **Dashboard → API keys → Create new secret key** → name: `promptgenie-prod-api`.
3. Copy key immediately (shown once) → `AI_API_KEY=sk-proj-xxxxxxxxxx`.

**Step 4 — Verify model access**

1. **Playground → Chat → Model** → select `gpt-4o-mini`.
2. Send a test message. If the model is unavailable, your account may need to
   spend $5 before Tier 1 (which unlocks most models) is activated.

**Step 5 — Enable 2FA**

**Account → Settings → Security → Enable 2FA**.

**Step 6 — Environment variables**

| Variable | Value | Code source |
|---|---|---|
| `AI_API_KEY` | `sk-proj-xxxxxxxxxx` | `configuration.ts:ai.apiKey` |
| `AI_BASE_URL` | `https://api.openai.com/v1` | `configuration.ts:ai.baseUrl` |
| `AI_MODEL` | `gpt-4o-mini` | `configuration.ts:ai.model` |
| `AI_ENABLED` | `true` | `configuration.ts:ai.enabled` |
| `AI_MAX_TOKENS` | `2048` | `configuration.ts:ai.maxTokens` |
| `AI_TEMPERATURE` | `0.7` | `configuration.ts:ai.temperature` |
| `AI_TOP_P` | `0.9` | `configuration.ts:ai.topP` |
| `AI_REQUEST_TIMEOUT` | `30000` | 30 s per request |
| `TENSORFLOW_ENABLED` | `false` | Disabled; set `true` only when ML models are deployed |
| `ML_MODEL_PATH` | `./ml-models` | `configuration.ts:ai.modelPath` |
| `FEATURE_STORE_UPDATE_INTERVAL` | `300000` | 5 min (ms) |

**Operational procedures:**
- **Quota / rate limit (`429`):** Check **Dashboard → Usage**. Upgrade
  usage tier if hitting limits.
- **Key rotation (every 90 days):** Create new key → update env → restart app
  → delete old key.

---

### 3.9 Paystack (Primary Payment Facilitator)

**What the app actually does with Paystack — the exact flow:**

`PaymentFacilitatorService._paystackTransfer` is called by `SettlementService`
after every matched trade in the Q Points market. The call:

```typescript
POST https://api.paystack.co/transfer
{
  source: 'balance',           // ← debits from THE PLATFORM's Paystack balance
  amount: Math.round(cashAmount * 100),  // ← in kobo (smallest NGN denomination)
  recipient: recipientCode,    // ← seller's recipient_code from facilitator_accounts
  reason: `QP trade settlement ref:${reference}`,
  reference: tradeId,          // ← used as idempotency key
  currency: NGN                // ← PAYMENT_FACILITATOR_CURRENCY
}
```

**`source: 'balance'` is the critical constraint:** The platform's own Paystack
account balance funds every payout to sellers. If the balance is zero, all
cash-out trades fail with a settlement error that notifies both buyer and
seller (`settlement.service.ts:95–107`).

Before any user can receive a cash-out payout, they must register via:
```
POST /api/v1/qpoints/payment/register
```
This calls `POST https://api.paystack.co/transferrecipient` and stores the
returned `recipient_code` in `facilitator_accounts`. Without this, cash-out
throws `BadRequestException("User <id> has no paystack facilitator account")`.

**Prerequisites for Paystack Live Mode:**
- CAC-registered company in Nigeria, or Registrar-General registration in Ghana
- Corporate bank account in the business name
- Valid ID for all directors
- Live website at `https://genieinprompt.app` with privacy policy and T&C

**Step 1 — Create account**

1. Go to [https://paystack.com](https://paystack.com) → **Create a free account**.
2. Business name: your legal entity name exactly as registered.
3. Country: Nigeria or Ghana.
4. Verify email.

**Step 2 — Test mode first**

The dashboard opens in test mode. Test keys (`sk_test_xxxxx`) are available
immediately without KYB:
1. **Settings → API Keys & Webhooks**.
2. Copy **Test Secret Key** → use as `PAYMENT_FACILITATOR_SECRET_KEY` for dev/staging.

**Step 3 — Enable Transfers in test mode**

1. **Settings → Preferences → Transfer OTP** → disable OTP for test mode.
   Without this, every `POST /transfer` in test mode requires an OTP confirmation
   step that blocks automated settlement tests.

**Step 4 — Submit KYB for Live Mode**

**Settings → Business Settings → Compliance**:

*Nigeria:*
- Business type: Limited Liability Company or Business Name
- RC Number: CAC registration number
- Upload: Certificate of Incorporation
- Upload: Business address proof (utility bill < 3 months old)
- Director details: full name, date of birth, BVN, government ID
- Bank account: name must exactly match registered business name

*Ghana:*
- Business registration number from Registrar-General
- Certificate of Incorporation
- Ghana Card (National ID) for director
- GhLink bank account

Review timeline: 1–5 business days.

**Step 5 — Enable Transfers separately (not automatic after KYB)**

After KYB approval: **Products → Transfers → Enable Transfers**.
Provide business purpose: *"Peer-to-peer cash settlement of Q Points market
trades. The platform instructs Paystack to pay out to users' registered bank
accounts when they sell Q Points."*

**Step 6 — Fund your Paystack balance**

Every seller payout debits your Paystack balance. You must pre-fund it:
- **Finance → Fund Balance** → bank transfer to Paystack's designated account.
- Recommended float: ≥ 3× expected daily payout volume.
- Set a low-balance alert: **Finance → Transfer Notifications → notify when
  balance falls below ₦100,000**.

**Step 7 — Get Live API keys**

Toggle dashboard to **Live** → **Settings → API Keys & Webhooks**:
- **Live Secret Key** (`sk_live_xxxxxxxxxx`) → `PAYMENT_FACILITATOR_SECRET_KEY`
- **Live Public Key** (`pk_live_xxxxxxxxxx`) → `PAYMENT_FACILITATOR_PUBLIC_KEY`

**Step 8 — Configure Webhook**

**Settings → Webhooks → Add Webhook URL**:
- URL: `https://api.genieinprompt.app/api/v1/qpoints/webhooks/payment`
- Events: `transfer.success`, `transfer.failed`, `transfer.reversed`

Paystack signs webhook payloads with HMAC-SHA512 using the **secret key**
(not a separate webhook secret). Verification:

```typescript
import * as crypto from 'crypto';

const hash = crypto
  .createHmac('sha512', process.env.PAYMENT_FACILITATOR_SECRET_KEY)
  .update(JSON.stringify(req.body))
  .digest('hex');

if (hash !== req.headers['x-paystack-signature']) {
  throw new UnauthorizedException('Invalid Paystack webhook signature');
}
```

Set `PAYMENT_FACILITATOR_WEBHOOK_SECRET` to the same value as
`PAYMENT_FACILITATOR_SECRET_KEY`.

**Step 9 — Nigerian bank codes (CBN codes)**

Required for the `bankCode` field in `POST /qpoints/payment/register`:

| Bank | Code |
|---|---|
| Access Bank | `044` |
| GTBank | `058` |
| First Bank | `011` |
| Zenith Bank | `057` |
| UBA | `033` |
| Sterling Bank | `232` |
| Fidelity Bank | `070` |
| FCMB | `214` |
| Union Bank | `032` |
| Wema Bank | `035` |

For Ghana mobile money (`type: "mobile_money"`):

| Network | Code |
|---|---|
| MTN Mobile Money | `MTN` |
| Vodafone Cash | `VOD` |
| AirtelTigo Money | `ATL` |

**Step 10 — Test the full flow before going live**

```bash
# Create a test recipient
curl -X POST https://api.paystack.co/transferrecipient \
  -H "Authorization: ******" \
  -H "Content-Type: application/json" \
  -d '{"type":"nuban","name":"Test User","account_number":"0690000031","bank_code":"044","currency":"NGN"}'
# → copy recipient_code

# Initiate a test transfer
curl -X POST https://api.paystack.co/transfer \
  -H "Authorization: ******" \
  -H "Content-Type: application/json" \
  -d '{"source":"balance","amount":1000,"recipient":"RCP_xxxxxxxxxx","reason":"Test settlement"}'
# → check "status": true
```

**Step 11 — Environment variables**

| Variable | Value | Code source |
|---|---|---|
| `PAYMENT_FACILITATOR_PROVIDER` | `paystack` | `configuration.ts:payments.facilitatorProvider`; also checked at `PaymentFacilitatorService` init — if `PAYMENT_FACILITATOR_SECRET_KEY` starts with `mock_` or is empty, provider auto-downgrades to `mock` |
| `PAYMENT_FACILITATOR_SECRET_KEY` | `sk_live_xxxxxxxxxx` | `configuration.ts:payments.facilitatorSecretKey` |
| `PAYMENT_FACILITATOR_PUBLIC_KEY` | `pk_live_xxxxxxxxxx` | `configuration.ts:payments.facilitatorPublicKey` |
| `PAYMENT_FACILITATOR_WEBHOOK_SECRET` | *(same value as secret key)* | Webhook HMAC verification |
| `PAYMENT_FACILITATOR_WEBHOOK_URL` | `https://api.genieinprompt.app/api/v1/qpoints/webhooks/payment` | `_flutterwaveTransfer:callback_url` |
| `PAYMENT_FACILITATOR_CURRENCY` | `NGN` | `configuration.ts:payments.facilitatorCurrency` |

**Operational procedures:**

**Daily:**
- Check Paystack balance: **Finance → Balance** — maintain float.
- Check failed transfers: **Transfers → Filter: Failed** → investigate with
  reference (tradeId).

**Transfer failure response:**  
When settlement fails, the app sends `settlement_failed` WebSocket events to
both buyer and seller. Support steps:
1. Paystack Dashboard → **Transfers → search by reference (trade UUID)**.
2. Read failure reason (e.g., invalid account number, network timeout).
3. Retry via dashboard or re-call `POST /transfer` with the same `reference`
   (Paystack deduplicates on reference — safe to retry).

**Key rotation:**  
Dashboard → **Settings → Roll Secret Key** → new key immediately active,
old key immediately invalid → update `PAYMENT_FACILITATOR_SECRET_KEY` and
`PAYMENT_FACILITATOR_WEBHOOK_SECRET` → restart app → run a test transfer.

---

### 3.10 Flutterwave (Alternative Payment Facilitator)

**Difference from Paystack:**  
Flutterwave does NOT use a persistent recipient object. Bank details are
submitted with every transfer call. The `facilitator_accounts` table stores
a `bankCode|accountNumber` composite string as `externalId` for Flutterwave
rows (e.g., `"044|0690000031"`). This composite is split on `|` in
`_flutterwaveTransfer`:

```typescript
account_bank: recipientCode.split('|')[0],    // e.g. "044"
account_number: recipientCode.split('|')[1],  // e.g. "0690000031"
```

Account validation at onboarding calls:
```
POST https://api.flutterwave.com/v3/accounts/resolve
{ account_number, account_bank }
```

**Step 1 — Create account**

1. Go to [https://app.flutterwave.com/register](https://app.flutterwave.com/register).
2. Business name: `PROMPT Genie` (or legal entity name).
3. Country: Nigeria or Ghana.

**Step 2 — Complete KYB**

Dashboard → **Settings → Business Information**:
- Business registration number
- Certificate of Incorporation
- Director ID

**Step 3 — Enable Transfers**

Dashboard → **Products → Transfers → Get Started**. Approval: 2–5 business days.

**Step 4 — Fund Flutterwave Balance**

Same requirement as Paystack: **Payouts → Fund Account** before any payout
can be executed.

**Step 5 — Get Live API Keys**

Dashboard → **Settings → API Keys**:
- **Secret Key** (`FLWSECK_LIVE-xxxxxxxxxx`) → `PAYMENT_FACILITATOR_SECRET_KEY`
- **Public Key** (`FLWPUBK_LIVE-xxxxxxxxxx`) → `PAYMENT_FACILITATOR_PUBLIC_KEY`

**Step 6 — Configure Webhook**

Dashboard → **Settings → Webhooks**:
- URL: `https://api.genieinprompt.app/api/v1/qpoints/webhooks/payment`
- Copy **Secret Hash** → `PAYMENT_FACILITATOR_WEBHOOK_SECRET`
- Events: `transfer.completed`, `transfer.failed`

Flutterwave webhook verification uses a simple header comparison (not HMAC):
```typescript
const hash = req.headers['verif-hash'];
if (hash !== process.env.PAYMENT_FACILITATOR_WEBHOOK_SECRET) {
  throw new UnauthorizedException('Invalid Flutterwave webhook signature');
}
```

**Step 7 — Ghana bank codes for Flutterwave**

| Bank | Code |
|---|---|
| GCB Bank | `GH030100` |
| Ecobank Ghana | `GH230100` |
| Fidelity Bank Ghana | `GH040100` |
| Stanbic Bank Ghana | `GH190100` |

**Step 8 — Environment variables**

| Variable | Value |
|---|---|
| `PAYMENT_FACILITATOR_PROVIDER` | `flutterwave` |
| `PAYMENT_FACILITATOR_SECRET_KEY` | `FLWSECK_LIVE-xxxxxxxxxx` |
| `PAYMENT_FACILITATOR_PUBLIC_KEY` | `FLWPUBK_LIVE-xxxxxxxxxx` |
| `PAYMENT_FACILITATOR_WEBHOOK_SECRET` | *(Flutterwave Secret Hash)* |
| `PAYMENT_FACILITATOR_CURRENCY` | `NGN` or `GHS` |

---

### 3.11 Sentry (Error Tracking)

**What the app uses it for:**  
`SENTRY_DSN` and `SENTRY_ENABLED=true` configure the Sentry SDK. All unhandled
exceptions reach Sentry. Critical paths:
- Every `this.logger.error(...)` call in `SettlementService`,
  `PaymentFacilitatorService`, `WalletsService`, `OrderBookService`.
- SOS alert creation in `rides.service.ts` emits a structured critical log
  tagged for Sentry ingestion.

**Step 1 — Create account**

1. Go to [https://sentry.io/signup/](https://sentry.io/signup/).
2. Organization name: `promptgenie`.
3. Plan: **Developer** (free, 5k errors/month) for pre-launch;
   **Team** ($26/month, 50k errors/month) for production.

**Step 2 — Create a Node.js project**

1. **Projects → Create Project → Node.js**.
2. Name: `promptgenie-backend`.

**Step 3 — Copy DSN**

Settings → **Projects → promptgenie-backend → Client Keys (DSN)**:
- Format: `https://xxxxxxxxxx@o000000.ingest.sentry.io/000000`
- → `SENTRY_DSN`

**Step 4 — PII scrubbing (required for GDPR)**

Settings → **Security & Privacy → Data Scrubbing**:
- Add fields: `phoneNumber`, `password`, `passwordHash`, `authToken`,
  `accessToken`, `refreshToken`, `accountNumber`, `bankCode`, `pin`, `pinHash`
- Enable: **Scrub IP addresses**

**Step 5 — Alert rules**

**Alerts → Create Alert Rule**:
- New issue first seen → email `dev@genieinprompt.app`
- Issue frequency > 10 in 1 hour → Slack (if integrated)
- Priority: any error tagged with `PaymentFacilitatorService`,
  `SettlementService`, or `SOSAlert`

**Step 6 — Environment variables**

| Variable | Value |
|---|---|
| `SENTRY_DSN` | `https://xxxxxxxxxx@o000000.ingest.sentry.io/000000` |
| `SENTRY_ENABLED` | `true` |

---

### 3.12 AI Liquidity Manager (Internal — operational config only)

This is not an external account. The `AiLiquidityManagerService` is the
platform's own market-making bot. It runs on a `@Cron('*/30 * * * * *')`
schedule inside the NestJS process.

**When `AI_MARKET_ENABLED=false` (default):** the bot skips every cron tick.
The Q Points market still exists but has no guaranteed liquidity — users will
get errors if they try to cash in or cash out with no matching orders.

**When `AI_MARKET_ENABLED=true`:** the bot places buy and sell orders from the
AI participant account (`AI_PARTICIPANT_USER_ID`) every 30 seconds, maintaining
a spread of `AI_TARGET_SPREAD_PCT=2.0%` around the $1.00 peg.

**Circuit breaker:** `MAX_ORDERS_PER_MINUTE=20`. If the bot places > 20 orders
in one minute, it opens the circuit breaker and stops placing orders until
the next minute resets. Emergency kill switch:

```
POST /api/v1/qpoints/admin/ai-toggle
{ "enabled": false }
```

**Prerequisites:**

1. User `00000000-0000-0000-0000-000000000001` must exist in `users`.
2. A `qpoint_market_balances` row must exist for that user with a large QP
   balance (the genesis supply of 500 trillion QP — `QPOINTS_TOTAL_SUPPLY`).
3. Run `npm run seed` to create both.

**Environment variables**

| Variable | Default | Meaning |
|---|---|---|
| `AI_MARKET_ENABLED` | `false` | Master toggle |
| `AI_PARTICIPANT_USER_ID` | `00000000-0000-0000-0000-000000000001` | Must match DB seed |
| `AI_TARGET_INVENTORY` | `250000000000000` | Target QP holdings (250T) |
| `AI_MIN_INVENTORY` | `50000000000000` | Floor before buying back |
| `AI_MAX_INVENTORY` | `490000000000000` | Ceiling before selling |
| `AI_TARGET_SPREAD_PCT` | `2.0` | Bid-ask spread percentage |
| `AI_ORDER_BASE_QTY` | `500` | Base order size in QP |
| `AI_MAX_ORDER_QTY` | `2500` | Maximum single order |
| `AI_MAX_OPEN_ORDERS` | `10` | Cancel oldest when exceeded |
| `AI_ORDER_TTL_SECONDS` | `300` | Orders auto-expire after 5 min |
| `AI_RUN_INTERVAL_SECONDS` | `30` | Cron frequency (informational only — cron is hardcoded `*/30 * * * * *`) |
| `AI_MIN_CASH_RESERVE_USD` | `5000` | Bot pauses buying when cash < $5000 |
| `AI_FRAUD_BLOCK_THRESHOLD` | `0.85` | `configuration.ts:ai.fraudBlockThreshold`; also hardcoded in `AIFraudService:BLOCK_THRESHOLD` |
| `AI_FRAUD_REVIEW_THRESHOLD` | `0.55` | `configuration.ts:ai.fraudReviewThreshold`; also hardcoded in `AIFraudService:REVIEW_THRESHOLD` |
| `AI_SURGE_MAX_MULTIPLIER` | `3.5` | Hard cap on ride fare surge; also hardcoded in `AIPricingService` |
| `AI_PLATFORM_FEE_PCT` | `8` | Platform fee % on ride fares; also hardcoded at `0.08` in `AIPricingService` |

---

## 4. Master `.env` Checklist

Ordered by criticality. App behaviour if the variable is missing is noted.

```dotenv
# ── 1. HARD REQUIREMENTS (app fails to start without these) ────────────────

NODE_ENV=production
PORT=3000
API_PREFIX=api
API_VERSION=v1

JWT_SECRET=<openssl rand -hex 64>
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=<openssl rand -hex 64 — DIFFERENT from JWT_SECRET>
JWT_REFRESH_EXPIRES_IN=30d

SESSION_SECRET=<openssl rand -hex 64>

DB_HOST=postgres
DB_PORT=5432
DB_USERNAME=promptgenie_app
DB_PASSWORD=<openssl rand -hex 32>
DB_NAME=promptgenie_prod
DB_SYNCHRONIZE=false
DB_MIGRATIONS_RUN=true
DB_SSL=false
DB_LOGGING=false

REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=<openssl rand -hex 40>
REDIS_DB=0
REDIS_TTL=86400

BCRYPT_ROUNDS=12

# ── 2. USER REGISTRATION BLOCKED without these ─────────────────────────────

# All new users must verify phone via OTP before they can log in.
# auth.service.ts:70-74 throws 400 if user.otpVerified = false.
# sendOtpSms() checks: accountSid.startsWith('AC') && authToken && fromNumber.startsWith('+')
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=<from console.twilio.com>
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX

OTP_EXPIRY_MINUTES=5
PIN_ENCRYPTION_KEY=<openssl rand -hex 16>   # exactly 32 hex chars
PIN_ENCRYPTION_IV=<openssl rand -hex 8>     # exactly 16 hex chars
PIN_ALGORITHM=aes-256-cbc

# ── 3. Q POINTS MARKET CASH-OUT BLOCKED without these ──────────────────────

# PaymentFacilitatorService auto-downgrades to 'mock' if key starts with 'mock_' or is empty.
# Mock mode: no real money is moved; transfers always return succeeded.
PAYMENT_FACILITATOR_PROVIDER=paystack
PAYMENT_FACILITATOR_SECRET_KEY=sk_live_xxxxxxxxxx
PAYMENT_FACILITATOR_PUBLIC_KEY=pk_live_xxxxxxxxxx
PAYMENT_FACILITATOR_WEBHOOK_SECRET=<same value as PAYMENT_FACILITATOR_SECRET_KEY for Paystack>
PAYMENT_FACILITATOR_WEBHOOK_URL=https://api.genieinprompt.app/api/v1/qpoints/webhooks/payment
PAYMENT_FACILITATOR_CURRENCY=NGN

# ── 4. FILE UPLOADS FAIL without these ─────────────────────────────────────

# file.service.ts falls back to: region='us-east-1', key='test', secret='test', bucket='promptgenie-files'
# Those fallbacks will fail in real AWS environments.
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAxxxxxxxxxx
AWS_SECRET_ACCESS_KEY=<secret key from IAM>
AWS_S3_BUCKET=promptgenie-uploads-prod
BACKUP_S3_BUCKET=promptgenie-backups
BACKUP_ENABLED=true
BACKUP_ENCRYPTION=true
BACKUP_RETENTION_DAYS=30

# ── 5. EMAILS QUEUE WITHOUT DELIVERY without these ─────────────────────────

SENDGRID_API_KEY=SG.xxxxxxxxxx
EMAIL_FROM=noreply@genieinprompt.app
EMAIL_FROM_NAME=PROMPT Genie
EMAIL_SUPPORT=support@genieinprompt.app
EMAIL_WELCOME_TEMPLATE_ID=d-xxxxxxxx
EMAIL_FORGOT_PASSWORD_TEMPLATE_ID=d-xxxxxxxx
EMAIL_ORDER_CONFIRMATION_TEMPLATE_ID=d-xxxxxxxx
PROCESS_EMAILS=true

# ── 6. AI FEATURES DEGRADE without this ────────────────────────────────────

AI_API_KEY=sk-proj-xxxxxxxxxx
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
AI_ENABLED=true
AI_MAX_TOKENS=2048
AI_TEMPERATURE=0.7
AI_TOP_P=0.9
AI_REQUEST_TIMEOUT=30000
TENSORFLOW_ENABLED=false
ML_MODEL_PATH=./ml-models
FEATURE_STORE_UPDATE_INTERVAL=300000

# ── 7. RIDE FEATURES INCOMPLETE without this ───────────────────────────────

GOOGLE_MAPS_API_KEY=AIzaxxxxxxxx
GOOGLE_MAPS_ENABLED=false   # → true when ride-hailing goes live
MAX_RIDE_SEARCH_RADIUS_KM=50

# ── 8. Q POINTS MARKET ILLIQUID without this ───────────────────────────────
# Requires DB seed: npm run seed (creates AI participant user)
AI_MARKET_ENABLED=false     # → true when market is live
AI_PARTICIPANT_USER_ID=00000000-0000-0000-0000-000000000001
AI_TARGET_INVENTORY=250000000000000
AI_MIN_INVENTORY=50000000000000
AI_MAX_INVENTORY=490000000000000
AI_TARGET_SPREAD_PCT=2.0
AI_ORDER_BASE_QTY=500
AI_MAX_ORDER_QTY=2500
AI_MAX_OPEN_ORDERS=10
AI_ORDER_TTL_SECONDS=300
AI_RUN_INTERVAL_SECONDS=30
AI_MIN_CASH_RESERVE_USD=5000
AI_FRAUD_BLOCK_THRESHOLD=0.85
AI_FRAUD_REVIEW_THRESHOLD=0.55
AI_SURGE_MAX_MULTIPLIER=3.5
AI_PLATFORM_FEE_PCT=8

# ── 9. ERROR TRACKING ───────────────────────────────────────────────────────

SENTRY_DSN=https://xxxxxxxxxx@o000000.ingest.sentry.io/000000
SENTRY_ENABLED=true

# ── 10. PLATFORM ────────────────────────────────────────────────────────────

CORS_ORIGIN=https://genieinprompt.app
CORS_CREDENTIALS=true
THROTTLE_TTL=60
THROTTLE_LIMIT=100
LOG_LEVEL=info
LOG_FILE_PATH=./logs

# Bull queue processors
PROCESS_SMS=true
PROCESS_REPORTS=true
PROCESS_CLEANUP=true
PROCESS_SYNC=true

# Health check
HEALTH_CHECK_TIMEOUT=30000
METRICS_ENABLED=false
```

---

## 5. Startup Order

The following must be completed in order before the first request is served:

```
1. Start PostgreSQL              (DB_HOST, DB_PORT, DB_PASSWORD, DB_NAME)
2. Start Redis                   (REDIS_HOST, REDIS_PORT, REDIS_PASSWORD)
3. npm run migration:run:prod    (creates all tables including facilitator_accounts,
                                  qpoint_market_balances, subscription_plans, etc.)
4. npm run seed                  (creates AI participant user 00000000-0000-0000-0000-000000000001
                                  and seeds subscription plan tiers:
                                  Free / Basic / Professional / Enterprise)
5. Start NestJS app              (NODE_ENV=production)
6. Verify health endpoint:       GET /api/v1/health → { status: "ok" }
7. (optional) Enable AI market:  set AI_MARKET_ENABLED=true, restart app
                                  → AiLiquidityManagerService begins market-making
```

**If step 4 is skipped:**
- `AiLiquidityManagerService` fails silently on every cron tick (missing
  balance row for AI participant).
- `SubscriptionsService.activateSubscription` throws `NotFoundException('Subscription plan not found')`
  until plans are seeded.
- Cash-in/cash-out with no open orders returns
  `BadRequestException('No matching sell/buy order found')`.

---

## 6. 90-Day Rotation Calendar

| Timing | Secret | Impact | Procedure |
|---|---|---|---|
| Day 0 | `JWT_SECRET` | All access tokens invalidated — users get `401` on next request, must log in | Update env → rolling restart |
| Day 0 | `JWT_REFRESH_SECRET` | All refresh tokens invalidated — users must log in from scratch | Update env → rolling restart |
| Day 0 | `SESSION_SECRET` | All HTTP sessions cleared | Update env → rolling restart |
| Day 30 | `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | File uploads fail during transition window | Create new key → deploy → 24h → deactivate old → delete old |
| Day 60 | `SENDGRID_API_KEY` | Emails queue but fail to deliver during transition | Create new restricted key → deploy → delete old |
| Day 60 | `AI_API_KEY` | AI features return 401 until updated | Create new key → deploy → delete old |
| Day 90 | `DB_PASSWORD` | No new DB connections during restart | `ALTER USER promptgenie_app PASSWORD 'new'` → update env → rolling restart |
| Day 90 | `REDIS_PASSWORD` | Queue processing pauses | Update `requirepass` in redis.conf → restart Redis → update env → restart app |
| Day 90 | `TWILIO_AUTH_TOKEN` | SMS OTP not sent during transition | Console → Rotate Auth Token → update env → restart app |
| Day 90 | `PAYMENT_FACILITATOR_SECRET_KEY` + `PAYMENT_FACILITATOR_WEBHOOK_SECRET` | All settlements fail during transition; webhook verification fails | Paystack → Roll Secret Key → update both env vars simultaneously → restart app → verify test transfer |
| Annually | `PIN_ENCRYPTION_KEY` + `PIN_ENCRYPTION_IV` | **Corrupts all existing staff PINs** | Write decrypt-re-encrypt migration script → run migration → update env → restart |
| **Never** | `PIN_ENCRYPTION_KEY` without migration | Staff cannot log in | Do not rotate without executing the migration first |
