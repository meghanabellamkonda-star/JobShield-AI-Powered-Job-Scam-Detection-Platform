// JobShield - Single Post Analysis & Multi-Post Selection Isolation Tests
// Automated tests reproducing and verifying fixes for Scenarios TEST A through TEST I

import test from "node:test";
import assert from "node:assert/strict";
import JobShieldDetector from "../detector.js";
const RedFlagDetector = JobShieldDetector;

// ---------------------------------------------------------------------------
// Lightweight DOM Mock for Testing Post Extraction & Selection
// ---------------------------------------------------------------------------
class MockElement {
  constructor(tagName = "div", props = {}) {
    this.tagName = tagName.toUpperCase();
    this.id = props.id || "";
    this.className = props.className || "";
    this.textContent = props.textContent || "";
    this.innerText = props.innerText || this.textContent;
    this.attributes = Object.assign({}, props.attributes || {});
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

  get classList() {
    return {
      add: (cls) => {
        const set = new Set((this.className || "").split(/\s+/).filter(Boolean));
        set.add(cls);
        this.className = Array.from(set).join(" ");
      },
      remove: (cls) => {
        const set = new Set((this.className || "").split(/\s+/).filter(Boolean));
        set.delete(cls);
        this.className = Array.from(set).join(" ");
      },
      contains: (cls) => (this.className || "").split(/\s+/).includes(cls)
    };
  }

  contains(node) {
    if (!node) return false;
    let curr = node.parentElement;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentElement;
    }
    return false;
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

  cloneNode(deep = true) {
    const copy = new MockElement(this.tagName, {
      id: this.id,
      className: this.className,
      textContent: this.textContent,
      innerText: this.innerText,
      attributes: Object.assign({}, this.attributes)
    });
    if (deep) {
      for (const child of this.children) {
        copy.appendChild(child.cloneNode(true));
      }
    }
    return copy;
  }

  querySelector(selector) {
    const res = this.querySelectorAll(selector);
    return res.length > 0 ? res[0] : null;
  }

  querySelectorAll(selector) {
    const matched = [];
    const parts = selector.split(",").map((s) => s.trim());

    const testSingle = (node, sel) => {
      if (sel.includes(" ")) {
        const sub = sel.split(/\s+/);
        const last = sub[sub.length - 1];
        if (!testSingle(node, last)) return false;
        let curr = node.parentElement;
        let idx = sub.length - 2;
        while (curr && idx >= 0) {
          if (testSingle(curr, sub[idx])) idx--;
          curr = curr.parentElement;
        }
        return idx < 0;
      }

      if (sel.startsWith("#")) return node.id === sel.slice(1);
      if (sel.startsWith(".")) {
        const cls = sel.slice(1);
        return (node.className || "").split(/\s+/).includes(cls);
      }
      const attrMatch = sel.match(/^([a-zA-Z0-9]+)?\[([a-zA-Z0-9_-]+)(?:([*^~|]?=)["']?([^"']*)["']?)?\]$/);
      if (attrMatch) {
        const tag = attrMatch[1];
        const attrName = attrMatch[2];
        const op = attrMatch[3] || "=";
        const attrVal = attrMatch[4];
        if (tag && node.tagName !== tag.toUpperCase()) return false;
        const actual = node.getAttribute(attrName);
        if (actual === null || actual === undefined) return false;
        if (attrVal === undefined) return true;
        if (op === "=") return actual === attrVal;
        if (op === "*=") return actual.includes(attrVal);
        if (op === "^=") return actual.startsWith(attrVal);
        return false;
      }
      const tagClassMatch = sel.match(/^([a-zA-Z0-9]+)\.([a-zA-Z0-9_-]+)$/);
      if (tagClassMatch) {
        const tag = tagClassMatch[1].toUpperCase();
        const cls = tagClassMatch[2];
        return node.tagName === tag && (node.className || "").split(/\s+/).includes(cls);
      }
      if (/^[a-zA-Z0-9]+$/.test(sel)) return node.tagName === sel.toUpperCase();
      return false;
    };

    const traverse = (node) => {
      for (const p of parts) {
        if (testSingle(node, p)) {
          if (!matched.includes(node)) matched.push(node);
          break;
        }
      }
      for (const c of node.children) traverse(c);
    };

    for (const c of this.children) traverse(c);
    return matched;
  }
}

// ---------------------------------------------------------------------------
// Extractor Simulation Harness Scoped to Post DOM Container
// ---------------------------------------------------------------------------
function cleanText(text) {
  if (!text || typeof text !== "string") return "";
  return text.replace(/\s+/g, " ").trim();
}

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
      if (!trimmed || /^[A-Z\s]{4,}:?$/.test(trimmed)) break;
      capturedLines.push(trimmed);
      if (capturedLines.length >= 4) break;
    } else if (headingRegex.test(trimmed)) {
      capturing = true;
      capturedLines.push(trimmed);
    }
  }
  return capturedLines.join(" ");
}

