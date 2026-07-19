# KhataERP production security audit

Audit date: 2026-07-19

Architecture reviewed: Vite/React static SPA on Vercel, using browser-to-Supabase Auth, PostgREST and Realtime. There is no Express/custom API server and no direct PostgreSQL client in this repository.

## Check results

| Check | Result | Evidence and remediation |
|---|---|---|
| Required environment variables | **Pass** | `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are required browser variables. The public `VITE_HCAPTCHA_SITE_KEY` is optional while CAPTCHA is disabled. `vite.config.ts` refuses startup/build with missing Supabase values, rejects a Supabase secret key, requires HTTPS in production, and refuses `VITE_WRITE_PERF=true` in production. |
| Optional/debug environment | **Pass** | `VITE_WRITE_PERF` defaults to `false`, only runs when `import.meta.env.DEV`, and is rejected by a production build if set to `true`. `.env.local` is ignored and was confirmed untracked. |
| Debug code and test endpoints | **Pass** | No `console.log`, `debugger`, TODO/FIXME security work, commented-out executable blocks, hardcoded credentials, `/test`, `/debug`, `/admin-backdoor`, or `/seed-data` route was found. The remaining `console.info` is opt-in development-only performance instrumentation; no production path can execute it. Sanitized best-effort audit failures no longer print database errors. |
| Client-visible error details | **Pass for application UI** | Error boundary and caught form/data errors now show only a generic operation message and correlation UUID. Raw stack traces, SQL/provider messages and file paths are sent through the sanitizer to `app_events`. `supabase-production-security-migration.sql` removes retailer SELECT access to that operational log; developer admins retain support access. |
| Direct provider error body | **Architectural limitation** | The browser talks directly to Supabase, so a user can inspect Supabase's own HTTP error body in browser developer tools even though the application never renders it. Guaranteeing custom HTTP error envelopes would require routing all PostgREST/Auth traffic through a trusted backend/edge proxy. Do not claim this stronger guarantee with the current SPA architecture. |
| Security headers | **Pass on Vercel** | `vercel.json` applies `nosniff`, `DENY`, one-year HSTS, CSP, Referrer-Policy, Permissions-Policy and DNS-prefetch disabling to every path. CSP restricts scripts and connections to self plus the required Supabase/hCaptcha origins, permits hCaptcha frames, blocks objects, and upgrades insecure requests. Inline styles remain allowed because the current React UI and hCaptcha use them; inline scripts are not allowed. |
| Authentication rate limiting | **Partial / provider deployment gate** | CAPTCHA is temporarily disabled. The UI locks login for one minute after five confirmed invalid-credential responses and limits signup/reset requests per browser session. Browser throttling is bypassable and is not an IP security boundary; Supabase Auth provider limits remain the server-side control. |
| Password reset rate | **Provider-controlled** | With Supabase's built-in mail service, email endpoints are limited project-wide and recovery requests also have a per-user cooldown. Confirm the live values under Authentication -> Rate Limits. If custom SMTP is enabled, explicitly configure a maximum of 3 reset emails/hour and CAPTCHA. |
| CORS | **Pass for repository / provider caveat** | The Vercel app defines no permissive CORS headers and exposes no custom API. Supabase's anon PostgREST endpoint is deliberately a public browser API; tenant security is RLS/JWT rather than Origin trust. Restrict Supabase Auth Site URL and Redirect URLs to the exact production HTTPS domain. A strict Origin-only data API would require a backend proxy and removal of direct browser PostgREST access. |
| Database credentials and TLS used by app | **Pass** | No database URL, database password, default credential, PostgreSQL driver or direct port connection exists in frontend source. Browser traffic is required to use an HTTPS Supabase URL and only the public anon/publishable key. |
| Direct PostgreSQL port and SSL enforcement | **Provider deployment gate** | Supabase manages the database listener outside this repository. Before launch enable SSL enforcement/network restrictions in the Supabase Database settings, rotate the database password, and allow direct/pooler access only from trusted administrative/backend IPs. The SPA does not need the PostgreSQL port at all. |
| Database RLS | **Requires live verification** | Supplied migrations enable tenant-scoped RLS. Run `supabase-security-audit.sql` against the production project after every migration; deployment should stop if it returns any table without RLS or any table without a policy. |

## Required provider-side launch actions

These cannot be truthfully completed through source-code changes:

1. In Supabase Authentication -> URL Configuration, set Site URL and redirect allow-list to the exact production HTTPS domain; remove localhost and broad wildcards from production.
2. In Authentication -> Rate Limits, review live quotas. Enable CAPTCHA/Turnstile for signup, sign-in and recovery. Use an edge/WAF proxy with durable storage if the exact 5-login-attempts/minute/IP policy is mandatory.
3. If custom SMTP is enabled, cap password-reset email delivery at 3/hour and disable link tracking.
4. In Database network/SSL settings, enforce SSL and restrict direct database/pooler access. The browser application requires neither port 5432 nor a database password.
5. Run `supabase-security-audit.sql`, apply `supabase-production-security-migration.sql`, and confirm the audit returns zero failures.
6. Verify the deployed response headers with `curl -I https://YOUR_DOMAIN/` and a deep SPA route after Vercel deployment.

## Correlation-ID flow

`publicErrorMessage()` generates a UUID and dispatches an in-memory error report. `App.tsx` records sanitized detail plus the same UUID in `app_events`. The browser receives only `Could not complete <operation>. Reference: <UUID>`. Authentication errors before a company exists are kept generic but are not written to a company event log; Supabase Auth retains its own provider audit logs.
