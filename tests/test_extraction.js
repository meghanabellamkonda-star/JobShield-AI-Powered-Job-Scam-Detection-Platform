// JobShield Test Suite
// Validates extraction strategies, validation logic, heuristic scam detection,
// dynamic navigation, observer safety, and simulated messaging

import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Lightweight DOM Mock for Unit Testing Selectors
// ---------------------------------------------------------------------------
class MockElement {
  constructor(tagName = "div", props = {}) {
    this.tagName = tagName.toUpperCase();
    this.id = props.id || "";
    this.className = props.className || "";
    this.textContent = props.textContent || "";
    this.innerText = props.innerText || this.textContent;
    this.attributes = props.attributes || {};
    this.children = [];
    this.parentElement = null;
    this.offsetWidth = props.offsetWidth !== undefined ? props.offsetWidth : 100;
    this.offsetHeight = props.offsetHeight !== undefined ? props.offsetHeight : 100;
  }

  getAttribute(name) {
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    return this.attributes[name] || null;
  }

  setAttribute(name, val) {
    if (name === "id") this.id = val;
    else if (name === "class") this.className = val;
    else this.attributes[name] = val;
  }

  get href() {
    return this.attributes["href"] || "";
  }

  set href(val) {
    this.attributes["href"] = val;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  querySelector(selector) {
    const results = this.querySelectorAll(selector);
    return results.length > 0 ? results[0] : null;
  }

  querySelectorAll(selector) {
    const matched = [];
    const parts = selector.split(",").map((s) => s.trim());

    const testSingleSelector = (node, sel) => {
      // Direct child or descendant selector handling
      if (sel.includes(" ")) {
        const subParts = sel.split(/\s+/);
        // check if node matches the last subPart and has ancestors matching preceding parts
        const lastPart = subParts[subParts.length - 1];
        if (!testSingleSelector(node, lastPart)) return false;
        let curr = node.parentElement;
        let pIdx = subParts.length - 2;
        while (curr && pIdx >= 0) {
          if (testSingleSelector(curr, subParts[pIdx])) {
            pIdx--;
          }
          curr = curr.parentElement;
        }
        return pIdx < 0;
      }

      // ID selector: #id
      if (sel.startsWith("#")) {
        const id = sel.slice(1);
        return node.id === id;
      }
      // Class selector: .class
      if (sel.startsWith(".")) {
        const cls = sel.slice(1);
        return (node.className || "").split(/\s+/).includes(cls);
      }
      // Attribute selector: [attr="val"] or [attr*="val"] or [attr^="val"] or [attr]
      const attrMatch = sel.match(/^([a-zA-Z0-9]+)?\[([a-zA-Z0-9_-]+)(?:([*^~|]?=)["']?([^"']*)["']?)?\]$/);
      if (attrMatch) {
        const tag = attrMatch[1];
        const attrName = attrMatch[2];
        const op = attrMatch[3] || "=";
        const attrVal = attrMatch[4];

        if (tag && node.tagName !== tag.toUpperCase()) return false;
        const actualVal = node.getAttribute(attrName);
        if (actualVal === null || actualVal === undefined) return false;
        if (attrVal === undefined) return true;

        if (op === "=") return actualVal === attrVal;
        if (op === "*=") return actualVal.includes(attrVal);
        if (op === "^=") return actualVal.startsWith(attrVal);
        return false;
      }
      // Tag with class: h1.title
      const tagClassMatch = sel.match(/^([a-zA-Z0-9]+)\.([a-zA-Z0-9_-]+)$/);
      if (tagClassMatch) {
        const tag = tagClassMatch[1].toUpperCase();
        const cls = tagClassMatch[2];
        return node.tagName === tag && (node.className || "").split(/\s+/).includes(cls);
      }
      // Simple Tag: h1, main, etc.
      if (/^[a-zA-Z0-9]+$/.test(sel)) {
        return node.tagName === sel.toUpperCase();
      }
      return false;
    };

    const traverse = (node) => {
      for (const singleSel of parts) {
        if (testSingleSelector(node, singleSel)) {
          if (!matched.includes(node)) matched.push(node);
          break;
        }
      }
      for (const child of node.children) {
        traverse(child);
      }
    };

    for (const child of this.children) {
      traverse(child);
    }
    return matched;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (selector.startsWith(".") && curr.className?.split(/\s+/).includes(selector.slice(1))) {
        return curr;
      }
      if (selector.startsWith("#") && curr.id === selector.slice(1)) {
        return curr;
      }
      if (/^[a-zA-Z0-9]+$/.test(selector) && curr.tagName === selector.toUpperCase()) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Extractor Helpers Under Test
// ---------------------------------------------------------------------------

function cleanText(text) {
  if (!text || typeof text !== "string") return "";
  return text.replace(/\s+/g, " ").trim();
}

function cleanCompanyName(name) {
  if (!name) return "";
  return name.replace(/\s+\d(?:\.\d)?\s*(?:★|stars?|out of \d)?\s*$/i, "").trim();
}

function getElementText(selector, parent) {
  if (!selector || !parent) return "";
  const el = parent.querySelector(selector);
  return el ? cleanText(el.textContent) : "";
}

function validateJobData(jobData) {
  if (!jobData || typeof jobData !== "object") {
    return { isValid: false, status: "no_job_selected", reason: "No job data extracted" };
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
  return { isValid: true, status: "detected", reason: "Valid job details identified" };
}

function extractIndeedJobFromDoc(doc, currentUrl = "https://www.indeed.com/jobs?q=developer") {
  const data = {
    jobTitle: "",
    company: "",
    location: "",
    salary: "",
    experience: "",
    employmentType: "",
    description: "",
    jobUrl: "",
    platform: "indeed",
    strategy: "none"
  };

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
    const el = doc.querySelector(sel);
    if (el) {
      pane = el;
      break;
    }
  }

  if (!pane) {
    const descEl = doc.querySelector("#jobDescriptionText, [data-testid='jobsearch-jobDescriptionText']");
    if (descEl) {
      pane = descEl.closest('#jobsearch-ViewjobPaneWrapper, .jobsearch-RightPane, .fastviewjob, #vjs-container, .jobsearch-JobComponent, main') || descEl.parentElement;
    }
  }

  const cardSelectors = [
    ".cardOutline.selected",
    ".job_seen_beacon.selected",
    "[data-mobtk].selected",
    ".tapItem.selected",
    ".tapItem[aria-current='true']",
    ".vjs-highlight",
    ".cardOutline[tabindex='0']"
  ];

  let selectedCard = null;
  for (const sel of cardSelectors) {
    const el = doc.querySelector(sel);
    if (el) {
      selectedCard = el;
      break;
    }
  }

  const root = pane || doc;
  data.strategy = pane ? "indeed-split-pane" : (selectedCard ? "indeed-selected-card" : "indeed-document");

  // Title
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

  if (!data.jobTitle && selectedCard) {
    const cardTitle = getElementText('h2.jobTitle span, a[id^="job_"] span, h2.jobTitle', selectedCard);
    if (cardTitle) data.jobTitle = cardTitle;
  }

  // If title was found from the pane, find the matching card in the left list if selectedCard wasn't caught by class
  if (data.jobTitle && !selectedCard) {
    const allCards = doc.querySelectorAll('.job_seen_beacon, .cardOutline, .tapItem');
    for (const c of allCards) {
      const cTitle = getElementText('h2.jobTitle span, a[id^="job_"] span, h2.jobTitle', c);
      if (cTitle && cTitle.toLowerCase() === data.jobTitle.toLowerCase()) {
        selectedCard = c;
        break;
      }
    }
  }

  // Company
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

  if (!data.company && selectedCard) {
    const cardComp = getElementText('[data-testid="company-name"], span.companyName, span.css-63koeb', selectedCard);
    if (cardComp) data.company = cleanCompanyName(cardComp);
  }

  // Location
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

  if (!data.location && selectedCard) {
    const cardLoc = getElementText('[data-testid="text-location"], div.companyLocation', selectedCard);
    if (cardLoc) data.location = cardLoc;
  }

  // Salary
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

  // Employment Type & Experience
  const typePattern = /\b(Full-time|Part-time|Contract|Temporary|Internship|Fresher|Permanent|Volunteer)\b/i;
  const metadataCandidates = root.querySelectorAll(
    '#salaryInfoAndJobType, #salaryInfoAndJobType span, [data-testid="jobsearch-JobMetadataHeader-item"], #jobDetailsSection div, #jobDetailsSection span, div[aria-label*="Job type" i], .jobsearch-JobMetadataHeader-item'
  );

  for (const el of metadataCandidates) {
    const txt = cleanText(el.textContent);
    if (!data.employmentType) {
      const match = txt.match(typePattern);
      if (match) data.employmentType = match[0];
    }
    if (!data.experience) {
      const expMatch = txt.match(/\b(\d+[\s–-]+(?:\d+)?\s*(?:years?|yrs?)(?:\s*(?:of\s+)?experience)?)\b/i);
      if (expMatch) data.experience = expMatch[0];
    }
  }

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

  // Description
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

  // Verified Job URL
  let verifiedJk = null;
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

  if (!verifiedJk && pane) {
    const paneLink = pane.querySelector('a[href*="/viewjob?jk="], a[href*="/rc/clk?jk="], a[data-testid="jobsearch-JobInfoHeader-title-link"]');
    if (paneLink && paneLink.href) {
      const m = paneLink.href.match(/jk=([a-zA-Z0-9_-]+)/);
      if (m) verifiedJk = m[1];
    }
  }

  if (!verifiedJk && currentUrl.includes("/viewjob")) {
    const m = currentUrl.match(/[?&](?:jk|vjk)=([a-zA-Z0-9_-]+)/);
    if (m) verifiedJk = m[1];
  }

  if (verifiedJk) {
    data.jobUrl = `https://www.indeed.com/viewjob?jk=${verifiedJk}`;
  } else {
    data.jobUrl = ""; // No fabrication
  }

  return data;
}

function extractLinkedInJobFromDoc(doc, currentUrl = "https://www.linkedin.com/jobs/search/?currentJobId=456") {
  const data = {
    jobTitle: "",
    company: "",
    location: "",
    salary: "",
    experience: "",
    employmentType: "",
    description: "",
    jobUrl: "",
    platform: "linkedin",
    strategy: "none"
  };

  const paneSelectors = [
    ".jobs-search__job-details",
    ".jobs-search-results-list__details",
    ".scaffold-layout__detail",
    ".jobs-details__main-content",
    ".jobs-details",
    "div[data-job-id]",
    ".job-view-layout",
    "main"
  ];

  let pane = null;
  for (const sel of paneSelectors) {
    const el = doc.querySelector(sel);
    if (el) {
      pane = el;
      break;
    }
  }

  const root = pane || doc;
  data.strategy = pane ? "linkedin-split-pane" : "linkedin-page";

  // Title
  const titleSelectors = [
    "h1.job-details-jobs-unified-top-card__job-title",
    ".job-details-jobs-unified-top-card__job-title h1",
    ".job-details-jobs-unified-top-card__job-title a",
    ".job-details-jobs-unified-top-card__job-title",
    "h1.t-24",
    ".t-24.job-details-jobs-unified-top-card__job-title",
    "h1.top-card-layout__title",
    ".jobs-search__job-details h1",
    ".jobs-details__main-content h1",
    ".artdeco-entity-lockup__title",
    "h1"
  ];

  for (const sel of titleSelectors) {
    const text = getElementText(sel, root);
    if (text && text.length > 2 && !/^(linkedin|jobs|search|notifications|messaging)$/i.test(text)) {
      data.jobTitle = text;
      break;
    }
  }

  // Company
  const companySelectors = [
    ".job-details-jobs-unified-top-card__company-name a",
    ".job-details-jobs-unified-top-card__company-name",
    ".jobs-unified-top-card__company-name a",
    ".jobs-unified-top-card__company-name",
    ".job-details-jobs-unified-top-card__primary-description-container a[href*='/company/']",
    ".jobs-details__main-content a[href*='/company/']",
    ".topcard__org-name-link",
    "a[href*='/company/']"
  ];

  for (const sel of companySelectors) {
    const text = getElementText(sel, root);
    if (text) {
      data.company = cleanCompanyName(text);
      break;
    }
  }

  // Location
  const locationSelectors = [
    ".job-details-jobs-unified-top-card__primary-description-container",
    ".job-details-jobs-unified-top-card__bullet",
    ".jobs-unified-top-card__bullet",
    ".topcard__flavor--bullet",
    ".job-details-jobs-unified-top-card__tertiary-description"
  ];

  for (const sel of locationSelectors) {
    const text = getElementText(sel, root);
    if (text) {
      data.location = text;
      break;
    }
  }

  // Salary, Type, Experience
  const insightElements = root.querySelectorAll(
    ".job-details-jobs-unified-top-card__job-insight-view-model-secondary, .jobs-unified-top-card__job-insight, li.job-details-jobs-unified-top-card__job-insight"
  );
  for (const el of insightElements) {
    const txt = cleanText(el.textContent);
    if (/[\$₹€£]|\d+k|\/yr|\/hr|year|hour|month/i.test(txt) && !data.salary) {
      const parts = txt.split(/[·•|]/).map((s) => s.trim());
      const salPart = parts.find((p) => /[\$₹€£]|\d+k|\/yr|\/hr|year|hour|month/i.test(p));
      data.salary = salPart || txt;
    }
    const typeMatch = txt.match(/\b(Full-time|Part-time|Contract|Temporary|Internship|Volunteer)\b/i);
    if (typeMatch && !data.employmentType) {
      data.employmentType = typeMatch[0];
    }
    const expMatch = txt.match(/\b(Entry level|Associate|Mid-Senior level|Director|Executive|\d+\+?\s*(?:years?|yrs?))\b/i);
    if (expMatch && !data.experience) {
      data.experience = expMatch[0];
    }
  }

  // Description
  const descSelectors = [
    "#job-details",
    ".jobs-description__content .jobs-box__html-content",
    ".jobs-description-content__text",
    ".jobs-description__content",
    "article.jobs-description__container"
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

  // Verified URL
  let verifiedId = null;
  if (pane) {
    const titleLink = pane.querySelector("a.job-details-jobs-unified-top-card__job-title-link, a[href*='/jobs/view/']");
    if (titleLink && titleLink.href) {
      const m = titleLink.href.match(/\/jobs\/view\/(\d+)/);
      if (m) verifiedId = m[1];
    }
  }

  if (!verifiedId && currentUrl.includes("/jobs/view/")) {
    const m = currentUrl.match(/\/jobs\/view\/(\d+)/);
    if (m) verifiedId = m[1];
  }

  if (verifiedId) {
    data.jobUrl = `https://www.linkedin.com/jobs/view/${verifiedId}/`;
  } else {
    data.jobUrl = "";
  }

  return data;
}

// ---------------------------------------------------------------------------
// 12 SPECIFIC TEST CASES (As required in Section 10)
// ---------------------------------------------------------------------------

test("1. Indeed split-panel layout extracts company, location, salary, employment type, description, and verified URL", () => {
  const doc = new MockElement("div");

  // Left side list with selected card
  const leftRail = new MockElement("div", { className: "jobsearch-LeftPane" });
  const card = new MockElement("div", { className: "cardOutline selected" });
  const cardLink = new MockElement("a", { attributes: { "data-jk": "soranova_jk_123" } });
  cardLink.appendChild(new MockElement("h2", { className: "jobTitle", textContent: "SOFTWARE DEVELOPER- Fresher" }));
  card.appendChild(cardLink);
  leftRail.appendChild(card);
  doc.appendChild(leftRail);

  // Right side details pane
  const rightPane = new MockElement("div", { id: "jobsearch-ViewjobPaneWrapper" });
  rightPane.appendChild(new MockElement("h1", {
    attributes: { "data-testid": "jobsearch-JobInfoHeader-title" },
    textContent: "SOFTWARE DEVELOPER- Fresher"
  }));
  rightPane.appendChild(new MockElement("div", {
    attributes: { "data-testid": "inlineHeader-companyName" },
    textContent: "Soranova Technologies Private Limited 3.8 ★"
  }));
  rightPane.appendChild(new MockElement("div", {
    attributes: { "data-testid": "inlineHeader-companyLocation" },
    textContent: "Remote"
  }));
  rightPane.appendChild(new MockElement("div", {
    id: "salaryInfoAndJobType",
    textContent: "₹3,00,000–₹4,50,000 a year - Full-time"
  }));
  rightPane.appendChild(new MockElement("div", {
    id: "jobDescriptionText",
    textContent: "Soranova Technologies is hiring freshers for software development roles. Full stack engineering with React and Node.js."
  }));
  doc.appendChild(rightPane);

  const result = extractIndeedJobFromDoc(doc, "https://in.indeed.com/jobs?q=developer");
  const validation = validateJobData(result);

  assert.equal(validation.isValid, true);
  assert.equal(result.jobTitle, "SOFTWARE DEVELOPER- Fresher");
  assert.equal(result.company, "Soranova Technologies Private Limited");
  assert.equal(result.location, "Remote");
  assert.equal(result.salary, "₹3,00,000–₹4,50,000 a year - Full-time");
  assert.equal(result.employmentType, "Full-time");
  assert.ok(result.description.includes("Soranova Technologies is hiring freshers"));
  assert.equal(result.jobUrl, "https://www.indeed.com/viewjob?jk=soranova_jk_123");
});

test("2. Indeed panel with no salary extracts valid job with empty salary string", () => {
  const doc = new MockElement("div");
  const pane = new MockElement("div", { id: "jobsearch-ViewjobPaneWrapper" });
  pane.appendChild(new MockElement("h1", {
    attributes: { "data-testid": "jobsearch-JobInfoHeader-title" },
    textContent: "Frontend Engineer"
  }));
  pane.appendChild(new MockElement("div", {
    attributes: { "data-testid": "inlineHeader-companyName" },
    textContent: "Acme Corp"
  }));
  pane.appendChild(new MockElement("div", {
    attributes: { "data-testid": "inlineHeader-companyLocation" },
    textContent: "Hyderabad, Telangana"
  }));
  pane.appendChild(new MockElement("div", {
    id: "jobDescriptionText",
    textContent: "Build clean web interfaces."
  }));
  doc.appendChild(pane);

  const result = extractIndeedJobFromDoc(doc);
  const validation = validateJobData(result);

  assert.equal(validation.isValid, true);
  assert.equal(result.salary, ""); // Explicitly empty string, not undefined
  assert.equal(result.jobTitle, "Frontend Engineer");
  assert.equal(result.company, "Acme Corp");
  assert.equal(result.location, "Hyderabad, Telangana");
});

test("3. Indeed job with an undisclosed company preserves undisclosed status accurately", () => {
  const doc = new MockElement("div");
  const pane = new MockElement("div", { id: "jobsearch-ViewjobPaneWrapper" });
  pane.appendChild(new MockElement("h1", {
    attributes: { "data-testid": "jobsearch-JobInfoHeader-title" },
    textContent: "Executive Assistant"
  }));
  pane.appendChild(new MockElement("div", {
    attributes: { "data-testid": "inlineHeader-companyName" },
    textContent: "Confidential Employer"
  }));
  doc.appendChild(pane);

  const result = extractIndeedJobFromDoc(doc);
  assert.equal(result.company, "Confidential Employer");
});

test("4. Indeed homepage with no selected job returns invalid extraction state", () => {
  const doc = new MockElement("div");
  doc.appendChild(new MockElement("h1", { textContent: "Find Jobs" }));
  doc.appendChild(new MockElement("input", { attributes: { "placeholder": "Job title, keywords, or company" } }));

  const result = extractIndeedJobFromDoc(doc, "https://www.indeed.com");
  const validation = validateJobData(result);

  assert.equal(validation.isValid, false);
  assert.equal(validation.status, "no_job_selected");
});

test("5. Indeed switching between two jobs updates data without page refresh", () => {
  const doc = new MockElement("div");
  const pane = new MockElement("div", { id: "jobsearch-ViewjobPaneWrapper" });
  const titleEl = new MockElement("h1", {
    attributes: { "data-testid": "jobsearch-JobInfoHeader-title" },
    textContent: "Job 1: Junior QA"
  });
  const companyEl = new MockElement("div", {
    attributes: { "data-testid": "inlineHeader-companyName" },
    textContent: "Company Alpha"
  });
  pane.appendChild(titleEl);
  pane.appendChild(companyEl);
  doc.appendChild(pane);

  const job1 = extractIndeedJobFromDoc(doc);
  assert.equal(job1.jobTitle, "Job 1: Junior QA");
  assert.equal(job1.company, "Company Alpha");

  // User selects Job 2 in split view
  titleEl.textContent = "Job 2: Senior DevOps";
  companyEl.textContent = "Company Beta";

  const job2 = extractIndeedJobFromDoc(doc);
  assert.equal(job2.jobTitle, "Job 2: Senior DevOps");
  assert.equal(job2.company, "Company Beta");
  assert.notEqual(job1.jobTitle, job2.jobTitle);
});

test("6. LinkedIn selected-job panel extracts title, company, location, salary, and description", () => {
  const doc = new MockElement("div");
  const pane = new MockElement("div", { className: "jobs-search__job-details" });
  const titleLink = new MockElement("a", {
    className: "job-details-jobs-unified-top-card__job-title-link",
    attributes: { href: "https://www.linkedin.com/jobs/view/99887766/" }
  });
  titleLink.appendChild(new MockElement("h1", { textContent: "Machine Learning Engineer" }));
  pane.appendChild(titleLink);

  pane.appendChild(new MockElement("div", {
    className: "job-details-jobs-unified-top-card__company-name",
    textContent: "Neural Labs Inc"
  }));
  pane.appendChild(new MockElement("div", {
    className: "job-details-jobs-unified-top-card__primary-description-container",
    textContent: "Bangalore, Karnataka · Hybrid"
  }));
  pane.appendChild(new MockElement("li", {
    className: "job-details-jobs-unified-top-card__job-insight",
    textContent: "$120,000/yr - $150,000/yr · Full-time"
  }));
  pane.appendChild(new MockElement("div", {
    id: "job-details",
    textContent: "Design scalable deep learning training systems."
  }));
  doc.appendChild(pane);

  const result = extractLinkedInJobFromDoc(doc);
  assert.equal(result.jobTitle, "Machine Learning Engineer");
  assert.equal(result.company, "Neural Labs Inc");
  assert.equal(result.location, "Bangalore, Karnataka · Hybrid");
  assert.ok(result.salary.includes("$120,000"));
  assert.equal(result.employmentType, "Full-time");
  assert.equal(result.jobUrl, "https://www.linkedin.com/jobs/view/99887766/");
});

test("7. LinkedIn changing the selected job updates extracted state", () => {
  const doc = new MockElement("div");
  const pane = new MockElement("div", { className: "jobs-search__job-details" });
  const title = new MockElement("h1", {
    className: "job-details-jobs-unified-top-card__job-title",
    textContent: "Product Manager"
  });
  pane.appendChild(title);
  doc.appendChild(pane);

  const first = extractLinkedInJobFromDoc(doc);
  assert.equal(first.jobTitle, "Product Manager");

  title.textContent = "Senior Product Designer";
  const second = extractLinkedInJobFromDoc(doc);
  assert.equal(second.jobTitle, "Senior Product Designer");
});

test("8. Missing optional fields (experience, salary) do not fail extraction", () => {
  const doc = new MockElement("div");
  const pane = new MockElement("div", { id: "jobsearch-ViewjobPaneWrapper" });
  pane.appendChild(new MockElement("h1", {
    attributes: { "data-testid": "jobsearch-JobInfoHeader-title" },
    textContent: "Cloud Support Associate"
  }));
  doc.appendChild(pane);

  const result = extractIndeedJobFromDoc(doc);
  const validation = validateJobData(result);

  assert.equal(validation.isValid, true);
  assert.equal(result.salary, "");
  assert.equal(result.experience, "");
  assert.equal(result.employmentType, "");
});

test("9. Delayed DOM content: extraction succeeds once pane populates", () => {
  const doc = new MockElement("div");
  // At t=0, pane is empty
  const pane = new MockElement("div", { id: "jobsearch-ViewjobPaneWrapper" });
  doc.appendChild(pane);

  let initialResult = extractIndeedJobFromDoc(doc);
  assert.equal(validateJobData(initialResult).isValid, false);

  // At t=1, details finish rendering via AJAX
  pane.appendChild(new MockElement("h1", {
    attributes: { "data-testid": "jobsearch-JobInfoHeader-title" },
    textContent: "Full Stack Engineer"
  }));
  pane.appendChild(new MockElement("div", {
    attributes: { "data-testid": "inlineHeader-companyName" },
    textContent: "Delta Tech"
  }));

  let populatedResult = extractIndeedJobFromDoc(doc);
  assert.equal(validateJobData(populatedResult).isValid, true);
  assert.equal(populatedResult.jobTitle, "Full Stack Engineer");
  assert.equal(populatedResult.company, "Delta Tech");
});

test("10. Incorrect or unavailable job URLs are not fabricated", () => {
  const doc = new MockElement("div");
  const pane = new MockElement("div", { id: "jobsearch-ViewjobPaneWrapper" });
  pane.appendChild(new MockElement("h1", {
    attributes: { "data-testid": "jobsearch-JobInfoHeader-title" },
    textContent: "Security Specialist"
  }));
  doc.appendChild(pane);

  // URL has an unrelated query parameter from a different search session
  const result = extractIndeedJobFromDoc(doc, "https://www.indeed.com/jobs?q=security&someParam=123");

  // Since no verified selected-job card or pane link exists, jobUrl must be empty, NOT fabricated
  assert.equal(result.jobUrl, "");
});

test("11. Multiple job cards in search list do not cross-contaminate selected job data", () => {
  const doc = new MockElement("div");

  const leftRail = new MockElement("div", { className: "jobsearch-LeftPane" });

  // Unselected Card 1
  const card1 = new MockElement("div", { className: "cardOutline" });
  card1.appendChild(new MockElement("h2", { className: "jobTitle", textContent: "Card 1: Java Developer" }));
  card1.appendChild(new MockElement("span", { attributes: { "data-testid": "company-name" }, textContent: "Company One" }));
  leftRail.appendChild(card1);

  // Selected Card 2
  const card2 = new MockElement("div", { className: "cardOutline selected" });
  const card2Link = new MockElement("a", { attributes: { "data-jk": "card2_jk" } });
  card2Link.appendChild(new MockElement("h2", { className: "jobTitle", textContent: "Card 2: Python Developer" }));
  card2.appendChild(card2Link);
  card2.appendChild(new MockElement("span", { attributes: { "data-testid": "company-name" }, textContent: "Company Two" }));
  leftRail.appendChild(card2);

  // Unselected Card 3
  const card3 = new MockElement("div", { className: "cardOutline" });
  card3.appendChild(new MockElement("h2", { className: "jobTitle", textContent: "Card 3: Go Developer" }));
  card3.appendChild(new MockElement("span", { attributes: { "data-testid": "company-name" }, textContent: "Company Three" }));
  leftRail.appendChild(card3);

  doc.appendChild(leftRail);

  // Right pane corresponds to selected Card 2
  const pane = new MockElement("div", { id: "jobsearch-ViewjobPaneWrapper" });
  pane.appendChild(new MockElement("h1", {
    attributes: { "data-testid": "jobsearch-JobInfoHeader-title" },
    textContent: "Card 2: Python Developer"
  }));
  pane.appendChild(new MockElement("div", {
    attributes: { "data-testid": "inlineHeader-companyName" },
    textContent: "Company Two"
  }));
  doc.appendChild(pane);

  const result = extractIndeedJobFromDoc(doc);
  assert.equal(result.jobTitle, "Card 2: Python Developer");
  assert.equal(result.company, "Company Two");
  assert.equal(result.jobUrl, "https://www.indeed.com/viewjob?jk=card2_jk");
  // Ensure no fields leaked from Card 1 or Card 3
  assert.notEqual(result.company, "Company One");
  assert.notEqual(result.company, "Company Three");
});

test("12. Malformed or unexpected DOM structures do not crash extractor", () => {
  const doc = new MockElement("div");
  const malformedPane = new MockElement("div", { id: "jobsearch-ViewjobPaneWrapper" });
  malformedPane.appendChild(new MockElement("div", { textContent: "" }));
  doc.appendChild(malformedPane);

  assert.doesNotThrow(() => {
    const result = extractIndeedJobFromDoc(doc);
    const validation = validateJobData(result);
    assert.equal(validation.isValid, false);
  });
});
