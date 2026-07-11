# WTS Standalone Attendance Terminal Gateway

This service connects a fixed QR, NFC or RFID terminal to the same secured attendance backend used by the Android scanner.

It is designed for a school gate installation where students and staff present a credential and attendance is submitted without using a teacher's personal phone.

## Supported operating patterns

- Fixed Wi-Fi or Ethernet gate terminal
- Android box or small Linux computer connected to a card reader
- Reader controller that sends an HTTP event to the local gateway
- Development simulator before physical hardware is purchased
- Check-in terminal and checkout terminal as separate devices

## Security model

The gateway never contains a Supabase service-role key.

It uses:

- a dedicated attendance device code and one-time device secret;
- a permanent installation identifier;
- a local reader key so other devices on the school network cannot submit fake taps;
- optional registered gate coordinates;
- an encrypted AES-256-GCM offline queue;
- server-generated attendance timestamps and idempotent event IDs.

Production terminals should be registered through **Authorized Device Security** as school-owned hardware with `standalone_terminal` deployment mode.

## Required environment variables

```text
WTS_DEVICE_CODE
WTS_DEVICE_SECRET
WTS_INSTALLATION_ID
WTS_READER_KEY
WTS_QUEUE_KEY
```

`WTS_READER_KEY` and `WTS_QUEUE_KEY` must each contain at least 16 characters and must be different values.

Optional settings:

```text
WTS_API_URL
WTS_QUEUE_PATH
WTS_DEFAULT_MODE=check_in
WTS_GATE_LATITUDE
WTS_GATE_LONGITUDE
WTS_GATE_ACCURACY_METRES=10
WTS_SYNC_INTERVAL_MS=60000
WTS_TERMINAL_PORT=8787
```

## Start the gateway

```bash
cd terminal-gateway
npm run check
npm start
```

## Local reader protocol

Every local reader request must include:

```text
x-wts-reader-key: configured-local-reader-key
```

### Health check

```http
GET /health
```

### Submit a tap

```http
POST /tap
Content-Type: application/json

{
  "credential": "opaque-card-token",
  "eventType": "check_in"
}
```

For a dedicated checkout terminal, configure `WTS_DEFAULT_MODE=check_out` or send `eventType: check_out`.

### Non-recording diagnostic

```http
POST /diagnostic
Content-Type: application/json

{
  "credential": "opaque-card-token"
}
```

Diagnostics work only when the registered attendance device is marked as a development device. They confirm identity, reader configuration and device security without creating attendance.

### Retry the encrypted offline queue

```http
POST /sync
```

The gateway also retries automatically according to `WTS_SYNC_INTERVAL_MS`.

## Offline behaviour

Only transport failures and server-side failures are queued. Invalid credentials, revoked devices and policy rejections are not repeatedly queued.

Queued scans retain their original `clientEventId`, allowing the backend to reject duplicates safely after internet service returns.

## Hardware integration boundary

A physical reader needs only to extract the opaque credential and send it to `/tap`. Hardware-specific adapters for Wiegand, RS-485, serial, USB HID or vendor webhooks can be added without changing the attendance database.

Do not store student names, classes or admission numbers on the card or reader. The card should carry only the opaque attendance credential.
