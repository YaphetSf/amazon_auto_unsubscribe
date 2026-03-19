import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

// Load config from config.json, with env var overrides
const CONFIG_PATH = path.resolve("config.json");
const config = JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8").catch(() => "{}"));

const STORAGE_FILE = path.resolve("storage/amazon-session.json");
const BASE_URL = (process.env.AMAZON_BASE_URL || config.baseUrl || "https://www.amazon.co.uk").replace(/\/$/, "");
const TARGET_URL =
  process.env.AMAZON_SUBSCRIBE_SAVE_URL ||
  config.subscribeAndSaveUrl ||
  `${BASE_URL}/gp/subscribe-and-save/manager`;
const IS_DRY_RUN = process.argv.includes("--dry-run");
const IS_INSPECT = process.argv.includes("--inspect");
const MAX_CANCELLATIONS = Number.parseInt(
  process.env.AMAZON_MAX_CANCELLATIONS || String(config.maxCancellations || 50), 10
);
const EXCLUDE_KEYWORDS = (process.env.AMAZON_EXCLUDE_KEYWORDS || (config.excludeKeywords || []).join(","))
  .split(",")
  .map(k => k.trim().toLowerCase())
  .filter(Boolean);

const SUBSCRIPTIONS_TAB_SELECTORS = [
  'text=SUBSCRIPTIONS',
  'text=Subscriptions',
  'a:has-text("SUBSCRIPTIONS")',
  'button:has-text("SUBSCRIPTIONS")',
  'a:has-text("Subscriptions")',
  'button:has-text("Subscriptions")',
  '[role="tab"]:has-text("SUBSCRIPTIONS")',
  '[role="tab"]:has-text("Subscriptions")',
  '[role="button"]:has-text("SUBSCRIPTIONS")',
  '[role="button"]:has-text("Subscriptions")'
];

const EDIT_BUTTON_SELECTORS = [
  'span.a-button-small:has-text("Edit")',
  'span.a-button:has(.a-button-text:text-is("Edit"))',
  'text=Edit',
  'button:has-text("Edit")',
  'a:has-text("Edit")',
  'input[value="Edit"]',
  '[role="button"]:has-text("Edit")'
];

const CANCEL_SUBSCRIPTION_SELECTORS = [
  'a:has-text("Cancel subscription")',
  'button:has-text("Cancel subscription")',
  'span:has-text("Cancel subscription")',
  'div:has-text("Cancel subscription") >> visible=true'
];

const FINAL_CANCEL_SELECTORS = [
  'button:has-text("Cancel my subscription")',
  'a:has-text("Cancel my subscription")',
  'span.a-button:has-text("Cancel my subscription")',
  'button:has-text("Confirm cancellation")',
  'span.a-button:has-text("Confirm cancellation")',
  'input[type="submit"][value*="Cancel"]',
  'span.a-button:has-text("Cancel")'
];

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function clickFirstVisible(root, selectors, label, dryRun) {
  for (const selector of selectors) {
    const locator = root.locator(selector).first();
    if (await locator.count()) {
      try {
        await locator.waitFor({ state: "visible", timeout: 1_500 });
        if (dryRun) {
          await locator.evaluate((element) => {
            element.style.outline = "3px solid red";
            element.style.backgroundColor = "rgba(255, 0, 0, 0.15)";
          });
          console.log(`[dry-run] Would click ${label}: ${selector}`);
        } else {
          console.log(`Clicking ${label}: ${selector}`);
          await locator.click({ timeout: 3_000 });
        }
        return true;
      } catch {
        // Keep trying the next possible selector because Amazon's UI changes often.
      }
    }
  }

  console.log(`No visible selector found for ${label}`);
  return false;
}

