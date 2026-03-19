# Amazon Subscribe & Save Auto Cancel

This project uses Playwright to automate the Amazon Subscribe & Save cancellation flow.

## How it works

1. Open a real browser window.
2. Reuse a saved Amazon login session.
3. Visit the Subscribe & Save management page.
4. Switch to the `Subscriptions` tab.
5. Click the first visible item-level `Edit` button.
6. In the details modal, click `Cancel subscription`.
7. Click `Cancel my subscription`.
8. Return to the `Subscriptions` tab and repeat on the new first item.

## Setup

```bash
npm install
npx playwright install chromium
```

## Configuration

Copy the example config and edit it:

```bash
cp config.example.json config.json
```

```json
{
  "baseUrl": "https://www.amazon.co.uk",
  "subscribeAndSaveUrl": "https://www.amazon.co.uk/auto-deliveries/subscriptionList?ref_=sns_discover_m_d_nav_mys",
  "excludeKeywords": ["purina", "cat"],
  "maxCancellations": 50
}
```

| Field | Description |
|---|---|
| `baseUrl` | Your Amazon domain (e.g. `amazon.co.uk`, `amazon.com`, `amazon.de`) |
| `subscribeAndSaveUrl` | The full URL of your Subscribe & Save management page |
| `excludeKeywords` | Products matching any keyword (case-insensitive) will be skipped |
| `maxCancellations` | Maximum number of subscriptions to cancel per run |

Environment variables (`AMAZON_BASE_URL`, `AMAZON_SUBSCRIBE_SAVE_URL`, `AMAZON_EXCLUDE_KEYWORDS`, `AMAZON_MAX_CANCELLATIONS`) will override config.json values if set.

## Login (first-time or session expired)

Only needed once. Run again if your session expires (scripts fail to load the page or get redirected to the login page).

```bash
npm run login
```

A browser window will open at your configured Amazon domain. Log in manually (including MFA if needed), then go back to the terminal and press Enter. Your session will be saved to `storage/amazon-session.json` and the browser will close. After this, all other commands will reuse the saved session automatically.

## Usage

```bash
npm test              # Dry-run — preview what would be cancelled
npm run cancel_all    # Actually cancel subscriptions
npm run inspect       # Open the page without clicking anything
```

## Important note

Amazon changes its HTML and button labels often. The selectors in `scripts/cancel-subscribe-save.js` are starter selectors, not guaranteed final ones. The usual workflow is:

1. Run `npm test`
2. See which buttons are highlighted or skipped
3. Inspect the page and update selectors
4. Run `npm run cancel_all` only after dry-run looks correct