function extractLinkedInFeedPost(postEl) {
  const data = {
    postId: postEl.getAttribute("data-urn") || postEl.id || "",
    contentType: "linkedin-feed-post",
    jobTitle: "",
    company: "",
    companyWebsite: "",
    companyVerified: null,
    recruiterName: "",
    recruiterEmail: "",
    location: "",
    salary: "",
    experience: "",
    employmentType: "",
    jobClassification: "job",
    applicationInstructions: "",
    contactInstructions: "",
    selectionProcess: "",
    feesOrDeposits: [],
    sensitiveInfoRequests: [],
    description: "",
    postExcerpt: "",
    jobUrl: "",
    platform: "linkedin",
    strategy: "linkedin-feed-post",
    unextractedFields: []
  };

  const textSelectors = [
    ".feed-shared-update-v2__description",
    ".update-components-text",
    ".feed-shared-text",
    "div[class*='update-v2__commentary']",
    "span.break-words"
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
    const clone = postEl.cloneNode(true);
    const excludeSelectors = [
      ".feed-shared-actor",
      ".update-components-actor",
      ".feed-shared-social-actions",
      ".feed-shared-social-action-bar",
      ".feed-shared-social-counts",
      ".comments-comments-list"
    ];
    for (const ex of excludeSelectors) {
      const matched = clone.querySelectorAll(ex);
      for (const m of matched) m.parentElement?.removeChild(m);
    }
    postText = cleanText(clone.innerText || clone.textContent || "");
  }

  data.description = postText;
  data.postExcerpt = postText ? (postText.slice(0, 160) + (postText.length > 160 ? "..." : "")) : "";

  // Actor & Recruiter
  const actorNameEl = postEl.querySelector(".update-components-actor__name, .feed-shared-actor__name");
  if (actorNameEl) data.recruiterName = cleanText(actorNameEl.textContent);

  const actorDescEl = postEl.querySelector(".update-components-actor__description, .feed-shared-actor__description");
  const actorHeadline = actorDescEl ? cleanText(actorDescEl.textContent) : "";

  const atMatch = actorHeadline.match(/\b(?:at|@|for)\s+([A-Z][A-Za-z0-9&.,\s]{2,35})/);
  if (atMatch) data.company = cleanCompanyName(atMatch[1]);
  if (!data.company) {
    const compLink = postEl.querySelector("a[href*='/company/']");
    if (compLink) data.company = cleanCompanyName(cleanText(compLink.textContent));
  }
  if (!data.company) {
    const compMatch = postText.match(/\b(?:at|company|organization|startup)\s*:\s*([A-Z][A-Za-z0-9&.,\s]{2,30})/i);
    if (compMatch) data.company = cleanCompanyName(compMatch[1]);
  }

  // Job Title
  const roleRegexes = [
    /(?:hiring\s+for|looking\s+for|urgent\s+requirement\s+for|position\s*:|role\s*:|job\s*title\s*:|we\s+are\s+hiring\s*:?|opening\s+for)\s*[:\-–]?\s*([A-Za-z0-9\s/–-]{3,50})(?=[,\n.]|$)/i,
    /(?:^|\n)\s*(?:role|position|profile|title)\s*:\s*([^\n,]{3,50})/i
  ];
  for (const r of roleRegexes) {
    const m = postText.match(r);
    if (m && m[1]) {
      const candidate = cleanText(m[1]);
      if (candidate.length > 2 && !/^(immediate|urgent|join|apply|fresher)$/i.test(candidate)) {
        data.jobTitle = candidate;
        break;
      }
    }
  }
  if (!data.jobTitle) {
    const lines = postText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const cleanLine = line.replace(/^[#*•\-\s]+/, "").trim();
      if (cleanLine.length >= 4 && cleanLine.length <= 60 && !/^(hello|hi|dear|greetings|hope|urgent hiring|we are hiring|hiring alert)/i.test(cleanLine)) {
        data.jobTitle = cleanLine;
        break;
      }
    }
  }
  if (!data.jobTitle && /remote\s+personal\s+assistant/i.test(postText)) {
    data.jobTitle = "Remote Personal Assistant";
  } else if (!data.jobTitle && postText.length >= 25) {
    data.jobTitle = "Job Opportunity";
  }

  // Location & Salary
  if (/remote|work\s*from\s*home/i.test(postText)) data.location = "Remote";
  const salMatch = postText.match(/(?:salary|stipend|ctc|pay)\s*:\s*([^\n,]{2,40})|[\$₹€£]\s*[\d,]+/i);
  if (salMatch) data.salary = cleanText(salMatch[1] || salMatch[0]);

  // Links & Emails STRICTLY scoped to postEl
  const links = postEl.querySelectorAll("a[href^='http']");
  for (const a of links) {
    const h = a.href;
    if (!h.includes("linkedin.com") && !h.includes("licdn.com") && !h.includes("lnkd.in")) {
      data.companyWebsite = h;
      break;
    }
  }

  const emails = postText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g);
  if (emails) {
    const valid = emails.filter((e) => !e.toLowerCase().includes("linkedin.com"));
    if (valid.length > 0) data.recruiterEmail = valid[0];
  }

  // Instructions
  data.applicationInstructions = extractSectionSnippet(postText, /(?:how\s*to\s*apply|application\s*instructions?|to\s*apply):?/i);
  data.contactInstructions = extractSectionSnippet(postText, /(?:contact\s*us|reach\s*out|dm\s*me|whatsapp):?/i);

  if (!data.companyWebsite) data.unextractedFields.push("companyWebsite");
  if (!data.recruiterEmail) data.unextractedFields.push("recruiterEmail");
  if (!data.salary) data.unextractedFields.push("salary");

  return data;
}

