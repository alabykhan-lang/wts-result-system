# Standalone Attendance Deployment

The attendance application can now be deployed independently from the result portal while continuing to use the same controlled Supabase project.

## Immediate Vercel deployment

Create a new Vercel project from the current GitHub repository and set:

- **Framework preset:** Other
- **Root directory:** `attendance-dashboard`
- **Build command:** leave empty
- **Output directory:** leave empty
- **Install command:** leave empty

Vercel will use `attendance-dashboard/vercel.json`.

The application root redirects to the Attendance Control Room.

Useful routes:

- `/` — Control Room
- `/parents` — Parent Contact Library
- `/students` — Student Attendance
- `/staff` — Staff Management
- `/operations` — Operations and Session Preparation
- `/analytics` — Health and Analytics
- `/controls` — Attendance Controls and Governance
- `/deployment` — Deployment and Recovery Tools

## Runtime configuration

The standalone app loads configuration in this order:

1. `window.WTS_ATTENDANCE_RUNTIME_CONFIG`
2. `attendance-config.json`
3. the temporary legacy fallback in `app.js`

For the new Vercel project, copy `attendance-config.example.json` to `attendance-config.json` and supply only the public Supabase URL and publishable key.

Never place the Supabase service-role key, device secret, WhatsApp provider secret or administrator secret in this file.

## Recommended project name

`wts-attendance-system`

Suggested future domain:

`attendance.waytosuccess.sch.ng`

## Current shared database

The standalone frontend may continue to use the current Supabase project because attendance tables are isolated by RLS and controlled functions.

This is not permission for unrestricted cross-application database access. Result and attendance modules remain separate owners of their operational data.

## Future extraction to a separate GitHub repository

When a dedicated repository is created:

1. Copy the entire `attendance-dashboard` directory to the new repository root.
2. Rename `attendance-config.example.json` to `attendance-config.json` only in the deployment environment.
3. Keep secrets in Supabase Edge Function environment variables or Vercel encrypted environment variables.
4. Connect the new repository to a separate Vercel project.
5. Attach the attendance subdomain.
6. Preserve the existing result repository without attendance production deployment.

## Production safety gates

Do not activate production attendance until:

- final 2026/2027 roster is approved;
- operational dates are entered;
- school-owned scanner or terminal is approved;
- parent WhatsApp consent has been collected;
- a production WhatsApp provider has passed delivery and webhook tests;
- development device and administrator secrets have been rotated;
- staging tests return no failures;
- the final management demonstration is approved.
