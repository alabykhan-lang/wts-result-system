# WhatsApp Gateway Evaluation

Checked for the attendance platform in July 2026.

## Objective

Use WhatsApp as the primary parent-notification channel while controlling cost, delivery reliability, privacy and account-blocking risk.

## Provider classes

### 1. Official WhatsApp Business Platform

Best for long-term production use.

Advantages:

- official business identity;
- approved utility templates;
- delivery status and webhooks;
- reduced risk of account suspension when policies are followed;
- suitable for attendance and future report-card notifications.

Limitations:

- message charges may apply;
- business verification and template approval are required;
- configuration is more involved.

### 2. Low-cost external WhatsApp gateway

Examples include providers that link an ordinary WhatsApp number and expose an HTTP API.

Advantages:

- low monthly subscription;
- simple API integration;
- may allow text, files, replies and webhooks;
- useful for controlled pilot testing.

Risks:

- may rely on WhatsApp Web sessions rather than an official business platform;
- the linked number may be logged out or restricted;
- provider availability and support may be limited;
- no guarantee of long-term compatibility;
- sending too quickly or without consent can trigger restrictions.

Policy:

- use a dedicated school notification number, never the main management number;
- keep the provider disabled until a controlled pilot passes;
- never send to contacts without recorded opt-in;
- cap daily messages during pilot;
- retain delivery attempts and failures;
- keep SMS or manual contact as emergency fallback;
- do not send sensitive report-card files through an unprotected public link.

### 3. Free personal-use API

Not approved for school production.

Some free services explicitly limit use to personal messaging or sending to the account owner. They are unsuitable for automated parent communication.

## Current attendance implementation

The notification service supports:

- mock WhatsApp testing;
- manual delivery;
- generic external HTTPS JSON gateways;
- provider credentials stored only in Edge Function environment secrets;
- delivery queue locking;
- retries and stale-lock recovery;
- provider response history;
- WhatsApp consent enforcement;
- normalized Nigerian `+234` numbers.

The generic external gateway is currently disabled.

## Recommended pilot

1. Create a dedicated school WhatsApp Business number.
2. Collect guardian opt-in for one class.
3. Use the mock provider first.
4. Evaluate one low-cost gateway with 10–20 guardians.
5. Send only check-in and checkout notices for one week.
6. Review delivery success, account stability and parent feedback.
7. Expand to lateness and absence only after the pilot succeeds.
8. Move to the official WhatsApp Business Platform if reliability or compliance becomes a concern.

## Result notification extension

The future result system should use the same shared notification service, but it should send only a secure, expiring report-card link. Report cards must not be exposed as permanent public PDF URLs.