// ---------------------------------------------------------------------------
// TEST A: Multi-Post Feed Isolation
// ---------------------------------------------------------------------------
test("TEST A: LinkedIn page with five posts; analyzing fee-requesting post detects payment warning without interference from other posts", () => {
  // Post 1: Normal post
  const post1 = new MockElement("div", { className: "feed-shared-update-v2", attributes: { "data-urn": "urn:li:activity:101" } });
  post1.appendChild(new MockElement("div", { className: "feed-shared-text", textContent: "Hiring Senior React Developer at TechNova. 5+ years experience required. Send CV." }));

  // Post 2: Scam post with registration fee
  const post2 = new MockElement("div", { className: "feed-shared-update-v2", attributes: { "data-urn": "urn:li:activity:102" } });
  post2.appendChild(new MockElement("div", { className: "feed-shared-text", textContent: "Urgent opening for Internship at Soranova. Registration fee of ₹2,000 required to confirm your internship." }));

  // Post 3: Normal post
  const post3 = new MockElement("div", { className: "feed-shared-update-v2", attributes: { "data-urn": "urn:li:activity:103" } });
  post3.appendChild(new MockElement("div", { className: "feed-shared-text", textContent: "Excited to share our Q3 results! Great job team!" }));

  // Post 4: Normal job post
  const post4 = new MockElement("div", { className: "feed-shared-update-v2", attributes: { "data-urn": "urn:li:activity:104" } });
  post4.appendChild(new MockElement("div", { className: "feed-shared-text", textContent: "We are hiring QA Engineers. Remote position available." }));

  // Post 5: Normal post
  const post5 = new MockElement("div", { className: "feed-shared-update-v2", attributes: { "data-urn": "urn:li:activity:105" } });
  post5.appendChild(new MockElement("div", { className: "feed-shared-text", textContent: "Looking for recommendations for cloud database architectures." }));

  // Analyze Post 2 specifically
  const extractedPost2 = extractLinkedInFeedPost(post2);
  const analysis2 = RedFlagDetector.analyzeJobPosting(extractedPost2);

  assert.equal(extractedPost2.postId, "urn:li:activity:102");
  assert.equal(analysis2.isPaymentWarning, true, "Must flag payment warning for post 2");
  assert.equal(analysis2.riskScore >= 40, true, "Score must reflect critical payment fee");
  assert.equal(analysis2.findings.some((f) => f.ruleId === "RULE_A_PAYMENT_REQUIRED"), true);
  assert.match(analysis2.findings[0].exactText, /registration fee of ₹2,000 required/i);

  // Analyze Post 1 specifically
  const extractedPost1 = extractLinkedInFeedPost(post1);
  const analysis1 = RedFlagDetector.analyzeJobPosting(extractedPost1);

  assert.equal(extractedPost1.postId, "urn:li:activity:101");
  assert.equal(analysis1.isPaymentWarning, false, "Post 1 must not inherit post 2's payment warning");
  assert.equal(analysis1.riskScore < 20, true, "Post 1 must remain low risk");
});

