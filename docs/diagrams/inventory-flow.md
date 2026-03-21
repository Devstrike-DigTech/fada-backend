# FADA — Inventory Flow Diagrams

---

## Add Single Drug (NAFDAC-First)

```mermaid
flowchart TD
    FAB[Pharmacist taps + FAB] --> MODAL[NAFDAC Number Modal appears]
    MODAL --> ENTER[Enter NAFDAC No.\ne.g. 454BH-UY] --> LOOKUP

    LOOKUP[GET /inventory/nafdac/:number] --> CACHE{In NAFDAC\ncache?}

    CACHE -- Yes --> AUTOFILL[Auto-fill:\nDrug name, manufacturer,\ncomposition, category]
    CACHE -- No --> MANUAL[Manual entry\nnafdac_verified = false]

    AUTOFILL --> FORM[Show Add Drug form\npre-populated]
    MANUAL --> FORM

    FORM --> SECTIONS[Three accordion sections:\n1. Drug Information\n2. Usage Information\n3. Inventory Information]

    SECTIONS --> SUBMIT[Tap Save]
    SUBMIT --> SLOTCHECK{Slots\navailable?}

    SLOTCHECK -- No --> UPGRADE[Show: Upgrade subscription\nto add more drugs]
    SLOTCHECK -- Yes --> VALIDATE[Validate all fields]

    VALIDATE --> IMAGES[Upload drug images\nto Cloudinary]
    IMAGES --> SAVE[POST /inventory/:branchId/drugs]
    SAVE --> DB[(Save to DB\nCompute stock_status\nUpdate search_vector)]

    DB --> EMIT[Emit: inventory.drug.added]
    EMIT --> SEARCH[SearchModule:\nIndex new drug]
    EMIT --> POINTS[PointsModule:\nPharmacy +5 points]

    DB --> SUCCESS[Navigate to drug detail page]
```

---

## Batch Upload Flow

```mermaid
sequenceDiagram
    participant PA as Pharmacy App
    participant API as FADA API
    participant R2 as Cloudflare R2
    participant BQ as BullMQ
    participant Worker as Upload Worker
    participant DB as PostgreSQL
    participant WS as WebSocket

    PA->>API: GET /inventory/batch-upload/template
    API-->>PA: Download CSV template\n(with FADA column headers)

    Note over PA: Pharmacist fills template\nwith drug data

    PA->>API: POST /inventory/:branchId/drugs/batch-upload\n(multipart: file.csv)
    API->>R2: Upload file to R2
    R2-->>API: file_url
    API->>DB: Create BatchUploadJob {status: queued}
    API->>BQ: Dispatch batch-upload job {jobId, fileUrl, branchId}
    API-->>PA: 202 Accepted\n{jobId}

    PA->>WS: Subscribe to room: batch-upload:{jobId}

    BQ->>Worker: Process job
    Worker->>R2: Download file
    R2-->>Worker: File contents

    loop For each row
        Worker->>Worker: Parse + validate row
        Worker->>DB: Check NAFDAC cache
        Worker->>Worker: Map to Drug schema
        Worker->>DB: Insert valid row (check slot limit)
        Worker->>WS: Emit progress {processed, total, errors}
    end

    Worker->>DB: Update BatchUploadJob\n{status: completed, added, errorRows}
    Worker->>BQ: Queue notification job

    WS-->>PA: Final progress update
    BQ-->>PA: Push notification:\n"Upload complete: 45 added, 3 errors"
```

---

## Stock Management

```mermaid
stateDiagram-v2
    [*] --> in_stock: Drug added\nstock_amount > threshold

    in_stock --> low_stock: stock_amount <= low_stock_threshold\n(default: 5)
    low_stock --> in_stock: Stock replenished

    low_stock --> out_of_stock: stock_amount = 0
    in_stock --> out_of_stock: stock_amount drops to 0\n(direct)

    out_of_stock --> in_stock: Stock replenished > threshold

    note right of low_stock
        Event: inventory.stock.low
        → Notify pharmacist
    end note

    note right of out_of_stock
        Event: inventory.stock.out
        → Notify pharmacist
        → Auto-cancel pending reservations
        → Update search index
    end note
```

---

## Inventory Overview Screen Data

```mermaid
flowchart LR
    subgraph Screen [Inventory Screen]
        HEADER[1230 of 2250 slots used\nProgress bar]
        LAST[Last Updated Drug card:\nDate, Name, Type, Price]
        CATS[Category Grid:\nOral Drugs 10\nInfusion Drugs 9\nInjectable Drugs 14\nAntiseptics 21\nOthers 14]
    end

    subgraph API_Calls [API Calls]
        A1[GET /inventory/:branchId/summary\n→ {used, total, lastDrug}]
        A2[GET /inventory/categories\nwith item counts per branch]
    end

    Screen --> API_Calls
```
