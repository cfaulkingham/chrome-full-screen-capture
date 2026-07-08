# Full Page Screenshot Button

A small Manifest V3 Chrome extension that captures the current tab from top to bottom when you click the extension toolbar button. The screenshot is stitched from visible viewport captures and saved as a PNG in Downloads.

## Install Locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `chrome-full-screen-capture`.
5. Pin **Full Page Screenshot Button** to the toolbar.

## Use

Open the page you want to capture and click the extension button. The badge shows `...` while it captures, `OK` when the download starts, and `ERR` if Chrome blocks the page.

## Notes

- Chrome does not allow extensions to capture internal pages like `chrome://extensions` or Chrome Web Store pages.
- Very tall pages can be slow because Chrome limits how quickly extensions can capture visible tabs.
- Pages with sticky headers or animations may show repeated fixed elements because the extension scrolls the page and stitches the visible captures.