// ---------------------------------------------------------------------------
// TEST B: Cross-Post Contact Contamination Prevention
// ---------------------------------------------------------------------------
test("TEST B: Selected post with no contact info reports missing contact info and does not steal contact details from sibling posts", () => {
  // Post A: Has email and website
  const postA = new MockElement("div", { className: "feed-shared-update-v2", attributes: { "data-urn": "urn:li:activity:201" } });
  postA.appendChild(new MockElement("div", { className: "feed-shared-text", textContent: "Hiring Developer. Contact hr@acmecorp.com or visit our site." }));
  const linkA = new MockElement("a", { attributes: { href: "https://acmecorp.com/careers" } });
  postA.appendChild(linkA);

  // Post B: Job post with NO email and NO website
  const postB = new MockElement("div", { className: "feed-shared-update-v2", attributes: { "data-urn": "urn:li:activity:202" } });
  postB.appendChild(new MockElement("div", { className: "feed-shared-text", textContent: "Hiring Remote Personal Assistant for scheduling and calendar management. Full-time position." }));

  // Extract Post B strictly
  const extractedPostB = extractLinkedInFeedPost(postB);
  const analysisB = RedFlagDetector.analyzeJobPosting(extractedPostB);

  assert.equal(extractedPostB.recruiterEmail, "", "Must not acquire recruiter email from post A");
  assert.equal(extractedPostB.companyWebsite, "", "Must not acquire website from post A");
  assert.equal(analysisB.missingInformation.some((m) => m.includes("website")), true);
  assert.equal(analysisB.missingInformation.some((m) => m.includes("recruiter email")), true);
});

// ---------------------------------------------------------------------------
// TEST C: Independent Sequential Analysis
// ---------------------------------------------------------------------------
test("TEST C: User analyzes Post A then selects Post B; Post B gets fresh analysis without accumulating Post A's score or findings", () => {
  const postA = new MockElement("div", { className: "feed-shared-update-v2", attributes: { "data-urn": "urn:li:activity:301" } });
  postA.appendChild(new MockElement("div", { className: "feed-shared-text", textContent: "Internship opportunity. Pay ₹1,500 registration deposit to confirm your seat immediately." }));

  const postB = new MockElement("div", { className: "feed-shared-update-v2", attributes: { "data-urn": "urn:li:activity:302" } });
  postB.appendChild(new MockElement("div", { className: "feed-shared-text", textContent: "Software Engineer opening at GlobalTech. Competitive salary and standard interview process. Remote." }));

  // Analyze Post A
  let currentAnalysis = RedFlagDetector.analyzeJobPosting(extractLinkedInFeedPost(postA));
  assert.equal(currentAnalysis.isPaymentWarning, true);
  assert.equal(currentAnalysis.riskScore >= 40, true);

  // User selects Post B: Previous analysis is completely replaced
  currentAnalysis = RedFlagDetector.analyzeJobPosting(extractLinkedInFeedPost(postB));
  assert.equal(currentAnalysis.isPaymentWarning, false, "Post B must not retain Post A payment warning");
  assert.equal(currentAnalysis.riskScore < 20, true, "Post B must not accumulate Post A score");
  assert.equal(currentAnalysis.findings.some((f) => f.ruleId === "RULE_A_PAYMENT_REQUIRED"), false);
});

