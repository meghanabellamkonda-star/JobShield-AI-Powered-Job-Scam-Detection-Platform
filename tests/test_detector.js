// JobShield Scam Detection Engine Unit Tests
// Tests Rules A through I, evidence extraction, explainable scoring, deduplication,
// boundary cases, and ghost-job separation.

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JobShieldDetector = require("../detector.js");
const RedFlagDetector = JobShieldDetector;

// ---------------------------------------------------------------------------
// 1. Genuine Corporate Job Posting
// ---------------------------------------------------------------------------
test("1. Genuine corporate listing scores low risk with zero scam indicators", () => {
  const genuineJob = {
    jobTitle: "Senior Software Engineer",
    company: "Google",
    companyWebsite: "https://careers.google.com",
    companyVerified: true,
    recruiterEmail: "recruiting@google.com",
    location: "Mountain View, CA",
    salary: "$180,000 - $240,000 a year",
    employmentType: "Full-time",
    jobClassification: "job",
    selectionProcess: "Initial technical phone screen followed by virtual onsite interviews with coding and system design rounds.",
    applicationInstructions: "Submit your resume through Google Careers portal.",
    contactInstructions: "For accommodations during the interview process, email accommodations@google.com",
    description: `Google is seeking a Senior Software Engineer to design, develop, test, and deploy software solutions.
    Responsibilities:
    - Write clean, maintainable, scalable code in Go, C++, or Java.
    - Collaborate with cross-functional teams to define architecture and requirements.
    - Participate in code reviews and mentor junior team members.
    Qualifications:
    - Bachelor's degree in Computer Science or equivalent practical experience.
    - 5+ years of experience with software development in one or more programming languages.
    - Strong problem-solving and algorithmic skills.`
  };

  const result = RedFlagDetector.analyzeJobPosting(genuineJob);

  assert.equal(result.status, "analyzed");
  assert.equal(result.riskScore, 0);
  assert.equal(result.riskLevel, "low");
  assert.equal(result.riskCategory, "Low Risk");
  assert.equal(result.isPaymentWarning, false);
  assert.equal(result.findings.length, 0);
});

// ---------------------------------------------------------------------------
// 2. Suspicious Internship Demanding Fees / Deposits (Rule A)
// ---------------------------------------------------------------------------
test("2. Internship requiring security deposit or training fee triggers Rule A with critical payment warning", () => {
  const scamInternship = {
    jobTitle: "Full Stack Web Development Intern",
    company: "TechSkillz Infotech",
    companyWebsite: "",
    recruiterEmail: "internships@gmail.com",
    location: "Remote",
    salary: "₹15,000 a month",
    employmentType: "Internship",
    jobClassification: "internship",
    selectionProcess: "Direct selection based on registration form submission.",
    description: `We are offering 3 months remote internship for engineering freshers.
    Selected candidates will receive training on MERN stack.
    Note: A refundable security deposit of ₹3,000 is required for certificate processing and training materials before offer letter issuance.`
  };

  const result = RedFlagDetector.analyzeJobPosting(scamInternship);

  assert.equal(result.isPaymentWarning, true);
  assert.ok(result.riskScore >= 40, `Expected score >= 40, got ${result.riskScore}`);

  const paymentFinding = result.findings.find((f) => f.ruleId === "RULE_A_PAYMENT_REQUIRED");
  assert.ok(paymentFinding, "Expected Rule A finding");
  assert.ok(paymentFinding.riskPoints >= 40);
  assert.ok(paymentFinding.exactText.toLowerCase().includes("security deposit"));
  assert.ok(result.verificationSteps[0].includes("DO NOT TRANSFER FUNDS"));
});

// ---------------------------------------------------------------------------
// 3. WhatsApp-only / Telegram-only Recruitment (Rule D)
// ---------------------------------------------------------------------------
test("3. Recruitment directed exclusively through WhatsApp or Telegram triggers Rule D", () => {
  const whatsappJob = {
    jobTitle: "Customer Support Executive",
    company: "Swift Solutions",
    companyWebsite: "",
    recruiterEmail: "",
    location: "Remote",
    salary: "$25/hour",
    employmentType: "Part-time",
    jobClassification: "job",
    contactInstructions: "Do not apply on this portal. Message HR exclusively on WhatsApp at +1-555-0199 for interview schedule.",
    description: `We are looking for immediate joiners for remote chat support.
    Interested candidates must send their resume to our Telegram @SwiftRecruiter24 or WhatsApp +1-555-0199. All communication will be handled via WhatsApp only.`
  };

  const result = RedFlagDetector.analyzeJobPosting(whatsappJob);

  const finding = result.findings.find((f) => f.ruleId === "RULE_D_EXCLUSIVE_MESSAGING");
  assert.ok(finding, "Expected Rule D finding");
  assert.equal(finding.riskPoints, 20);
  assert.ok(finding.exactText.toLowerCase().includes("whatsapp") || finding.exactText.toLowerCase().includes("telegram"));
});

