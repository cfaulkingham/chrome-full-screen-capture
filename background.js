const CAPTURE_INTERVAL_MS = 650;
const SCROLL_SETTLE_MS = 175;
const BADGE_CLEAR_MS = 2500;

chrome.action.onClicked.addListener((tab) => {
  void captureFullPage(tab);
});

async function captureFullPage(tab) {
  if (!tab.id || !isCaptureAllowed(tab.url)) {
    await showBadge(tab.id, "ERR", "#b3261e", true);
    return;
  }

  await showBadge(tab.id, "...", "#3f6c51", false);

  let prepared;
  try {
    prepared = await runInPage(tab.id, preparePageForCapture);

    const tiles = [];
    const seenScrollPositions = new Set();
    let pageHeight = prepared.scrollHeight;
    let nextScrollY = 0;

    while (nextScrollY < pageHeight) {
      const maxScrollY = Math.max(0, pageHeight - prepared.viewportHeight);
      const targetY = Math.min(nextScrollY, maxScrollY);
      const position = await runInPage(tab.id, scrollToPosition, [
        prepared.originalScrollX,
        targetY,
        SCROLL_SETTLE_MS
      ]);

      const scrollY = Math.round(position.scrollY);
      pageHeight = Math.max(pageHeight, position.scrollHeight);

      if (seenScrollPositions.has(scrollY)) {
        break;
      }

      seenScrollPositions.add(scrollY);
      tiles.push({
        scrollY,
        dataUrl: await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: "png"
        })
      });

      if (scrollY + prepared.viewportHeight >= pageHeight) {
        break;
      }

      nextScrollY = scrollY + prepared.viewportHeight;
      await sleep(CAPTURE_INTERVAL_MS);
    }

    if (!tiles.length) {
      throw new Error("No screenshot tiles were captured.");
    }

    const screenshotDataUrl = await stitchTiles({
      tiles,
      viewportWidth: prepared.viewportWidth,
      viewportHeight: prepared.viewportHeight,
      scrollHeight: pageHeight
    });

    await chrome.downloads.download({
      url: screenshotDataUrl,
      filename: makeFilename(tab),
      saveAs: false
    });

    await showBadge(tab.id, "OK", "#3f6c51", true);
  } catch (error) {
    console.error("Full-page screenshot failed:", error);
    await showBadge(tab.id, "ERR", "#b3261e", true);
  } finally {
    if (prepared) {
      try {
        await runInPage(tab.id, restorePageAfterCapture, [
          prepared.originalScrollX,
          prepared.originalScrollY
        ]);
      } catch (error) {
        console.warn("Could not restore scroll position:", error);
      }
    }
  }
}

function isCaptureAllowed(url = "") {
  return /^(https?|file):/i.test(url);
}

async function runInPage(tabId, func, args = []) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args
  });

  return result.result;
}

function preparePageForCapture() {
  const styleId = "__full_page_screenshot_scroll_style__";
  let style = document.getElementById(styleId);

  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    style.textContent = "html, body { scroll-behavior: auto !important; }";
    document.documentElement.appendChild(style);
  }

  const root = document.documentElement;
  const body = document.body || root;

  return {
    originalScrollX: window.scrollX,
    originalScrollY: window.scrollY,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    scrollHeight: Math.max(
      root.scrollHeight,
      body.scrollHeight,
      root.offsetHeight,
      body.offsetHeight,
      root.clientHeight
    )
  };
}

async function scrollToPosition(x, y, settleMs) {
  window.scrollTo(x, y);

  await new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, settleMs);
    });
  });

  const root = document.documentElement;
  const body = document.body || root;

  return {
    scrollY: window.scrollY,
    scrollHeight: Math.max(
      root.scrollHeight,
      body.scrollHeight,
      root.offsetHeight,
      body.offsetHeight,
      root.clientHeight
    )
  };
}

function restorePageAfterCapture(x, y) {
  const style = document.getElementById("__full_page_screenshot_scroll_style__");

  if (style) {
    style.remove();
  }

  window.scrollTo(x, y);
}

async function stitchTiles({ tiles, viewportWidth, viewportHeight, scrollHeight }) {
  const firstBitmap = await bitmapFromDataUrl(tiles[0].dataUrl);
  const scaleX = firstBitmap.width / viewportWidth;
  const scaleY = firstBitmap.height / viewportHeight;
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(viewportWidth * scaleX)),
    Math.max(1, Math.round(scrollHeight * scaleY))
  );
  const context = canvas.getContext("2d");

  if (!context) {
    firstBitmap.close();
    throw new Error("Could not create a canvas context.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  await drawTile(context, canvas, firstBitmap, tiles[0], scaleY, scrollHeight);

  for (const tile of tiles.slice(1)) {
    const bitmap = await bitmapFromDataUrl(tile.dataUrl);
    await drawTile(context, canvas, bitmap, tile, scaleY, scrollHeight);
  }

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(blob);
}

async function drawTile(context, canvas, bitmap, tile, scaleY, scrollHeight) {
  const destinationY = Math.round(tile.scrollY * scaleY);
  const remainingPageHeight = Math.max(0, scrollHeight - tile.scrollY);
  const sourceHeight = Math.min(
    bitmap.height,
    Math.round(remainingPageHeight * scaleY),
    canvas.height - destinationY
  );

  if (sourceHeight > 0) {
    context.drawImage(
      bitmap,
      0,
      0,
      Math.min(bitmap.width, canvas.width),
      sourceHeight,
      0,
      destinationY,
      canvas.width,
      sourceHeight
    );
  }

  bitmap.close();
}

async function bitmapFromDataUrl(dataUrl) {
  const response = await fetch(dataUrl);
  return createImageBitmap(await response.blob());
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return `data:${blob.type};base64,${btoa(binary)}`;
}

function makeFilename(tab) {
  const timestamp = new Date().toISOString()
    .replace(/\.\d{3}Z$/, "")
    .replace(/[T:]/g, "-");
  const title = (tab.title || "screenshot")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);

  return `full-page-${title || "screenshot"}-${timestamp}.png`;
}

async function showBadge(tabId, text, color, autoClear) {
  const details = tabId ? { tabId } : {};

  await chrome.action.setBadgeBackgroundColor({ ...details, color });
  await chrome.action.setBadgeText({ ...details, text });

  if (autoClear) {
    setTimeout(() => {
      chrome.action.setBadgeText({ ...details, text: "" }).catch(() => {});
    }, BADGE_CLEAR_MS);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}