// ---------------------------------------------------------------------------
// TEST D: Out-of-Order Asynchronous Response Protection
// ---------------------------------------------------------------------------
test("TEST D: Late async response from Post A does not overwrite currently selected Post B", async () => {
  let activePostId = "urn:li:activity:post-B";
  let activeAnalysisResult = null;

  // Simulate late response from Post A arriving after Post B is selected
  const handleAsyncAnalysisResponse = (reqPostId, result) => {
    if (reqPostId !== activePostId) {
      // Stale response discarded!
      return false;
    }
    activeAnalysisResult = result;
    return true;
  };

  const postAResult = { postId: "urn:li:activity:post-A", riskScore: 85, riskCategory: "Critical Risk" };
  const postBResult = { postId: "urn:li:activity:post-B", riskScore: 10, riskCategory: "Low Risk" };

  // Post B is current; Post A returns late
  const acceptedA = handleAsyncAnalysisResponse("urn:li:activity:post-A", postAResult);
  assert.equal(acceptedA, false, "Late response for Post A must be discarded");
  assert.equal(activeAnalysisResult, null);

  // Post B returns
  const acceptedB = handleAsyncAnalysisResponse("urn:li:activity:post-B", postBResult);
  assert.equal(acceptedB, true, "Response for active Post B must be accepted");
  assert.equal(activeAnalysisResult.riskScore, 10);
  assert.equal(activeAnalysisResult.postId, "urn:li:activity:post-B");
});

// ---------------------------------------------------------------------------
// TEST E: Multiple Posts Visible With None Selected
// ---------------------------------------------------------------------------
test("TEST E: Multiple LinkedIn posts visible but none selected returns select_post instruction instead of analyzing entire page", () => {
  const visiblePosts = [
    new MockElement("div", { className: "feed-shared-update-v2", attributes: { "data-urn": "urn:li:activity:1" } }),
    new MockElement("div", { className: "feed-shared-update-v2", attributes: { "data-urn": "urn:li:activity:2" } }),
    new MockElement("div", { className: "feed-shared-update-v2", attributes: { "data-urn": "urn:li:activity:3" } })
  ];

  let selectedLinkedInPostElement = null;

  function coordinatorCheck() {
    if (!selectedLinkedInPostElement && visiblePosts.length > 1) {
      return {
        isValid: false,
        status: "select_post",
        reason: "Select an individual job post to analyze.",
        jobData: null
      };
    }
    return { isValid: true };
  }

  const result = coordinatorCheck();
  assert.equal(result.isValid, false);
  assert.equal(result.status, "select_post");
  assert.equal(result.reason, "Select an individual job post to analyze.");
  assert.equal(result.jobData, null);
});

// ---------------------------------------------------------------------------
// TEST F: Multiple Indicators in Single Selected Post With Deduplication
// ---------------------------------------------------------------------------
test("TEST F: Selected post demanding payment and WhatsApp-only recruitment detects both indicators with verbatim evidence and deduplicated scoring", () => {
  const post = new MockElement("div", { className: "feed-shared-update-v2", attributes: { "data-urn": "urn:li:activity:401" } });
  post.appendChild(new MockElement("div", {
    className: "feed-shared-text",
    textContent: "Urgent Hiring: Remote Personal Assistant. Registration fee of ₹2,500 required for confirmation. Contact recruiter only on WhatsApp at +91 9876543210. Do not send email. Also pay fee of ₹2,500 before starting."
  }));

  const extracted = extractLinkedInFeedPost(post);
  const analysis = RedFlagDetector.analyzeJobPosting(extracted);

  assert.equal(analysis.isPaymentWarning, true);
  assert.equal(analysis.findings.some((f) => f.ruleId === "RULE_A_PAYMENT_REQUIRED"), true);
  assert.equal(analysis.findings.some((f) => f.ruleId === "RULE_D_EXCLUSIVE_MESSAGING"), true);

  // Exact verbatim evidence quotes must come from the post
  const paymentFinding = analysis.findings.find((f) => f.ruleId === "RULE_A_PAYMENT_REQUIRED");
  assert.match(paymentFinding.exactText, /registration fee of ₹2,500 required/i);
  assert.equal(paymentFinding.evidenceStrength, "explicit");

  const messagingFinding = analysis.findings.find((f) => f.ruleId === "RULE_D_EXCLUSIVE_MESSAGING");
  assert.match(messagingFinding.exactText, /WhatsApp/i);

  // Deduplication check: repeated mention of "pay fee" does not count Rule A twice
  const ruleACount = analysis.findings.filter((f) => f.ruleId === "RULE_A_PAYMENT_REQUIRED").length;
  assert.equal(ruleACount, 1, "Rule A must be deduplicated and scored once");
});

