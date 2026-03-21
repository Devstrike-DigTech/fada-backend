# FADA — Reservation Flow Diagrams

---

## Customer Makes a Reservation

```mermaid
sequenceDiagram
    participant CA as Customer App
    participant API as FADA API
    participant DB as PostgreSQL
    participant R2 as Cloudflare R2
    participant Redis as Redis
    participant BQ as BullMQ
    participant FCM as Firebase FCM

    CA->>API: GET /search/drugs?q=panadol&lat=6.5&lng=3.3
    API->>DB: Geo + FTS query (radius expansion)
    DB-->>API: [drug results with distances]
    API->>Redis: Log search (guest rate limit check)
    API-->>CA: Search results

    CA->>API: GET /search/drugs/:drugId
    API->>DB: Full drug profile + pharmacy info
    API-->>CA: Drug detail page data

    CA->>API: POST /reservations\n{drugId, branchId, quantity}

    Note over API: Guest check
    API->>Redis: Check guest reservation limit
    Redis-->>API: 0 today (allowed)

    API->>DB: Create Reservation (status: pending)
    API->>DB: Create ReservationItem(s)
    API->>API: Generate code: RSV + nanoid(7)
    API->>API: Generate QR code (PNG buffer)
    API->>R2: Upload QR code PNG
    R2-->>API: qr_code_url
    API->>DB: Update reservation with code + QR URL
    API->>Redis: Increment guest:deviceId:reservations:date
    API->>BQ: Schedule expiry check job

    Note over API: Emit: reservation.created
    API->>BQ: Queue notification job
    BQ->>FCM: Push to pharmacist: "New reservation"

    API-->>CA: 201 Created\n{reservationId, code: "RSVAB1234", qrCodeUrl, expiresAt}
```

---

## Pharmacist Verifies & Serves Reservation

```mermaid
sequenceDiagram
    participant PA as Pharmacy App
    participant API as FADA API
    participant DB as PostgreSQL
    participant BQ as BullMQ
    participant FCM as Firebase FCM

    PA->>API: POST /reservations/verify\n{code: "RSVAB1234"}
    API->>DB: Find reservation by alphanumeric_code
    DB-->>API: Reservation + items + customer info
    API-->>PA: Popup data:\n{drugName, genericName, quantity,\ntotal, pricePerItem, customerName,\ncustomerPhone}

    Note over PA: Pharmacist sees popup\nwith Call button + Serve Drug

    PA->>API: PUT /reservations/:id/serve\n{servedBy: pharmacistId}
    API->>DB: Update status → served
    API->>DB: Update served_by, served_at
    API->>DB: Create ReservationStatusHistory entry

    Note over API: Emit: reservation.picked_up

    API->>BQ: Queue: award customer +10 points
    API->>BQ: Queue: award pharmacy +20 points
    API->>BQ: Queue: push notification to customer
    BQ->>FCM: "Your reservation was served ✅"

    API-->>PA: 200 OK → Show SUCCESS modal
```

---

## Reservation Expiry (Cron Job)

```mermaid
flowchart TD
    CRON[BullMQ Cron\nEvery 15 minutes] --> QUERY

    QUERY[Query DB:\nstatus='pending'\nAND expires_at < NOW] --> CHECK

    CHECK{Any expired\nreservations?}
    CHECK -- No --> END[Sleep until next run]
    CHECK -- Yes --> LOOP

    LOOP[For each expired reservation] --> UPDATE
    UPDATE[Update status → expired\nCreate status history] --> EMIT

    EMIT[Emit: reservation.expired] --> NOTIFY
    EMIT --> STOCK

    NOTIFY[Notification Module:\nPush to customer\n'Your reservation expired'] --> NEXT

    STOCK[Inventory Module:\nRestore stock amount\nRecompute stock_status] --> NEXT

    NEXT{More expired\nreservations?}
    NEXT -- Yes --> LOOP
    NEXT -- No --> END
```

---

## Batch Reservation (From Saved List)

```mermaid
sequenceDiagram
    participant CA as Customer App
    participant API as FADA API
    participant DB as PostgreSQL
    participant R2 as Cloudflare R2

    CA->>API: GET /saves/lists/:id
    API->>DB: Fetch list + items + drug details
    API-->>CA: List with drugs, prices, stock status

    CA->>API: POST /reservations/from-list\n{listId, branchId}
    API->>DB: Check all drugs available at branch
    API->>DB: Create single Reservation
    API->>DB: Create ReservationItem for each list drug
    API->>API: Generate one shared RSV code + QR
    API->>R2: Upload QR code
    API-->>CA: 201 Created\n{reservationId, code, qrCodeUrl,\nitemCount, total, expiresAt}
```

---

## Auto-Cancel on Stock Out

```mermaid
flowchart LR
    UPDATE[Inventory Update:\nstock_amount = 0] --> EMIT1

    EMIT1[Emit: inventory.stock.out\ndrug: Panadol Xtra] --> RES_LISTENER

    RES_LISTENER[ReservationModule Listener:\nFind PENDING reservations\nfor this drug] --> CANCEL_EACH

    CANCEL_EACH[Cancel each reservation\nstatus → cancelled\ncancelled_by = SYSTEM] --> EMIT2

    EMIT2[Emit: reservation.cancelled\nfor each] --> NOT_LISTENER

    NOT_LISTENER[NotificationsModule:\nPush to each affected customer\n'Reservation cancelled —\ndrug unavailable'] --> DONE[Done]
```
