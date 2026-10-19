# Orbit

A general-purpose AI chatbot powered by [Groq](https://groq.com). Plain HTML, CSS and JavaScript, with one Vercel serverless function (`api/chat.js`) that calls Groq so the API key never reaches the browser.

## Project layout

```
public/            static site (index.html, styles.css, app.js, assets/robot.png)
api/chat.js        Vercel serverless endpoint → Groq chat completions
dev-server.js      local-only server (not used by Vercel)
tests/             node:test unit tests for the endpoint
vercel.json        serves /public, sets function duration
.env.example       template for local env vars (no real key)
```

## Run locally

Requires Node 18+. No dependencies to install.

```bash
cp .env.example .env        # then put your real key in .env (never commit it)
npm run dev                 # http://localhost:3000
npm test                    # unit tests (Groq is mocked)
```

## Environment variables

| Name           | Required | Default                   |
| -------------- | -------- | ------------------------- |
| `GROQ_API_KEY` | yes      | —                         |
| `GROQ_MODEL`   | no       | `llama-3.3-70b-versatile` |

## Limits

- Each message: up to 4,000 characters
- History sent as context: the 20 most recent messages, up to 24,000 characters in total
- Groq request timeout: 30 s (server); browser timeout: 45 s

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel: **Add New → Project → Import** that repo. The framework preset is **Other**. Leave the build command empty.
3. Under **Environment Variables**, add `GROQ_API_KEY`. You can also add `GROQ_MODEL`.
4. Deploy. If you change the variables later, redeploy for them to take effect.