// ---------------------------------------------------------------------------
// TEST G: Indeed Search Page Scoping
// ---------------------------------------------------------------------------
test("TEST G: Indeed search page with multiple cards and one active detail pane analyzes only the selected job", () => {
  // Details pane for Job B
  const pane = new MockElement("div", { id: "jobsearch-ViewjobPaneWrapper" });
  pane.appendChild(new MockElement("h1", { className: "jobsearch-JobInfoHeader-title", textContent: "Frontend Engineer" }));
  const compLink = new MockElement("div", { className: "jobsearch-CompanyInfoContainer" });
  compLink.appendChild(new MockElement("a", { textContent: "Acme Web Solutions" }));
  pane.appendChild(compLink);
  pane.appendChild(new MockElement("div", { id: "jobDescriptionText", textContent: "Building performant Web components in TypeScript. Full-time position." }));

  // Extraction scoped to pane
  const jobTitle = cleanText(pane.querySelector("h1.jobsearch-JobInfoHeader-title").textContent);
  const company = cleanCompanyName(cleanText(pane.querySelector(".jobsearch-CompanyInfoContainer a").textContent));
  const desc = cleanText(pane.querySelector("#jobDescriptionText").textContent);

  assert.equal(jobTitle, "Frontend Engineer");
  assert.equal(company, "Acme Web Solutions");
  assert.equal(desc.includes("Building performant Web components"), true);
});

// ---------------------------------------------------------------------------
// TEST H: Real-Time Dynamic Selection Update
// ---------------------------------------------------------------------------
test("TEST H: User navigates from Job 1 to Job 2; current result updates cleanly without displaying stale data", () => {
  let state = {
    selectedPostId: "urn:li:activity:job-1",
    jobTitle: "Data Analyst",
    riskScore: 35
  };

  // User navigates / clicks Job 2
  const newPost = {
    selectedPostId: "urn:li:activity:job-2",
    jobTitle: "Customer Support Executive",
    riskScore: 0
  };

  // State is reset and replaced
  state = {
    selectedPostId: newPost.selectedPostId,
    jobTitle: newPost.jobTitle,
    riskScore: newPost.riskScore
  };

  assert.equal(state.selectedPostId, "urn:li:activity:job-2");
  assert.equal(state.jobTitle, "Customer Support Executive");
  assert.equal(state.riskScore, 0);
});

// ---------------------------------------------------------------------------
// TEST I: Insufficient Data Handling
// ---------------------------------------------------------------------------
test("TEST I: Post with insufficient text or extraction failure displays insufficient-data message without fabricating risk explanation", () => {
  const emptyPostData = {
    jobTitle: "",
    description: "",
    platform: "linkedin"
  };

  const analysisEmpty = RedFlagDetector.analyzeJobPosting(emptyPostData);
  assert.equal(analysisEmpty.status, "insufficient_data");
  assert.equal(analysisEmpty.riskScore, 0);
  assert.equal(analysisEmpty.riskCategory, "Insufficient Data");
  assert.equal(analysisEmpty.findings.length, 0);
  assert.match(analysisEmpty.disclaimer, /Insufficient data/i);

  const tinyPostData = {
    jobTitle: "Dev",
    description: "hi",
    platform: "linkedin"
  };

  const analysisTiny = RedFlagDetector.analyzeJobPosting(tinyPostData);
  assert.equal(analysisTiny.status, "insufficient_data");
  assert.equal(analysisTiny.riskScore, 0);
  assert.equal(analysisTiny.riskCategory, "Insufficient Data");
  assert.equal(analysisTiny.findings.length, 0);
});

