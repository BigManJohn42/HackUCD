# EireGo front-end v0.1.1 integration

This guide describes the function calls implemented in EireGo v0.1.1 and the HTTP contracts the back-end team needs to wire up. The client is a desktop React/Vite prototype. Start the server separately on port 4000 and the client on 5173. The Vite proxy forwards `/api` requests. No sample route, chat, or subscription responses are shipped in the client.

Change endpoint mappings and adapters in `src/api.ts`; the shared interfaces are in `src/types.ts`. All endpoints return JSON. Failed HTTP responses, invalid JSON, unexpected response shapes, and 30-second timeouts display recoverable unavailable states. AI and Stripe credentials belong on the server.

## Quick wiring map

| Front-end function | HTTP call | When it runs | What the function returns to the UI |
| --- | --- | --- | --- |
| `fetchTransportData()` | `GET /api/transport-data` | App startup; transport Retry | `Promise<TransportData>` |
| `planRoute(journey)` | `POST /api/routes` | Manual Planner → Find routes | `Promise<RouteOption[]>` (unwraps `routes`) |
| `sendChatMessage(message, history, transportData)` | `POST /api/chat` | Smart Planner → Send or Retry reply | `Promise<ChatMessage>` (converts `reply` to assistant `content`) |
| `fetchSubscriptionPlans()` | `GET /api/subscription-plans` | First visit to Subscriptions; plans Retry | `Promise<SubscriptionPlan[]>` (unwraps `plans`, sorts monthly first) |

No function calls are made for clicking a route option, swapping destinations, changing font size, or navigating home. Those operations run locally. Route and chat data stay in memory during navigation. Subscription plans and transport data are reused during the session; reloading the app clears them. There is no checkout call in this version.

### Integration steps

1. Implement the four HTTP contracts below, or agree on alternate URLs and update the `endpoints` object in `client/src/api.ts`.
2. Return the exact response envelopes: transport is a direct object; manual routes use `{ routes }`; chat uses `{ reply, routes? }`; subscriptions use `{ plans }`.
3. Run the server on port 4000 and `npm run dev` from `client`. Open `http://localhost:5173`. If the server uses a different port, change the `/api` target in `client/vite.config.ts`.
4. Verify transport data first, then manual routing, chat, and subscriptions using the checks at the end of this guide.

All requests are ordinary JSON HTTP requests, not WebSocket events. POST requests use `Content-Type: application/json`. The front end has no authentication token, account identifier, streaming-chat protocol, or checkout session handling.

### Existing server compatibility

The server folder is unchanged from the earlier prototype:

| Existing endpoint | Compatibility with EireGo v0.1.1 |
| --- | --- |
| `GET /api/corridor` | Not called. Its `Corridor`/leg-options response does not match `TransportData` or `RouteOption[]`. |
| `POST /api/chat` | Already returns a compatible plain-text `{ reply }`, but currently expects `context` and ignores the new `history` and `transportData` fields. Update the handler/service to use them for contextual routing. |
| `/api/billing/status`, `/api/billing/create-checkout-session`, `/api/billing/confirm` | Not called. These do not provide the plan-list response needed by the new subscription page. |

The back end can keep those legacy endpoints while adding the new ones. Server-side `RouteOption` currently describes a single travel option; the new client `RouteOption` describes an entire journey. Do not reuse the old type without adapting it.

## Transport data

`GET /api/transport-data` → `TransportData`:

```ts
{
  destinations: Array<{ id: string; name: string }>;
  referenceData: Record<string, unknown>;
}
```

Supply Dublin destination names and any reference data required by the concierge. An empty destination list is allowed. Manual input remains available if this request fails; chat requires a successful response. The fetched object is included in every chat request. The server should validate supplied context against its own data.

Example response (illustrative location/reference data, not a bundled app fallback):

```json
{
  "destinations": [
    { "id": "ucd-belfield", "name": "UCD Belfield" },
    { "id": "stephens-green", "name": "St Stephen's Green" }
  ],
  "referenceData": {
    "source": "your-transport-provider",
    "updatedAt": "2026-10-10T07:00:00Z"
  }
}
```

`referenceData` must be a JSON object; `{}` is accepted. Its internal structure is up to your back end and should contain the data your AI service actually needs. Destination IDs identify suggestion entries, but **manual requests send the typed destination names, not these IDs**. Users can enter names outside the suggestions, so the back end must resolve or reject free text. The client does not perform geocoding.

