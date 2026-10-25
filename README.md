# SnowDash

**"Tableau Dataviz" inside Snowflake** — ad-hoc, drag-and-drop pivot analysis running as a Snowflake App (Snowflake App Runtime). Every layout change runs a live query in Snowflake. The UI is available in English and Portuguese.

## Features

- **Catalog**: pick a database, schema and object (table, view or semantic view).
- **Drag-and-drop pivot**: Filters, Columns, Rows and Values shelves.
  - Aggregations: SUM, AVG, MIN, MAX, COUNT, COUNT DISTINCT and record count.
  - Date granularity (day, week, month, quarter, year).
  - Row, column and grand totals computed in Snowflake, via `GROUPING SETS` (tables) or `UNION ALL` (semantic views).
  - Sort by label or value, heatmap and CSV export.
- **Charts**: bars, stacked bars, lines and area.
- **Semantic views**: dimensions and metrics queried through `SEMANTIC_VIEW(...)`.
- **Data model (joins)**: click other tables to join them in.
  - The app suggests the join keys (e.g. `C_CUSTKEY = O_CUSTKEY`).
  - LEFT/INNER joins, up to 8 tables, across schemas.
- **SnowBooks**: a data model plus multiple sheets, saved in a Snowflake table and shared across users.
  - Open, Save, Save as, Delete; deep links via `?book=<id>`; Ctrl/⌘+S shortcut.
- **Languages**: English and Portuguese, with a switcher in the header. Server errors are localized too.
- **Show SQL**: displays the SQL generated for every query.

## Security

- Identifiers (columns, join keys) are validated against the catalog's real metadata and always quoted (`"..."`).
- Aggregations, granularities and filter operators are closed allow-lists.
- Filter values are always sent as binds (`?`), never concatenated into SQL.
- Queries run with **owner's rights**, i.e. as the service role.

## Project layout

| Path | Contents |
|---|---|
| `app/page.tsx` | Single page hosting the workbench |
| `app/api/catalog` | Databases, schemas, objects (`GET`) |
| `app/api/fields` | Fields for a source, including models (`POST`) |
| `app/api/pivot` | Runs the pivot query (`POST`) |
| `app/api/values` | Distinct values for filters (`POST`) |
| `app/api/snowbooks` | List / open / save / delete SnowBooks |
| `lib/pivot/` | Types, SQL builder, catalog, join model, grid transform |
| `lib/snowbooks.ts` | SnowBook persistence |
| `lib/i18n/` | EN/PT dictionaries and client provider |
| `components/pivot/` | Workbench, catalog panel, shelves, table, chart, model and SnowBook bars |

## Snowflake prerequisites

SnowBooks table (the name can be overridden with the `SNOWDASH_BOOKS_TABLE` environment variable):

```sql
CREATE SCHEMA IF NOT EXISTS LABS.SNOWDASH;
CREATE TABLE IF NOT EXISTS LABS.SNOWDASH.SNOWBOOKS (
  ID VARCHAR(36) NOT NULL PRIMARY KEY,
  NAME VARCHAR(200) NOT NULL,
  DESCRIPTION VARCHAR(2000),
  SOURCE VARIANT NOT NULL,
  SHEETS VARIANT NOT NULL,
  CREATED_BY VARCHAR(255),
  CREATED_AT TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
  UPDATED_BY VARCHAR(255),
  UPDATED_AT TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP()
);
```

The role that owns the service needs:

- `USAGE` on `LABS` and `LABS.SNOWDASH`;
- `SELECT, INSERT, UPDATE, DELETE` on `LABS.SNOWDASH.SNOWBOOKS`;
- `USAGE` and `SELECT` on the databases, schemas and tables to be analyzed;
- `USAGE` on the query warehouse.

## Run locally

```bash
npm install
SNOWFLAKE_CONNECTION_NAME=<your_connection> npm run dev   # uses ~/.snowflake/config.toml
```

Open the URL printed by `next dev` (e.g. http://localhost:3000).

## Tests

```bash
npm test
```

There are 73 tests covering the SQL builder (including injection attempts), joins and key suggestion, the pivot grid transform, and the i18n dictionaries.

> If `SNOWFLAKE_DEFAULT_CONNECTION_NAME` is set in your shell, one template test fails; run `env -u SNOWFLAKE_DEFAULT_CONNECTION_NAME npm test`.

## Deploy

Deployment uses the Snowflake CLI. The deployment config lives in `snowflake.yml` and the build in `app.yml`.

```bash
snow app deploy --verbose
```