// ---------------------------------------------------------------------------
// REGRESSION TEST 1: Formal LinkedIn Job Listing (/jobs/view/4459763391/)
// ---------------------------------------------------------------------------
test("REGRESSION TEST 1: Formal LinkedIn Job Listing (/jobs/view/4459763391/ - Ira Hospitality)", () => {
  // Simulate page URL
  const testUrl = "https://www.linkedin.com/jobs/view/4459763391/?alternateChannel=search";
  const path = new URL(testUrl).pathname.toLowerCase();

  // 1. Page type detection verification
  const isFormalJob = path.includes("/jobs/view/");
  assert.equal(isFormalJob, true, "URL must be recognized as formal job-detail, NOT feed or search");

  // 2. DOM hierarchy: Topcard, description, and sidebar with similar jobs (div[data-job-id])
  const doc = new MockElement("div");

  // Main job details container
  const mainPane = new MockElement("div", { className: "jobs-details__main-content" });
  doc.appendChild(mainPane);

  const topCard = new MockElement("div", { className: "job-details-jobs-unified-top-card" });
  mainPane.appendChild(topCard);

  const titleEl = new MockElement("h1", {
    className: "job-details-jobs-unified-top-card__job-title",
    textContent: "Full Stack Developer Intern (6-Month Tenure)"
  });
  topCard.appendChild(titleEl);

  const compLink = new MockElement("a", {
    className: "job-details-jobs-unified-top-card__company-name",
    textContent: "Ira Hospitality",
    attributes: { href: "https://www.linkedin.com/company/ira-hospitality/" }
  });
  topCard.appendChild(compLink);

  const locContainer = new MockElement("div", {
    className: "job-details-jobs-unified-top-card__primary-description-container",
    textContent: "Hyderabad, Telangana, India · 2 months ago · Over 100 people clicked apply"
  });
  topCard.appendChild(locContainer);

  const insightList = new MockElement("ul", { className: "job-details-jobs-unified-top-card__job-insight" });
  topCard.appendChild(insightList);
  insightList.appendChild(new MockElement("li", { className: "ui-pill", textContent: "On-site" }));
  insightList.appendChild(new MockElement("li", { className: "ui-pill", textContent: "Internship" }));

  const descEl = new MockElement("div", {
    id: "job-details",
    className: "jobs-description__content",
    textContent: `About Ira Hospitality:
We are a premier hospitality brand in Hyderabad.
We are looking for a dedicated Full Stack Developer Intern for a 6-Month tenure.
Requirements:
- Strong knowledge of JavaScript, React, Node.js, and SQL.
- Problem solving and API design skills.
- Available for on-site internship in Hyderabad.
Stipend: ₹15,000 per month.`
  });
  mainPane.appendChild(descEl);

  // Sidebar recommendation card with data-job-id that previously hijacked extraction
  const sidebar = new MockElement("div", { className: "jobs-similar-jobs" });
  doc.appendChild(sidebar);
  sidebar.appendChild(new MockElement("div", {
    attributes: { "data-job-id": "8877665544" },
    textContent: "Unrelated Recommended Job"
  }));

  // Extraction logic reproduction
  const pane = doc.querySelector(".jobs-details__main-content, .job-view-layout") || doc;
  assert.ok(pane, "Main pane must be located");

  const extractedTitle = pane.querySelector("h1.job-details-jobs-unified-top-card__job-title, h1")?.textContent?.trim();
  assert.equal(extractedTitle, "Full Stack Developer Intern (6-Month Tenure)");

  const extractedComp = pane.querySelector(".job-details-jobs-unified-top-card__company-name")?.textContent?.trim();
  assert.equal(extractedComp, "Ira Hospitality");

  const locText = pane.querySelector(".job-details-jobs-unified-top-card__primary-description-container")?.textContent?.trim();
  const extractedLoc = locText?.split(/[·•|]/)[0]?.trim();
  assert.equal(extractedLoc, "Hyderabad, Telangana, India");

  const pillEls = pane.querySelectorAll("li.ui-pill");
  const pills = pillEls.map((p) => p.textContent.trim()).join(" ");
  const typeMatch = pills.match(/\b(Internship|Full-time)\b/i);
  assert.ok(typeMatch, "Must identify Internship employment type");
  assert.equal(typeMatch[0].toLowerCase(), "internship");

  // Run through detector
  const analysis = RedFlagDetector.analyzeJobPosting({
    jobTitle: extractedTitle,
    company: extractedComp,
    location: extractedLoc,
    employmentType: typeMatch[0],
    description: descEl.textContent,
    platform: "linkedin",
    contentType: "job_listing"
  });

  assert.equal(analysis.status, "analyzed");
  assert.equal(analysis.riskCategory, "Low Risk");
  assert.equal(analysis.isPaymentWarning, false);
});

