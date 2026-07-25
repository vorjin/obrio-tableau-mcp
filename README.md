 # Tableau MCP

[![Tableau Supported](https://img.shields.io/badge/Support%20Level-Tableau%20Supported-53bd92.svg)](https://www.tableau.com/support-levels-it-and-developer-tools)

[![Build and Test](https://github.com/tableau/tableau-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/tableau/tableau-mcp/actions/workflows/ci.yml)

[![npm](https://img.shields.io/npm/v/@tableau/mcp-server)](https://www.npmjs.com/package/@tableau/mcp-server)

## Overview

Tableau MCP is a suite of developer primitives, including tools, resources and prompts, that will
make it easier for developers to build AI applications that integrate with Tableau.

## Official Documentation

https://tableau.github.io/tableau-mcp/

## Getting Started

### Hosted Tableau MCP (Recommended for Tableau Cloud)

Tableau MCP is available as a managed service at **`https://mcp.tableau.com`**. It uses OAuth 2.1 so every user signs in with their own Tableau Cloud identity, and all existing per-user permissions are enforced automatically.

Point any MCP-compatible client at `https://mcp.tableau.com` and complete the OAuth sign-in flow when prompted.

See [Popular Client Integrations](https://tableau.github.io/tableau-mcp/docs/hosted-tableau-mcp/client-integrations) for step-by-step setup instructions for Slack, Claude, ChatGPT, and other common AI clients.

> **Tableau Server customers** and Cloud customers who require self-hosted infrastructure should see the [Enterprise Deployment](https://tableau.github.io/tableau-mcp/docs/enterprise) and [Self-Hosted Getting Started](https://tableau.github.io/tableau-mcp/docs/getting-started) guides.

### Self-Hosted / Local (npx)

The quickest way to run Tableau MCP locally. Requires [Node.js](https://nodejs.org/en/download) 22.7.5 or later — no cloning or building needed. Configure your AI tool (MCP client) with:

```json
{
  "mcpServers": {
    "tableau": {
      "command": "npx",
      "args": ["-y", "@tableau/mcp-server@latest"],
      "env": {
        "SERVER": "https://my-tableau-server.com",
        "SITE_NAME": "my_site",
        "PAT_NAME": "my_pat",
        "PAT_VALUE": "pat_value"
      }
    }
  }
}
```

For Docker, building from source, and other self-hosted options, see the [Getting Started guide](https://tableau.github.io/tableau-mcp/docs/getting-started).

## Authenticating MCP Clients over HTTP

An HTTP transport must authenticate its callers; otherwise anyone who can reach the server can open a
session and invoke every registered tool against the server's own Tableau credentials. Two mechanisms
are available.

**OAuth 2.1** — set `OAUTH_ISSUER` so each user signs in with their own Tableau identity and Tableau's
per-user permissions are enforced. This is the right choice whenever the callers are people.

**Pre-shared bearer tokens** — set `MCP_USERS` to a comma-separated list of `name=token` pairs. Each
client sends its token as `Authorization: Bearer <token>`. The name carries no privileges; it labels
the entry in configuration and is attached to the authenticated request for downstream handlers. This
suits service-to-service callers, which have no user present to complete an interactive sign-in.

```
MCP_USERS=first-client=<token>,second-client=<other-token>
```

Generate tokens from a cryptographically secure random source and give every client its own, so one
can be rotated without disturbing the others. A token may itself contain `=`, since each entry is
split on its first `=` only, but it must not contain a comma, which separates entries. Assigning one
token to two clients is rejected at startup, because the token is what identifies the caller.

The credential must travel in the `Authorization` header. Passing it in the query string is not
supported: the MCP specification prohibits it, and URLs are routinely retained in proxy and CDN access
logs. A missing, malformed or unrecognised token is answered with `401` and a `WWW-Authenticate:
Bearer` challenge, and the rejection is logged without the token.

When `TRANSPORT` is `http`, the server refuses to start unless `OAUTH_ISSUER` or `MCP_USERS` is set,
or authentication is explicitly waived with `DANGEROUSLY_DISABLE_OAUTH=true`. The two mechanisms are
mutually exclusive and setting both is rejected at startup: they run as consecutive gates, so a
combined configuration would require every caller to satisfy both.

`GET /health` is served without a credential so platform health checks need no secret. Every other
request is authenticated, including MCP `ping`.

Consider also narrowing the surface a token can reach with `INCLUDE_TOOLS` or `EXCLUDE_TOOLS`. An
unrecognised tool name in either list is discarded, and an empty resulting list applies no filtering
at all, so confirm the deployed surface by calling `tools/list` rather than by reading the variable.

## Deploy to Heroku

[![Deploy to Heroku](https://www.herokucdn.com/deploy/button.svg)](https://www.heroku.com/deploy?template=https://github.com/tableau/tableau-mcp)

## Example Prompts to Client

#### Prompt #1: Querying Data

```
For the Superstore Datasource, what are the top 5 states with the most sales in 2025?
```

#### Response

```
Based on the Superstore Datasource, here are the top 5 states with the most sales in 2025:
  1. California - $146,388.34
  2. New York - $93,922.99
  3. Washington - $65,539.90
  4. Texas - $43,421.76
  5. Pennsylvania - $42,688.31
California leads by a significant margin with over $146,000 in sales, followed by New York with nearly $94,000. These two states alone account for a substantial portion of the total sales across the top 5 states.
```

#### Prompt #2: Content Exploration

```
Find me the most viewed workbook within the last year.
```

#### Response

```
The most viewed workbook within the last year is:

Global Connections
- Owner: John Doe
- Project: Marketing
- Views in last year: 523
- Last Modified: September 2, 2025
- Workbook ID: 111fb672-9401-4913-a167-17b3d89a3e4f
```

#### Prompt #3: Getting a View

```
Show me the "Economy" view in the "Finances" project.
```

#### Response

![Economy View Image](docs/static/img/economy-view.png)
