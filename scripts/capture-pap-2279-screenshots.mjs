#!/usr/bin/env node
// Captures the §9 acceptance screenshots for PAP-2279 from a logged-in
// dev server (local_trusted mode auto-authenticates as local-board).
// Seed: PAP-2232 has 3 external objects (failed/auth_required/succeeded);
// PAP-2179 has one running object; PAP-2210 has none (related-work empty state).

import { createRequire } from "node:module";
const localRequire = createRequire(import.meta.url);
const { chromium } = localRequire("playwright");
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "screenshots", "pap-2279");

const baseUrl = process.env.PAP_DEV_URL ?? "http://127.0.0.1:3104";
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

async function shoot(page, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await page.screenshot({ path: dest, fullPage: false });
  console.log("captured", path.relative(repoRoot, dest));
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();

  // ====== Desktop ======
  const desktop = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2 });
  const page = await desktop.newPage();

  // ---- #03 Properties panel @ 1440x900 with 3 pills + tooltip ----
  await page.goto(`${baseUrl}/PAP/issues/PAP-2232`, { waitUntil: "networkidle" });
  await page.locator('text=External objects').first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(800);
  // Hover the failed-status pill to open its Radix tooltip. We aim for the
  // pill in the properties rail; the test scope is the Properties aside.
  const propertiesRail = page.locator('aside, [data-slot="sidebar"], [class*="properties" i]').first();
  const railScope = (await propertiesRail.count()) > 0 ? propertiesRail : page;
  const firstPill = railScope.locator('a, button').filter({ hasText: /pull request|lead/i }).first();
  if ((await firstPill.count()) > 0) {
    try {
      await firstPill.scrollIntoViewIfNeeded();
      const box = await firstPill.boundingBox();
      if (box) {
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        // Move from far away first, then to the pill center, to ensure pointermove fires
        await page.mouse.move(0, 0);
        await page.waitForTimeout(50);
        await page.mouse.move(cx, cy, { steps: 10 });
      }
      await firstPill.focus().catch(() => {});
      await page.waitForTimeout(1500);
    } catch (e) { console.warn("pill hover failed:", e.message); }
  } else {
    console.warn("no pill in properties rail found");
  }
  await shoot(page, path.join(outDir, "03-properties-desktop-3-pills-tooltip.png"));

  // ---- #07 Related-work empty state @ 1440x900 (PAP-2210) ----
  await page.goto(`${baseUrl}/PAP/issues/PAP-2210`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  // Click the "Related work" tab
  const relatedTab = page.locator('[role="tab"]', { hasText: /Related work/i }).first();
  if ((await relatedTab.count()) > 0) {
    try { await relatedTab.click({ timeout: 5000 }); } catch (e) { console.warn("related tab click failed:", e.message); }
    await page.waitForTimeout(800);
  } else {
    console.warn("Related work tab not found");
  }
  // Scroll down so the empty External objects copy is in viewport
  const emptyCopy = page.locator('text=does not reference any external objects').first();
  if ((await emptyCopy.count()) > 0) {
    try { await emptyCopy.scrollIntoViewIfNeeded(); } catch {}
  }
  await page.waitForTimeout(400);
  await shoot(page, path.join(outDir, "07-related-work-empty-desktop.png"));

  // ---- #10 Issue-list row @ 1440x900 (badge + non-badge) ----
  // Note: the Phase 6 plumbing ships the IssueRow `externalObjectSummary` prop
  // but no IssuesList caller fetches/forwards summaries today. So the live-app
  // list cannot render the badge yet — we still capture the list view as the
  // truthful current state and flag the wiring gap in the issue comment.
  await page.goto(`${baseUrl}/PAP/issues`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  // Search for PAP-2232 so the seeded "with-badge" issue shows up at the top
  // alongside any other matches (control rows without badge).
  const search = page.locator('input[placeholder*="Search issues" i], input[type="search"]').first();
  if ((await search.count()) > 0) {
    try {
      await search.click();
      await search.fill("Follow up PR");
      await page.waitForTimeout(800);
    } catch {}
  } else {
    console.warn("Search input not found");
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await shoot(page, path.join(outDir, "10-issue-list-rows-desktop.png"));

  // ---- #11 Filter popover @ 1440x900, External object status section, "Failed" checked ----
  // Click the icon-only Filter button (title="Filter")
  const filterButton = page.locator('button[title="Filter"], button[title*="Filters" i]').first();
  if ((await filterButton.count()) > 0) {
    try {
      await filterButton.click({ timeout: 5000 });
      await page.waitForTimeout(600);
    } catch (e) { console.warn("filter click failed:", e.message); }
  } else {
    console.warn("Filter button not found");
  }
  // Scroll the popover so the "External object status" section is visible
  const externalSection = page.locator('text=External object status').first();
  if ((await externalSection.count()) > 0) {
    try { await externalSection.scrollIntoViewIfNeeded({ timeout: 3000 }); } catch {}
    // Click the Failed checkbox label
    const failedLabel = page.locator('label', { hasText: /^\s*Failed\s*$/ }).first();
    const failedFallback = page.locator('label:has-text("Failed")').first();
    const target = (await failedLabel.count()) > 0 ? failedLabel : failedFallback;
    if ((await target.count()) > 0) {
      try { await target.click({ timeout: 3000 }); } catch (e) { console.warn("failed-check click failed:", e.message); }
      await page.waitForTimeout(400);
    }
    try { await externalSection.scrollIntoViewIfNeeded(); } catch {}
  } else {
    console.warn("External object status section not found in popover");
  }
  await page.waitForTimeout(400);
  await shoot(page, path.join(outDir, "11-filter-popover-desktop.png"));

  await desktop.close();

  // ====== Mobile ======
  const mobile = await browser.newContext({
    viewport: MOBILE,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  });
  const m = await mobile.newPage();

  // ---- #04 Properties mobile sheet expanded ----
  await m.goto(`${baseUrl}/PAP/issues/PAP-2232`, { waitUntil: "networkidle" });
  await m.waitForTimeout(1200);
  // Click button[title="Properties"] (SlidersHorizontal icon in mobile toolbar)
  const propsTrigger = m.locator('button[title="Properties"]').first();
  if ((await propsTrigger.count()) > 0) {
    try { await propsTrigger.click({ timeout: 5000 }); } catch (e) { console.warn("props trigger click failed:", e.message); }
    await m.waitForTimeout(800);
  } else {
    console.warn("mobile Properties trigger not found");
  }
  // Scroll sheet so external objects row visible
  const extLabel = m.locator('text=External objects').first();
  if ((await extLabel.count()) > 0) {
    try { await extLabel.scrollIntoViewIfNeeded(); } catch {}
  }
  await m.waitForTimeout(400);
  await shoot(m, path.join(outDir, "04-properties-mobile.png"));

  // ---- #09 Sidebar mobile drawer ----
  await m.goto(`${baseUrl}/PAP/issues`, { waitUntil: "networkidle" });
  await m.waitForTimeout(1000);
  // The hamburger to open the sidebar drawer is "Open Paperclip menu" in mobile
  // BUT the drawer that contains nav (with project list) is opened via the
  // dropdown trigger or a separate sidebar trigger; try both.
  const menuButton = m.locator('button[aria-label="Open Paperclip menu"]').first();
  const sidebarTrigger = m.locator('[data-slot="sidebar-trigger"], button[aria-label*="sidebar" i], button[aria-label*="navigation" i]').first();
  let opened = false;
  for (const cand of [sidebarTrigger, menuButton]) {
    if ((await cand.count()) > 0) {
      try {
        await cand.scrollIntoViewIfNeeded({ timeout: 1000 });
        await cand.click({ timeout: 3000, force: true });
        opened = true;
        break;
      } catch (e) { console.warn("drawer trigger click failed:", e.message); }
    }
  }
  if (!opened) console.warn("no drawer trigger clicked");
  await m.waitForTimeout(700);
  await shoot(m, path.join(outDir, "09-sidebar-mobile-drawer.png"));

  await mobile.close();
  await browser.close();
}

main().catch((err) => {
  console.error("capture failed:", err);
  process.exit(1);
});