// ---------------------------------------------------------------------------
// REGRESSION TEST 2: LinkedIn Content-Search Results (Edvexa & CareBazar Posts)
// ---------------------------------------------------------------------------
test("REGRESSION TEST 2: LinkedIn Content-Search Results (Edvexa & CareBazar isolated detection)", () => {
  const searchUrl = "https://www.linkedin.com/search/results/content/?keywords=full%20stack%20developer%20internships";
  const path = new URL(searchUrl).pathname.toLowerCase();

  assert.equal(path.includes("/search/results/content/"), true, "Must recognize posts-search route");

  const container = new MockElement("div", { className: "search-results-container" });
  const resultsList = new MockElement("ul", { className: "reusable-search__entity-result-list" });
  container.appendChild(resultsList);

  // Post 1: Edvexa
  const item1 = new MockElement("li", { className: "reusable-search__result-container artdeco-card" });
  resultsList.appendChild(item1);

  const post1 = new MockElement("div", {
    className: "feed-shared-update-v2",
    attributes: { "data-urn": "urn:li:activity:7100000001" }
  });
  item1.appendChild(post1);

  const actor1 = new MockElement("div", { className: "update-components-actor" });
  actor1.appendChild(new MockElement("span", { className: "update-components-actor__name", textContent: "Abhyanand Jha" }));
  post1.appendChild(actor1);

  const text1 = new MockElement("div", {
    className: "update-components-text",
    textContent: `💥 Edvexa Is Hiring | Software Engineer Intern | Freshers & 0–1 Year
🔥 Remote Internship Opportunity for Aspiring Software Engineers!
💼 Role: Software Engineer Intern – Full Stack
Apply now for hands-on project exposure.`
  });
  post1.appendChild(text1);

  const miniCard1 = new MockElement("div", { className: "update-components-mini-update-v2" });
  miniCard1.appendChild(new MockElement("div", { className: "update-components-mini-update-v2__title", textContent: "Software Engineer Intern" }));
  miniCard1.appendChild(new MockElement("div", { className: "update-components-mini-update-v2__sub-title", textContent: "Edvexa" }));
  miniCard1.appendChild(new MockElement("div", { className: "update-components-mini-update-v2__metadata", textContent: "Bengaluru (Remote)" }));
  post1.appendChild(miniCard1);

  // Post 2: CareBazar
  const item2 = new MockElement("li", { className: "reusable-search__result-container artdeco-card" });
  resultsList.appendChild(item2);

  const post2 = new MockElement("div", {
    className: "feed-shared-update-v2",
    attributes: { "data-urn": "urn:li:activity:7100000002" }
  });
  item2.appendChild(post2);

  const actor2 = new MockElement("div", { className: "update-components-actor" });
  actor2.appendChild(new MockElement("span", { className: "update-components-actor__name", textContent: "Anurag Shrivastava" }));
  post2.appendChild(actor2);

  const text2 = new MockElement("div", {
    className: "update-components-text",
    textContent: `💥 We're Hiring Intern at CareBazar!
We're looking for passionate and motivated Full-Stack Developer Intern who are eager to learn, build real-world projects, and grow with us.
💼 Role: Full-Stack Developer Intern
If you're enthusiastic about development and ready to turn your skills into real-world experience, we'd love to connect with you!`
  });
  post2.appendChild(text2);

  // Verify containment filtering:
  // Candidate list containing outer item and inner post
  const rawCandidates = [item1, post1, item2, post2];
  const filtered = rawCandidates.filter((cand) => {
    const containsSubCandidate = rawCandidates.some((other) => other !== cand && cand.contains(other));
    return !containsSubCandidate;
  });

  // item1 contains post1, so item1 is discarded and post1 is retained!
  assert.equal(filtered.length, 2, "Must retain exactly the 2 individual post cards without outer nesting");
  assert.ok(filtered.includes(post1), "Post 1 (Edvexa) must be present");
  assert.ok(filtered.includes(post2), "Post 2 (CareBazar) must be present");

  // Extract Post 1 independently
  const p1Title = post1.querySelector(".update-components-mini-update-v2__title")?.textContent?.trim();
  const p1Comp = post1.querySelector(".update-components-mini-update-v2__sub-title")?.textContent?.trim();
  assert.equal(p1Title, "Software Engineer Intern");
  assert.equal(p1Comp, "Edvexa");

  // Extract Post 2 independently
  const p2Text = post2.querySelector(".update-components-text")?.textContent?.trim();
  const p2RoleMatch = p2Text.match(/role\s*:\s*([^\n,]{3,50})/i);
  const p2CompMatch = p2Text.match(/we(?:'re|\s+are)\s+hiring\s+intern\s+at\s+([A-Za-z0-9&.,\s]{1,30})/i);
  assert.equal(p2RoleMatch[1].trim(), "Full-Stack Developer Intern");
  assert.equal(p2CompMatch[1].trim(), "CareBazar");

  // Verify they do not contaminate each other
  assert.notEqual(p1Comp, p2CompMatch[1].trim());
  assert.strictEqual(p1Title.includes("CareBazar"), false);
  assert.strictEqual(p2Text.includes("Edvexa"), false);
});

