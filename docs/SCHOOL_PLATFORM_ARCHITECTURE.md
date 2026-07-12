# Way to Success School Platform Architecture

## Decision

The school platform will be built as separate applications that share a controlled school data platform.

The result system, attendance system, examination system, school website and future portals must not be deployed as one tightly coupled application.

## Application boundaries

Each application owns its interface, deployment, permissions and operational tables.

- Public website
- Identity and portal gateway
- Result management
- Attendance management
- Examination and assessment
- Staff self-service
- Student and parent portal
- Notification service

## Repository and deployment model

Preferred production structure:

- one GitHub repository per major application;
- one Vercel project per web application;
- one Android repository or module for scanner applications;
- separate preview, staging and production deployments;
- independent rollback for every application.

The current attendance dashboard remains in the result-system development repository only as a temporary incubation environment. It must be extracted before production launch.

## Domain model

Recommended structure after the school domain is acquired:

- `www.school-domain` — public school website
- `portal.school-domain` — central login and application launcher
- `attendance.school-domain` — attendance administration
- `results.school-domain` — result management
- `exams.school-domain` — examination and assessment
- `staff.school-domain` — staff self-service
- `parents.school-domain` — parent portal
- `api.school-domain` — controlled platform APIs where required

The public website may display all services in one place, but each service remains technically independent.

## Shared database boundaries

The applications may initially share one Supabase PostgreSQL project, but they must not share unrestricted table access.

### Shared core data

A future `core` ownership layer should contain only canonical school records:

- students;
- staff;
- guardians;
- academic sessions and terms;
- classes and arms;
- subjects;
- school calendar;
- user identities and role assignments.

### Application-owned data

- attendance tables are owned by the attendance service;
- result tables are owned by the result service;
- examination tables are owned by the examination service;
- notification tables are owned by the notification service.

Applications should consume shared records through controlled functions, views or service APIs. One application must not directly rewrite another application's operational data.

## Authentication

The final platform should use one central identity system with role-based access:

- super administrator;
- school management;
- result officer;
- attendance officer;
- attendance reviewer;
- teacher;
- staff member;
- student;
- parent or guardian.

A user signs in once through the portal and receives access only to authorized applications.

## WhatsApp-first notification strategy

WhatsApp is the preferred parent communication channel.

Planned notifications include:

- student check-in;
- lateness;
- absence;
- student checkout;
- attendance correction;
- emergency notices;
- future result publication and report-card link.

Production notification requirements:

- verified WhatsApp Business account;
- approved utility templates;
- guardian consent and opt-in records;
- normalized international phone numbers;
- delivery status webhooks;
- opt-out handling;
- retry and failure logs;
- no report card or sensitive data sent as plain message content;
- secure expiring links for report cards and other private documents.

SMS remains an optional fallback for guardians who cannot receive WhatsApp messages.

## Current transition plan

1. Continue stabilizing attendance in the current development branch.
2. Remove direct dependency on result-dashboard configuration files.
3. Package the attendance frontend as a standalone deployable application.
4. Extract attendance into a dedicated GitHub repository and Vercel project.
5. Keep the existing Supabase project temporarily, with attendance isolated by RLS and service functions.
6. Introduce central identity and shared core records before building the comprehensive public portal.
7. Connect a verified WhatsApp Business provider only after templates, opt-in and privacy controls are approved.

## Non-negotiable rules

- no service-role key in browser, APK or terminal firmware;
- no cross-application unrestricted write access;
- no production notification without guardian consent;
- no result document sent as an unprotected public file;
- no attendance production activation before the final roster and session dates are confirmed;
- every correction and manual entry remains auditable.
