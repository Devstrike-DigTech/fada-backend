# FADA — Search & Discovery Flow Diagrams

---

## Drug Search with Geo-Fence Expansion

```mermaid
flowchart TD
    REQUEST[GET /search/drugs\n?q=panadol&lat=6.5&lng=3.3] --> GUEST_CHECK

    GUEST_CHECK{Is guest user?}
    GUEST_CHECK -- Yes --> RATE_CHECK
    GUEST_CHECK -- No --> SEARCH

    RATE_CHECK[Redis: Check\nguest:deviceId:searches:date] --> LIMIT_CHECK

    LIMIT_CHECK{Count >= 3?}
    LIMIT_CHECK -- Yes --> BLOCKED[429 Too Many Requests\n'Login to search more']
    LIMIT_CHECK -- No --> INCREMENT

    INCREMENT[Increment guest search counter\nTTL: end of day] --> SEARCH

    SEARCH[Start geo-fenced FTS search] --> R2KM

    R2KM[Try radius = 2km\nPostGIS + tsvector query] --> CHK2

    CHK2{Results found?}
    CHK2 -- Yes --> RETURN
    CHK2 -- No --> R5KM

    R5KM[Expand to 5km] --> CHK5
    CHK5{Results found?}
    CHK5 -- Yes --> RETURN
    CHK5 -- No --> R10KM

    R10KM[Expand to 10km] --> CHK10
    CHK10{Results found?}
    CHK10 -- Yes --> RETURN
    CHK10 -- No --> R20KM

    R20KM[Expand to 20km] --> CHK20
    CHK20{Results found?}
    CHK20 -- Yes --> RETURN
    CHK20 -- No --> R50KM

    R50KM[Expand to 50km] --> CHK50
    CHK50{Results found?}
    CHK50 -- Yes --> RETURN
    CHK50 -- No --> EMPTY[Return empty\nwith suggestion to\ncheck spelling or\nexpand location]

    RETURN[Return results\nwith metadata:\n{results, radiusUsed, total}] --> LOG

    LOG[Log to CustomerSearchHistory\nEmit: search.query.recorded] --> DONE[Response to client]
```

---

## Search Result Types

```mermaid
flowchart LR
    QUERY[Search Query] --> TABS

    TABS{Filter Tab Selected}

    TABS -- Drugs --> DRUG_SEARCH
    TABS -- Ailments --> AIM_SEARCH
    TABS -- Pharmacies --> PHM_SEARCH

    DRUG_SEARCH[FTS on drug name,\ngeneric name, alias,\nmanufacturer, composition\n+ geo-filter] --> DRUG_RESULT[Results:\nDrug name\nPharmacy address\nDistance KM\nPrice\nStock count]

    AIM_SEARCH[Match query to\nAilmentTag names\n→ get drug_ids via\nDrugAilmentTag junction\n+ geo-filter] --> AIM_RESULT[Results:\nDrugs treating\nthe ailment\nat nearby pharmacies]

    PHM_SEARCH[FTS on pharmacy name\n+ geo-filter] --> PHM_RESULT[Results:\nPharmacy name\nAddress\nDistance KM\nLVL badge\nYears active]

    PHM_RESULT --> PHM_CLICK{User clicks pharmacy}
    PHM_CLICK --> PHM_PROFILE[Pharmacy Profile:\nPhotos, hours, contact]
    PHM_CLICK --> SEARCH_IN[Search in Pharmacy:\nScoped inventory search\n/search/pharmacies/:id/drugs]
```

---

## Drug Information Page (Customer)

```mermaid
sequenceDiagram
    participant CA as Customer App
    participant API as FADA API
    participant DB as PostgreSQL

    CA->>API: GET /search/drugs/:drugId
    API->>DB: SELECT drug + branch + pharmacy +\nindicaitons + contraindications +\nalternatives + ailment tags + images
    DB-->>API: Full drug profile

    API-->>CA: Drug Information:\n- Name, Generic name, Price, Package\n- Pharmacy: name, phone, email, address\n- Ailment(s)\n- Dosage (adult + children)\n- Drug type\n- Alternatives (clickable links)\n- Manufacturer\n- Alias name\n- Category\n- Contraindications\n- NAFDAC No\n- Images carousel

    Note over CA: Customer can:\n+ Bookmark drug\n+ Add to list (+)\n+ Reserve Drug\n+ View alternatives
```

---

## Reserve from Search (with Guest Prompt)

```mermaid
stateDiagram-v2
    [*] --> DrugInfo: View drug page

    DrugInfo --> GuestCheck: Tap "Reserve Drug"

    state GuestCheck <<choice>>
    GuestCheck --> ShowQuantity: Is logged-in user
    GuestCheck --> CheckGuestLimit: Is guest

    state CheckGuestLimit <<choice>>
    CheckGuestLimit --> ShowQuantity: 0 reservations today
    CheckGuestLimit --> ShowLoginPrompt: Already made 1 reservation

    ShowLoginPrompt --> ShowQuantity: User taps Login\n(optional flow)
    ShowLoginPrompt --> [*]: User dismisses

    ShowQuantity --> ConfirmReservation: Adjust quantity\nTap "Reserve drug"
    ConfirmReservation --> ReservationDetail: 201 Created\nShow QR code + code
    ReservationDetail --> [*]
```
