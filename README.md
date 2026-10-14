# ReSellReady

ReSellReady is a product-adaptive listing studio for side-hustle sellers. It changes its copy, questions, quality checklist, and suggested tags based on whether the seller is listing vintage goods, handmade products, food, print-on-demand products, or something else.

## What is built

- Responsive seller-facing UI
- Product-type adaptation
- Photo previews that stay in the browser
- Marketplace and tone controls
- Demo-mode listing generation with no account or API key (for UI development only)
- Hosted Together AI + Gemma adapter
- Copy-to-clipboard and regenerate actions
- Explicit privacy and model-safety copy

## Run it

The production path is a hosted model behind the server. Do not open `index.html` directly for hosted inference; run the server:

```powershell
npm start
```

Then open `http://localhost:3000`. Without `GOOGLE_API_KEY`, the UI uses its clearly labeled demo fallback.

## Deploy the hosted version

1. Create a Google AI Studio API key with access to the Gemma model you plan to use.
2. Copy `.env.example` to a private local `.env` only if testing locally. Never commit it.
3. Set `MODEL_PROVIDER=google`, `GOOGLE_API_KEY`, and `GOOGLE_MODEL=gemma-4-31b-it` in Render's environment variables.
4. Deploy this folder as a Render Node web service. `render.yaml` contains the build, start, and health-check configuration.
5. Confirm `https://YOUR-RENDER-URL/api/health` returns `{ "ok": true }`.
6. Generate a listing from the public URL. The result badge should say `HOSTED ...`, not `DEMO MODE`.

Google AI Studio is the default hosted inference adapter and the server calls it only from the backend. The model is configurable because an API key does not itself identify which Gemma model your project should use. Together AI remains available as an alternate provider by setting `MODEL_PROVIDER=together`.

## Sponsor integrations

- **Backboard:** the server has a memory adapter hook using `BACKBOARD_API_URL` and `BACKBOARD_API_KEY`. It retrieves seller preferences before generation.
- **Tinker:** `TINKER_MODEL_ENDPOINT` is reserved for the fine-tuned model adapter. Add it after you have a trained endpoint and benchmark it against Together's baseline.
- **Render:** `render.yaml` deploys the frontend and backend as one public service.

The remaining sponsor work is intentionally gated on your real Backboard and Tinker API details. Do not invent API calls or put sponsor secrets in frontend JavaScript.

## Google AI Studio safety

Do not paste the API key into chat, `script.js`, HTML, GitHub, or a committed `.env` file. Add it to Render's secret environment variables and use a local environment variable for local testing. Before deploying, confirm that `gemma-4-31b-it` is the exact model identifier exposed by your AI Studio account.

Do not put API keys in this folder or in frontend JavaScript. Add a server-side adapter before connecting hosted sponsor APIs.
