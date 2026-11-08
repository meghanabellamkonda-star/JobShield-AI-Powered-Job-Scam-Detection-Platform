// JobShield Popup Script
// Handles the extension popup interface, job details rendering, and user controls

console.log("JobShield: Popup script loaded");

// DOM Elements
const elements = {
  enableToggle: document.getElementById("enable-toggle"),
  warningsToggle: document.getElementById("warnings-toggle"),
  analysisMode: document.getElementById("analysis-mode"),
  reportJobBtn: document.getElementById("report-job-btn"),
  reanalyzeBtn: document.getElementById("reanalyze-btn"),
  statusCard: document.getElementById("status-card"),
  statusIcon: document.getElementById("status-icon"),
  statusTitle: document.getElementById("status-title"),
  statusSubtitle: document.getElementById("status-subtitle"),
  jobInfoSection: document.getElementById("job-info-section"),
  riskBadge: document.getElementById("risk-badge"),
  currentJobTitle: document.getElementById("current-job-title"),
  currentJobCompany: document.getElementById("current-job-company"),
  currentJobLocation: document.getElementById("current-job-location"),
  currentJobWorkplace: document.getElementById("current-job-workplace"),
  currentJobSalary: document.getElementById("current-job-salary"),
  currentJobPlatform: document.getElementById("current-job-platform"),
  currentJobContentType: document.getElementById("current-job-content-type"),
  currentJobPosted: document.getElementById("current-job-posted"),
  currentJobActivity: document.getElementById("current-job-activity"),
  currentJobType: document.getElementById("current-job-type"),
  currentJobWebsite: document.getElementById("current-job-website"),
  currentJobEmail: document.getElementById("current-job-email"),
  currentJobUrl: document.getElementById("current-job-url"),
  postExcerptCard: document.getElementById("post-excerpt-card"),
  currentJobExcerpt: document.getElementById("current-job-excerpt"),
  selectAnotherBtn: document.getElementById("select-another-btn"),
  analyzeFirstBtn: document.getElementById("analyze-first-btn"),
  paymentWarningCard: document.getElementById("payment-warning-card"),
  jobFindingsSection: document.getElementById("job-findings-section"),
  riskCategoryDisplay: document.getElementById("risk-category-display"),
  riskScoreDisplay: document.getElementById("risk-score-display"),
  findingsList: document.getElementById("findings-list"),
  findingsLimitation: document.getElementById("findings-limitation"),
  unverifiedInfoCard: document.getElementById("unverified-info-card"),
  unverifiedInfoList: document.getElementById("unverified-info-list"),
  verificationStepsCard: document.getElementById("verification-steps-card"),
  verificationStepsList: document.getElementById("verification-steps-list"),
  reportsSection: document.getElementById("reports-section"),
  reportsList: document.getElementById("reports-list"),
  reportCount: document.getElementById("report-count"),
  reportModal: document.getElementById("report-modal"),
  reportForm: document.getElementById("report-form"),
  reportType: document.getElementById("report-type"),
  reportComment: document.getElementById("report-comment"),
  modalClose: document.getElementById("modal-close"),
  cancelReport: document.getElementById("cancel-report"),
};

// Global state
let currentTab = null;
let currentJobData = null;
let currentAnalysisResult = null;
let settings = {};

const SUPPORTED_SITES = {
  linkedin: "LinkedIn",
  indeed: "Indeed",
  ziprecruiter: "ZipRecruiter",
};

// Initialize popup on load
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await initializePopup();
    setupEventListeners();
  } catch (error) {
    console.error("JobShield: Popup initialization error:", error);
    showError("Failed to initialize extension");
  }
});

// Initialize popup state
async function initializePopup() {
  console.log("JobShield: Initializing popup");

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tabs[0];

  if (!currentTab || !currentTab.url) {
    showError("Unable to access current tab information");
    disableJobActions();
    return;
  }

  await loadSettings();

  const currentSiteKey = getCurrentSiteKey(currentTab.url);

  if (currentSiteKey) {
    await loadCurrentJobData();
  } else {
    showStatus(
      `Navigate to a supported job site (${Object.values(SUPPORTED_SITES).join(", ")}) to use JobShield`,
      "info",
      "No supported job site active in this tab."
    );
    disableJobActions();
  }

  await loadRecentReports();
}