// ---------------------------------------------------------------------------
// 4. Free-Email Startup with Normal Hiring Process (Rule B Unverified vs Fraud)
// ---------------------------------------------------------------------------
test("4. Small business using free email provider receives mild notice, NOT high risk fraud flag", () => {
  const localBusinessJob = {
    jobTitle: "Pastry Chef Assistant",
    company: "Sweet Treats Bakery",
    companyWebsite: "https://sweettreatsbakery.com",
    recruiterEmail: "sweettreatsbakery@gmail.com",
    location: "Austin, TX",
    salary: "$18 - $22 an hour",
    employmentType: "Full-time",
    jobClassification: "job",
    selectionProcess: "In-person kitchen trial and recipe tasting interview.",
    description: `Family-owned artisan bakery looking for an enthusiastic pastry assistant to help prepare morning croissants and tarts.
    Requirements:
    - 1+ year baking experience or culinary school training.
    - Ability to lift 40lb flour sacks.
    - Early morning availability (5:00 AM starts).`
  };

  const result = RedFlagDetector.analyzeJobPosting(localBusinessJob);

  // Free email should add small unverified advisory (5 pts), but NOT high risk or domain mismatch
  assert.ok(result.riskScore <= 15, `Score should remain low, got ${result.riskScore}`);
  assert.equal(result.riskLevel, "low");
  assert.equal(result.isPaymentWarning, false);

  const mismatchFinding = result.findings.find((f) => f.ruleId === "RULE_B_EMAIL_DOMAIN_MISMATCH");
  assert.equal(mismatchFinding, undefined, "Free email should not be flagged as corporate domain mismatch");

  const unverifiedFinding = result.findings.find((f) => f.ruleId === "RULE_B_EMAIL_DOMAIN_UNVERIFIED");
  assert.ok(unverifiedFinding, "Should note unverified free email provider");
  assert.equal(unverifiedFinding.riskPoints, 5);
});

// ---------------------------------------------------------------------------
// 5. Corporate Email Domain Mismatch (Rule B Domain Mismatch)
// ---------------------------------------------------------------------------
test("5. Recruiter email domain that clashes with corporate domain triggers Rule B mismatch", () => {
  const mismatchedJob = {
    jobTitle: "Cloud Solutions Architect",
    company: "Amazon Web Services",
    companyWebsite: "https://aws.amazon.com",
    recruiterEmail: "aws-hiring-desk@yahoo.com",
    location: "Seattle, WA",
    salary: "$160,000/year",
    employmentType: "Full-time",
    jobClassification: "job",
    description: `AWS is seeking a Cloud Architect to help enterprise customers migrate workloads to the cloud.
    Please contact recruiter directly at aws-hiring-desk@yahoo.com.`
  };

  const result = RedFlagDetector.analyzeJobPosting(mismatchedJob);

  const finding = result.findings.find((f) => f.ruleId === "RULE_B_EMAIL_DOMAIN_MISMATCH");
  assert.ok(finding, "Expected corporate domain mismatch finding");
  assert.equal(finding.riskPoints, 20);
  assert.ok(finding.explanation.includes("amazon.com") || finding.explanation.includes("aws"));
});

// ---------------------------------------------------------------------------
// 6. Missing Website and Missing Salary Without False Fraud Flags
// ---------------------------------------------------------------------------
test("6. Missing optional fields (salary, website) are listed in missingInformation without false fraud points", () => {
  const incompleteJob = {
    jobTitle: "Dental Receptionist",
    company: "Dr. Miller Family Dentistry",
    companyWebsite: "",
    recruiterEmail: "",
    location: "Denver, CO",
    salary: "",
    employmentType: "Part-time",
    jobClassification: "job",
    description: `Friendly dental practice looking for a front desk receptionist.
    Duties include greeting patients, scheduling appointments, and verifying insurance eligibility.
    Experience with Dentrix software preferred.`
  };

  const result = RedFlagDetector.analyzeJobPosting(incompleteJob);

  // Missing fields alone should NOT make a job high risk or scam
  assert.ok(result.riskScore < 20, `Missing fields should not inflate score to medium/high, got ${result.riskScore}`);
  assert.equal(result.isPaymentWarning, false);

  // Missing fields must be documented in missingInformation
  assert.ok(result.missingInformation.some((m) => m.toLowerCase().includes("website")));
  assert.ok(result.missingInformation.some((m) => m.toLowerCase().includes("salary")));
});

