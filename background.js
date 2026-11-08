// JobShield Companion Extension Launcher (Manifest V3)
// When clicked, opens the JobShield web application in a new browser tab.
// Passes the current active tab's URL (if it is a job posting) as a query parameter for prefilled analysis.

const DEFAULT_WEB_APP_URL = "http://localhost:5173";

chrome.action.onClicked.addListener(async (tab) => {
  try {
    // Get configurable web app base URL from storage, fallback to default
    const stored = await chrome.storage.sync.get(["webAppUrl"]);
    const baseUrl = stored.webAppUrl || DEFAULT_WEB_APP_URL;

    let targetUrl = baseUrl;

    // If the active tab has a valid http/https URL, pass it safely as a param
    if (tab && tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
      const encodedUrl = encodeURIComponent(tab.url);
      targetUrl = `${baseUrl}/?url=${encodedUrl}`;
    }

    // Open JobShield website in a new tab and focus it
    await chrome.tabs.create({
      url: targetUrl,
      active: true
    });
  } catch (err) {
    console.error("JobShield launcher failed to open tab:", err);
    // Fallback simple open
    chrome.tabs.create({ url: DEFAULT_WEB_APP_URL, active: true });
  }
});
