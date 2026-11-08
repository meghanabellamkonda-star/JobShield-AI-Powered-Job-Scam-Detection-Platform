// JobShield Content Script
// Detects and extracts job postings from Indeed, LinkedIn, and ZipRecruiter
// Performs explainable heuristic scam analysis and renders results

console.log("JobShield: Content script loaded on", window.location.href);

const JOBSCAN_CONFIG = {
  statusElementId: "jobscan-status",
  debounceDelay: 400,
  retryDelay: 600,
  maxRetries: 3
};

// Global extension state
let isAnalyzing = false;
let currentJobData = null;
let extensionEnabled = true;
let currentAnalysisResult = null;
let currentSite = null;
let analysisMode = "conservative";
let showWarnings = true;
let lastAnalyzedSignature = "";
let debounceTimer = null;
let observerInstance = null;
let analysisRequestId = 0;

// LinkedIn post selection state
let selectedLinkedInPostElement = null;
let selectedLinkedInPostId = null;

const LINKEDIN_FEED_POST_SELECTORS = [
  "div.feed-shared-update-v2",
  "div[data-urn*='urn:li:activity:']",
  "div[data-urn*='urn:li:ugcPost:']",
  "div[data-urn*='urn:li:share:']",
  "div.feed-shared-update",
  ".occludable-update",
  "article.feed-shared-update-v2",
  "[data-id*='urn:li:activity']",
  "div[data-chameleon-result-urn]",
  "div[data-view-name*='feed-full-update']",
  "div[data-view-name*='search-entity-result']",
  "div.search-results-container li.artdeco-card",
  "div.search-results-container div.artdeco-card",
  "div.search-results__cluster-content li"
];

// Helper: detect site by hostname
function detectCurrentSite() {
  const hostname = window.location.hostname.toLowerCase();
  if (hostname.includes("linkedin.com")) return "linkedin";
  if (hostname.includes("indeed.") || hostname.match(/\bindeed\b/)) return "indeed";
  if (hostname.includes("ziprecruiter.com")) return "ziprecruiter";
  return null;
}

function detectLinkedInPageType() {
  const path = (window.location.pathname || "").toLowerCase();
  // A. Formal job detail: /jobs/view/
  if (path.includes("/jobs/view/")) return "job-detail";
  // B. Job search results: /jobs/search/, /jobs/collections/
  if (path.includes("/jobs/search/") || path.includes("/jobs/collections/") || path.startsWith("/jobs")) return "jobs-search";
  // C. Content search results: /search/results/content/
  if (path.includes("/search/results/content/")) return "posts-search";
  // D. Standalone feed post: /feed/update/, /posts/
  if (path.includes("/feed/update/") || path.includes("/posts/")) return "standalone-post";
  // E. Feed & activity
  if (path === "/feed" || path.startsWith("/feed/")) return "feed";
  if (path.includes("/recent-activity/")) return "feed-or-posts";
  // Profile or company page
  if (path.startsWith("/in/") || path.startsWith("/company/") || path.startsWith("/school/")) return "profile-or-company";
  // Unsupported LinkedIn pages
  if (path.startsWith("/messaging") || path.startsWith("/notifications") || path.startsWith("/mynetwork")) return "unsupported-page";
  return "other";
}

function isStandaloneLinkedInPostPage() {
  const p = (window.location.pathname || "").toLowerCase();
  return p.includes("/feed/update/") || p.includes("/posts/");
}

function isFeedOrMultiPostPage() {
  const site = detectCurrentSite();
  if (site === "linkedin") {
    const pt = detectLinkedInPageType();
    return pt === "posts-search" || pt === "feed" || pt === "feed-or-posts";
  }
  return false;
}

function findVisibleLinkedInPosts() {
  const selector = LINKEDIN_FEED_POST_SELECTORS.join(", ");
  const rawElements = new Set();

  // 1. Direct post candidates matching feed post selectors
  try {
    const directMatches = document.querySelectorAll(selector);
    for (const el of directMatches) {
      rawElements.add(el);
    }
  } catch (e) {
    console.warn("JobShield: Error in direct post querySelectorAll", e);
  }

  // 2. Discover post cards via actor header anchors
  try {
    const actors = document.querySelectorAll(
      ".update-components-actor, .feed-shared-actor, [class*='update-components-actor']"
    );
    for (const act of actors) {
      const card = act.closest(
        "li.reusable-search__result-container, li.artdeco-card, div.feed-shared-update-v2, div[data-view-name*='feed-full-update'], div.artdeco-card, [data-urn*='activity'], [data-id*='activity']"
      );
      if (card) {
        rawElements.add(card);
      }
    }
  } catch (e) {
    console.warn("JobShield: Error in actor anchor discovery", e);
  }

  const rawList = Array.from(rawElements);

  // 3. Hierarchy containment filtering:
  // If candidate A contains candidate B, keep candidate B (the specific card) and discard container A!
  const posts = rawList.filter((cand) => {
    // Drop if cand strictly contains another distinct candidate in rawList
    const containsSubCandidate = rawList.some((other) => other !== cand && cand.contains(other));
    if (containsSubCandidate) return false;

    // Must have meaningful content
    const text = (cand.innerText || cand.textContent || "").trim();
    return text.length > 20;
  });

  return posts;
}

function getLinkedInPostId(postEl) {
  if (!postEl) return "";
  const urn = postEl.getAttribute("data-urn") || postEl.getAttribute("data-id") || postEl.getAttribute("data-activity-urn");
  if (urn) return urn;

  const link = postEl.querySelector("a[href*='urn:li:activity:'], a[href*='/feed/update/'], a[href*='/posts/']");
  if (link && link.href) {
    const m = link.href.match(/urn:li:activity:(\d+)/) || link.href.match(/\/posts\/([a-zA-Z0-9_-]+)/);
    if (m) return m[0];
  }

  const author = getElementText(".update-components-actor__name, .feed-shared-actor__name", postEl);
  const textSnippet = (postEl.innerText || postEl.textContent || "").slice(0, 50).replace(/\s+/g, "_");
  return `post_${cleanText(author)}_${textSnippet}`;
}

function getLinkedInPostUrl(postEl) {
  if (!postEl) return "";
  const urn = postEl.getAttribute("data-urn") || postEl.getAttribute("data-activity-urn");
  if (urn && urn.includes("activity:")) {
    const idMatch = urn.match(/activity:(\d+)/);
    if (idMatch) {
      return `https://www.linkedin.com/feed/update/urn:li:activity:${idMatch[1]}/`;
    }
  }
  const link = postEl.querySelector("a[href*='/feed/update/urn:li:activity:'], a[href*='/posts/']");
  if (link && link.href) {
    try {
      const u = new URL(link.href);
      return `${u.origin}${u.pathname}`;
    } catch {
      return link.href;
    }
  }
  if (isStandaloneLinkedInPostPage()) {
    try {
      const u = new URL(window.location.href);
      return `${u.origin}${u.pathname}`;
    } catch {
      return window.location.href;
    }
  }
  return "";
}

function selectLinkedInPost(postEl) {
  if (!postEl) return;
  if (selectedLinkedInPostElement && selectedLinkedInPostElement !== postEl) {
    selectedLinkedInPostElement.classList.remove("redflag-selected-post");
    const oldIndicator = selectedLinkedInPostElement.querySelector(".redflag-post-indicator");
    if (oldIndicator) oldIndicator.remove();
  }

  selectedLinkedInPostElement = postEl;
  selectedLinkedInPostId = getLinkedInPostId(postEl);

  postEl.classList.add("redflag-selected-post");
  if (!postEl.querySelector(".redflag-post-indicator")) {
    const indicator = document.createElement("div");
    indicator.className = "redflag-post-indicator jobscan-extension-root";
    indicator.textContent = "🚩 Selected for JobShield Analysis";
    if (postEl.firstChild) {
      postEl.insertBefore(indicator, postEl.firstChild);
    } else {
      postEl.appendChild(indicator);
    }
  }

  // Reset analysis results so previous post findings are immediately replaced
  currentJobData = null;
  currentAnalysisResult = null;
  lastAnalyzedSignature = "";

  console.log("JobShield: Selected LinkedIn post:", selectedLinkedInPostId);
  startAnalysis(true, 0);
}

function deselectLinkedInPost() {
  if (selectedLinkedInPostElement) {
    selectedLinkedInPostElement.classList.remove("redflag-selected-post");
    const ind = selectedLinkedInPostElement.querySelector(".redflag-post-indicator");
    if (ind) ind.remove();
  }
  selectedLinkedInPostElement = null;
  selectedLinkedInPostId = null;
  currentJobData = null;
  currentAnalysisResult = null;
  lastAnalyzedSignature = "";

  const existingStatus = document.getElementById(JOBSCAN_CONFIG.statusElementId);
  if (existingStatus) existingStatus.remove();
}

// Initialize content script
init();

async function init() {
  try {
    currentSite = detectCurrentSite();
    if (!currentSite) {
      console.log("JobShield: Unsupported site, not analyzing");
      return;
    }
    console.log("JobShield: Detected site:", currentSite);

    // Fetch initial settings from background
    try {
      const response = await sendMessageToBackground({ type: "GET_SETTINGS" });
      if (response && response.success && response.settings) {
        extensionEnabled = response.settings.extensionEnabled !== false;
        showWarnings = response.settings.showWarnings !== false;
        analysisMode = response.settings.analysisMode || "conservative";
      }
    } catch (e) {
      console.warn("JobShield: Could not fetch initial settings, using defaults", e);
    }

    if (!extensionEnabled) {
      console.log("JobShield: Extension disabled in settings, pausing analysis");
      return;
    }

    // Hook SPA navigation & user job card clicks
    hookNavigation();
    hookJobCardClicks();

    // Start initial analysis once DOM is ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => startAnalysis(true));
    } else {
      startAnalysis(true);
    }

    // Set up mutation observer for dynamic DOM updates
    setupObserver();
  } catch (error) {
    console.error("JobShield: Initialization error:", error);
  }
}

// ---------------------------------------------------------------------------
// SPA Navigation & Card Click Hooking
// ---------------------------------------------------------------------------
function hookNavigation() {
  const origPushState = history.pushState;
  history.pushState = function (...args) {
    const res = origPushState.apply(this, args);
    handleUrlOrJobChange("pushState");
    return res;
  };

  const origReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    const res = origReplaceState.apply(this, args);
    handleUrlOrJobChange("replaceState");
    return res;
  };

  window.addEventListener("popstate", () => handleUrlOrJobChange("popstate"));
  window.addEventListener("hashchange", () => handleUrlOrJobChange("hashchange"));
}

function hookJobCardClicks() {
  document.addEventListener(
    "click",
    (e) => {
      // 1. LinkedIn Feed Post click
      const postSelector = LINKEDIN_FEED_POST_SELECTORS.join(", ");
      const post = e.target.closest(postSelector);
      if (post && detectLinkedInPageType() !== "jobs") {
        console.log("JobShield: User clicked a LinkedIn feed post.");
        selectLinkedInPost(post);
        return;
      }

      // 2. Job card click on Indeed or LinkedIn Jobs
      const card = e.target.closest(
        ".job_seen_beacon, .cardOutline, .tapItem, [data-jk], .jobs-search-results-list__list-item, [data-occludable-job-id], .job-card-container"
      );
      if (card) {
        console.log("JobShield: User clicked a job card. Scheduling extraction.");
        setTimeout(() => startAnalysis(false, 0), 200);
      }
    },
    { passive: true }
  );
}

function handleUrlOrJobChange(triggerSource) {
  console.log(`JobShield: Navigation event detected (${triggerSource}):`, window.location.href);
  const newSite = detectCurrentSite();
  if (newSite !== currentSite) {
    currentSite = newSite;
  }
  if (!currentSite || !extensionEnabled) return;

  // If navigating away on LinkedIn, clear post selection
  if (currentSite === "linkedin") {
    selectedLinkedInPostElement = null;
    selectedLinkedInPostId = null;
  }

  startAnalysis(true, 0);
}