function getCurrentSiteKey(url) {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes("linkedin.com")) return "linkedin";
  if (lower.includes("indeed.") || lower.match(/\bindeed\b/)) return "indeed";
  if (lower.includes("ziprecruiter.com")) return "ziprecruiter";
  return null;
}

function getCurrentSiteDisplayName(url) {
  const key = getCurrentSiteKey(url);
  return key ? SUPPORTED_SITES[key] : "Unsupported Site";
}

// Setup event listeners
function setupEventListeners() {
  elements.enableToggle.addEventListener("change", handleEnableToggle);
  elements.warningsToggle.addEventListener("change", handleWarningsToggle);
  elements.analysisMode.addEventListener("change", handleAnalysisModeChange);
  elements.reportJobBtn.addEventListener("click", handleReportJob);
  elements.reanalyzeBtn.addEventListener("click", handleReanalyze);
  if (elements.selectAnotherBtn) {
    elements.selectAnotherBtn.addEventListener("click", handleSelectAnotherPost);
  }
  if (elements.analyzeFirstBtn) {
    elements.analyzeFirstBtn.addEventListener("click", handleAnalyzeFirstPost);
  }
  elements.modalClose.addEventListener("click", closeReportModal);
  elements.cancelReport.addEventListener("click", closeReportModal);
  elements.reportForm.addEventListener("submit", handleReportSubmit);
  elements.reportModal.addEventListener("click", (e) => {
    if (e.target === elements.reportModal) {
      closeReportModal();
    }
  });
}

async function handleAnalyzeFirstPost() {
  try {
    showStatus("Selecting visible post...", "loading");
    const response = await sendMessageToTab({ type: "SELECT_FIRST_POST" });
    if (response && response.success) {
      await loadCurrentJobData();
    } else {
      showStatus("Could not select post", "info", response?.error || "Please click on a post directly.");
    }
  } catch (err) {
    console.error("JobShield: Error analyzing first post:", err);
  }
}

async function handleSelectAnotherPost() {
  try {
    await sendMessageToTab({ type: "DESELECT_POST" });
  } catch (e) {
    console.warn("JobShield: Could not send DESELECT_POST message", e);
  }
  currentJobData = null;
  currentAnalysisResult = null;
  updateJobDisplay(null, null);
  disableJobActions();
  if (elements.analyzeFirstBtn) {
    elements.analyzeFirstBtn.style.display = "inline-flex";
  }
  showStatus(
    "Select an individual job post to analyze",
    "info",
    "Click directly on any job posting or card on the page to view its JobShield analysis."
  );
}

// Load settings from storage
async function loadSettings() {
  try {
    const response = await sendMessageToBackground({ type: "GET_SETTINGS" });
    if (response && response.success && response.settings) {
      settings = response.settings;
      elements.enableToggle.checked = settings.extensionEnabled !== false;
      elements.warningsToggle.checked = settings.showWarnings !== false;
      elements.analysisMode.value = settings.analysisMode || "conservative";
      console.log("JobShield: Settings loaded:", settings);
    } else {
      settings = {
        extensionEnabled: elements.enableToggle.checked,
        showWarnings: elements.warningsToggle.checked,
        analysisMode: elements.analysisMode.value,
      };
    }
  } catch (error) {
    console.error("JobShield: Error loading settings:", error);
  }
}

// Attempt dynamic content script injection if not yet loaded
async function injectContentScript(tabId) {
  try {
    console.log("JobShield: Attempting to dynamically inject content script into tab", tabId);
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["style.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content_script.js"],
    });
    return true;
  } catch (err) {
    console.warn("JobShield: Failed to dynamically inject content script:", err);
    return false;
  }
}

