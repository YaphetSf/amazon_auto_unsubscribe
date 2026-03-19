import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const CONFIG_PATH = path.resolve("config.json");
const config = JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8").catch(() => "{}"));

const STORAGE_DIR = path.resolve("storage");
const STORAGE_FILE = path.join(STORAGE_DIR, "amazon-session.json");
const BASE_URL = (process.env.AMAZON_BASE_URL || config.baseUrl || "https://www.amazon.co.uk").replace(/\/$/, "");
const LOGIN_URL = `${BASE_URL}/`;

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function main() {
  await ensureDir(STORAGE_DIR);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log(`\nOpening Amazon at ${LOGIN_URL}`);
  console.log("Please log in manually in the browser (including MFA if needed).\n");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

  console.log("==========================================================");
  console.log("  After you have logged in, come back here and press ENTER");
  console.log("  to save your session. Do NOT close the browser manually.");
  console.log("==========================================================\n");
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });

  console.log(`Current page URL: ${page.url()}`);
  await context.storageState({ path: STORAGE_FILE });
  console.log(`Saved login session to ${STORAGE_FILE}`);

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