// ---------------------------------------------------------------------------
// Data Models & Text Utilities
// ---------------------------------------------------------------------------
function createEmptyJobData(platform = "") {
  return {
    postId: "",
    contentType: "", // 'linkedin-feed-post', 'linkedin-job', 'indeed-job', 'ziprecruiter-job'
    jobTitle: "",
    company: "",
    companyWebsite: "",
    companyVerified: null,
    recruiterName: "",
    recruiterEmail: "",
    location: "",
    workplaceType: "", // 'On-site', 'Remote', 'Hybrid'
    salary: "",
    currency: "",
    payPeriod: "",
    stipend: "",
    experience: "",
    education: "",
    employmentType: "",
    jobClassification: "job", // 'job' or 'internship'
    responsibilities: "",
    qualifications: "",
    benefits: "",
    applicationInstructions: "",
    applicationUrl: "",
    contactInstructions: "",
    selectionProcess: "",
    authorProfileUrl: "",
    companyProfileUrl: "",
    postedDate: "",
    applicantActivity: "",
    feesOrDeposits: [],
    sensitiveInfoRequests: [],
    guaranteedClaims: [],
    contactDetails: [],
    description: "",
    postExcerpt: "",
    jobUrl: "",
    platform: platform || currentSite || "unknown",
    strategy: "none",
    unextractedFields: [],
    diagnostics: null
  };
}

function cleanText(text) {
  if (!text || typeof text !== "string") return "";
  return text.replace(/\s+/g, " ").trim();
}

function getElementText(selector, parent = document) {
  if (!selector) return "";
  try {
    const el = parent.querySelector(selector);
    return el ? cleanText(el.textContent) : "";
  } catch (e) {
    return "";
  }
}

// Remove rating suffix (e.g. "Soranova Technologies Private Limited 3.8" -> "Soranova Technologies Private Limited")
function cleanCompanyName(name) {
  if (!name) return "";
  return name.replace(/\s+\d(?:\.\d)?\s*(?:★|stars?|out of \d)?\s*$/i, "").trim();
}

function extractSectionSnippet(fullText, headingRegex) {
  if (!fullText) return "";
  const lines = fullText.split(/\r?\n/);
  let capturing = false;
  let capturedLines = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (capturing) {
      if (!trimmed || /^[A-Z\s]{4,}:?$/.test(trimmed)) {
        break;
      }
      capturedLines.push(trimmed);
      if (capturedLines.length >= 4) break;
    } else if (headingRegex.test(trimmed)) {
      capturing = true;
      capturedLines.push(trimmed);
    }
  }
  return capturedLines.join(" ");
}

// ---------------------------------------------------------------------------
// Strategy 1: High-Precision Indeed Extraction
// ---------------------------------------------------------------------------
function extractIndeedJob() {
  const data = createEmptyJobData("indeed");
  const attemptedSelectors = {};

  // 1. Identify the Right-Hand Details Pane
  const paneSelectors = [
    "#jobsearch-ViewjobPaneWrapper",
    ".jobsearch-RightPane",
    'div[data-testid="jobsearch-ViewjobPane"]',
    "div[data-testid='viewJobSSRRoot']",
    "#viewJobSSRRoot",
    ".fastviewjob",
    "#vjs-container",
    ".jobsearch-ViewJobLayout-jobDisplay",
    ".jobsearch-JobComponent"
  ];

  let pane = null;
  for (const sel of paneSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      pane = el;
      break;
    }
  }

  // Fallback: locate container by job description presence
  if (!pane) {
    const descEl = document.querySelector("#jobDescriptionText, [data-testid='jobsearch-jobDescriptionText']");
    if (descEl) {
      pane = descEl.closest('#jobsearch-ViewjobPaneWrapper, .jobsearch-RightPane, .fastviewjob, #vjs-container, .jobsearch-JobComponent, main') || descEl.parentElement;
    }
  }

  // 2. Identify the active selected job card in the left rail (for cross-referencing and verification)
  const cardSelectors = [
    ".cardOutline.selected",
    ".job_seen_beacon.selected",
    "[data-mobtk].selected",
    ".tapItem.selected",
    ".tapItem[aria-current='true']",
    ".vjs-highlight",
    ".cardOutline[tabindex='0']",
    "li.css-5lfssm.selected"
  ];

  let selectedCard = null;
  for (const sel of cardSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      selectedCard = el;
      break;
    }
  }

  // On search results pages with no pane or selected card, do not fall back to document
  if (!pane && !selectedCard) {
    if (window.location.pathname.includes("/viewjob")) {
      pane = document.querySelector(".jobsearch-JobComponent, main") || document;
    } else {
      data.strategy = "none";
      return data;
    }
  }

  const root = pane || selectedCard;
  data.contentType = "indeed-job";
  data.strategy = pane ? "indeed-split-pane" : "indeed-selected-card";

  // ----------------------------------------------------
  // A. Job Title Extraction
  // ----------------------------------------------------
  const titleSelectors = [
    '[data-testid="jobsearch-JobInfoHeader-title"]',
    'h1.jobsearch-JobInfoHeader-title',
    'h2.jobsearch-JobInfoHeader-title',
    'h1[data-testid="simpler-jobTitle"]',
    '.jobsearch-JobInfoHeader-title span',
    '.jobsearch-JobInfoHeader-title',
    '#vjs-jobtitle',
    'h1'
  ];

  for (const sel of titleSelectors) {
    const text = getElementText(sel, root);
    if (text && text.length > 2 && !/^(indeed|jobs|search|results)$/i.test(text)) {
      data.jobTitle = text;
      break;
    }
  }

  // Fallback title from selected card
  if (!data.jobTitle && selectedCard) {
    const cardTitle = getElementText('h2.jobTitle span, a[id^="job_"] span, h2.jobTitle', selectedCard);
    if (cardTitle) {
      data.jobTitle = cardTitle;
    }
  }

  if (!data.jobTitle) {
    attemptedSelectors.jobTitle = titleSelectors;
  }

  // If title was found from the pane, find the matching card in the left list if selectedCard wasn't caught by class
  if (data.jobTitle && !selectedCard) {
    const allCards = document.querySelectorAll('.job_seen_beacon, .cardOutline, .tapItem');
    for (const c of allCards) {
      const cTitle = getElementText('h2.jobTitle span, a[id^="job_"] span, h2.jobTitle', c);
      if (cTitle && cTitle.toLowerCase() === data.jobTitle.toLowerCase()) {
        selectedCard = c;
        break;
      }
    }
  }

  // ----------------------------------------------------
  // B. Company Name Extraction
  // ----------------------------------------------------
  const companySelectors = [
    '[data-testid="inlineHeader-companyName"] a',
    '[data-testid="inlineHeader-companyName"] span',
    '[data-testid="inlineHeader-companyName"]',
    '.jobsearch-CompanyInfoContainer a',
    '.jobsearch-CompanyInfoContainer',
    '.jobsearch-CompanyInfoName a',
    '.jobsearch-CompanyInfoName',
    '[data-company-name="true"]',
    '.jobsearch-InlineCompanyRating a',
    '.jobsearch-InlineCompanyRating div',
    '.jobsearch-CompanyReview--heading',
    '.jobsearch-JobInfoHeader-subtitle a[href*="/cmp/"]',
    'div.jobsearch-CompanyInfoWithoutHeaderImage a',
    'div.jobsearch-JobInfoHeader-subtitle a'
  ];

  for (const sel of companySelectors) {
    const text = getElementText(sel, root);
    if (text) {
      data.company = cleanCompanyName(text);
      break;
    }
  }

  // Fallback to selected card
  if (!data.company && selectedCard) {
    const cardCompany = getElementText('[data-testid="company-name"], span.companyName, span.css-63koeb, span[class*="company"]', selectedCard);
    if (cardCompany) {
      data.company = cleanCompanyName(cardCompany);
    }
  }

  if (!data.company) {
    attemptedSelectors.company = companySelectors;
  }

  // ----------------------------------------------------
  // C. Location Extraction
  // ----------------------------------------------------
  const locationSelectors = [
    '[data-testid="inlineHeader-companyLocation"]',
    '[data-testid="job-location"]',
    '#jobLocationText',
    'div.jobsearch-JobInfoHeader-subtitle [data-testid="job-location"]',
    'div.jobsearch-JobInfoHeader-subtitle [data-testid="inlineHeader-companyLocation"]',
    'div[class*="companyLocation"]'
  ];

  for (const sel of locationSelectors) {
    const text = getElementText(sel, root);
    if (text) {
      data.location = text;
      break;
    }
  }

  // Subtitle children inspection for location tokens (e.g. Remote, City, State)
  if (!data.location && root) {
    const subtitle = root.querySelector('.jobsearch-JobInfoHeader-subtitle');
    if (subtitle) {
      const candidates = subtitle.querySelectorAll('div, span');
      for (const el of candidates) {
        const txt = cleanText(el.textContent);
        if (txt && txt !== data.company && !/^\d(?:\.\d)?$/.test(txt)) {
          if (/remote|hybrid/i.test(txt) || txt.includes(",") || /^[A-Z][a-zA-Z\s]+$/.test(txt)) {
            data.location = txt;
            break;
          }
        }
      }
    }
  }

  // Fallback to selected card
  if (!data.location && selectedCard) {
    const cardLoc = getElementText('[data-testid="text-location"], div.companyLocation, div[class*="companyLocation"]', selectedCard);
    if (cardLoc) {
      data.location = cardLoc;
    }
  }

  if (!data.location) {
    attemptedSelectors.location = locationSelectors;
  }

  // ----------------------------------------------------
  // D. Salary & Compensation Extraction
  // ----------------------------------------------------
  const salaryCandidates = root.querySelectorAll(
    '#salaryInfoAndJobType, #salaryInfoAndJobType span, [data-testid="salary-snippet-container"], [data-testid="jobsearch-JobMetadataHeader-item"], #jobDetailsSection div, #jobDetailsSection span, [data-testid="attribute_snippet_testid"], .jobsearch-JobMetadataHeader-item'
  );

  for (const el of salaryCandidates) {
    const txt = cleanText(el.textContent);
    if (txt && (txt.includes("₹") || txt.includes("$") || txt.includes("€") || txt.includes("£") || /Rs\.?|INR|\b(?:a\s+year|a\s+month|an\s+hour|per\s+year|annually)\b/i.test(txt))) {
      data.salary = txt;
      break;
    }
  }

  // Check general salary selectors if not caught
  if (!data.salary) {
    const sel = getElementText('#salaryInfoAndJobType, [data-testid="salary-snippet-container"], .salary-snippet-container', root);
    if (sel && (sel.includes("₹") || sel.includes("$") || sel.includes("€") || sel.includes("£") || /Rs\.?|INR/i.test(sel))) {
      data.salary = sel;
    }
  }

  // Fallback to selected card
  if (!data.salary && selectedCard) {
    const cardSalary = selectedCard.querySelectorAll('[data-testid="attribute_snippet_testid"], .salary-snippet-container, div[class*="metadata"]');
    for (const el of cardSalary) {
      const txt = cleanText(el.textContent);
      if (txt && (txt.includes("₹") || txt.includes("$") || txt.includes("€") || txt.includes("£") || /Rs\.?|INR/i.test(txt))) {
        data.salary = txt;
        break;
      }
    }
  }

  if (!data.salary) {
    attemptedSelectors.salary = ["#salaryInfoAndJobType", "[data-testid='jobsearch-JobMetadataHeader-item']", "[data-testid='attribute_snippet_testid']"];
  }

  // ----------------------------------------------------
  // E. Employment Type & Experience Extraction
  // ----------------------------------------------------
  const typePattern = /\b(Full-time|Part-time|Contract|Temporary|Internship|Fresher|Permanent|Volunteer)\b/i;
  const metadataCandidates = root.querySelectorAll(
    '#salaryInfoAndJobType, #salaryInfoAndJobType span, [data-testid="jobsearch-JobMetadataHeader-item"], #jobDetailsSection div, #jobDetailsSection span, div[aria-label*="Job type" i], .jobsearch-JobMetadataHeader-item'
  );

  for (const el of metadataCandidates) {
    const txt = cleanText(el.textContent);
    if (!data.employmentType) {
      const match = txt.match(typePattern);
      if (match) {
        data.employmentType = match[0];
      }
    }
    if (!data.experience) {
      const expMatch = txt.match(/\b(\d+[\s–-]+(?:\d+)?\s*(?:years?|yrs?)(?:\s*(?:of\s+)?experience)?)\b/i);
      if (expMatch) {
        data.experience = expMatch[0];
      } else if (/total\s*work:\s*(\d+\s*(?:years?|yrs?))/i.test(txt)) {
        data.experience = txt.match(/total\s*work:\s*(\d+\s*(?:years?|yrs?))/i)[1];
      }
    }
  }

  // Check card if employment type not yet found
  if (!data.employmentType && selectedCard) {
    const cardChips = selectedCard.querySelectorAll('[data-testid="attribute_snippet_testid"], div[class*="metadata"]');
    for (const el of cardChips) {
      const txt = cleanText(el.textContent);
      const match = txt.match(typePattern);
      if (match) {
        data.employmentType = match[0];
        break;
      }
    }
  }

  // ----------------------------------------------------
  // F. Description Extraction
  // ----------------------------------------------------
  const descSelectors = [
    '#jobDescriptionText',
    '[data-testid="jobsearch-jobDescriptionText"]',
    '.jobsearch-jobDescriptionText',
    '.jobsearch-JobComponent-description'
  ];

  for (const sel of descSelectors) {
    const el = root.querySelector(sel);
    if (el) {
      const text = el.innerText || el.textContent || "";
      if (text.trim().length > data.description.length) {
        data.description = text.trim();
      }
    }
  }

  if (!data.description) {
    attemptedSelectors.description = descSelectors;
  }

  // ----------------------------------------------------
  // G. Verified Job URL Resolution
  // ----------------------------------------------------
  // Rule: Must belong to the SELECTED job. Never guess or fabricate with arbitrary parameters!
  let verifiedJk = null;

  // Check 1: Card associated with this selected job
  if (selectedCard) {
    const cardLink = selectedCard.querySelector('a[data-jk], a[id^="job_"], a.jcs-JobTitle, a[href*="jk="]');
    if (cardLink) {
      verifiedJk = cardLink.getAttribute("data-jk") || (cardLink.id ? cardLink.id.replace("job_", "") : null);
      if (!verifiedJk && cardLink.href) {
        const m = cardLink.href.match(/jk=([a-zA-Z0-9_-]+)/);
        if (m) verifiedJk = m[1];
      }
    }
  }

  // Check 2: Header link or title link inside details pane
  if (!verifiedJk && pane) {
    const paneLink = pane.querySelector('a[href*="/viewjob?jk="], a[href*="/rc/clk?jk="], a[data-testid="jobsearch-JobInfoHeader-title-link"]');
    if (paneLink && paneLink.href) {
      const m = paneLink.href.match(/jk=([a-zA-Z0-9_-]+)/);
      if (m) verifiedJk = m[1];
    }
  }

  // Check 3: Standalone /viewjob URL
  if (!verifiedJk && window.location.pathname.includes("/viewjob")) {
    const urlObj = new URL(window.location.href);
    const paramJk = urlObj.searchParams.get("jk") || urlObj.searchParams.get("vjk");
    if (paramJk) verifiedJk = paramJk;
  }

  if (verifiedJk) {
    data.jobUrl = `${window.location.origin}/viewjob?jk=${verifiedJk}`;
  } else {
    data.jobUrl = ""; // Explicitly empty string if cannot be verified
    attemptedSelectors.jobUrl = ["selectedCard a[data-jk]", "pane a[href*='/viewjob?jk=']"];
  }

  // ----------------------------------------------------
  // H. Phase 1 Extended Fields: Website, Email, Classification, Instructions
  // ----------------------------------------------------
  const websiteSelectors = [
    'a[data-testid="company-website"]',
    'a[aria-label*="company website" i]',
    'a[aria-label*="visit company" i]',
    '.jobsearch-CompanyInfoContainer a[href^="http"]',
    'div.jobsearch-CompanyInfoWithoutHeaderImage a[href^="http"]'
  ];
  for (const sel of websiteSelectors) {
    const linkEl = root.querySelector(sel);
    if (linkEl && linkEl.href && !linkEl.href.includes("indeed.com")) {
      data.companyWebsite = linkEl.href;
      break;
    }
  }
  if (!data.companyWebsite && data.description) {
    const webMatch = data.description.match(/https?:\/\/(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s.,)]*)?/i);
    if (webMatch && !webMatch[0].includes("indeed.com")) {
      data.companyWebsite = webMatch[0];
    }
  }

  if (data.description) {
    const emailMatches = data.description.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g);
    if (emailMatches) {
      const valid = emailMatches.filter((e) => {
        const el = e.toLowerCase();
        return !el.endsWith("indeed.com") && !el.endsWith("linkedin.com") && !el.includes("noreply") && !el.includes("donotreply");
      });
      if (valid.length > 0) {
        data.recruiterEmail = valid[0];
      }
    }
  }

  const fullText = `${data.jobTitle || ""} ${data.employmentType || ""} ${data.description || ""}`.toLowerCase();
  data.jobClassification = /\b(intern|internship|trainee|apprentice)\b/i.test(fullText) ? "internship" : "job";

  data.applicationInstructions = extractSectionSnippet(data.description, /(?:how\s*to\s*apply|application\s*instructions?|to\s*apply|application\s*process):?/i);
  data.contactInstructions = extractSectionSnippet(data.description, /(?:contact\s*us|contact\s*details|reach\s*out|send\s*resume\s*to|queries|for\s*more\s*info):?/i);
  data.selectionProcess = extractSectionSnippet(data.description, /(?:selection\s*process|interview\s*process|hiring\s*process|evaluation\s*rounds?|selection\s*criteria):?/i);

  data.unextractedFields = [];
  if (!data.companyWebsite) data.unextractedFields.push("companyWebsite");
  if (!data.recruiterEmail) data.unextractedFields.push("recruiterEmail");
  if (!data.salary) data.unextractedFields.push("salary");
  if (!data.employmentType) data.unextractedFields.push("employmentType");
  data.postId = verifiedJk || "";
  data.postExcerpt = data.description ? (data.description.slice(0, 160) + (data.description.length > 160 ? "..." : "")) : "";

  data.diagnostics = logExtractionDiagnostics(data, attemptedSelectors);
  return data;
}

