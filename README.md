# SnowDash

**Tableau inside Snowflake** — análise ad-hoc estilo pivot, com arrastar e soltar, rodando como um Snowflake App (Snowflake App Runtime). Cada alteração no layout gera uma consulta direto no Snowflake.

*Ad-hoc, drag-and-drop pivot analysis running as a Snowflake App. Every layout change runs a live query in Snowflake. The UI is available in Portuguese and English.*

## Funcionalidades

- **Catálogo**: escolha database, schema e objeto (tabela, view ou semantic view).
- **Pivot com arrastar e soltar**: prateleiras de Filtros, Colunas, Linhas e Valores.
  - Agregações SUM, AVG, MIN, MAX, COUNT, COUNT DISTINCT e nº de registros.
  - Granularidade de datas (dia, semana, mês, trimestre, ano).
  - Totais de linhas, colunas e geral, calculados no Snowflake via `GROUPING SETS` (tabelas) ou `UNION ALL` (semantic views).
  - Ordenação por rótulo ou valor, mapa de calor e exportação CSV.
- **Gráficos**: barras, barras empilhadas, linhas e área.
- **Semantic views**: dimensões e métricas consultadas via `SEMANTIC_VIEW(...)`.
- **Modelo de dados (joins)**: clique em outras tabelas para juntá-las.
  - O app sugere as chaves (ex.: `C_CUSTKEY = O_CUSTKEY`).
  - LEFT/INNER JOIN, até 8 tabelas, inclusive de schemas diferentes.
- **SnowBooks**: modelo + várias planilhas salvos numa tabela do Snowflake e compartilhados entre usuários.
  - Abrir, Salvar, Salvar como, Excluir; link direto via `?book=<id>`; atalho Ctrl/⌘+S.
- **Idiomas**: Português e Inglês, com seletor no cabeçalho. Erros do servidor também vêm traduzidos.
- **Ver SQL**: mostra o SQL gerado para cada consulta.

## Segurança

- Identificadores (colunas, chaves de join) são validados contra os metadados reais do catálogo e sempre citados (`"..."`).
- Agregações, granularidades e operadores de filtro são listas fechadas.
- Valores de filtro são sempre enviados como *binds* (`?`), nunca concatenados no SQL.
- As consultas rodam com **owner's rights**, ou seja, com o role do serviço.

## Estrutura

| Caminho | Conteúdo |
|---|---|
| `app/page.tsx` | Página única com o workbench |
| `app/api/catalog` | Databases, schemas, objetos (`GET`) |
| `app/api/fields` | Campos de uma fonte, inclusive modelos (`POST`) |
| `app/api/pivot` | Executa a consulta pivot (`POST`) |
| `app/api/values` | Valores distintos para filtros (`POST`) |
| `app/api/snowbooks` | Listar / abrir / salvar / excluir SnowBooks |
| `lib/pivot/` | Tipos, gerador de SQL, catálogo, modelo de joins, transformação em grade |
| `lib/snowbooks.ts` | Persistência dos SnowBooks |
| `lib/i18n/` | Dicionários PT/EN e provider do cliente |
| `components/pivot/` | Workbench, painel de catálogo, prateleiras, tabela, gráfico, barras de modelo e SnowBook |

## Pré-requisitos no Snowflake

Tabela dos SnowBooks (o nome pode ser trocado via variável `SNOWDASH_BOOKS_TABLE`):

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

O role que é dono do serviço precisa de:

- `USAGE` em `LABS` e `LABS.SNOWDASH`;
- `SELECT, INSERT, UPDATE, DELETE` em `LABS.SNOWDASH.SNOWBOOKS`;
- `USAGE` e `SELECT` nos databases, schemas e tabelas que forem analisados;
- `USAGE` no warehouse de consulta.

## Rodar localmente

```bash
npm install
SNOWFLAKE_CONNECTION_NAME=triggoai_lab npm run dev   # usa ~/.snowflake/config.toml
```

Abra a URL exibida pelo `next dev` (ex.: http://localhost:3000).

## Testes

```bash
npm test
```

São 73 testes: gerador de SQL (inclusive tentativas de injeção), joins e sugestão de chaves, transformação da grade pivot e dicionários i18n.

> Se a variável `SNOWFLAKE_DEFAULT_CONNECTION_NAME` estiver definida no seu shell, um teste do template falha; rode com `env -u SNOWFLAKE_DEFAULT_CONNECTION_NAME npm test`.

## Deploy

O deploy usa o Snowflake CLI. A configuração está em `snowflake.yml` e o build em `app.yml`.

```bash
snow app deploy --verbose
```