// ---------------------------------------------------------------------------
// 7. Guaranteed Automatic Selection Without Meaningful Assessment (Rule E)
// ---------------------------------------------------------------------------
test("7. Guaranteed direct selection without interview triggers Rule E", () => {
  const autoSelectJob = {
    jobTitle: "Junior Data Entry Associate",
    company: "Global Matrix Logistics",
    companyWebsite: "https://globalmatrixlogistics.com",
    recruiterEmail: "hr@globalmatrixlogistics.com",
    location: "Remote",
    salary: "$30/hr",
    employmentType: "Full-time",
    jobClassification: "job",
    selectionProcess: "100% direct selection. No interview required, instant offer letter issued upon application.",
    description: `Simple remote typing job. Guaranteed placement without any interview or background check. Every applicant is automatically hired.`
  };

  const result = RedFlagDetector.analyzeJobPosting(autoSelectJob);

  const finding = result.findings.find((f) => f.ruleId === "RULE_E_AUTOMATIC_SELECTION");
  assert.ok(finding, "Expected Rule E automatic selection finding");
  assert.equal(finding.riskPoints, 15);
  assert.ok(finding.exactText.toLowerCase().includes("no interview") || finding.exactText.toLowerCase().includes("guaranteed"));
});

// ---------------------------------------------------------------------------
// 8. Implausible Compensation for Entry-Level Work (Rule F)
// ---------------------------------------------------------------------------
test("8. Unrealistic compensation for low-skill/fresher roles triggers Rule F", () => {
  const highSalaryJob = {
    jobTitle: "Data Entry Clerk - No Experience Needed",
    company: "Apex Apex Ventures",
    companyWebsite: "",
    recruiterEmail: "recruitment@apexventures-jobs.com",
    location: "Remote",
    salary: "$5,000 a week",
    employmentType: "Full-time",
    experience: "No experience",
    jobClassification: "job",
    description: `Earn $5,000 weekly from home. Minimal effort required, just copy and paste data into spreadsheets 2 hours per day. No experience needed, freshers welcome.`
  };

  const result = RedFlagDetector.analyzeJobPosting(highSalaryJob);

  const finding = result.findings.find((f) => f.ruleId === "RULE_F_UNREALISTIC_COMPENSATION");
  assert.ok(finding, "Expected Rule F unrealistic compensation finding");
  assert.equal(finding.riskPoints, 15);
});

// ---------------------------------------------------------------------------
// 9. Premature Sensitive Information Requests (Rule G)
// ---------------------------------------------------------------------------
test("9. Demanding online banking credentials or identity documents before hiring triggers Rule G", () => {
  const sensitiveJob = {
    jobTitle: "Remote Administrative Assistant",
    company: "Vertex Prime Management",
    companyWebsite: "https://vertexprime.com",
    recruiterEmail: "jobs@vertexprime.com",
    location: "Remote",
    salary: "$28/hr",
    employmentType: "Full-time",
    jobClassification: "job",
    applicationInstructions: "To proceed with initial screening, submit your online banking credentials, SSN copy, and mother's maiden name.",
    description: `Administrative role supporting executive calendar and document preparation.
    Applicants must provide bank login details and government identity cards during preliminary application for credit check verification.`
  };

  const result = RedFlagDetector.analyzeJobPosting(sensitiveJob);

  const finding = result.findings.find((f) => f.ruleId === "RULE_G_SENSITIVE_INFO");
  assert.ok(finding, "Expected Rule G sensitive information request");
  assert.equal(finding.riskPoints, 25);
  assert.ok(finding.exactText.toLowerCase().includes("bank") || finding.exactText.toLowerCase().includes("ssn"));
});

// ---------------------------------------------------------------------------
// 10. Legitimate Onboarding Direct Deposit vs Premature Bank Request
// ---------------------------------------------------------------------------
test("10. Legitimate corporate posting describing post-hire onboarding direct deposit is not penalized", () => {
  const onboardingJob = {
    jobTitle: "Human Resources Coordinator",
    company: "Salesforce",
    companyWebsite: "https://www.salesforce.com",
    companyVerified: true,
    recruiterEmail: "careers@salesforce.com",
    location: "San Francisco, CA",
    salary: "$95,000 a year",
    employmentType: "Full-time",
    jobClassification: "job",
    description: `Join Salesforce as an HR Coordinator.
    Key Responsibilities:
    - Facilitate new hire onboarding and coordinate orientation schedules.
    - Assist candidates with post-hire document verification and direct deposit setup through the employee portal.
    - Maintain confidential employee records in compliance with labor laws.`
  };

  const result = RedFlagDetector.analyzeJobPosting(onboardingJob);

  const finding = result.findings.find((f) => f.ruleId === "RULE_G_SENSITIVE_INFO");
  assert.equal(finding, undefined, "Post-hire onboarding direct deposit should not trigger Rule G");
  assert.equal(result.riskScore, 0);
});