## Manual routes

`POST /api/routes` body → `Journey`:

```ts
{ from: string; to: string; departureTime: string }
```

`departureTime` is ISO 8601 with the device's local UTC offset. The user chooses date and time; the form labels this convention. Response → `{ routes: RouteOption[] }`. Empty routes mean no matching journeys.

```ts
interface RouteOption {
  id: string;
  title: string;
  departureTime: string;
  arrivalTime: string;
  durationMin: number;
  transfers: number;
  steps: Array<{
    id: string;
    mode: string;
    service?: string;
    from: string;
    to: string;
    departureTime: string;
    arrivalTime: string;
    instructions?: string;
  }>;
}
```

Use unique route IDs and unique step IDs within each route. Return date-times including `Z` or an explicit offset, not time-only strings. The client formats all returned journey times in `Europe/Dublin`, including the date. Duration is a nonnegative number; transfers is a nonnegative integer. Journey steps are displayed in response order. The first route is initially selected; users can select alternatives but cannot edit legs.

Example request:

```json
{
  "from": "UCD Belfield",
  "to": "St Stephen's Green",
  "departureTime": "2026-10-10T08:00:00+01:00"
}
```

Example response showing the shape only; these are illustrative times and service labels, not verified transit information:

```json
{
  "routes": [
    {
      "id": "journey-1",
      "title": "Bus to the city centre",
      "departureTime": "2026-10-10T08:00:00+01:00",
      "arrivalTime": "2026-10-10T08:30:00+01:00",
      "durationMin": 30,
      "transfers": 0,
      "steps": [
        {
          "id": "step-1",
          "mode": "bus",
          "service": "Service label from your provider",
          "from": "UCD Belfield",
          "to": "St Stephen's Green",
          "departureTime": "2026-10-10T08:00:00+01:00",
          "arrivalTime": "2026-10-10T08:30:00+01:00",
          "instructions": "Board at the stop specified by your provider."
        }
      ]
    }
  ]
}
```

The UI displays the totals you return; it does not recalculate duration or transfers from steps. Include walking, waiting, and transfers in your routing calculation as appropriate. Send an array in journey order. An empty `steps` array is accepted and displays a message that details have not been supplied. Returning `{ "routes": [] }` is a successful no-results response, not a server error.

Before requesting, the UI trims destination text and checks that destinations are nonempty and different (case-insensitive), and that the date/time is valid. It does not prevent past dates; apply any scheduling rules on the server. The timestamp offset is taken from the user's device for the selected date, including daylight-saving changes.

## Concierge

`POST /api/chat` body:

```ts
{
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  transportData: TransportData;
}
```

History contains previous conversation messages, excluding the current message and the static welcome. Response → `{ reply: string; routes?: RouteOption[] }`. Reply must be nonempty plain text; Markdown/HTML is not interpreted. Routes use the same schema and component as manual results. A retry resends the failed message without adding another copy to the conversation. Missing journey information can be requested in the reply.

Example request after a clarification question:

```json
{
  "message": "Tomorrow at 8am.",
  "history": [
    { "role": "user", "content": "Help me get from UCD to the city centre." },
    { "role": "assistant", "content": "When would you like to leave?" }
  ],
  "transportData": {
    "destinations": [{ "id": "ucd-belfield", "name": "UCD Belfield" }],
    "referenceData": { "source": "your-transport-provider" }
  }
}
```

Example clarification response:

```json
{ "reply": "Where in the city centre would you like to arrive?" }
```

For a completed journey, return `{ "reply": "Your plain-language explanation", "routes": [...] }`, with the complete route objects from the manual-route schema. Do not return routes only inside reply text if you want timetable cards to appear. `routes` can be omitted or an empty array; `null` is not accepted. An empty array displays the no-routes message.

The function strips structured routes from history and sends only `role` and `content`. Keep those text messages sufficient for future follow-up requests, or adapt the contract together with the front-end team if you need route IDs. History may contain a previous unanswered user message after a failed request. There is no separate conversation ID, client timezone, or current-date field in the chat payload; the server must define how it interprets relative dates such as “tomorrow” (Dublin time is a sensible service default).

The UI waits for one complete JSON reply and allows one in-flight message at a time. It does not support token streaming. Failed replies remain visible as a retryable error, not a fabricated assistant message. Returning nonempty `reply` text plus malformed route data fails the whole response.

