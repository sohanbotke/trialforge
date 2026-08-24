async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function init() {
  const tab = await getCurrentTab();
  document.getElementById('title').value = tab.title || '';
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const sanitizedUrl = sanitizePublicUrl(tab.url || '');
    if (!sanitizedUrl) {
      document.getElementById('status').textContent = 'Only public http/https offer pages can be saved.';
      return;
    }
    const candidate = {
      id: crypto.randomUUID(),
      title: document.getElementById('title').value.trim(),
      notes: document.getElementById('notes').value.trim(),
      url: sanitizedUrl,
      capturedAt: new Date().toISOString()
    };
    const stored = await chrome.storage.local.get({
      trywiseCandidates: [],
      trialforgeCandidates: []
    });
    const previousCandidates = stored.trywiseCandidates.length
      ? stored.trywiseCandidates
      : stored.trialforgeCandidates;
    await chrome.storage.local.set({
      trywiseCandidates: [...previousCandidates, candidate]
    });
    document.getElementById('status').textContent = 'Saved in Chrome local storage.';
  });
}

function sanitizePublicUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.local') ||
      /^(127\.|10\.|192\.168\.|169\.254\.)/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    ) {
      return null;
    }
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_cid|mc_eid)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

init();