async function clickExactEditButton(page, dryRun, editIndex = 0) {
  // Try Amazon's custom button component first (span.a-button with "Edit" text)
  const amazonBtn = page.locator('span.a-button-small.sns-full-width:has(span.a-button-text:text-is("Edit"))').nth(editIndex);
  if (await tryClickLocator(amazonBtn, "first item Edit button", dryRun, "span.a-button Edit")) {
    return true;
  }

  const itemEdit = page.getByText(/^Edit$/, { exact: true }).nth(0);
  if (await tryClickLocator(itemEdit, "first item Edit button", dryRun)) {
    return true;
  }

  for (const selector of EDIT_BUTTON_SELECTORS) {
    const candidates = page.locator(selector);
    const count = await candidates.count();
    for (let index = 0; index < count; index += 1) {
      const locator = candidates.nth(index);
      try {
        await locator.waitFor({ state: "visible", timeout: 1_000 });
        const text = (await locator.innerText().catch(() => "")).trim();
        const value = (await locator.inputValue().catch(() => "")).trim();
        const ariaLabel = (await locator.getAttribute("aria-label").catch(() => "")).trim();
        const label = text || value || ariaLabel;
        if (label !== "Edit") {
          continue;
        }

        if (await tryClickLocator(locator, "first item Edit button", dryRun, selector)) {
          return true;
        }
      } catch {
        // Try the next candidate.
      }
    }
  }

  console.log("No visible item Edit button found");
  return false;
}

async function hasVisibleEditButton(page) {
  const itemEdit = page.getByText(/^Edit$/, { exact: true }).nth(0);
  try {
    await itemEdit.waitFor({ state: "visible", timeout: 750 });
    return true;
  } catch {
    // Fall back to selector-based checks below.
  }

  for (const selector of EDIT_BUTTON_SELECTORS) {
    const candidates = page.locator(selector);
    const count = await candidates.count();
    for (let index = 0; index < count; index += 1) {
      const locator = candidates.nth(index);
      try {
        await locator.waitFor({ state: "visible", timeout: 750 });
        const text = (await locator.innerText().catch(() => "")).trim();
        const value = (await locator.inputValue().catch(() => "")).trim();
        const ariaLabel = (await locator.getAttribute("aria-label").catch(() => "")).trim();
        const label = text || value || ariaLabel;
        if (label === "Edit") {
          return true;
        }
      } catch {
        // Try the next candidate.
      }
    }
  }

  return false;
}

async function tryClickLocator(locator, label, dryRun, selector = "text match") {
  try {
    await locator.waitFor({ state: "visible", timeout: 1_000 });
    if (dryRun) {
      await locator.evaluate((element) => {
        element.style.outline = "3px solid red";
        element.style.backgroundColor = "rgba(255, 0, 0, 0.15)";
      });
      console.log(`[dry-run] Would click ${label}: ${selector}`);
    } else {
      console.log(`Clicking ${label}: ${selector}`);
      await locator.click({ timeout: 3_000 });
    }
    return true;
  } catch {
    return false;
  }
}

async function getProductNameAtIndex(page, index) {
  // Find the Nth visible Edit button's card and return its text content.
  try {
    return await page.evaluate((idx) => {
      const editButtons = [...document.querySelectorAll('span.a-button-small.sns-full-width')]
        .filter(btn => btn.innerText?.trim() === 'Edit' && btn.offsetParent);
      if (idx >= editButtons.length) return '';
      const btn = editButtons[idx];
      let card = btn.parentElement;
      for (let i = 0; i < 20 && card; i++) {
        const editsInside = [...card.querySelectorAll('span.a-button-small.sns-full-width')]
          .filter(b => b.innerText?.trim() === 'Edit' && b.offsetParent);
        if (editsInside.length === 1 && card.offsetHeight > 100) {
          return card.innerText?.trim() || '';
        }
        card = card.parentElement;
      }
      return '';
    }, index);
  } catch {
    return '';
  }
}


async function openTargetPage(page) {
  console.log(`Opening target page: ${TARGET_URL}`);
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_000);
  console.log(`Current page URL: ${page.url()}`);
}

async function waitForEnter(message) {
  console.log(message);
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });
}

async function focusSubscriptionsTab(page, dryRun) {
  // Always actually click the tab even in dry-run mode — switching tabs is
  // non-destructive and the rest of the flow needs the tab content to be visible.
  const switched = await clickFirstVisible(
    page,
    SUBSCRIPTIONS_TAB_SELECTORS,
    "Subscriptions tab",
    false
  );
  if (switched) {
    await page.waitForTimeout(1_500);
    return true;
  }

  if (await hasVisibleEditButton(page)) {
    console.log("Subscriptions tab click was not needed; item Edit buttons are already visible.");
    return true;
  }

  return false;
}