// Load current job data from content script
async function loadCurrentJobData() {
  if (!elements.enableToggle.checked) {
    showStatus("JobShield is currently disabled", "info", "Toggle extension above to enable analysis.");
    disableJobActions();
    updateJobDisplay(null, null);
    return;
  }

  try {
    showStatus("Checking job information...", "loading");

    let response = null;
    try {
      response = await sendMessageToTab({ type: "GET_CURRENT_JOB" });
    } catch (tabError) {
      // If content script was not connected, try injecting and retry
      if (
        tabError.message &&
        (tabError.message.includes("Could not establish connection") ||
          tabError.message.includes("Receiving end does not exist"))
      ) {
        const injected = await injectContentScript(currentTab.id);
        if (injected) {
          await new Promise((r) => setTimeout(r, 350));
          response = await sendMessageToTab({ type: "GET_CURRENT_JOB" });
        } else {
          throw tabError;
        }
      } else {
        throw tabError;
      }
    }

    console.log("[JobShield Popup Diagnostics] tab response:", response);

    if (response && response.status === "select_post") {
      currentJobData = null;
      currentAnalysisResult = null;
      showStatus(
        "Select an individual job post to analyze",
        "info",
        response.reason || "Click on a specific job post or card on the page to analyze it."
      );
      if (elements.analyzeFirstBtn) {
        elements.analyzeFirstBtn.style.display = "inline-flex";
      }
      disableJobActions();
      updateJobDisplay(null, null);
      return;
    }

    if (response && response.status === "no_posts_found") {
      currentJobData = null;
      currentAnalysisResult = null;
      showStatus(
        "No Visible Posts Detected",
        "info",
        response.reason || "Scroll down on LinkedIn to reveal hiring posts, or click Analyze Visible Post."
      );
      if (elements.analyzeFirstBtn) {
        elements.analyzeFirstBtn.style.display = "inline-flex";
      }
      disableJobActions();
      updateJobDisplay(null, null);
      return;
    }

    if (response && response.status === "unsupported_page") {
      currentJobData = null;
      currentAnalysisResult = null;
      showStatus(
        "Unsupported Page",
        "info",
        response.reason || "JobShield analyzes job listings and hiring posts."
      );
      if (elements.analyzeFirstBtn) {
        elements.analyzeFirstBtn.style.display = "none";
      }
      disableJobActions();
      updateJobDisplay(null, null);
      return;
    }

    if (response && response.status === "extraction_error") {
      currentJobData = null;
      currentAnalysisResult = null;
      showStatus(
        "Extraction Incomplete",
        "warning",
        response.reason || "Could not read complete job details. Ensure the page has fully loaded and click Reanalyze."
      );
      if (elements.analyzeFirstBtn) {
        elements.analyzeFirstBtn.style.display = "none";
      }
      disableJobActions();
      updateJobDisplay(null, null);
      return;
    }

    if (response && response.status === "non_job_content") {
      currentJobData = null;
      currentAnalysisResult = null;
      showStatus(
        "Non-Job Content",
        "info",
        response.reason || "The selected content is an ordinary discussion or personal post, not a job announcement."
      );
      if (elements.analyzeFirstBtn) {
        elements.analyzeFirstBtn.style.display = "none";
      }
      disableJobActions();
      updateJobDisplay(null, null);
      return;
    }

    if (response && response.status === "insufficient_data") {
      currentJobData = null;
      currentAnalysisResult = null;
      showStatus(
        "Insufficient Content Details",
        "warning",
        response.reason || "The selected post does not contain enough text or hiring details to evaluate."
      );
      if (elements.analyzeFirstBtn) {
        elements.analyzeFirstBtn.style.display = "none";
      }
      disableJobActions();
      updateJobDisplay(null, null);
      return;
    }

    if (response && response.success && response.jobData && response.jobData.jobTitle) {
      currentJobData = response.jobData;
      currentAnalysisResult = response.analysisResult;

      if (elements.analyzeFirstBtn) {
        elements.analyzeFirstBtn.style.display = "none";
      }
      if (elements.selectAnotherBtn) {
        elements.selectAnotherBtn.style.display =
          currentJobData.contentType === "linkedin-feed-post" ? "inline-flex" : "none";
      }

      updateJobDisplay(currentJobData, currentAnalysisResult);
      enableJobActions();

      if (currentAnalysisResult) {
        displayAnalysisStatus(currentAnalysisResult);
      } else {
        showStatus("Job detected, evaluating risk...", "loading");
      }
    } else {
      currentJobData = null;
      currentAnalysisResult = null;
      const isContentOrFeed =
        currentTab.url &&
        (currentTab.url.includes("/search/results/content/") || currentTab.url.includes("/feed"));

      if (elements.analyzeFirstBtn) {
        elements.analyzeFirstBtn.style.display = isContentOrFeed ? "inline-flex" : "none";
      }

      const siteName = getCurrentSiteDisplayName(currentTab.url);
      showStatus(
        isContentOrFeed ? "Select an individual post to analyze" : "No selected job detected",
        "info",
        isContentOrFeed
          ? 'Click a specific post on the page or click "Analyze Visible Post".'
          : `Open a job listing or select a job from the results panel on ${siteName}, then try again.`
      );
      disableJobActions();
      updateJobDisplay(null, null);
    }
  } catch (error) {
    console.error("JobShield: Error loading job data from content script:", error);
    if (elements.analyzeFirstBtn) {
      elements.analyzeFirstBtn.style.display = "none";
    }
    const siteName = getCurrentSiteDisplayName(currentTab.url);
    showStatus(
      `JobShield isn't active on this ${siteName} page`,
      "error",
      "Please refresh the tab or navigate to a job listing."
    );
    disableJobActions();
    updateJobDisplay(null, null);
  }
}