## Subscription plans

`GET /api/subscription-plans` → `{ plans: SubscriptionPlan[] }`:

```ts
interface SubscriptionPlan {
  id: string;
  name: string;
  interval: "month" | "year";
  price: number;
  currency: string;
  benefits: string[];
}
```

Return exactly one monthly and one yearly plan with unique IDs. Price is a nonnegative amount in **major currency units**, not Stripe's integer minor units. Currency is a three-letter uppercase code. Convert Stripe prices on the server if needed. Cards display only returned names, prices, currencies, intervals, and benefits. A missing/invalid plan response produces a single unavailable message. This version has no checkout, billing confirmation, or subscription purchase flow.

Example response using arbitrary documentation prices only; fetch your real sandbox plan values on the server:

```json
{
  "plans": [
    {
      "id": "your-monthly-plan-id",
      "name": "Monthly plan",
      "interval": "month",
      "price": 12.34,
      "currency": "EUR",
      "benefits": ["A benefit supplied by the back end"]
    },
    {
      "id": "your-yearly-plan-id",
      "name": "Yearly plan",
      "interval": "year",
      "price": 123.45,
      "currency": "EUR",
      "benefits": ["A benefit supplied by the back end"]
    }
  ]
}
```

Use interval values `month` and `year`, not `monthly` or `yearly`. The yearly price is the amount for the whole year, not a monthly equivalent. Prices must be JSON numbers, not formatted strings. Return both plans even if benefits are empty arrays. The client formats currency and sorts monthly first. It does not calculate discounts, savings, taxes, or subscription eligibility.

## Errors and retries

Use successful HTTP statuses for valid responses and appropriate non-success statuses for invalid input or service failures. A useful server-side error body is:

```json
{ "error": "Your diagnostic message" }
```

The current client **does not display this server error text**; it presents page-specific generic messages. Log useful diagnostics on the server. A non-success status, invalid JSON, contract mismatch, network failure, or 30-second timeout rejects the function promise. The client does not retry automatically.

| Failure | Front-end behaviour |
| --- | --- |
| Transport data | Manual typing still works. Chat Send is disabled. Retry fetches transport again. |
| Manual routes | Form values remain. Find routes submits another request. |
| Chat | User message remains; Retry reply resends it without duplicating the bubble. |
| Plans | No plan cards are shown. A single unavailable message and Retry appear. |

GET endpoints should tolerate repeated requests. React development Strict Mode can issue the startup transport request more than once. A client timeout cancels its fetch but does not guarantee that server-side AI work has stopped. There are no payment side effects in these calls.

## Wiring acceptance checklist

- Startup successfully loads destination suggestions and enables chat.
- The manual request contains typed names and a departure timestamp with an explicit offset.
- Route response envelopes render alternative summaries and timed steps. Selecting a route makes no additional request.
- No-match routing returns `{ "routes": [] }` and shows “No routes found”.
- Chat receives prior text history and transport data, asks for missing details, and can return the same structured routes as manual planning.
- Monthly and yearly values come from the server and appear in the correct order. A missing plan makes the plan list unavailable.
- With the server stopped or returning an error, each affected page shows its agreed unavailable state and recovers after Retry.
- No credentials, checkout redirects, or hardcoded fallback data are introduced into the client.

## Local use and checks

From `client`, run `npm install`, then `npm run dev`. Run `npm run build` for a production build. Navigation uses `#/home`, `#/manual`, `#/smart`, and `#/subscriptions`; deep-link refresh needs no routing configuration.

For integration checks, intercept the proposed endpoints in a test browser or point them at your own server. Exercise successful routes and chat, empty routes, failed requests and retry, both plan intervals, and navigation away/back. Test fixtures must remain confined to tests. Font size is the only browser-persisted setting; journey and conversation data are kept in memory and cleared on reload.

The automated browser check is `tests/frontend.cjs`. With Vite running, install Playwright as a local test tool (`npm install --no-save --package-lock=false playwright`), then run `node tests/frontend.cjs`. It uses installed Microsoft Edge in headless mode by default; set `BROWSER_PATH` for a different Chromium executable or `TEST_URL` for a different local port. Screenshots are written to the ignored `client/tmp` directory. Playwright is a verification tool, not an application dependency.