async function processFirstItem(page, iteration, dryRun, skipCount = 0) {
  console.log(`\nProcessing subscription ${iteration + 1}`);

  const onSubscriptionsTab = await focusSubscriptionsTab(page, dryRun);
  if (!onSubscriptionsTab) {
    return { success: false, reason: "could_not_open_subscriptions_tab" };
  }

  // Wait for subscription items to load after tab switch
  await page.waitForTimeout(3_000);

  // Scan from the skipCount-th Edit button onward, skipping excluded items
  let editIndex = skipCount;
  let newSkips = 0;
  while (true) {
    const productName = await getProductNameAtIndex(page, editIndex);
    if (!productName) {
      return { success: false, reason: "no_more_items", newSkips };
    }
    console.log(`  Product: ${productName}`);

    if (EXCLUDE_KEYWORDS.length > 0) {
      const nameLower = productName.toLowerCase();
      const matchedKeyword = EXCLUDE_KEYWORDS.find(kw => nameLower.includes(kw));
      if (matchedKeyword) {
        console.log(`  Skipping — matches exclude keyword "${matchedKeyword}"`);
        editIndex += 1;
        newSkips += 1;
        continue;
      }
    }
    break;
  }

  // Always click Edit even in dry-run — it only opens the item detail page,
  // which is non-destructive and needed for the next steps.
  const opened = await clickExactEditButton(page, false, editIndex);
  if (!opened) {
    return { success: false, reason: "could_not_open_first_item" };
  }

  await page.waitForTimeout(1_000);

  // Click "Cancel subscription" even in dry-run — it only opens the
  // cancellation confirmation page, which is not yet destructive.
  const cancelSubscription = await clickFirstVisible(
    page,
    CANCEL_SUBSCRIPTION_SELECTORS,
    "Cancel subscription",
    false
  );
  if (!cancelSubscription) {
    return { success: false, reason: "could_not_click_cancel_subscription" };
  }

  await page.waitForTimeout(1_000);

  const finalCancel = await clickFirstVisible(
    page,
    FINAL_CANCEL_SELECTORS,
    "Cancel my subscription",
    dryRun
  );
  if (!finalCancel) {
    // Debug: print visible buttons/links on the confirmation page
    const elements = await page.evaluate(() => {
      const els = [...document.querySelectorAll('a, button, span.a-button, input[type="submit"], [role="button"]')];
      return els
        .filter(el => el.offsetParent !== null)
        .map(el => (el.innerText || el.value || '').trim())
        .filter(t => t.length > 0 && t.length < 100);
    });
    console.log('[debug] Visible clickable text on page:');
    for (const t of elements) {
      console.log(`  "${t}"`);
    }
    return { success: false, reason: "could_not_click_final_cancel" };
  }

  await page.waitForTimeout(2_500);

  // Reload the page so the list refreshes for the next iteration
  await openTargetPage(page);

  return { success: true, newSkips };
}

async function main() {
  if (!(await fileExists(STORAGE_FILE))) {
    throw new Error(
      `Missing ${STORAGE_FILE}. Run "npm run login" first to save your Amazon session.`
    );
  }

  console.log(`Using Amazon base URL: ${BASE_URL}`);
  const browser = await chromium.launch({ headless: false, slowMo: IS_DRY_RUN ? 250 : 150 });
  const context = await browser.newContext({ storageState: STORAGE_FILE });
  const page = await context.newPage();

  await openTargetPage(page);

  if (IS_INSPECT) {
    await waitForEnter(
      "Inspect mode is active. Use the opened browser to review the page manually, then press Enter to close it."
    );
    await browser.close();
    return;
  }

  if (EXCLUDE_KEYWORDS.length > 0) {
    console.log(`Exclude keywords: ${EXCLUDE_KEYWORDS.join(", ")}`);
  }

  let cancelledCount = 0;
  let skippedCount = 0;
  let skipOffset = 0; // number of excluded items to skip past in the list
  const runCount = MAX_CANCELLATIONS;
  for (let index = 0; index < runCount; index += 1) {
    const result = await processFirstItem(page, index, IS_DRY_RUN, skipOffset);
    skippedCount += result.newSkips || 0;
    skipOffset += result.newSkips || 0;
    if (result.success) {
      cancelledCount += 1;
      // After cancelling, the page reloads so the cancelled item is gone.
      // Excluded items are still there, so skipOffset keeps its accumulated value.
    } else {
      if (result.reason !== "no_more_items") {
        console.log(`Run ${index + 1} stopped at: ${result.reason}`);
      }
      break;
    }
  }

  const action = IS_DRY_RUN ? "Dry-run reviewed" : "Cancelled";
  console.log(`\nFinished. ${action} ${cancelledCount} subscription(s), skipped ${skippedCount}.`);

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