function formatContentType(contentType, platform) {
  if (contentType === "internship_post") return "Internship Post";
  if (contentType === "job_hiring_post") return "Job Hiring Post";
  if (contentType === "recruitment_post") return "Recruitment Post";
  if (contentType === "job_listing") return "Job Listing";
  if (contentType === "linkedin-feed-post") return "LinkedIn Feed Post";
  if (contentType === "linkedin-job") return "LinkedIn Job Listing";
  if (contentType === "indeed-job") return "Indeed Job Listing";
  if (contentType === "ziprecruiter-job") return "ZipRecruiter Job Listing";
  if (platform === "linkedin") return "LinkedIn Job Listing";
  if (platform === "indeed") return "Indeed Job Listing";
  return "Job Listing";
}

// Display analysis status in header status card
function displayAnalysisStatus(analysisResult) {
  if (!analysisResult) {
    showStatus("Analysis pending...", "loading");
    return;
  }

  if (analysisResult.status === "insufficient_data") {
    showStatus(
      "Insufficient Posting Information",
      "warning",
      analysisResult.disclaimer || "This post lacks sufficient text or details to evaluate scam indicators reliably."
    );
    return;
  }

  let message = "";
  let statusType = "info";
  let subMessage = `Risk Score: ${analysisResult.riskScore}/100`;

  if (analysisResult.isPaymentWarning) {
    message = "🚨 Employment Payment Demand Detected";
    statusType = "error";
    subMessage += " — NEVER pay to get a job or internship.";
  } else {
    switch (analysisResult.riskLevel) {
      case "critical":
        message = `Critical Risk (${analysisResult.riskCategory || "Critical Risk"})`;
        statusType = "error";
        subMessage += " — Multiple serious scam indicators. Extreme caution advised.";
        break;
      case "high":
        message = "High Risk — Potentially Suspicious";
        statusType = "error";
        subMessage += " — Strong scam indicators detected. Proceed with extreme caution.";
        break;
      case "medium":
        message = "Moderate Risk — Review Carefully";
        statusType = "warning";
        subMessage += " — Review flagged warning signs carefully.";
        break;
      case "low":
      default:
        if (analysisResult.riskScore === 0) {
          message = "No Significant Red Flags";
          subMessage = "Looks generally typical. Always verify employers independently.";
        } else {
          message = "Low Risk Detected";
          subMessage += " — Minor cautionary indicators found.";
        }
        statusType = "success";
        break;
    }
  }

  showStatus(message, statusType, subMessage);
}

