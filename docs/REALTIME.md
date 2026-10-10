# FADA — Real-time (WebSocket) Contract

Socket.IO 4, same host and port as the HTTP API, default namespace `/`.

## Connecting

Send the **access token** (the same JWT used for HTTP) in the handshake:

```js
const socket = io(API_BASE_URL, { auth: { token: accessToken }, transports: ['websocket'] });
socket.on('ready', ({ userId, rooms }) => { /* connected and authenticated */ });
socket.on('connect_error', (err) => { /* err.message: missing_token | invalid_token | account_inactive */ });
```

`Authorization: Bearer <token>` or `?token=` also work. Guests cannot connect. When the access token is
refreshed, reconnect with the new one.

## Rooms

Joined automatically on connect:

| Room | Who |
|---|---|
| `user:{userId}` | everyone (notifications, support replies) |
| `customer:{userId}:reservations` | customers |
| `admin:feed` | admins |

Join on demand with an acknowledgement:

```js
socket.emit('subscribe', { room: `pharmacy:${pharmacyId}:reservations` }, (ack) => {
  // { ok: true, room } or { ok: false, error: 'forbidden' | 'unknown_room' | 'rate_limited' | 'too_many_rooms' | 'check_failed' }
});
socket.emit('unsubscribe', { room });
```

| Room | Allowed |
|---|---|
| `reservation:{reservationId}` | its customer; that pharmacy's team (branch staff: their branch only) |
| `pharmacy:{pharmacyId}:reservations` | owner, operators, staff not tied to one branch |
| `branch:{branchId}:reservations` | anyone who can see that branch |
| `pharmacy:{pharmacyId}:billing` | owner and operators |
| `batch-upload:{jobId}` | anyone who can see the upload's branch |

Limits: 50 rooms per connection, 60 subscribe calls per minute. Rooms must be re-joined after a reconnect.

## Events (server → client)

Payloads are small; refetch details over HTTP when needed. A socket in several matching rooms receives
each event once.

| Event | Rooms | Payload |
|---|---|---|
| `reservation.created` | pharmacy, branch, customer | `reservationId, code, status, pharmacyId, branchId, itemCount, expiresAt, createdAt` |
| `reservation.updated` | reservation, customer, pharmacy, branch | `reservationId, code, status, previousStatus, reason, pharmacyId, branchId, changedAt` |
| `batch-upload.progress` | batch-upload | `jobId, branchId, status, processed, total, added, errors, percent, message, done` |
| `subscription.updated` | pharmacy billing | `pharmacyId, type (activated, payment_successful, payment_failed, renewed, cancelled, plan_changed, expired), planName, …, at` |
| `ad-payment.updated` | pharmacy billing | `campaignId, reference, amountKobo, paidAt, status` |
| `notification` | user | `id, title, body, category, data, createdAt, unreadCount` |
| `support.ticket.updated` | user | `ticketId, ticketNumber, status, hasNewReply, at` |
| `admin.activity` | admin feed | `type (reservation.created, support.ticket.created, support.ticket.user_replied), …` |

## Scaling

Rooms are shared across server instances through Redis (`@socket.io/redis-adapter`, using `REDIS_URL`).
If Redis is unreachable at boot the server logs a warning and falls back to in-memory rooms, which only
work with a single instance. Browser origins are restricted by `ALLOWED_ORIGINS` (HTTP and WebSocket).
