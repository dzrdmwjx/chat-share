// server.js
const express = require('express');
const fs = require('fs');
const puppeteer = require('puppeteer');
const bodyParser = require('body-parser');
const path = require('path');

const OUTPUT_FILE = 'output.html';
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// Serve the generated HTML
app.get('/home', (req, res) => {
  if (fs.existsSync(OUTPUT_FILE)) {
    res.sendFile(path.resolve(OUTPUT_FILE));
  } else {
    res.status(404).send('Output not generated yet.');
  }
});

// Update link and generate output.html
app.post('/updateLink', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing url in request body' });

  try {
    // Launch Puppeteer with no-sandbox for Render
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle0' });

    await page.waitForSelector('#thread');

    // Extract and inline CSS
    const cssLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(link => link.href)
    );

    const cssContents = await Promise.all(
      cssLinks.map(async (link) => {
        try {
          const res = await fetch(link);
          return await res.text();
        } catch {
          return '';
        }
      })
    );

    const inlineCSS = cssContents.map(css => `<style>${css}</style>`).join('\n');

    // Extract #thread HTML
    const threadHTML = await page.evaluate(() => {
      const thread = document.querySelector('#thread');
      if (!thread) return '';

      const header = document.querySelector('header#page-header');
      if (header) header.remove();

      const bottom = document.querySelector('div#thread-bottom-container');
      if (bottom) bottom.remove();

      return thread.outerHTML;
    });

    const finalHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>ChatGPT Share</title>
${inlineCSS}
</head>
<body>
${threadHTML}

<script>
function enableCopyButtons() {
  document.querySelectorAll('button[aria-label="Copy"]').forEach(btn => {
    if (btn.dataset.copyAttached) return;
    btn.dataset.copyAttached = 'true';

    btn.addEventListener('click', async () => {
      try {
        const pre = btn.closest('pre');
        if (!pre) return;
        const code = pre.querySelector('div.overflow-y-auto > code');
        if (!code) return;
        await navigator.clipboard.writeText(code.innerText);
        const originalText = btn.innerText;
        btn.innerText = 'Copied!';
        btn.disabled = true;
        setTimeout(() => {
          btn.innerText = originalText;
          btn.disabled = false;
        }, 1500);
      } catch (err) { console.error('Copy failed', err); }
    });
  });
}

enableCopyButtons();
const observer = new MutationObserver(() => enableCopyButtons());
observer.observe(document.body, { childList: true, subtree: true });
</script>

</body>
</html>
`;

    fs.writeFileSync(OUTPUT_FILE, finalHTML, 'utf-8');
    console.log(`Saved standalone chat to ${OUTPUT_FILE} with inlined CSS.`);

    await browser.close();
    res.json({ message: 'HTML generated successfully' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate HTML' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