// Severity to CSS class mapping for Phase 3 rules
const SEVERITY_LEVEL_MAP = {
  RULE_A_PAYMENT_REQUIRED: "critical",
  RULE_G_SENSITIVE_INFO: "high",
  RULE_D_EXCLUSIVE_MESSAGING: "high",
  RULE_B_EMAIL_DOMAIN_MISMATCH: "high",
  RULE_E_AUTOMATIC_SELECTION: "medium",
  RULE_F_UNREALISTIC_COMPENSATION: "medium",
  RULE_C_WEBSITE_UNREACHABLE: "medium",
  RULE_C_WEBSITE_UNVERIFIED: "low",
  RULE_C_WEBSITE_MISSING: "info",
  RULE_B_EMAIL_DOMAIN_UNVERIFIED: "low",
  RULE_H_VAGUE_DESCRIPTION: "low",
  RULE_I_URGENCY_PRESSURE: "medium",
  // Legacy fallback keys
  high: "high",
  medium: "medium",
  low: "low",
};

// Update complete job display & findings list in popup
function updateJobDisplay(jobData, analysisResult) {
  if (jobData && jobData.jobTitle) {
    elements.currentJobTitle.textContent = jobData.jobTitle;
    elements.currentJobCompany.textContent = jobData.company || "Not specified";
    elements.currentJobLocation.textContent = jobData.location || "Not specified";
    if (elements.currentJobWorkplace) {
      elements.currentJobWorkplace.textContent = jobData.workplaceType || "Not specified";
    }
    elements.currentJobSalary.textContent = jobData.salary || (jobData.stipend ? jobData.stipend : "Not specified");
    elements.currentJobPlatform.textContent = (jobData.platform || "job board").toUpperCase();
    if (elements.currentJobContentType) {
      elements.currentJobContentType.textContent = formatContentType(jobData.contentType, jobData.platform);
    }
    if (elements.currentJobPosted) {
      elements.currentJobPosted.textContent = jobData.postedDate || "Not specified";
    }
    if (elements.currentJobActivity) {
      elements.currentJobActivity.textContent = jobData.applicantActivity || "Not specified";
    }
    elements.currentJobType.textContent = jobData.employmentType || "Not specified";

    // Website
    if (elements.currentJobWebsite) {
      elements.currentJobWebsite.textContent = jobData.companyWebsite || "Not provided";
    }
    // Recruiter email
    if (elements.currentJobEmail) {
      elements.currentJobEmail.textContent = jobData.recruiterEmail || "Not found";
    }

    // Post Excerpt
    if (elements.postExcerptCard && elements.currentJobExcerpt) {
      const excerpt = jobData.postExcerpt || (jobData.description ? (jobData.description.slice(0, 160) + (jobData.description.length > 160 ? "..." : "")) : "");
      if (excerpt) {
        elements.currentJobExcerpt.textContent = excerpt;
        elements.postExcerptCard.style.display = "block";
      } else {
        elements.postExcerptCard.style.display = "none";
      }
    }

    // Job URL
    if (jobData.jobUrl) {
      elements.currentJobUrl.href = jobData.jobUrl;
      elements.currentJobUrl.textContent = "View original posting";
      elements.currentJobUrl.title = jobData.jobUrl;
      elements.currentJobUrl.style.pointerEvents = "auto";
    } else {
      elements.currentJobUrl.textContent = "URL not verified";
      elements.currentJobUrl.removeAttribute("href");
      elements.currentJobUrl.title = "Direct URL for this specific selected job could not be verified";
      elements.currentJobUrl.style.pointerEvents = "none";
    }

    // "Select Another Post" button: Only display on feeds / multi-post stream pages, hide on formal job detail pages (/jobs/view/ or /viewjob)
    if (elements.selectAnotherBtn) {
      const isFormalJob = (jobData.strategy === "linkedin-view-job" || (jobData.jobUrl && jobData.jobUrl.includes("/jobs/view/")) || (jobData.jobUrl && jobData.jobUrl.includes("/viewjob")));
      elements.selectAnotherBtn.style.display = isFormalJob ? "none" : "inline-flex";
    }

    // Payment warning card
    if (elements.paymentWarningCard) {
      elements.paymentWarningCard.style.display = (analysisResult && analysisResult.isPaymentWarning) ? "block" : "none";
    }

    // Update Risk Badge
    if (analysisResult) {
      if (analysisResult.status === "insufficient_data") {
        elements.riskBadge.textContent = "INSUFFICIENT DATA";
        elements.riskBadge.className = "risk-badge badge-info";
      } else {
        const level = analysisResult.riskLevel || "low";
        const category = analysisResult.riskCategory || `${level.charAt(0).toUpperCase() + level.slice(1)} Risk`;
        elements.riskBadge.textContent = category.toUpperCase();
        elements.riskBadge.className = `risk-badge badge-${level}`;
      }
    } else {
      elements.riskBadge.textContent = "ANALYZING";
      elements.riskBadge.className = "risk-badge";
    }

    // Render Findings List
    if (analysisResult) {
      const findings = analysisResult.findings || [];
      elements.riskScoreDisplay.textContent = `Score: ${analysisResult.riskScore}/100`;
      if (elements.riskCategoryDisplay) {
        elements.riskCategoryDisplay.textContent = analysisResult.riskCategory || "Low Risk";
        elements.riskCategoryDisplay.className = `risk-category-display cat-${analysisResult.riskLevel || "low"}`;
      }

      if (findings.length > 0) {
        elements.findingsList.innerHTML = findings.map((f) => {
          const severityClass = SEVERITY_LEVEL_MAP[f.ruleId] || SEVERITY_LEVEL_MAP[f.severity] || "low";
          const label = escapeHtml(f.ruleName || f.code || f.ruleId || "Warning");
          const evidence = f.exactText
            ? `<blockquote class="finding-quote">${escapeHtml(f.exactText)}</blockquote>`
            : "";
          const explanation = escapeHtml(f.explanation || "");
          const pts = f.riskPoints != null ? `<span class="finding-pts">+${f.riskPoints} pts</span>` : "";
          const strength = f.evidenceStrength
            ? `<span class="finding-strength strength-${f.evidenceStrength}">${escapeHtml(f.evidenceStrength.toUpperCase())}</span>`
            : "";
          const rec = f.recommendation ? `<div class="finding-recommendation">💡 <strong>Action:</strong> ${escapeHtml(f.recommendation)}</div>` : "";
          return `<div class="finding-card severity-${severityClass}">
            <div class="finding-header">
              <span class="finding-label">${label}</span>${strength}${pts}
            </div>
            ${evidence}
            <div class="finding-explanation">${explanation}</div>
            ${rec}
          </div>`;
        }).join("");
      } else {
        const noFindingsText = analysisResult.status === "insufficient_data"
          ? (analysisResult.disclaimer || "Insufficient data to evaluate scam indicators. JobShield requires substantive posting details.")
          : "Listing appears consistent with legitimate job postings. Always independently verify employers before sharing personal information or attending interviews.";
        elements.findingsList.innerHTML = `<div class="finding-card severity-low">
          <div class="finding-label">${analysisResult.status === "insufficient_data" ? "Insufficient Information" : "No scam indicators detected"}</div>
          <div class="finding-explanation">${escapeHtml(noFindingsText)}</div>
        </div>`;
      }
      elements.jobFindingsSection.style.display = "block";

      // Missing / Unverified Information
      const missingInfo = analysisResult.missingInformation || [];
      if (elements.unverifiedInfoCard && elements.unverifiedInfoList) {
        if (missingInfo.length > 0) {
          elements.unverifiedInfoList.innerHTML = missingInfo.map((m) => `<li>${escapeHtml(m)}</li>`).join("");
          elements.unverifiedInfoCard.style.display = "block";
        } else {
          elements.unverifiedInfoCard.style.display = "none";
        }
      }

      // Verification Steps
      const steps = analysisResult.verificationSteps || [];
      if (elements.verificationStepsCard && elements.verificationStepsList) {
        if (steps.length > 0) {
          elements.verificationStepsList.innerHTML = steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
          elements.verificationStepsCard.style.display = "block";
        } else {
          elements.verificationStepsCard.style.display = "none";
        }
      }
    } else {
      elements.jobFindingsSection.style.display = "none";
      if (elements.unverifiedInfoCard) elements.unverifiedInfoCard.style.display = "none";
      if (elements.verificationStepsCard) elements.verificationStepsCard.style.display = "none";
    }

    elements.jobInfoSection.style.display = "block";
  } else {
    elements.jobInfoSection.style.display = "none";
    elements.jobFindingsSection.style.display = "none";
    if (elements.paymentWarningCard) elements.paymentWarningCard.style.display = "none";
    if (elements.unverifiedInfoCard) elements.unverifiedInfoCard.style.display = "none";
    if (elements.verificationStepsCard) elements.verificationStepsCard.style.display = "none";
    if (elements.postExcerptCard) elements.postExcerptCard.style.display = "none";
    if (elements.selectAnotherBtn) elements.selectAnotherBtn.style.display = "none";
    elements.currentJobTitle.textContent = "-";
    elements.currentJobCompany.textContent = "-";
    elements.currentJobLocation.textContent = "-";
    elements.currentJobSalary.textContent = "-";
    elements.currentJobPlatform.textContent = "-";
    if (elements.currentJobContentType) elements.currentJobContentType.textContent = "-";
    elements.currentJobType.textContent = "-";
    if (elements.currentJobWebsite) elements.currentJobWebsite.textContent = "-";
    if (elements.currentJobEmail) elements.currentJobEmail.textContent = "-";
    if (elements.currentJobExcerpt) elements.currentJobExcerpt.textContent = "-";
    elements.currentJobUrl.textContent = "-";
    elements.currentJobUrl.href = "#";
  }
}

