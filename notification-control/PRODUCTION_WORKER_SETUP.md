# WTS Notification Worker — Production Setup

The worker is implemented at `/api/notification-worker` but must remain inactive until the school completes the production gate.

## Required server environment variables

Set these only in the server/Vercel environment. Never place their values in browser JavaScript, GitHub files, QR codes or mobile applications.

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | WTS Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase service role |
| `WTS_NOTIFICATION_WORKER_SECRET` | Bearer secret used to call the worker |
| `WTS_WHATSAPP_GATEWAY_ENDPOINT` | HTTPS provider send-message endpoint |
| `WTS_WHATSAPP_GATEWAY_TOKEN` | Provider API token or key |
| `WTS_WHATSAPP_ALLOWED_HOSTS` | Comma-separated host allow-list, for example `api.provider.example` |

The database provider record uses the prefix `WTS_WHATSAPP_GATEWAY`, so the worker resolves the endpoint and credential from the matching environment variables.

## Activation sequence

1. Obtain a dedicated school WhatsApp number.
2. Complete the parent-contact and explicit-consent pilot.
3. Confirm the provider supports HTTPS API delivery, stable message references and delivery-error reporting.
4. Add the server environment variables.
5. Keep Notification Control in protected mode and run mock delivery first.
6. Validate the authenticated worker health endpoint.
7. Configure the external provider endpoint in Notification Control. Saving it does not activate delivery.
8. Submit the production-activation request in the Readiness workspace.
9. Review contact consent, template approval, provider credentials, endpoint allow-list and retry settings.
10. Activate the external provider and live delivery through a controlled server/database release—not through browser controls.

## Worker request

The worker accepts an authenticated `POST` request:

```http
POST /api/notification-worker
Authorization: Bearer <WTS_NOTIFICATION_WORKER_SECRET>
Content-Type: application/json

{
  "limit": 25,
  "providerCode": "external_whatsapp_gateway"
}
```

An authenticated `GET` request returns a health response. It does not expose credentials.

## Safety behavior

- Missing server environment: HTTP 503.
- Invalid worker secret: HTTP 401.
- Non-HTTPS provider endpoint: rejected.
- Provider host absent from `WTS_WHATSAPP_ALLOWED_HOSTS`: rejected.
- Missing provider token: rejected.
- Consent-ineligible guardian message: not claimed.
- Duplicate workers: protected through database row locking.
- Temporary provider failure: queued for retry until maximum attempts.
- Provider response snapshots: sensitive fields redacted.
- Destinations returned by the worker: masked.

## Current protected state

- Live delivery is disabled.
- Dry-run mode is enabled.
- Mock WhatsApp is the selected provider.
- Automatic queueing is disabled.
- Explicit guardian consent is mandatory.
- Result notifications are disabled.