// ---------------------------------------------------------------------------
// Strategy 1: High-Precision LinkedIn Extraction
// ---------------------------------------------------------------------------
function extractLinkedInJob(mode = "") {
  const data = createEmptyJobData("linkedin");
  const attemptedSelectors = {};
  const isViewJobPage = mode === "job-detail" || window.location.pathname.includes("/jobs/view/");

  // 1. Identify Top Card and Details Containers
  const topCardSelectors = [
    ".job-details-jobs-unified-top-card",
    ".jobs-unified-top-card",
    ".top-card-layout",
    ".topcard",
    "[class*='jobs-unified-top-card']",
    "[class*='job-details-jobs-unified-top-card']"
  ];
  let topCard = null;
  for (const sel of topCardSelectors) {
    const el = document.querySelector(sel);
    if (el) { topCard = el; break; }
  }

  const descContainerSelectors = [
    "#job-details",
    ".jobs-description__content",
    ".jobs-description",
    ".jobs-box__html-content",
    ".jobs-details__main-content"
  ];
  let descContainer = null;
  for (const sel of descContainerSelectors) {
    const el = document.querySelector(sel);
    if (el) { descContainer = el; break; }
  }

  // Active job card in left rail (search mode only)
  const cardSelectors = [
    ".jobs-search-results-list__list-item--active",
    "li.jobs-search-results-list__list-item.active",
    "div[data-occludable-job-id].active",
    ".job-card-container--clickable.active"
  ];

  let selectedCard = null;
  if (!isViewJobPage) {
    for (const sel of cardSelectors) {
      const el = document.querySelector(sel);
      if (el) { selectedCard = el; break; }
    }
  }

  // Root container resolution
  let pane = document.querySelector("main.scaffold-layout__main, .job-view-layout, .jobs-search__job-details, .scaffold-layout__detail, main") || document;
  const root = pane || selectedCard || document;

  data.contentType = "linkedin-job";
  data.strategy = isViewJobPage ? "linkedin-view-job" : (selectedCard ? "linkedin-selected-card" : "linkedin-split-pane");

  // ----------------------------------------------------
  // A. Job Title Extraction (Never truncate hyphens in titles like "6-Month")
  // ----------------------------------------------------
  const titleSelectors = [
    "h1.job-details-jobs-unified-top-card__job-title",
    ".job-details-jobs-unified-top-card__job-title h1",
    ".job-details-jobs-unified-top-card__job-title a",
    ".job-details-jobs-unified-top-card__job-title",
    "h1.t-24",
    ".t-24.job-details-jobs-unified-top-card__job-title",
    "h1.top-card-layout__title",
    "h1.topcard__title",
    "[data-test-job-title]",
    ".jobs-unified-top-card__job-title a",
    ".jobs-unified-top-card__job-title",
    ".jobs-search__job-details h1",
    "h1"
  ];

  // Try topCard first, then document
  for (const sel of titleSelectors) {
    const text = (topCard ? getElementText(sel, topCard) : "") || getElementText(sel, root);
    if (text && text.length > 2 && !/^(linkedin|jobs|search|notifications|messaging)$/i.test(text)) {
      data.jobTitle = text;
      break;
    }
  }

  if (!data.jobTitle && selectedCard) {
    const cardTitle = getElementText(".job-card-list__title, a.job-card-container__link, .artdeco-entity-lockup__title", selectedCard);
    if (cardTitle) {
      data.jobTitle = cardTitle;
    }
  }

  // Safe document.title fallback (Only split on spaced pipe/bullet or spaced dash, NEVER within words like "6-Month")
  if (!data.jobTitle && typeof document !== "undefined" && document.title) {
    const rawTitle = document.title || "";
    const hiringMatch = rawTitle.match(/^(.+?)\s+hiring\s+(.+?)\s+in\s+/i);
    if (hiringMatch) {
      if (!data.company) data.company = cleanCompanyName(hiringMatch[1]);
      data.jobTitle = cleanText(hiringMatch[2]);
    } else {
      const parts = rawTitle.split(/\s+[|•·]\s+|\s+-\s+/).map((p) => p.trim());
      if (parts.length >= 2 && !/^(linkedin|jobs)$/i.test(parts[0])) {
        data.jobTitle = cleanText(parts[0]);
        if (!data.company && parts[1] && !parts[1].toLowerCase().includes("linkedin")) {
          data.company = cleanCompanyName(parts[1]);
        }
      }
    }
  }

  if (!data.jobTitle) {
    attemptedSelectors.jobTitle = titleSelectors;
  }

  // ----------------------------------------------------
  // B. Company Name Extraction
  // ----------------------------------------------------
  const companySelectors = [
    ".job-details-jobs-unified-top-card__company-name a",
    ".job-details-jobs-unified-top-card__company-name",
    ".jobs-unified-top-card__company-name a",
    ".jobs-unified-top-card__company-name",
    ".job-details-jobs-unified-top-card__primary-description-container a[href*='/company/']",
    ".topcard__org-name-link",
    "a[data-tracking-control-name*='topcard-org-name']",
    "a.topcard__org-name-link",
    "a[href*='/company/']"
  ];

  for (const sel of companySelectors) {
    const text = (topCard ? getElementText(sel, topCard) : "") || getElementText(sel, root);
    if (text) {
      data.company = cleanCompanyName(text);
      break;
    }
  }

  if (!data.company && selectedCard) {
    const cardCompany = getElementText(".job-card-container__company-name, .artdeco-entity-lockup__subtitle", selectedCard);
    if (cardCompany) {
      data.company = cleanCompanyName(cardCompany);
    }
  }

  if (!data.company) {
    attemptedSelectors.company = companySelectors;
  }

  // ----------------------------------------------------
  // C. Location, Posted Age & Applicant Activity Extraction
  // ----------------------------------------------------
  const subtitleSelectors = [
    ".job-details-jobs-unified-top-card__primary-description-container",
    ".job-details-jobs-unified-top-card__tertiary-description",
    ".jobs-unified-top-card__bullet",
    ".job-details-jobs-unified-top-card__bullet",
    ".topcard__flavor-row",
    "[class*='top-card'] [class*='primary-description']"
  ];

  for (const sel of subtitleSelectors) {
    const text = (topCard ? getElementText(sel, topCard) : "") || getElementText(sel, root);
    if (text) {
      const parts = text.split(/[·•|]/).map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        if (/\b(?:ago|reposted|posted|just now|day|days|month|months|week|weeks|hour|hours)\b/i.test(part) && !data.postedDate) {
          data.postedDate = part;
        } else if (/\b(?:applicant|applied|clicked apply|people clicked)\b/i.test(part) && !data.applicantActivity) {
          data.applicantActivity = part;
        } else if (!data.location && !/^(responses managed|see recent|easy apply)/i.test(part)) {
          data.location = part;
        }
      }
      if (data.location) break;
    }
  }

  if (!data.location && selectedCard) {
    const cardLoc = getElementText(".job-card-container__metadata-item", selectedCard);
    if (cardLoc) {
      data.location = cardLoc;
    }
  }

  if (!data.location) {
    attemptedSelectors.location = subtitleSelectors;
  }

  // ----------------------------------------------------
  // D. Workplace Type & Employment Type Badges (e.g. On-site, Internship)
  // ----------------------------------------------------
  const badgeSelectors = [
    ".ui-pill",
    ".ui-label",
    ".job-details-preference-insight",
    ".job-details-jobs-unified-top-card__job-insight-view-model-secondary",
    "li.job-details-jobs-unified-top-card__job-insight",
    ".job-details-jobs-unified-top-card__job-insight",
    "[class*='job-insight']",
    "[class*='workplace-type']",
    "button[class*='job-insight']"
  ];

  const badgeEls = Array.from((topCard || root).querySelectorAll(badgeSelectors.join(", "))).concat(
    isViewJobPage ? Array.from(document.querySelectorAll(badgeSelectors.join(", "))) : []
  );

  for (const el of badgeEls) {
    const txt = cleanText(el.textContent);
    // Workplace arrangement
    const wpMatch = txt.match(/\b(On-site|Remote|Hybrid)\b/i);
    if (wpMatch && !data.workplaceType) {
      data.workplaceType = wpMatch[0].charAt(0).toUpperCase() + wpMatch[0].slice(1).toLowerCase();
    }
    // Employment type
    const typeMatch = txt.match(/\b(Full-time|Part-time|Contract|Temporary|Internship|Volunteer)\b/i);
    if (typeMatch && !data.employmentType) {
      data.employmentType = typeMatch[0];
    }
    // Salary
    if (/[\$₹€£]|\d+k|\/yr|\/hr|year|hour|month/i.test(txt) && !data.salary) {
      const parts = txt.split(/[·•|]/).map((s) => s.trim());
      const salPart = parts.find((p) => /[\$₹€£]|\d+k|\/yr|\/hr|year|hour|month/i.test(p));
      data.salary = salPart || txt;
    }
    // Experience
    const expMatch = txt.match(/\b(Entry level|Associate|Mid-Senior level|Director|Executive|\d+\+?\s*(?:years?|yrs?))\b/i);
    if (expMatch && !data.experience) {
      data.experience = expMatch[0];
    }
  }

  // ----------------------------------------------------
  // E. Description Extraction (Preserving full text)
  // ----------------------------------------------------
  const descSelectors = [
    "#job-details",
    ".jobs-description__content .jobs-box__html-content",
    ".jobs-description-content__text",
    ".jobs-description__content",
    ".jobs-box__html-content",
    "article.jobs-description__container",
    ".jobs-description",
    "[data-job-description]"
  ];

  for (const sel of descSelectors) {
    const el = (descContainer ? descContainer.querySelector(sel) : null) || document.querySelector(sel);
    if (el) {
      const text = el.innerText || el.textContent || "";
      if (text.trim().length > data.description.length) {
        data.description = text.trim();
      }
    }
  }

  if (!data.description && descContainer) {
    data.description = (descContainer.innerText || descContainer.textContent || "").trim();
  }

  if (!data.description) {
    attemptedSelectors.description = descSelectors;
  }

  // ----------------------------------------------------
  // F. Description Regex Fallbacks for Type, Duration, Stipend
  // ----------------------------------------------------
  if (data.description) {
    // Type fallback from text (e.g., "Type: Full-Time Internship (Stipend-Paid)")
    if (!data.employmentType) {
      const typeTextMatch = data.description.match(/(?:type|employment\s*type|job\s*type)\s*:\s*([^\n\r,.;]+)/i);
      if (typeTextMatch) {
        const tVal = typeTextMatch[1].trim();
        const m = tVal.match(/\b(Full-time|Part-time|Contract|Temporary|Internship|Volunteer)\b/i);
        data.employmentType = m ? m[0] : tVal;
      }
    }
    // Stipend / Salary extraction from description
    if (/\((?:stipend-paid|paid\s*stipend|stipend)\)/i.test(data.description) || /stipend\s*:\s*([^\n\r,.;]+)/i.test(data.description)) {
      const stMatch = data.description.match(/stipend\s*:\s*([^\n\r,.;]+)/i);
      data.stipend = stMatch ? cleanText(stMatch[1]) : "Stipend-Paid";
      if (!data.salary) data.salary = data.stipend;
    }
    // Workplace type fallback
    if (!data.workplaceType) {
      const wpMatch = data.description.match(/\b(On-site|Remote|Hybrid)\b/i);
      if (wpMatch) data.workplaceType = wpMatch[0].charAt(0).toUpperCase() + wpMatch[0].slice(1).toLowerCase();
    }
  }

  // ----------------------------------------------------
  // G. Verified Job URL Resolution
  // ----------------------------------------------------
  let verifiedId = null;
  if (topCard) {
    const titleLink = topCard.querySelector("a.job-details-jobs-unified-top-card__job-title-link, a[href*='/jobs/view/']");
    if (titleLink && titleLink.href) {
      const m = titleLink.href.match(/\/jobs\/view\/(\d+)/);
      if (m) verifiedId = m[1];
    }
  }

  if (!verifiedId && selectedCard) {
    const cardLink = selectedCard.querySelector("a[data-job-id], a[href*='/jobs/view/']");
    if (cardLink) {
      verifiedId = cardLink.getAttribute("data-job-id");
      if (!verifiedId && cardLink.href) {
        const m = cardLink.href.match(/\/jobs\/view\/(\d+)/);
        if (m) verifiedId = m[1];
      }
    }
  }

  if (!verifiedId && window.location.href.includes("/jobs/view/")) {
    const m = window.location.href.match(/\/jobs\/view\/(\d+)/);
    if (m) verifiedId = m[1];
  }

  if (verifiedId) {
    data.jobUrl = `https://www.linkedin.com/jobs/view/${verifiedId}/`;
  } else {
    data.jobUrl = "";
    attemptedSelectors.jobUrl = ["topCard a[href*='/jobs/view/']", "selectedCard a[data-job-id]"];
  }

  // ----------------------------------------------------
  // H. Extended Fields: Company Profile, Email, Sections
  // ----------------------------------------------------
  const compProfileEl = (topCard || root).querySelector("a[href*='/company/']");
  if (compProfileEl && compProfileEl.href) {
    data.companyProfileUrl = compProfileEl.href;
    data.companyWebsite = compProfileEl.href;
  }

  if (data.description) {
    const webMatch = data.description.match(/https?:\/\/(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s.,)]*)?/i);
    if (webMatch && !webMatch[0].includes("linkedin.com")) {
      data.companyWebsite = webMatch[0];
    }

    const emailMatches = data.description.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g);
    if (emailMatches) {
      const valid = emailMatches.filter((e) => {
        const el = e.toLowerCase();
        return !el.endsWith("indeed.com") && !el.endsWith("linkedin.com") && !el.includes("noreply") && !el.includes("donotreply");
      });
      if (valid.length > 0) {
        data.recruiterEmail = valid[0];
      }
    }
  }

  const fullText = `${data.jobTitle || ""} ${data.employmentType || ""} ${data.description || ""}`.toLowerCase();
  data.jobClassification = /\b(intern|internship|trainee|apprentice)\b/i.test(fullText) ? "internship" : "job";

  data.responsibilities = extractSectionSnippet(data.description, /(?:responsibilities|the\s*role|key\s*tasks|what\s*you\s*will\s*do):?/i);
  data.qualifications = extractSectionSnippet(data.description, /(?:requirements|qualifications|what\s*we\s*are\s*looking\s*for|skills?):?/i);
  data.benefits = extractSectionSnippet(data.description, /(?:benefits|perks|what\s*we\s*offer):?/i);
  data.applicationInstructions = extractSectionSnippet(data.description, /(?:how\s*to\s*apply|application\s*instructions?|to\s*apply|application\s*process):?/i);
  data.contactInstructions = extractSectionSnippet(data.description, /(?:contact\s*us|contact\s*details|reach\s*out|send\s*resume\s*to|queries|for\s*more\s*info):?/i);
  data.selectionProcess = extractSectionSnippet(data.description, /(?:selection\s*process|interview\s*process|hiring\s*process|evaluation\s*rounds?|selection\s*criteria):?/i);

  data.unextractedFields = [];
  if (!data.companyWebsite) data.unextractedFields.push("companyWebsite");
  if (!data.recruiterEmail) data.unextractedFields.push("recruiterEmail");
  if (!data.salary) data.unextractedFields.push("salary");
  if (!data.experience) data.unextractedFields.push("experience");
  if (!data.employmentType) data.unextractedFields.push("employmentType");
  data.postId = verifiedId || "";
  data.postExcerpt = data.description ? (data.description.slice(0, 160) + (data.description.length > 160 ? "..." : "")) : "";

  data.diagnostics = logExtractionDiagnostics(data, attemptedSelectors);
  return data;
}