// Load recent reports
async function loadRecentReports() {
  try {
    const response = await sendMessageToBackground({ type: "GET_REPORTS" });
    if (response && response.success) {
      updateReportsDisplay(response.reports || []);
    }
  } catch (error) {
    console.error("JobShield: Error loading reports:", error);
  }
}

// Handle enable/disable toggle
async function handleEnableToggle() {
  const enabled = elements.enableToggle.checked;
  try {
    await saveSettings({ extensionEnabled: enabled });
    try {
      await sendMessageToTab({
        type: "TOGGLE_EXTENSION",
        enabled: enabled,
      });
    } catch (tabError) {
      console.warn("JobShield: Could not message tab to toggle extension:", tabError.message);
    }

    if (enabled) {
      const currentSiteKey = getCurrentSiteKey(currentTab.url);
      if (currentSiteKey) {
        await loadCurrentJobData();
      } else {
        showStatus("JobShield enabled. Navigate to a supported job page.", "success");
      }
    } else {
      showStatus("JobShield disabled", "info", "Toggle extension switch to resume analysis.");
      disableJobActions();
      currentJobData = null;
      currentAnalysisResult = null;
      updateJobDisplay(null, null);
    }
  } catch (error) {
    console.error("JobShield: Error toggling extension:", error);
    showError("Could not toggle extension state.");
    elements.enableToggle.checked = !enabled;
  }
}

