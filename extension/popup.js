async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function init() {
  const tab = await getCurrentTab();
  document.getElementById('title').value = tab.title || '';
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const candidate = {
      id: crypto.randomUUID(),
      title: document.getElementById('title').value.trim(),
      notes: document.getElementById('notes').value.trim(),
      url: tab.url,
      capturedAt: new Date().toISOString()
    };
    const stored = await chrome.storage.local.get({ trialforgeCandidates: [] });
    await chrome.storage.local.set({
      trialforgeCandidates: [...stored.trialforgeCandidates, candidate]
    });
    document.getElementById('status').textContent = 'Saved in Chrome local storage.';
  });
}

init();