// ---------------------------------------------------------------------------
// 11. Optional WhatsApp Contact alongside Corporate Website
// ---------------------------------------------------------------------------
test("11. Optional WhatsApp contact for quick inquiries alongside corporate channels is not flagged as exclusive messaging", () => {
  const optionalWhatsAppJob = {
    jobTitle: "Operations Analyst",
    company: "Stripe",
    companyWebsite: "https://stripe.com",
    companyVerified: true,
    recruiterEmail: "recruiting@stripe.com",
    location: "Dublin, Ireland",
    salary: "€65,000 a year",
    employmentType: "Full-time",
    jobClassification: "job",
    applicationInstructions: "Please submit applications directly via stripe.com/jobs.",
    contactInstructions: "For general candidate queries regarding office accessibility, you may also reach our team via WhatsApp at +353-1-234567.",
    description: `Stripe powers online commerce. We are looking for an Operations Analyst to evaluate payment workflows.
    Formal applications must be submitted through our corporate careers site.`
  };

  const result = RedFlagDetector.analyzeJobPosting(optionalWhatsAppJob);

  const finding = result.findings.find((f) => f.ruleId === "RULE_D_EXCLUSIVE_MESSAGING");
  assert.equal(finding, undefined, "Optional inquiry WhatsApp should not trigger exclusive messaging rule");
});

// ---------------------------------------------------------------------------
// 12. Deduplication of Repeated Warnings (No Double Counting)
// ---------------------------------------------------------------------------
test("12. Multiple mentions of payment fees in the same listing are deduplicated and scored once", () => {
  const repeatFeeJob = {
    jobTitle: "Online Data Assistant",
    company: "QuickEarn Ltd",
    companyWebsite: "",
    recruiterEmail: "quickearn@hotmail.com",
    location: "Remote",
    salary: "$20/hr",
    employmentType: "Part-time",
    jobClassification: "job",
    description: `Section 1: Candidates must pay a registration fee of $50 before starting work.
    Section 2: The registration fee is required for document verification.
    Section 3: Please submit the $50 registration fee via gift card or UPI to proceed.`
  };

  const result = RedFlagDetector.analyzeJobPosting(repeatFeeJob);

  const ruleAFindings = result.findings.filter((f) => f.ruleId === "RULE_A_PAYMENT_REQUIRED");
  assert.equal(ruleAFindings.length, 1, "Rule A must be deduplicated to exactly 1 finding");
  assert.equal(ruleAFindings[0].riskPoints, 40, "Points must not be doubled or tripled");
});

// ---------------------------------------------------------------------------
// 13. Extraction Failure / Insufficient Data Handling
// ---------------------------------------------------------------------------
test("13. Extraction failure or empty posting safely returns insufficient_data status without crashing", () => {
  const emptyJob = {
    jobTitle: "",
    company: "",
    description: "",
    salary: ""
  };

  const result = RedFlagDetector.analyzeJobPosting(emptyJob);

  assert.equal(result.status, "insufficient_data");
  assert.equal(result.riskScore, 0);
  assert.equal(result.riskCategory, "Insufficient Data");
  assert.equal(result.findings.length, 0);
  assert.ok(result.missingInformation.length > 0);
});

// ---------------------------------------------------------------------------
// 14. Ghost Job Separation (Distinguishing Stale Listings from Scams)
// ---------------------------------------------------------------------------
test("14. Long-active or reposted listing without scam indicators is not falsely classified as fraud", () => {
  const staleJob = {
    jobTitle: "Product Marketing Manager",
    company: "Acme Cloud Software",
    companyWebsite: "https://acmecloud.com",
    companyVerified: true,
    recruiterEmail: "careers@acmecloud.com",
    location: "Chicago, IL",
    salary: "$110,000 - $130,000",
    employmentType: "Full-time",
    jobClassification: "job",
    description: `Acme Cloud is seeking a Product Marketing Manager.
    Note: This position has been open for 90+ days with high applicant volume and multiple reposts.
    Responsibilities include market positioning, sales enablement, and competitive benchmarking.`
  };

  const result = RedFlagDetector.analyzeJobPosting(staleJob);

  // Ghost job traits (stale/reposted) should NOT trigger recruitment fraud or payment rules
  assert.equal(result.riskScore, 0);
  assert.equal(result.riskLevel, "low");
  assert.equal(result.isPaymentWarning, false);
  assert.equal(result.findings.length, 0);
});