async function handleWarningsToggle() {
  const showWarnings = elements.warningsToggle.checked;
  try {
    await saveSettings({ showWarnings: showWarnings });
    console.log("JobShield: Warnings toggle updated:", showWarnings);
  } catch (error) {
    console.error("JobShield: Error updating warnings setting:", error);
    elements.warningsToggle.checked = !showWarnings;
  }
}

async function handleAnalysisModeChange() {
  const mode = elements.analysisMode.value;
  try {
    await saveSettings({ analysisMode: mode });
    console.log("JobShield: Analysis mode updated:", mode);
    if (currentJobData && currentJobData.jobTitle) {
      await handleReanalyze();
    }
  } catch (error) {
    console.error("JobShield: Error updating analysis mode:", error);
  }
}

function handleReportJob() {
  if (!currentJobData || !currentJobData.jobTitle) {
    showError("No job data available to report");
    return;
  }
  openReportModal();
}

async function handleReanalyze() {
  try {
    showStatus("Reanalyzing job...", "loading");
    const response = await sendMessageToTab({ type: "REANALYZE" });
    if (response && response.success && response.jobData) {
      currentJobData = response.jobData;
      currentAnalysisResult = response.analysisResult;
      updateJobDisplay(currentJobData, currentAnalysisResult);
      enableJobActions();
      displayAnalysisStatus(currentAnalysisResult);
    } else {
      // Re-read current job data
      await loadCurrentJobData();
    }
  } catch (error) {
    console.error("JobShield: Error reanalyzing:", error);
    showStatus("Reanalysis failed", "error", error.message);
  }
}

