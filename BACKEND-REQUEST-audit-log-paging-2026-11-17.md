# Audit log paging and search: backend request

**Date:** 2026-11-17

## The problem

The Activity Logs page can never show more than the newest 500 entries. `GET /platform/audit-logs` caps `limit` at 500 and has no paging, so anything older can't be reached.

Search on the page only looks through the rows already loaded. On 17 Nov, searching "vij" on the deployed site found nothing, because Vijayakumar's entries from 12 Nov were no longer in the newest 100.

`GET /company/audit-logs` (the company admin's own trail) has the same limit.

## What we need

Please add these to **both** `GET /platform/audit-logs` and `GET /company/audit-logs`:

| # | Change | Details |
| --- | --- | --- |
| 1 | `cursor` param + `nextCursor` in the reply | `nextCursor` is `null` when there are no more. An opaque string we pass back unchanged. Keyset paging on `(createdAt DESC, id DESC)`. |
| 2 | `total` in the reply | The count of entries matching the current filters. |
| 3 | `q` param | Case-insensitive search over action, actor email, target and details (including company name). |
| 4 | `id` on each log entry | Unique per entry. We use it as the row key; today two entries in the same second can clash. |
| 5 | Keep existing filters | `date_from`, `date_to`, `action` and `tz_offset_minutes` work with all of the above. `limit` stays, max 500. |
| 6 | `q` on export | `GET /platform/audit-logs/export` accepts `q`, so the CSV matches what's on screen. |

## Example

First page, searching "vij":

```
GET /api/platform/audit-logs?limit=100&q=vij&tz_offset_minutes=330
```

Next page: the same request plus the cursor from the previous reply:

```
GET /api/platform/audit-logs?limit=100&q=vij&tz_offset_minutes=330&cursor=eyJ0IjoiMjAyNi0xMS0xMlQxNjozODowMCIsImlkIjo0MTJ9
```

Reply:

```json
{
  "status": "ok",
  "logs": [
    {
      "id": 412,
      "actorEmail": "vijayakumar.n@method-hub.com",
      "action": "login",
      "target": "",
      "details": {},
      "ipAddress": "169.254.169.126",
      "createdAt": "2026-11-12T16:38:00"
    }
  ],
  "nextCursor": "eyJ0IjoiMjAyNi0xMS0xMlQxNjozODowMCIsImlkIjo0MTJ9",
  "total": 12
}
```

## Why a cursor, not offset

A cursor guarantees no entry is skipped or shown twice, even while new entries are being written. With `offset`, every new entry pushes the rest down a row. Someone on page 2 would see some rows again and miss others.

A cursor means "entries older than this exact one". Sorting on `(createdAt DESC, id DESC)` keeps two entries with the same time in a fixed order.

**Optional:** if `offset` is cheap to support alongside `cursor`, the page can offer a jump straight to the last page. It isn't required; Next and Previous are enough to reach every entry.

## Compatibility and frontend plan

The change is backwards compatible. `logs` keeps its shape, and `nextCursor`, `total` and `id` are new fields. The current frontend keeps working until we switch.

Once this is deployed, the frontend will:

- load one page at a time and follow `nextCursor`, so every entry can be reached;
- send the search box text as `q`, so search finds entries of any date;
- show `total` in the page header;
- use `id` as the row key.

Please confirm the field names (`cursor`, `nextCursor`, `total`, `q`, `id`) and share a test URL when it's ready.