// ---------------------------------------------------------------------------
// Strategy 1b: LinkedIn Feed Post Extraction (Strictly Scoped to Post Container)
// ---------------------------------------------------------------------------
function extractLinkedInFeedPost(postEl) {
  const data = createEmptyJobData("linkedin");
  data.contentType = "linkedin-feed-post";
  data.strategy = "linkedin-feed-post";
  data.postId = getLinkedInPostId(postEl);
  data.jobUrl = getLinkedInPostUrl(postEl);

  // A. Scoped Post Text Extraction
  // Programmatically expand "...see more" buttons to prevent truncation
  try {
    const seeMoreBtn = postEl.querySelector(
      "button.feed-shared-inline-show-more-text__button, button[aria-label*='see more' i], .feed-shared-see-more"
    );
    if (seeMoreBtn && typeof seeMoreBtn.click === "function") {
      seeMoreBtn.click();
    }
  } catch (e) {
    // Ignore DOM click errors
  }

  const textSelectors = [
    ".feed-shared-update-v2__description",
    ".update-components-text",
    ".feed-shared-text",
    ".feed-shared-inline-show-more-text",
    ".feed-shared-text-view",
    "div[class*='update-v2__commentary']",
    "span.break-words",
    "div.entity-result__content-summary",
    ".search-results-container .entity-result__summary",
    "div[data-view-name*='feed-full-update'] .feed-shared-text",
    ".feed-shared-main-content"
  ];

  let postText = "";
  for (const sel of textSelectors) {
    const el = postEl.querySelector(sel);
    if (el) {
      const t = el.innerText || el.textContent || "";
      if (t.trim().length > postText.length) {
        postText = t.trim();
      }
    }
  }

  if (!postText) {
    // Clone post to remove social actions, header, and comments
    const clone = postEl.cloneNode(true);
    const excludeSelectors = [
      ".feed-shared-actor",
      ".update-components-actor",
      ".feed-shared-social-actions",
      ".feed-shared-social-action-bar",
      ".feed-shared-social-counts",
      ".comments-comments-list",
      ".feed-shared-control-menu",
      ".jobscan-extension-root",
      ".redflag-post-indicator"
    ];
    for (const ex of excludeSelectors) {
      const matched = clone.querySelectorAll(ex);
      for (const m of matched) m.remove();
    }
    postText = cleanText(clone.innerText || clone.textContent || "");
  }

  // B. Embedded Job Card Extraction (e.g. Edvexa on content search)
  let embeddedCardText = "";
  const embeddedCard = postEl.querySelector(
    ".update-components-mini-update-v2, .feed-shared-mini-update-v2, [data-view-name*='job-card'], a[data-control-name='job_card'], .entity-result__item, div[class*='mini-update']"
  );
  if (embeddedCard) {
    const cardTitle = getElementText(
      ".update-components-mini-update-v2__title, .feed-shared-mini-update-v2__title, [class*='mini-update-v2__title'], h2, h3",
      embeddedCard
    );
    if (cardTitle && cardTitle.length > 2) data.jobTitle = cleanText(cardTitle);

    const cardComp = getElementText(
      ".update-components-mini-update-v2__sub-title, .feed-shared-mini-update-v2__sub-title, [class*='mini-update-v2__sub-title']",
      embeddedCard
    );
    if (cardComp) data.company = cleanCompanyName(cardComp);

    const cardLoc = getElementText(
      ".update-components-mini-update-v2__metadata, .feed-shared-mini-update-v2__metadata, [class*='mini-update-v2__metadata']",
      embeddedCard
    );
    if (cardLoc) data.location = cleanText(cardLoc);

    embeddedCardText = cleanText(embeddedCard.innerText || embeddedCard.textContent || "");
  }

  // Combine commentary and attached job card text so detector evaluates all evidence
  const combinedDesc = [postText, embeddedCardText ? `Job Card Details: ${embeddedCardText}` : ""].filter(Boolean).join("\n\n");
  data.description = combinedDesc || postText;
  data.postExcerpt = data.description ? (data.description.slice(0, 160) + (data.description.length > 160 ? "..." : "")) : "";

  // C. Recruiter Name & Headline
  const actorNameSel = [
    ".update-components-actor__name span[aria-hidden='true']",
    ".update-components-actor__name",
    ".feed-shared-actor__name",
    "a[data-field='actor_name']"
  ];
  for (const sel of actorNameSel) {
    const name = getElementText(sel, postEl);
    if (name) {
      data.recruiterName = name;
      break;
    }
  }

  const actorDescSel = [
    ".update-components-actor__description",
    ".feed-shared-actor__description",
    ".update-components-actor__sub-description"
  ];
  let actorHeadline = "";
  for (const sel of actorDescSel) {
    const desc = getElementText(sel, postEl);
    if (desc) {
      actorHeadline = desc;
      break;
    }
  }

  // D. Company Extraction (strictly scoped to postEl)
  if (!data.company) {
    const atMatch = actorHeadline.match(/\b(?:at|@|for)\s+([A-Z][A-Za-z0-9&.,\s]{2,35})/);
    if (atMatch) {
      data.company = cleanCompanyName(atMatch[1]);
    }
  }
  if (!data.company) {
    const hiringCompMatch = postText.match(/([A-Z][A-Za-z0-9&.,\s]{1,30})\s+(?:is|are)\s+hiring\b/i);
    if (hiringCompMatch && !/^(we|everyone|company|someone|team)$/i.test(hiringCompMatch[1].trim())) {
      data.company = cleanCompanyName(hiringCompMatch[1]);
    }
  }
  if (!data.company) {
    const atHiringMatch = postText.match(/we(?:'re|\s+are)\s+hiring\s+(?:interns?|freshers?|developers?|for)?\s*(?:at|for|with)\s+([A-Z][A-Za-z0-9&.,\s]{1,30})/i);
    if (atHiringMatch) {
      data.company = cleanCompanyName(atHiringMatch[1]);
    }
  }
  if (!data.company) {
    const compLink = postEl.querySelector("a[href*='/company/']");
    if (compLink) {
      const compText = cleanCompanyName(cleanText(compLink.textContent));
      if (compText && compText.length > 1 && !compText.toLowerCase().includes("see all")) {
        data.company = compText;
      }
    }
  }
  if (!data.company) {
    const compMatch = postText.match(/\b(?:at|company|organization|startup)\s*:\s*([A-Z][A-Za-z0-9&.,\s]{2,30})/i);
    if (compMatch) {
      data.company = cleanCompanyName(compMatch[1]);
    }
  }

  // E. Job Title / Role Extraction
  if (!data.jobTitle) {
    const roleRegexes = [
      /(?:role|position|profile|title)\s*:\s*([^\n,]{3,50})/i,
      /(?:is\s+hiring\s*[|\-–:]\s*)([a-zA-Z0-9\s/–-]+(?:internship|opportunity|developer|engineer|intern|trainee|associate|specialist|manager|executive))/i,
      /(?:we(?:'re|\s+are)\s+hiring\s+)([a-zA-Z0-9\s/–-]+(?:internship|opportunity|developer|engineer|intern|trainee|associate|specialist|manager|executive))/i,
      /(?:hiring\s+now\s*[|\-–:]\s*)([a-zA-Z0-9\s/]+(?:internship|opportunity|developer|engineer|intern|trainee|associate|specialist|manager|executive))/i,
      /(?:urgent(?:ly)?\s+hiring\s+for\s+)([a-zA-Z0-9\s/]+(?:developers?|engineers?|interns?|executives?|freshers?))/i,
      /(?:hiring\s+for|looking\s+for|urgent\s+requirement\s+for|position\s*:|role\s*:|job\s*title\s*:|we\s+are\s+hiring\s*:?|opening\s+for)\s*[:\-–]?\s*([A-Za-z0-9\s/–-]{3,50})(?=[,\n.]|$)/i
    ];
    for (const r of roleRegexes) {
      const m = postText.match(r);
      if (m && m[1]) {
        const titleCandidate = cleanText(m[1]).replace(/[|:–\-]+$/, "").trim();
        if (titleCandidate.length > 2 && !/^(immediate|urgent|join|apply|fresher)$/i.test(titleCandidate)) {
          data.jobTitle = titleCandidate;
          break;
        }
      }
    }
  }
  if (!data.jobTitle) {
    const lines = postText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const cleanLine = line.replace(/^[#*•\-\s]+/, "").trim();
      if (
        cleanLine.length >= 4 &&
        cleanLine.length <= 60 &&
        !/^(hello|hi|dear|greetings|hope|urgent hiring|we are hiring|hiring alert|opportunity|please|connect)/i.test(cleanLine)
      ) {
        data.jobTitle = cleanLine;
        break;
      }
    }
  }
  if (!data.jobTitle && /remote\s+personal\s+assistant/i.test(postText)) {
    data.jobTitle = "Remote Personal Assistant";
  }

  // E. Content-Type Classification & Role Assignment
  if ((typeof JobShieldDetector !== "undefined" || typeof RedFlagDetector !== "undefined") && (typeof JobShieldDetector !== "undefined" ? JobShieldDetector : RedFlagDetector).classifyContentType) {
    const classification = (typeof JobShieldDetector !== "undefined" ? JobShieldDetector : RedFlagDetector).classifyContentType(data, "linkedin-feed-post");
    data.contentType = classification.category || "job_hiring_post";
    data.classification = classification;
    if (classification.roleTitle && (!data.jobTitle || data.jobTitle === "Job Opportunity" || data.jobTitle === "LinkedIn Post")) {
      data.jobTitle = classification.roleTitle;
    }
  } else {
    data.contentType = "job_hiring_post";
  }

  if (!data.jobTitle && postText.length >= 25) {
    data.jobTitle = "Job Opportunity";
  }

  // E. Location Extraction (strictly scoped)
  const locMatch = postText.match(/\b(remote|work\s*from\s*home|hybrid|wfh)\b/i);
  if (locMatch) {
    data.location = locMatch[0].charAt(0).toUpperCase() + locMatch[0].slice(1).toLowerCase();
  } else {
    const locKeywordMatch = postText.match(/\b(?:location|based\s*in|job\s*location)\s*:\s*([^\n,]{2,40})/i);
    if (locKeywordMatch) {
      data.location = cleanText(locKeywordMatch[1]);
    }
  }

  // F. Salary & Employment Type (strictly scoped)
  const salMatch = postText.match(/(?:(?:salary|stipend|ctc|pay|package)\s*:\s*([^\n,]{2,40})|[\$₹€£]\s*[\d,]+(?:\s*[-–]\s*[\$₹€£]?\s*[\d,]+)?(?:\s*(?:k|per\s*(?:month|year|hr|annum)|\/mo|\/yr))?)/i);
  if (salMatch) {
    data.salary = cleanText(salMatch[1] || salMatch[0]);
  }

  const typeMatch = postText.match(/\b(Full-time|Part-time|Contract|Temporary|Internship|Freelance)\b/i);
  if (typeMatch) {
    data.employmentType = typeMatch[0];
  }

  // G. Classification
  const fullText = `${data.jobTitle || ""} ${data.employmentType || ""} ${postText}`.toLowerCase();
  data.jobClassification = /\b(intern|internship|trainee|apprentice)\b/i.test(fullText) ? "internship" : "job";

  // H. Website & Email (strictly scoped to postEl)
  const links = postEl.querySelectorAll("a[href^='http']");
  for (const a of links) {
    const h = a.href;
    if (!h.includes("linkedin.com") && !h.includes("licdn.com") && !h.includes("lnkd.in")) {
      data.companyWebsite = h;
      break;
    }
  }
  if (!data.companyWebsite && postText) {
    const webMatch = postText.match(/https?:\/\/(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s.,)]*)?/i);
    if (webMatch && !webMatch[0].includes("linkedin.com") && !webMatch[0].includes("licdn.com")) {
      data.companyWebsite = webMatch[0];
    }
  }

  if (postText) {
    const emailMatches = postText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g);
    if (emailMatches) {
      const valid = emailMatches.filter((e) => {
        const el = e.toLowerCase();
        return !el.endsWith("linkedin.com") && !el.endsWith("indeed.com") && !el.includes("noreply") && !el.includes("donotreply");
      });
      if (valid.length > 0) {
        data.recruiterEmail = valid[0];
      }
    }
  }

  data.applicationInstructions = extractSectionSnippet(postText, /(?:how\s*to\s*apply|application\s*instructions?|to\s*apply|application\s*process):?/i);
  data.contactInstructions = extractSectionSnippet(postText, /(?:contact\s*us|contact\s*details|reach\s*out|send\s*resume\s*to|queries|for\s*more\s*info|dm\s*me|whatsapp):?/i);
  data.selectionProcess = extractSectionSnippet(postText, /(?:selection\s*process|interview\s*process|hiring\s*process|evaluation\s*rounds?|selection\s*criteria):?/i);

  data.unextractedFields = [];
  if (!data.companyWebsite) data.unextractedFields.push("companyWebsite");
  if (!data.recruiterEmail) data.unextractedFields.push("recruiterEmail");
  if (!data.salary) data.unextractedFields.push("salary");
  if (!data.employmentType) data.unextractedFields.push("employmentType");

  data.diagnostics = logExtractionDiagnostics(data, {});
  return data;
}

// ---------------------------------------------------------------------------
// Strategy 1: ZipRecruiter Extraction
// ---------------------------------------------------------------------------
function extractZipRecruiterJob() {
  const data = createEmptyJobData("ziprecruiter");
  const pane = document.querySelector(".job_details_container, #job_details, main, .job_header") || document;

  data.jobTitle = getElementText(".job_title span, h1.job_title, h1.jobTitle, h1", pane);
  data.company = cleanCompanyName(getElementText(".job_details_link.hiring_company_item, a.job_details_link[href*='/c/'], .hiring_company, .hiring_company_item", pane));
  data.location = getElementText("span.location_text, .job_location .value, .location", pane);
  data.salary = getElementText(".perk_item_body, span[data-name='perk_item_body_salary'], .job_compensation", pane);
  data.description = getElementText(".job_description, .jobDescriptionSection", pane);
  data.strategy = "ziprecruiter-pane";
  data.jobUrl = window.location.href;
  data.diagnostics = logExtractionDiagnostics(data, {});
  return data;
}

// ---------------------------------------------------------------------------
// Strategy 2: JSON-LD Structured Data
// ---------------------------------------------------------------------------
function extractFromJsonLd() {
  try {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      if (!script.textContent) continue;
      let parsed;
      try {
        parsed = JSON.parse(script.textContent);
      } catch (e) {
        continue;
      }

      const items = Array.isArray(parsed) ? parsed : (parsed["@graph"] || [parsed]);
      for (const item of items) {
        if (item && (item["@type"] === "JobPosting" || item["@type"]?.includes?.("JobPosting"))) {
          let salary = "";
          if (item.baseSalary) {
            const val = item.baseSalary.value || item.baseSalary;
            if (typeof val === "object") {
              const cur = item.baseSalary.currency || val.currency || "";
              if (val.minValue && val.maxValue) {
                salary = `${cur} ${val.minValue}–${val.maxValue} ${val.unitText || ""}`.trim();
              } else if (val.value) {
                salary = `${cur} ${val.value} ${val.unitText || ""}`.trim();
              }
            } else if (typeof val === "string" || typeof val === "number") {
              salary = String(val);
            }
          }

          let location = "";
          if (item.jobLocation) {
            const addr = item.jobLocation.address || item.jobLocation;
            if (typeof addr === "object") {
              location = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(", ");
            } else if (typeof addr === "string") {
              location = addr;
            }
          }
          if (!location && (item.jobLocationType === "TELECOMMUTE" || item.applicantLocationRequirements)) {
            location = "Remote";
          }

          let desc = item.description || "";
          if (desc && desc.includes("<")) {
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = desc;
            desc = tempDiv.textContent || tempDiv.innerText || "";
          }

          return {
            jobTitle: cleanText(item.title) || "",
            company: cleanCompanyName(cleanText(item.hiringOrganization?.name || (typeof item.hiringOrganization === "string" ? item.hiringOrganization : "")) || ""),
            location: cleanText(location) || "",
            salary: cleanText(salary) || "",
            experience: cleanText(item.experienceRequirements) || "",
            employmentType: cleanText(item.employmentType) || "",
            description: desc.trim() || "",
            jobUrl: item.url || "",
            platform: currentSite || "unknown",
            strategy: "json-ld"
          };
        }
      }
    }
  } catch (err) {
    console.warn("JobShield: Error parsing JSON-LD:", err);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Strategy 3 & 4: Semantic Fallbacks
// ---------------------------------------------------------------------------
function extractSemanticFallback(site) {
  const main = document.querySelector("main, article, [role='main']");
  if (!main) return null;

  const h1 = main.querySelector("h1, h2");
  const title = h1 ? cleanText(h1.textContent) : "";
  if (!title || title.length < 3) return null;

  return {
    jobTitle: title,
    strategy: "semantic-fallback"
  };
}

// ---------------------------------------------------------------------------
// Field-Level Diagnostics Logger
// ---------------------------------------------------------------------------
function logExtractionDiagnostics(jobData, attemptedMethods = {}) {
  const fields = {
    jobTitle: jobData.jobTitle ? "found" : "missing",
    company: jobData.company ? "found" : "missing",
    location: jobData.location ? "found" : "missing",
    salary: jobData.salary ? "found" : "missing",
    experience: jobData.experience ? "found" : "missing",
    employmentType: jobData.employmentType ? "found" : "missing",
    description: jobData.description ? "found" : "missing",
    jobUrl: jobData.jobUrl ? "verified" : "missing"
  };

  const diagnostics = {
    platform: jobData.platform,
    extractionScope: jobData.strategy,
    fields: fields,
    summary: {
      jobTitle: jobData.jobTitle || "(none)",
      company: jobData.company || "(none)",
      location: jobData.location || "(none)",
      salary: jobData.salary || "(none)",
      employmentType: jobData.employmentType || "(none)",
      experience: jobData.experience || "(none)",
      jobUrl: jobData.jobUrl || "(none)",
      descriptionSnippet: jobData.description ? `${jobData.description.slice(0, 80)}...` : "(none)"
    }
  };

  if (attemptedMethods && Object.keys(attemptedMethods).length > 0) {
    diagnostics.attemptedSelectors = attemptedMethods;
  }

  console.log("JobShield: Extraction Diagnostics:", JSON.stringify(diagnostics, null, 2));
  return diagnostics;
}

// ---------------------------------------------------------------------------
// Multi-Strategy Extraction Coordinator
// ---------------------------------------------------------------------------
function extractCurrentJob() {
  const site = detectCurrentSite();
  if (!site) {
    return {
      isValid: false,
      reason: "Unsupported site",
      jobData: null,
      status: "unsupported_site"
    };
  }

  let jobData = createEmptyJobData(site);

  // Strategy 1: Platform-specific scoped selectors
  if (site === "indeed") {
    jobData = extractIndeedJob();
    if (!jobData.jobTitle && !jobData.description) {
      return {
        isValid: false,
        reason: "Select an individual job listing to analyze.",
        jobData: null,
        status: "select_post"
      };
    }
  } else if (site === "linkedin") {
    const pageType = detectLinkedInPageType();

    // A. Formal Job Detail page (/jobs/view/...)
    if (pageType === "job-detail") {
      jobData = extractLinkedInJob("job-detail");
      if (!jobData.jobTitle && !jobData.description) {
        return {
          isValid: false,
          reason: "Could not read job details from this LinkedIn job page. Ensure the page has loaded and try clicking Reanalyze.",
          jobData: null,
          status: "extraction_error",
          pageType
        };
      }
    } else if (pageType === "jobs-search") {
      // B. LinkedIn Jobs Search page (/jobs/search/...)
      jobData = extractLinkedInJob("jobs-search");
      if (!jobData.jobTitle && !jobData.description) {
        return {
          isValid: false,
          reason: "Select a job listing from the results list on LinkedIn.",
          jobData: null,
          status: "select_post",
          pageType
        };
      }
    } else if (pageType === "posts-search" || pageType === "feed" || pageType === "feed-or-posts") {
      // C & D. Content search or feed
      const visiblePosts = findVisibleLinkedInPosts();
      if (visiblePosts.length === 0) {
        return {
          isValid: false,
          reason: pageType === "posts-search"
            ? "No LinkedIn content posts detected on this search page. Scroll down or click Analyze Visible Post."
            : "No LinkedIn posts found on page. Scroll down or click Analyze Visible Post.",
          jobData: null,
          status: "no_posts_found",
          pageType
        };
      }

      // If viewing an individual standalone post URL or exactly 1 post is visible on page, auto-select it!
      if ((isStandaloneLinkedInPostPage() || visiblePosts.length === 1) && !selectedLinkedInPostElement) {
        selectedLinkedInPostElement = visiblePosts[0];
        selectedLinkedInPostId = getLinkedInPostId(visiblePosts[0]);
      }

      // Check if selected element is still in DOM or needs re-binding by post ID
      if (!selectedLinkedInPostElement || !document.contains(selectedLinkedInPostElement)) {
        if (selectedLinkedInPostId) {
          const found = visiblePosts.find((p) => getLinkedInPostId(p) === selectedLinkedInPostId);
          if (found) selectedLinkedInPostElement = found;
        }
      }

      // If multiple posts exist and none is selected, do NOT guess or analyze entire feed!
      if (!selectedLinkedInPostElement) {
        return {
          isValid: false,
          status: "select_post",
          reason: `Found ${visiblePosts.length} posts on page. Click "Analyze Visible Post" or click a specific post to analyze it.`,
          availableCount: visiblePosts.length,
          pageType,
          jobData: null
        };
      }

      jobData = extractLinkedInFeedPost(selectedLinkedInPostElement);
    } else if (pageType === "standalone-post") {
      const visiblePosts = findVisibleLinkedInPosts();
      if (visiblePosts.length > 0 && !selectedLinkedInPostElement) {
        selectedLinkedInPostElement = visiblePosts[0];
        selectedLinkedInPostId = getLinkedInPostId(visiblePosts[0]);
      }
      const targetEl = selectedLinkedInPostElement || (visiblePosts.length > 0 ? visiblePosts[0] : document.querySelector("main") || document.body);
      jobData = extractLinkedInFeedPost(targetEl);
    } else if (pageType === "unsupported-page") {
      return {
        isValid: false,
        reason: "JobShield analyzes job listings and hiring posts. This LinkedIn page does not contain job listings.",
        jobData: null,
        status: "unsupported_page",
        pageType
      };
    } else {
      jobData = extractLinkedInJob();
      if (!jobData.jobTitle && !jobData.description) {
        const visiblePosts = findVisibleLinkedInPosts();
        if (visiblePosts.length > 0) {
          if (!selectedLinkedInPostElement) {
            selectedLinkedInPostElement = visiblePosts[0];
            selectedLinkedInPostId = getLinkedInPostId(visiblePosts[0]);
          }
          jobData = extractLinkedInFeedPost(selectedLinkedInPostElement);
        }
      }
    }
  } else if (site === "ziprecruiter") {
    jobData = extractZipRecruiterJob();
  }

  // Strategy 2: If title or description missing, inspect JSON-LD (standalone view fallback ONLY)
  if ((!jobData.jobTitle || !jobData.description) && !isFeedOrMultiPostPage()) {
    const jsonLdData = extractFromJsonLd();
    if (jsonLdData && jsonLdData.jobTitle) {
      console.log("JobShield: Supplementing job info from JSON-LD");
      jobData.jobTitle = jobData.jobTitle || jsonLdData.jobTitle;
      jobData.company = jobData.company || jsonLdData.company;
      jobData.location = jobData.location || jsonLdData.location;
      jobData.salary = jobData.salary || jsonLdData.salary;
      jobData.experience = jobData.experience || jsonLdData.experience;
      jobData.employmentType = jobData.employmentType || jsonLdData.employmentType;
      jobData.description = jobData.description || jsonLdData.description;
      jobData.jobUrl = jobData.jobUrl || jsonLdData.jobUrl;
      if (jobData.strategy === "none") jobData.strategy = "json-ld";
    }
  }

  // Strategy 3: Semantic fallback ONLY on standalone detail pages, NEVER on search results or feeds
  if (!jobData.jobTitle && !isFeedOrMultiPostPage() && window.location.pathname.includes("/view")) {
    const semantic = extractSemanticFallback(site);
    if (semantic && semantic.jobTitle) {
      jobData.jobTitle = semantic.jobTitle;
      jobData.strategy = semantic.strategy;
    }
  }

  // Validate the extracted result
  const validation = validateJobData(jobData);
  if (validation.isValid) {
    return {
      isValid: true,
      jobData: jobData,
      status: "detected"
    };
  } else {
    return {
      isValid: false,
      reason: validation.reason,
      jobData: jobData.jobTitle ? jobData : null,
      status: validation.status
    };
  }
}

// ---------------------------------------------------------------------------
// Job Validation Logic
// ---------------------------------------------------------------------------
function validateJobData(jobData) {
  if (!jobData || typeof jobData !== "object") {
    return { isValid: false, status: "no_job_selected", reason: "No job data extracted" };
  }

  // Check classification if RedFlagDetector is available
  if ((typeof JobShieldDetector !== "undefined" || typeof RedFlagDetector !== "undefined") && (typeof JobShieldDetector !== "undefined" ? JobShieldDetector : RedFlagDetector).classifyContentType) {
    const pageContext = jobData.platform === "indeed" 
      ? "indeed-job-listing" 
      : (jobData.strategy === "linkedin-feed-post" ? "linkedin-feed-post" : "linkedin-job-listing");
    const classification = (typeof JobShieldDetector !== "undefined" ? JobShieldDetector : RedFlagDetector).classifyContentType(jobData, pageContext);
    
    if (classification.category === "insufficient_data") {
      return {
        isValid: false,
        status: "insufficient_data",
        reason: "The extracted post does not contain enough text or hiring details to evaluate."
      };
    }
    
    if (classification.category === "non_job_content") {
      return {
        isValid: false,
        status: "non_job_content",
        reason: "Selected content was analyzed and determined not to be a job posting, hiring announcement, or internship opportunity."
      };
    }

    if (classification.isJobRelated) {
      if (!jobData.jobTitle || jobData.jobTitle === "Job Opportunity" || jobData.jobTitle === "LinkedIn Post") {
        jobData.jobTitle = classification.roleTitle || "Job Opportunity";
      }
      jobData.contentType = classification.category;
      return { isValid: true, status: "detected", reason: "Valid job or hiring content identified" };
    }
  }

  const title = (jobData.jobTitle || "").trim();
  if (!title) {
    return { isValid: false, status: "no_job_selected", reason: "No job title found in active view" };
  }

  if (title.length < 2) {
    return { isValid: false, status: "no_job_selected", reason: "Title too short to be valid" };
  }

  const genericTitles = /^(search|find jobs|jobs|recent searches|sign in|post a job|messages|notifications|home|my jobs|feed)$/i;
  if (genericTitles.test(title)) {
    return { isValid: false, status: "no_job_selected", reason: `Element text "${title}" matches generic navigation` };
  }

  // Note: Company, salary, location, and description are optional.
  // Missing company or salary does NOT invalidate an otherwise valid job!
  return { isValid: true, status: "detected", reason: "Valid job details identified" };
}

// ---------------------------------------------------------------------------
// Heuristic Scam Detection Engine
// ---------------------------------------------------------------------------
function performHeuristicAnalysis(jobData) {
  if ((typeof JobShieldDetector !== "undefined" || typeof RedFlagDetector !== "undefined") && typeof (typeof JobShieldDetector !== "undefined" ? JobShieldDetector : RedFlagDetector).analyzeJobPosting === "function") {
    const analysis = (typeof JobShieldDetector !== "undefined" ? JobShieldDetector : RedFlagDetector).analyzeJobPosting(jobData);
    return {
      riskScore: analysis.riskScore,
      riskCategory: analysis.riskCategory,
      riskLevel: analysis.riskLevel,
      isPaymentWarning: analysis.isPaymentWarning,
      method: "heuristic",
      findings: analysis.findings,
      missingInformation: analysis.missingInformation,
      verificationSteps: analysis.verificationSteps,
      limitations: [analysis.disclaimer],
      flags: (analysis.findings || []).map((f) => f.ruleId),
      reasons: (analysis.findings || []).map((f) => f.ruleName),
      timestamp: Date.now()
    };
  }

  const findings = [];
  const flags = [];
  const reasons = [];

  const jobTitle = (jobData.jobTitle || "").trim();
  const description = (jobData.description || "").trim();
  const salaryText = (jobData.salary || "").trim();
  const company = (jobData.company || "").trim();

  const titleNorm = jobTitle.toLowerCase();
  const descNorm = description.toLowerCase();
  const salaryNorm = salaryText.toLowerCase();
  const companyNorm = company.toLowerCase();

  let rawScore = 0;

  // 1. Upfront Payments & Equipment Purchase
  const upfrontPatterns = [
    { regex: /\b(upfront\s*(?:fee|payment|money|cost))\b/i, phrase: "upfront fee" },
    { regex: /\b(training\s*(?:fee|payment|cost))\b/i, phrase: "training fee" },
    { regex: /\b(application\s*(?:fee|payment))\b/i, phrase: "application fee" },
    { regex: /\b(registration\s*(?:fee|payment))\b/i, phrase: "registration fee" },
    { regex: /\b(must\s*purchase\s*equipment|buy\s*equipment\s*from\s*(?:our|specified))\b/i, phrase: "equipment purchase requirement" },
    { regex: /\b(investment\s*required|initial\s*investment)\b/i, phrase: "investment required" },
    { regex: /\b(pay\s*for\s*(?:background\s*check|materials|software\s*license))\b/i, phrase: "pay for materials/check" }
  ];

  for (const item of upfrontPatterns) {
    if (item.regex.test(descNorm) || item.regex.test(titleNorm)) {
      rawScore += 30;
      flags.push("upfront_payment_request");
      reasons.push(`Suspicious payment demand: "${item.phrase}"`);
      findings.push({
        code: "upfront_payment_request",
        severity: "high",
        evidence: `The listing mentions: "${item.phrase}".`,
        explanation: "Legitimate employers cover business and onboarding costs. Requiring applicants to pay fees or purchase equipment upfront is a primary indicator of employment fraud."
      });
      break;
    }
  }

  // 2. Unconventional / Ephemeral Communication Channels
  const commsPatterns = [
    { regex: /\b(telegram\s*[@:]|contact\s*(?:us\s*)?(?:via|on)\s*telegram|message\s*on\s*telegram)\b/i, phrase: "Telegram contact" },
    { regex: /\b(whatsapp\s*[@:]|contact\s*(?:us\s*)?(?:via|on)\s*whatsapp|message\s*on\s*whatsapp)\b/i, phrase: "WhatsApp contact" },
    { regex: /\b(interview\s*(?:will\s*be\s*conducted\s*)?(?:via|on)\s*(?:telegram|whatsapp|text\s*only))\b/i, phrase: "Interview via chat app" },
    { regex: /\b(google\s*hangouts\s*interview|signal\s*app\s*interview)\b/i, phrase: "Chat-only interview" }
  ];

  for (const item of commsPatterns) {
    if (item.regex.test(descNorm) || item.regex.test(titleNorm)) {
      rawScore += 25;
      flags.push("unconventional_communication_channel");
      reasons.push(`Unofficial communication channel: "${item.phrase}"`);
      findings.push({
        code: "unconventional_communication_channel",
        severity: "high",
        evidence: `The listing directs candidates to: "${item.phrase}".`,
        explanation: "Legitimate corporate recruiters use verified corporate email addresses and professional conferencing tools rather than conducting hiring exclusively through anonymous messaging apps."
      });
      break;
    }
  }

  // 3. Financial Manipulation & Check Cashing
  const finPatterns = [
    { regex: /\b(cashier(?:'s)?\s*check|receive\s*and\s*forward\s*funds|wire\s*transfer\s*funds)\b/i, phrase: "check / funds transfer" },
    { regex: /\b(online\s*banking\s*credentials|provide\s*bank\s*login)\b/i, phrase: "banking login request" },
    { regex: /\b(crypto\s*wallet|bitcoin\s*deposit|usdt\s*transfer)\b/i, phrase: "cryptocurrency transfer" }
  ];

  for (const item of finPatterns) {
    if (item.regex.test(descNorm) || item.regex.test(titleNorm)) {
      rawScore += 30;
      flags.push("sensitive_financial_request");
      reasons.push(`Suspicious financial request: "${item.phrase}"`);
      findings.push({
        code: "sensitive_financial_request",
        severity: "high",
        evidence: `The listing mentions: "${item.phrase}".`,
        explanation: "Employers do not ask applicants to handle wire transfers, deposit checks, or provide banking logins. Such requests often indicate money mule or counterfeit check scams."
      });
      break;
    }
  }

  // 4. Implausible Compensation Claims
  const unrealisticCompPatterns = [
    { regex: /\$\s*(\d{4,})\s*(?:per\s*day|daily|a\s*day)/i, phrase: "High daily compensation claim" },
    { regex: /\$\s*(\d{3,})\s*(?:per\s*hour|hourly|an\s*hour)/i, phrase: "Extremely high hourly rate" },
    { regex: /\b(earn\s*up\s*to\s*\$\s*(?:[1-9]\d{4,}))\b/i, phrase: "Extreme earnings guarantee" },
    { regex: /\b(make\s*money\s*fast|get\s*rich|financial\s*freedom|unlimited\s*earning\s*potential)\b/i, phrase: "Get-rich-quick language" }
  ];

  for (const item of unrealisticCompPatterns) {
    if (item.regex.test(salaryNorm) || item.regex.test(descNorm) || item.regex.test(titleNorm)) {
      rawScore += 20;
      flags.push("implausible_compensation");
      reasons.push(item.phrase);
      findings.push({
        code: "implausible_compensation",
        severity: "medium",
        evidence: `Unusual compensation claim detected: ${item.phrase}.`,
        explanation: "Extraordinarily high income promises with low barriers to entry are frequently used to lure job seekers into fraudulent schemes."
      });
      break;
    }
  }

  // 5. Generic / Placeholder Company Name
  if (company) {
    const placeholderNames = [
      /\b(confidential|private company|undisclosed|work from home|anyhome|your company|my company|virtual online|national opportunities|universal group)\b/i
    ];
    for (const pattern of placeholderNames) {
      if (pattern.test(companyNorm)) {
        rawScore += 15;
        flags.push("vague_employer_identity");
        reasons.push(`Vague company identity: "${company}"`);
        findings.push({
          code: "vague_employer_identity",
          severity: "medium",
          evidence: `Company name appears generic or placeholder: "${company}".`,
          explanation: "Undisclosed or generic employer names prevent verification of corporate registration, business reputation, and physical presence."
        });
        break;
      }
    }
  } else {
    // Missing company name is a weak indicator
    rawScore += 10;
    flags.push("missing_company_name");
    reasons.push("Employer name is not displayed");
    findings.push({
      code: "missing_company_name",
      severity: "low",
      evidence: "Company name was not identified in the listing.",
      explanation: "A missing company name requires independent verification before submitting private personal or financial information."
    });
  }

  // 6. Formatting & Structural Anomalies
  if (description) {
    const punctuationIssues = (description.match(/[!]{3,}|\$\$+|\?{3,}/g) || []).length;
    const capsWords = (description.match(/\b[A-Z]{6,}\b/g) || []).length;

    if (punctuationIssues >= 2 || capsWords >= 4) {
      rawScore += 10;
      flags.push("unprofessional_formatting");
      reasons.push("Multiple formatting anomalies (excessive symbols/capitalization)");
      findings.push({
        code: "unprofessional_formatting",
        severity: "low",
        evidence: "Text contains repeated symbols or excessive all-caps words.",
        explanation: "Professional job descriptions are typically reviewed for standard formatting. Erratic formatting can be a characteristic of hastily drafted scam postings."
      });
    }

    if (description.length < 100) {
      rawScore += 10;
      flags.push("minimal_job_description");
      reasons.push("Job description is very short");
      findings.push({
        code: "minimal_job_description",
        severity: "low",
        evidence: `Description is unusually short (${description.length} characters).`,
        explanation: "Legitimate job postings usually provide comprehensive details regarding job responsibilities, candidate qualifications, and employment terms."
      });
    }
  }

  // Adjust score based on analysisMode
  let adjustedScore = rawScore;
  if (analysisMode === "conservative") {
    adjustedScore = findings
      .filter((f) => f.severity === "high" || f.severity === "medium")
      .reduce((acc, f) => acc + (f.severity === "high" ? 25 : 15), 0);
  } else if (analysisMode === "aggressive") {
    adjustedScore = Math.round(rawScore * 1.2);
  }

  // Clamp risk score to [0, 100]
  const finalScore = Math.min(100, Math.max(0, adjustedScore));

  let riskLevel = "low";
  if (finalScore >= 50) {
    riskLevel = "high";
  } else if (finalScore >= 25) {
    riskLevel = "medium";
  }

  const result = {
    riskScore: finalScore,
    riskLevel: riskLevel,
    method: "heuristic",
    findings: findings,
    limitations: [
      "This is a heuristic assessment based on rule-based keyword and pattern matching, not definitive proof of fraud or legitimacy."
    ],
    flags: [...new Set(flags)],
    reasons: [...new Set(reasons)],
    timestamp: Date.now()
  };

  return result;
}

// ---------------------------------------------------------------------------
// On-Page Status UI
// ---------------------------------------------------------------------------
function injectStatusElement(message, status = "info", details = []) {
  if (!showWarnings && (status === "info" || status === "analyzing")) {
    return;
  }

  let statusElement = document.getElementById(JOBSCAN_CONFIG.statusElementId);
  if (!statusElement) {
    statusElement = document.createElement("div");
    statusElement.id = JOBSCAN_CONFIG.statusElementId;
    statusElement.setAttribute("role", "alert");
  }

  statusElement.className = `jobscan-extension-root jobscan-status jobscan-status-${status}`;

  while (statusElement.firstChild) {
    statusElement.removeChild(statusElement.firstChild);
  }

  const content = document.createElement("div");
  content.className = "jobscan-status-content";

  const iconSpan = document.createElement("span");
  iconSpan.className = "jobscan-icon";
  const icons = {
    analyzing: "⏳",
    success: "✅",
    warning: "⚠️",
    caution: "⚠️",
    error: "🚩",
    info: "ℹ️"
  };
  iconSpan.textContent = icons[status] || "🚩";

  const textContainer = document.createElement("div");
  textContainer.className = "jobscan-text-container";

  const msgSpan = document.createElement("div");
  msgSpan.className = "jobscan-message";
  msgSpan.textContent = message;
  textContainer.appendChild(msgSpan);

  if (details && details.length > 0) {
    const detailsContainer = document.createElement("div");
    detailsContainer.className = "jobscan-details-list";
    details.slice(0, 2).forEach((item) => {
      const itemEl = document.createElement("div");
      itemEl.className = "jobscan-detail-item";
      itemEl.textContent = `• ${item}`;
      detailsContainer.appendChild(itemEl);
    });
    textContainer.appendChild(detailsContainer);
  }

  content.appendChild(iconSpan);
  content.appendChild(textContainer);

  const closeBtn = document.createElement("button");
  closeBtn.className = "jobscan-close-btn";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Dismiss JobShield notification");
  closeBtn.style.cssText = "background:none;border:none;color:inherit;font-size:18px;cursor:pointer;padding:0 6px;margin-left:auto;";
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    statusElement.remove();
  };

  statusElement.appendChild(content);
  statusElement.appendChild(closeBtn);

  // Identify injection container
  let container = null;
  const siteSpecificContainers = {
    linkedin: [
      ".jobs-search__job-details",
      ".job-details-jobs-unified-top-card__primary-description-container",
      ".jobs-details__main-content",
      ".job-details-jobs-unified-top-card",
      "main#main-content",
      "main"
    ],
    indeed: [
      "#jobsearch-ViewjobPaneWrapper",
      ".jobsearch-JobInfoHeader-title-container",
      '[data-testid="jobsearch-JobInfoHeader"]',
      ".jobsearch-RightPane",
      "#viewJobSSRRoot",
      ".jobsearch-ViewJobLayout-jobDisplay",
      ".jobsearch-JobComponent",
      "main"
    ],
    ziprecruiter: [
      ".job_header",
      ".job_details_container",
      "main"
    ]
  };

  const candidateContainers = siteSpecificContainers[currentSite] || ["main", "body"];
  for (const selector of candidateContainers) {
    const el = document.querySelector(selector);
    if (el && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0)) {
      container = el;
      break;
    }
  }

  if (!container) {
    for (const selector of candidateContainers) {
      const el = document.querySelector(selector);
      if (el) {
        container = el;
        break;
      }
    }
  }

  if (container) {
    if (container.firstChild) {
      container.insertBefore(statusElement, container.firstChild);
    } else {
      container.appendChild(statusElement);
    }
  } else if (!document.body.contains(statusElement)) {
    document.body.appendChild(statusElement);
  }
}

function displayAnalysisResult(result) {
  let message = "";
  let status = "info";

  if (result.isPaymentWarning) {
    message = `🚨 CRITICAL WARNING: Employment Payment Demanded (Score: ${result.riskScore}/100)`;
    status = "error";
  } else {
    switch (result.riskLevel) {
      case "critical":
      case "high":
        message = `High Risk Suspected (Score: ${result.riskScore}/100)`;
        status = "error";
        break;
      case "medium":
        message = `Moderate Risk Detected (Score: ${result.riskScore}/100)`;
        status = "warning";
        break;
      case "low":
      default:
        if (result.riskScore === 0) {
          message = `No Significant Red Flags Detected (Score: 0/100)`;
        } else {
          message = `Low Risk Detected (Score: ${result.riskScore}/100)`;
        }
        status = "success";
        break;
    }
  }

  const details = (result.findings || []).map((f) => f.exactText ? `"${f.exactText}" — ${f.explanation}` : (f.evidence || f.explanation));
  injectStatusElement(message, status, details);
}

// ---------------------------------------------------------------------------
// Orchestration & Dynamic Analysis Loop
// ---------------------------------------------------------------------------
function getJobSignature(job) {
  if (!job) return "";
  return `${job.platform || ""}|${job.contentType || ""}|${job.postId || ""}|${job.jobTitle || ""}|${job.company || ""}|${job.salary || ""}|${job.jobUrl || ""}`;
}

function startAnalysis(isImmediate = false, retryCount = 0) {
  if (!extensionEnabled) return;
  clearTimeout(debounceTimer);

  const delay = isImmediate ? 100 : JOBSCAN_CONFIG.debounceDelay;
  debounceTimer = setTimeout(() => {
    runAnalysisWorkflow(retryCount);
  }, delay);
}

async function runAnalysisWorkflow(retryCount = 0) {
  const reqId = ++analysisRequestId;
  if (isAnalyzing) return;
  isAnalyzing = true;

  try {
    const extraction = extractCurrentJob();

    if (!extraction.isValid || !extraction.jobData || !extraction.jobData.jobTitle) {
      // If async rendering is still in progress, retry a few times
      if (retryCount < JOBSCAN_CONFIG.maxRetries) {
        isAnalyzing = false;
        setTimeout(() => {
          if (reqId === analysisRequestId) {
            runAnalysisWorkflow(retryCount + 1);
          }
        }, JOBSCAN_CONFIG.retryDelay);
        return;
      }

      console.log("JobShield: No job detected on page/panel:", extraction.reason);
      currentJobData = null;
      currentAnalysisResult = null;
      lastAnalyzedSignature = "";

      const existingStatus = document.getElementById(JOBSCAN_CONFIG.statusElementId);
      if (existingStatus) {
        existingStatus.remove();
      }
      return;
    }

    // Check if another request superseded this one
    if (reqId !== analysisRequestId) return;
    if (currentJobData && extraction.jobData && currentJobData.postId && extraction.jobData.postId && currentJobData.postId !== extraction.jobData.postId) {
      return;
    }

    const jobData = extraction.jobData;
    const signature = getJobSignature(jobData);

    // If same job already analyzed, do not re-run full analysis
    if (signature === lastAnalyzedSignature && currentAnalysisResult) {
      return;
    }

    lastAnalyzedSignature = signature;
    currentJobData = jobData;

    injectStatusElement("Analyzing job posting with JobShield heuristics...", "analyzing");

    const analysis = performHeuristicAnalysis(jobData);
    currentAnalysisResult = analysis;

    displayAnalysisResult(analysis);

    // Sync result with background service worker
    await sendMessageToBackground({
      type: "ANALYSIS_RESULT",
      data: {
        url: jobData.jobUrl || window.location.href,
        jobTitle: jobData.jobTitle,
        company: jobData.company,
        platform: jobData.platform,
        analysisResult: analysis
      }
    });
  } catch (err) {
    console.error("JobShield: Error in runAnalysisWorkflow:", err);
    injectStatusElement("Analysis failed. Check console for details.", "error");
  } finally {
    isAnalyzing = false;
  }
}

// ---------------------------------------------------------------------------
// Mutation Observer (Guard against infinite loops)
// ---------------------------------------------------------------------------
function setupObserver() {
  if (observerInstance) {
    observerInstance.disconnect();
  }

  observerInstance = new MutationObserver((mutations) => {
    if (!extensionEnabled || !currentSite) return;

    let relevantMutation = false;
    for (const mutation of mutations) {
      if (
        mutation.target &&
        (mutation.target.id === JOBSCAN_CONFIG.statusElementId ||
          (mutation.target.closest && mutation.target.closest(".jobscan-extension-root")))
      ) {
        continue;
      }

      if (mutation.type === "childList" || mutation.type === "subtree") {
        relevantMutation = true;
        break;
      }
    }

    if (relevantMutation) {
      startAnalysis(false, 0);
    }
  });

  const targetRoot = document.body || document.documentElement;
  if (targetRoot) {
    observerInstance.observe(targetRoot, {
      childList: true,
      subtree: true
    });
  }
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------
function sendMessageToBackground(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: true });
        }
      });
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
}