async function handleReportSubmit(e) {
  e.preventDefault();
  const reportType = elements.reportType.value;
  const reportComment = elements.reportComment.value;

  if (!reportType) {
    showError("Please select a report type");
    return;
  }

  try {
    const reportData = {
      url: currentJobData?.jobUrl || currentTab.url,
      jobTitle: currentJobData?.jobTitle || "Unknown Job Title",
      company: currentJobData?.company || "Unknown Company",
      reportType: reportType,
      userComment: reportComment,
    };

    await sendMessageToBackground({ type: "USER_REPORT", data: reportData });
    closeReportModal();
    showStatus("Report submitted successfully", "success", "Thank you for helping keep job seekers safe!");
    setTimeout(() => loadRecentReports(), 500);
  } catch (error) {
    console.error("JobShield: Error submitting report:", error);
    showError("Failed to submit report");
  }
}

async function saveSettings(newSettings) {
  const response = await sendMessageToBackground({
    type: "SAVE_SETTINGS",
    data: newSettings,
  });
  if (response && response.success) {
    settings = { ...settings, ...newSettings };
  } else {
    throw new Error(response?.error || "Failed to save settings");
  }
}

function updateReportsDisplay(reports) {
  elements.reportCount.textContent = reports.length;
  if (reports.length > 0) {
    elements.reportsList.innerHTML = reports
      .map(
        (report) => `
      <div class="report-item">
        <div class="report-title">${escapeHtml(report.jobTitle)}</div>
        <div class="report-meta">
          <span class="report-type">${escapeHtml(report.reportType)}</span>
          <span class="report-date">${formatDate(report.timestamp)}</span>
        </div>
      </div>`
      )
      .join("");
    elements.reportsSection.style.display = "block";
  } else {
    elements.reportsSection.style.display = "none";
  }
}

function showStatus(message, type = "info", subtitle = "") {
  const icons = {
    loading: "⏳",
    success: "✅",
    error: "🚩",
    warning: "⚠️",
    info: "ℹ️",
  };
  elements.statusIcon.textContent = icons[type] || icons.info;
  elements.statusTitle.textContent = message;
  elements.statusSubtitle.textContent = subtitle || getStatusSubtitleDefault(type);
  elements.statusCard.className = `status-card status-${type}`;
}

function showError(message, subtitle = "") {
  showStatus(message, "error", subtitle || "Please check console for details.");
}

function getStatusSubtitleDefault(type) {
  const subtitles = {
    loading: "Please wait...",
    success: "Analysis complete.",
    error: "An issue occurred.",
    warning: "Proceed with caution.",
    info: "No action required.",
  };
  return subtitles[type] || "";
}

function enableJobActions() {
  elements.reportJobBtn.disabled = false;
  elements.reanalyzeBtn.disabled = false;
}

function disableJobActions() {
  elements.reportJobBtn.disabled = true;
  // Keep Reanalyze button enabled so the user can manually trigger detection after clicking a job card
  elements.reanalyzeBtn.disabled = false;
}

function openReportModal() {
  elements.reportModal.style.display = "flex";
  elements.reportType.value = "";
  elements.reportComment.value = "";
}

function closeReportModal() {
  elements.reportModal.style.display = "none";
}

function sendMessageToBackground(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response || { success: true });
      }
    });
  });
}

function sendMessageToTab(message) {
  return new Promise((resolve, reject) => {
    if (!currentTab || !currentTab.id) {
      reject(new Error("No active tab available."));
      return;
    }
    chrome.tabs.sendMessage(currentTab.id, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

function formatDate(timestamp) {
  if (!timestamp) return "N/A";
  try {
    const date = new Date(timestamp);
    return (
      date.toLocaleDateString() +
      " " +
      date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  } catch (e) {
    return "Invalid Date";
  }
}

function escapeHtml(unsafe) {
  if (typeof unsafe !== "string") return "";
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
