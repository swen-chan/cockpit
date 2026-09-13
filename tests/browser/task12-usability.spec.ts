import { expect, test } from "@playwright/test";

const navigationNames = ["Overview", "System", "Conversations", "Files", "Jobs"] as const;

function colorChannels(color: string): number[] {
  if (color.startsWith("#")) {
    const hexChannels = color.match(/[a-f\d]{2}/gi)?.map((channel) => Number.parseInt(channel, 16));
    if (hexChannels?.length === 3) return hexChannels;
  }
  const rgbChannels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (rgbChannels?.length === 3) return rgbChannels;
  throw new Error(`Invalid color: ${color}`);
}

function relativeLuminance(color: string): number {
  const channels = colorChannels(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

for (const width of [320, 390]) {
  test(`keeps every primary navigation link visible without page overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const navigation = page.getByRole("navigation", { name: "Primary navigation" });

    for (const name of navigationNames) {
      const link = navigation.getByRole("link", { name, exact: true });
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box, `${name} should have a rendered box`).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect(await link.locator("span").evaluate((label) => label.scrollWidth <= label.clientWidth)).toBe(true);
    }

    const rootWidths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(rootWidths.scroll).toBeLessThanOrEqual(rootWidths.client);
  });
}

test("moves keyboard focus into System details only in the stacked layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/system");
  const sourceRows = page.locator(".index-pane .index-row");
  expect(await sourceRows.count()).toBeGreaterThan(1);
  await sourceRows.nth(1).focus();
  await sourceRows.nth(1).press("Enter");
  const previewTitle = page.locator("#system-preview-title");
  await expect(previewTitle).toBeFocused();
  const [navigationBox, titleBox] = await Promise.all([
    page.locator(".navigation-rail").boundingBox(),
    previewTitle.boundingBox(),
  ]);
  expect(navigationBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  expect(titleBox!.y).toBeGreaterThanOrEqual(navigationBox!.y + navigationBox!.height - 1);

  await page.setViewportSize({ width: 1024, height: 900 });
  await sourceRows.nth(2).focus();
  await sourceRows.nth(2).press("Enter");
  await expect(sourceRows.nth(2)).toBeFocused();
  await expect(previewTitle).not.toBeFocused();
});

test("keeps secondary and failure text above AA contrast on light and selected dark surfaces", async ({ page }) => {
  await page.goto("/system");
  const colors = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    const selectedIndex = document.querySelector<HTMLElement>(".index-row.is-selected .row-index");
    const selectedRow = document.querySelector<HTMLElement>(".index-row.is-selected");
    if (!selectedIndex || !selectedRow) throw new Error("Selected System row is unavailable");

    const probe = document.createElement("table");
    probe.innerHTML = '<tbody><tr class="is-selected"><td><span class="status-label status-failed">FAILED</span></td></tr></tbody>';
    document.body.append(probe);
    const selectedFailure = probe.querySelector<HTMLElement>(".status-failed");
    const selectedJobRow = probe.querySelector<HTMLElement>("tr");
    if (!selectedFailure || !selectedJobRow) throw new Error("Selected failure probe is unavailable");

    const result = {
      failedText: getComputedStyle(selectedFailure).color,
      muted: styles.getPropertyValue("--muted").trim(),
      rail: styles.getPropertyValue("--rail").trim(),
      selectedJobBackground: getComputedStyle(selectedJobRow).backgroundColor,
      selectedText: getComputedStyle(selectedIndex).color,
      selectedBackground: getComputedStyle(selectedRow).backgroundColor,
    };
    probe.remove();
    return result;
  });

  expect(contrastRatio(colors.muted, colors.rail)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.selectedText, colors.selectedBackground)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.failedText, colors.selectedJobBackground)).toBeGreaterThanOrEqual(4.5);
});
