# PBC Automated Emails

Daily birthday and anniversary emails for the congregation using:

- Planning Center People API
- Resend
- GitHub Actions

## What It Does

The daily job:

1. Fetches people from Planning Center People.
2. Checks each person's `birthdate` and `anniversary` against today's month/day in `America/Chicago`.
3. Sends a personalized email through Resend when there is a match.

Only people with an email address in Planning Center are emailed. People with `inactive` or `deceased` status are skipped.

## GitHub Setup

Create these repository secrets:

- `PC_CLIENTID`: Planning Center API application client ID
- `PC_SECRET`: Planning Center API application secret
- `RESEND_API`: Resend API key

Create this repository variable:

- `EMAIL_REPLY_TO`: optional reply-to address, for example `office@pbctulsa.org`

The workflow sends from `PBC <info@pbctulsa.org>`. Make sure `pbctulsa.org` is verified in Resend.

The workflow runs every day at `14:00 UTC`, which is `9:00 AM America/Chicago` during daylight saving time and `8:00 AM America/Chicago` during standard time.

## Manual Test

From GitHub Actions, run the `Celebration Emails` workflow manually with `dry_run` set to `true`. A dry run fetches Planning Center data and logs who would receive an email, but does not send anything.

To test locally:

```bash
npm install
PC_CLIENTID=... PC_SECRET=... DRY_RUN=true npm run send
```

To send locally:

```bash
PC_CLIENTID=... \
PC_SECRET=... \
RESEND_API=... \
EMAIL_FROM="PBC <info@pbctulsa.org>" \
TEST_EMAIL="james@touthang.info" \
npm run send
```

## Optional Settings

- `TIME_ZONE`: defaults to `America/Chicago`
- `SEND_EVENTS`: comma-separated list, defaults to `birthday,anniversary`
- `TEST_EMAIL`: sends all real emails to one test inbox instead of the person's email
- `DRY_RUN`: set to `true` to avoid sending

Examples:

```bash
SEND_EVENTS=birthday DRY_RUN=true npm run send
SEND_EVENTS=anniversary TEST_EMAIL=office@pbctulsa.org npm run send
```

## Edit Email Copy

The email text lives in [scripts/send-celebration-emails.js](./scripts/send-celebration-emails.js):

- `birthdayHtml` and `birthdayText`
- `anniversaryHtml` and `anniversaryText`
