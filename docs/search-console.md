# Connecting Google Search Console

The dashboard reads query-level clicks, impressions, CTR and average position
(last 28 days by default) with a read-only Search Console credential. Pick **one** of
the two options below.

## Option A: service account (recommended; works headless, e.g. on Termux)

1. In [Google Cloud Console](https://console.cloud.google.com/), create or pick a project and
   enable the **Google Search Console API**.
2. **IAM & Admin → Service Accounts → Create**, then **Keys → Add key → JSON**. Download the file.
3. In [Search Console](https://search.google.com/search-console) open your property →
   **Settings → Users and permissions → Add user**, and add the service account's
   `client_email` with **Restricted** (read-only) permission.
4. Point the dashboard at the key in `.env`, as a file path or as the JSON itself:
   ```
   GOOGLE_SEARCH_CONSOLE_CREDENTIALS=/path/to/service-account.json
   ```
   Keep the file out of git. The inline form (`GOOGLE_SEARCH_CONSOLE_CREDENTIALS={"type":"service_account",...}`)
   is handy where you can't keep a key file around.

## Option B: OAuth refresh token (if you can't create a service account)

Create an OAuth client (type **Desktop app**) with the Search Console API enabled, run
the consent flow once with the scope `https://www.googleapis.com/auth/webmasters.readonly`
to get a refresh token, then set:

```
GSC_CLIENT_ID=
GSC_CLIENT_SECRET=
GSC_REFRESH_TOKEN=
```

If both options are set, the service account is used.

## Using it

- **UI:** open a site and press **Sync Search Console** in the SEO panel.
- **API:** `POST /api/sites/:id/sync/gsc` with an optional body `{ "days": 28, "property": "sc-domain:example.com" }`.
- `GET /api/connectors` reports whether a credential is configured, and
  `GET /api/gsc/properties` lists the properties the credential can read.

## How a site is matched to a property

Search Console properties are either a **Domain** property (`sc-domain:example.com`) or a
**URL-prefix** property (`https://www.example.com/`). A site's domain is matched to a Domain
property first, then to an `https://` URL-prefix property on the same host (`www.` is ignored).
Properties you only have unverified access to are skipped. If nothing matches, the API
returns 404 with the list of properties it can see, and you can pass `property` explicitly.

## Things worth knowing

- Search Console data lags about two days, so the window ends two days ago.
- Each sync **replaces** that site's Search Console keywords with the fresh window; rows
  from other sources are left alone. Search Console returns at most 5,000 queries per pull.
- The numbers match the Search Console UI only for the same property, date range and
  search type (this connector uses web search).
