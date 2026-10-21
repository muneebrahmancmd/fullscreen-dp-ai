---
name: Access-change email behavior
description: Project decision for keeping access administration resilient when email delivery fails.
---

Persist admin access changes before sending user notification emails. Send the email asynchronously so an SMTP delay or failure cannot prevent or roll back the permission change. Avoid duplicate emails for repeated actions that do not change the account's access status.

**Why:** Access control is authoritative; email is only a notification and must not block an administrator or leave the user in an ambiguous partially-updated state.

**How to apply:** Keep this behavior for grant/revoke notifications and any future account-access emails in this app.
