# SPORE MAX administrator setup

## Assign the first administrator

There is intentionally no public admin registration or role-upgrade endpoint.

1. Register the owner's normal customer account through the website.
2. Verify the owner's identity and email out of band.
3. In the Cloudflare dashboard, open the SPORE MAX D1 database and its SQL console.
4. Run the following statement, replacing the email with the verified owner's exact account email:

```sql
UPDATE users
SET role = 'admin', updated_at = CURRENT_TIMESTAMP
WHERE email = 'verified-owner@example.com';
```

5. Confirm exactly one account was updated, then sign out and sign back in.
6. The administrator dashboard should be available to that account only.

Do not expose the D1 console or database credentials to ordinary users. Do not promote an account until ownership has been independently verified.

## Current administrator capabilities

- View user and catalogue counts.
- Create catalogue records as drafts.
- Publish, unpublish, and archive titles.
- View customer accounts.
- Suspend or reactivate non-admin accounts.
- Write administrator actions to `admin_audit_logs`.

All management endpoints check the authenticated session and `users.role = 'admin'` on the server. Admin status is not trusted from browser data.

## Before production

Administrator MFA, recovery controls, rate limiting, security review, and a tested backup/restore procedure are still required before public production use. Media upload and Stream playback are not implemented by this dashboard yet.
