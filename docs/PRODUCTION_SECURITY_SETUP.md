# SPORE MAX production security configuration

## Required Cloudflare Worker secrets and variables

Configure these in Cloudflare Workers & Pages → spore-max → Settings → Variables and Secrets. Use encrypted **Secrets** for secret values.

- `MFA_ENCRYPTION_KEY`: random secret at least 32 characters. Generate a new unique value with a password manager or cryptographically secure generator. Never commit or paste it into GitHub or chat. Back it up in an approved secrets vault; losing it makes stored MFA seeds undecryptable.
- `RESEND_API_KEY`: API key for the Resend email delivery account.
- `RESET_EMAIL_FROM`: verified sender address, e.g. `SPORE MAX <accounts@your-verified-domain.example>`.
- `APP_ORIGIN`: public HTTPS origin of the deployed application, without a trailing slash.

Password reset email delivery is deliberately non-enumerating. If the email provider secrets are missing or the sender domain is not verified, reset messages will not be delivered. Configure and test email delivery before launch.

## Apply database migrations

Apply migrations in numeric order, from `0001_initial.sql` through `0005_security_controls.sql`, to the production D1 database. The Worker expects these tables.

## Enrol the first administrator in MFA

1. Promote the verified owner account to `role='admin'` through the D1 SQL console, as described in `ADMIN_SETUP.md`.
2. Sign in normally. Admin routes remain blocked until MFA is enabled.
3. Open the administrator dashboard and choose **Set up authenticator**.
4. Add the displayed secret to an authenticator app, then enter its current six-digit code.
5. Save the one-time recovery codes offline in a secure password manager. They are displayed only once.
6. Sign out and sign back in with the authenticator code to verify enforcement.

MFA uses RFC 6238 TOTP with a 30-second period and a ±1-step clock window. Recovery codes are single-use and stored as SHA-256 hashes.

## Security caveats before production

- Configure rate limiting/WAF rules for login, password reset, and MFA endpoints.
- Configure and test Resend sender-domain verification and SPF/DKIM/DMARC.
- Add administrator MFA recovery/re-enrollment operations with an audited owner verification process.
- Perform an independent security review and end-to-end tests.
- The application code is not a substitute for a tested backup/restore process.
- Never deploy with the placeholder D1 database ID or APP_ORIGIN.