// Content script runtime message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("JobShield: Content script received message:", message.type);

  switch (message.type) {
    case "DESELECT_POST": {
      deselectLinkedInPost();
      sendResponse({ success: true });
      return true;
    }

    case "SELECT_FIRST_POST": {
      let visiblePosts = findVisibleLinkedInPosts();
      if (visiblePosts.length === 0) {
        // Fallback search across common post card containers
        const fallbackSel = "div.feed-shared-update-v2, div[data-view-name*='feed-full-update'], li.reusable-search__result-container, li.artdeco-card, [data-urn*='activity']";
        const fallbackEls = Array.from(document.querySelectorAll(fallbackSel));
        visiblePosts = fallbackEls.filter((el) => {
          const text = (el.innerText || el.textContent || "").trim();
          return text.length > 20;
        });
      }
      if (visiblePosts.length > 0) {
        selectLinkedInPost(visiblePosts[0]);
        console.log("[JobShield Diagnostics] Selected first visible post. Total available:", visiblePosts.length);
        sendResponse({ success: true, count: visiblePosts.length });
      } else {
        console.warn("[JobShield Diagnostics] SELECT_FIRST_POST failed: no visible posts found");
        sendResponse({ success: false, error: "No visible LinkedIn posts found on page." });
      }
      return true;
    }

    case "GET_CURRENT_JOB": {
      const pageType = typeof detectLinkedInPageType === "function" ? detectLinkedInPageType() : "unknown";
      const extraction = extractCurrentJob();

      console.log("[JobShield Diagnostics] GET_CURRENT_JOB execution:", {
        url: window.location.href,
        pageType,
        isValid: extraction.isValid,
        status: extraction.status,
        jobTitle: extraction.jobData?.jobTitle || "(none)",
        company: extraction.jobData?.company || "(none)",
        availableCount: extraction.availableCount || 0
      });

      if (extraction.status === "select_post") {
        currentJobData = null;
        currentAnalysisResult = null;
        lastAnalyzedSignature = "";
        sendResponse({
          success: true,
          status: "select_post",
          pageType,
          availableCount: extraction.availableCount || 0,
          reason: extraction.reason || "Select an individual job post to analyze.",
          jobData: null,
          analysisResult: null,
          url: window.location.href
        });
        return true;
      }

      if (extraction.isValid && extraction.jobData) {
        currentJobData = extraction.jobData;
        const sig = getJobSignature(currentJobData);
        if (sig !== lastAnalyzedSignature || !currentAnalysisResult) {
          currentAnalysisResult = performHeuristicAnalysis(currentJobData);
          lastAnalyzedSignature = sig;
        }
        sendResponse({
          success: true,
          status: "detected",
          pageType,
          jobData: currentJobData,
          analysisResult: currentAnalysisResult,
          url: currentJobData.jobUrl || window.location.href
        });
      } else {
        currentJobData = null;
        currentAnalysisResult = null;
        lastAnalyzedSignature = "";
        sendResponse({
          success: true,
          status: extraction.status || "no_job_selected",
          pageType,
          reason: extraction.reason || "No selected job detected",
          jobData: null,
          analysisResult: null,
          url: window.location.href
        });
      }
      return true;
    }

    case "REANALYZE": {
      lastAnalyzedSignature = "";
      const existingStatus = document.getElementById(JOBSCAN_CONFIG.statusElementId);
      if (existingStatus) existingStatus.remove();

      const extraction = extractCurrentJob();
      if (extraction.isValid && extraction.jobData) {
        currentJobData = extraction.jobData;
        currentAnalysisResult = performHeuristicAnalysis(currentJobData);
        lastAnalyzedSignature = getJobSignature(currentJobData);
        displayAnalysisResult(currentAnalysisResult);

        sendMessageToBackground({
          type: "ANALYSIS_RESULT",
          data: {
            url: currentJobData.jobUrl || window.location.href,
            jobTitle: currentJobData.jobTitle,
            company: currentJobData.company,
            platform: currentJobData.platform,
            analysisResult: currentAnalysisResult
          }
        });

        sendResponse({
          success: true,
          status: "detected",
          jobData: currentJobData,
          analysisResult: currentAnalysisResult
        });
      } else {
        currentJobData = null;
        currentAnalysisResult = null;
        sendResponse({
          success: false,
          status: "no_job_selected",
          error: "No job detected to reanalyze"
        });
      }
      return true;
    }

    case "TOGGLE_EXTENSION": {
      extensionEnabled = message.enabled !== false;
      const statusElement = document.getElementById(JOBSCAN_CONFIG.statusElementId);
      if (!extensionEnabled) {
        if (statusElement) statusElement.remove();
        console.log("JobShield: Extension disabled via toggle.");
      } else {
        console.log("JobShield: Extension enabled via toggle.");
        startAnalysis(true, 0);
      }
      sendResponse({ success: true, enabled: extensionEnabled });
      return true;
    }

    default:
      sendResponse({ success: false, error: "Unknown message type" });
      return false;
  }
});
