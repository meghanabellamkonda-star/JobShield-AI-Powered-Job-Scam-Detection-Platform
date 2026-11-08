/**
 * Test Suite: Content-Type Classification & Multi-Format Job Detection (Section 9 & Section 7)
 * Tests detection, classification, and heuristic evaluation across:
 * - Formal listings (LinkedIn, Indeed)
 * - Feed posts (recruiter, company, employee, internship, remote)
 * - Suspicious posts (registration fee, WhatsApp-only)
 * - Non-job content (discussions, celebrations, opinions)
 * - Regression test for user screenshot (HR Paid Internship Opportunity, ₹199 fee payable after orientation)
 */

const test = require("node:test");
const assert = require("node:assert");
const JobShieldDetector = require("../detector.js");
const RedFlagDetector = JobShieldDetector;

// ---------------------------------------------------------------------------
// Section 7: Screenshot Regression Test
// ---------------------------------------------------------------------------
test("REGRESSION TEST (User Screenshot): HR Paid Internship Opportunity with ₹199 registration fee payable after orientation", () => {
  const screenshotText = `HIRING NOW | HR PAID INTERNSHIP OPPORTUNITY
HR Intern recruitment opportunity.
Remote / work-from-home mode.
Duration: 45 days.
Working hours: 2–3 hours per day.
Performance-based stipend.
Registration fee: ₹199.
The fee is payable after the orientation session.
Interested candidates can apply now by sending resume.`;

  // 1. Classification
  const classification = RedFlagDetector.classifyContentType(screenshotText, "linkedin-feed-post");
  assert.strictEqual(classification.isJobRelated, true, "Must be recognized as job-related");
  assert.strictEqual(classification.category, "internship_post", "Must be classified as internship_post");
  assert.match(classification.roleTitle, /HR.*Intern/i, "Derived role title should match HR Intern / Internship Opportunity");

  // 2. Job Data Structure passed into detector
  const jobData = {
    jobTitle: classification.roleTitle,
    company: "Campus Placement Partners",
    description: screenshotText,
    platform: "linkedin",
    contentType: classification.category
  };

  // 3. Scam Detector Evaluation
  const result = RedFlagDetector.analyzeJobPosting(jobData);
  assert.strictEqual(result.status, "analyzed");
  assert.strictEqual(result.isPaymentWarning, true, "Must trigger payment demand warning (Rule A)");
  assert.ok(result.riskScore >= 40, `Expected risk score >= 40, got ${result.riskScore}`);

  // 4. Verbatim evidence verification
  const ruleAFinding = result.findings.find((f) => f.ruleId === "RULE_A_PAYMENT_REQUIRED");
  assert.ok(ruleAFinding, "Must have Rule A finding in detected indicators");
  assert.match(
    ruleAFinding.evidence,
    /registration\s+fee|fee\s+is\s+payable\s+after\s+the\s+orientation/i,
    "Evidence must quote the registration fee statement"
  );
  assert.ok(ruleAFinding.explanation.length > 20, "Must provide clear explanation of why payment violates employment standards");
});

// ---------------------------------------------------------------------------
// Section 9: 14 Content-Type Automated Tests
// ---------------------------------------------------------------------------

// 1. A formal LinkedIn job listing
test("1. Formal LinkedIn job listing: classified as job_listing and analyzed cleanly", () => {
  const formalText = `Senior Full Stack Engineer
Google - Mountain View, CA (Hybrid)
About the job:
We are seeking an experienced Full Stack Software Engineer to build scalable cloud architectures.
Qualifications:
- BS/MS in Computer Science
- 5+ years building distributed web applications
Salary: $165,000 - $210,000 per year. Full benefits package.`;

  const classification = RedFlagDetector.classifyContentType(formalText, "linkedin-job-listing");
  assert.strictEqual(classification.isJobRelated, true);
  assert.strictEqual(classification.category, "job_listing");

  const jobData = {
    jobTitle: "Senior Full Stack Engineer",
    company: "Google",
    companyWebsite: "https://www.google.com/careers",
    salary: "$165,000 - $210,000",
    description: formalText,
    platform: "linkedin",
    contentType: classification.category
  };

  const result = RedFlagDetector.analyzeJobPosting(jobData);
  assert.strictEqual(result.status, "analyzed");
  assert.strictEqual(result.riskCategory, "Low Risk");
  assert.strictEqual(result.riskScore, 0);
});

// 2. A LinkedIn internship announcement
test("2. LinkedIn internship announcement: classified as internship_post with role title extraction", () => {
  const postText = `We are excited to announce our Summer 2027 Software Engineering Internship!
Looking for ambitious 3rd and 4th year undergraduate students.
- Duration: 10 weeks
- Work from home / Remote
- Mentorship from senior engineers
- Stipend: ₹25,000 per month
Apply now by sending your resume to university-careers@techcorp.com`;

  const classification = RedFlagDetector.classifyContentType(postText, "linkedin-feed-post");
  assert.strictEqual(classification.isJobRelated, true);
  assert.strictEqual(classification.category, "internship_post");
  assert.ok(classification.signals.includes("opportunity_announcement") || classification.signals.includes("looking_for_talent"));
});

// 3. A LinkedIn recruiter post containing a registration fee
test("3. LinkedIn recruiter post containing registration fee: high risk score with verbatim payment quote", () => {
  const postText = `Urgent hiring for Freshers!
Data Entry & Document Processing Executive.
Work from home. Earn ₹35,000 per month.
Mandatory registration fee of ₹499 required for interview scheduling and verification kit.
Payment details will be shared upon application. Apply now!`;

  const classification = RedFlagDetector.classifyContentType(postText, "linkedin-feed-post");
  assert.strictEqual(classification.isJobRelated, true);

  const jobData = {
    jobTitle: classification.roleTitle || "Data Entry Executive",
    description: postText,
    platform: "linkedin",
    contentType: classification.category
  };

  const result = RedFlagDetector.analyzeJobPosting(jobData);
  assert.strictEqual(result.isPaymentWarning, true);
  assert.ok(result.riskScore >= 40);
  const feeFinding = result.findings.find(f => f.ruleId === "RULE_A_PAYMENT_REQUIRED");
  assert.ok(feeFinding);
  assert.match(feeFinding.evidence, /registration\s+fee/i);
});

// 4. A company-page hiring announcement
test("4. Company-page hiring announcement: classified as job_hiring_post", () => {
  const postText = `Acme Analytics is officially hiring!
We are opening 5 new positions in our Product Design & UX Research team.
Responsibilities:
- Conduct candidate research and build design systems
- Collaborate with engineering and product managers
- Full-time employment with comprehensive medical benefits
To apply, submit your portfolio and CV via the link below: https://acmeanalytics.com/careers`;

  const classification = RedFlagDetector.classifyContentType(postText, "linkedin-feed-post");
  assert.strictEqual(classification.isJobRelated, true);
  assert.strictEqual(classification.category, "job_hiring_post");
});

// 5. An individual recruiter advertising a remote job
test("5. Individual recruiter advertising a remote job: extracts remote criteria and valid classification", () => {
  const postText = `I am hiring a Remote Graphic Designer for my digital marketing client.
100% Work From Home.
Working hours: 4 hours a day, flexible schedule.
Compensation: $30/hour.
Requirements: Proficiency in Figma, Photoshop, and video editing.
DM me your portfolio link to be considered!`;

  const classification = RedFlagDetector.classifyContentType(postText, "linkedin-feed-post");
  assert.strictEqual(classification.isJobRelated, true);
  assert.ok(classification.confidence >= 0.6);
});

// 6. A job post that directs applicants to WhatsApp
test("6. Job post that directs applicants to WhatsApp: triggers Rule D exclusive messaging warning", () => {
  const postText = `Urgent vacancies available!
Telecaller and customer care associates needed immediately.
Salary: ₹18,000 per month.
No email or portal applications accepted. Strictly WhatsApp us at +91 9876543210 to schedule your slot.
DM on WhatsApp to apply.`;

  const classification = RedFlagDetector.classifyContentType(postText, "linkedin-feed-post");
  assert.strictEqual(classification.isJobRelated, true);

  const jobData = {
    jobTitle: "Customer Care Associate",
    description: postText,
    contactInstructions: "Strictly WhatsApp us",
    platform: "linkedin",
    contentType: classification.category
  };

  const result = RedFlagDetector.analyzeJobPosting(jobData);
  const ruleD = result.findings.find(f => f.ruleId === "RULE_D_EXCLUSIVE_MESSAGING");
  assert.ok(ruleD, "Must detect exclusive WhatsApp application process");
  assert.strictEqual(ruleD.score, 20);
});

// 7. A legitimate job post that does not request payment
test("7. Legitimate job post without payment: evaluates to low risk score", () => {
  const postText = `We are hiring Backend Software Engineers (Python/Django).
Location: Bangalore (Hybrid)
Experience: 2-4 years
Salary: 12-18 LPA
Requirements: Strong knowledge of PostgreSQL, Redis, REST APIs, and Docker.
Please share your updated resume at careers@hypergrowth.io with subject line 'Backend Engineer'.`;

  const classification = RedFlagDetector.classifyContentType(postText, "linkedin-feed-post");
  assert.strictEqual(classification.isJobRelated, true);

  const jobData = {
    jobTitle: "Backend Software Engineer",
    company: "Hypergrowth Tech",
    companyWebsite: "https://hypergrowth.io",
    recruiterEmail: "careers@hypergrowth.io",
    salary: "12-18 LPA",
    description: postText,
    platform: "linkedin",
    contentType: classification.category
  };

  const result = RedFlagDetector.analyzeJobPosting(jobData);
  assert.strictEqual(result.riskCategory, "Low Risk");
  assert.strictEqual(result.isPaymentWarning, false);
  assert.strictEqual(result.riskScore, 0);
});

// 8. General LinkedIn post that mentions the word 'job' but is NOT advertising a position
test("8. General LinkedIn post mentioning 'job': classified as non_job_content", () => {
  const opinionPost = `Reflecting on my career journey today.
When I got my first job 10 years ago, the hiring manager told me something I will never forget.
The job market has evolved tremendously, but fundamentals remain unchanged.
Continuous learning and empathy are the most important qualities in tech.
What was the most impactful advice you received in your first job? Let me know in the comments!`;

  const classification = RedFlagDetector.classifyContentType(opinionPost, "linkedin-feed-post");
  assert.strictEqual(classification.isJobRelated, false, "Opinion post must not be treated as a job posting");
  assert.strictEqual(classification.category, "non_job_content");

  // Another non-job: career celebration
  const celebrationPost = `I am happy to share that I have joined Microsoft as a Senior Product Manager!
Thank you to everyone who supported me throughout this journey. Excited for this new chapter!`;
  const celebClassification = RedFlagDetector.classifyContentType(celebrationPost, "linkedin-feed-post");
  assert.strictEqual(celebClassification.isJobRelated, false);
  assert.strictEqual(celebClassification.category, "non_job_content");
});

// 9. Post containing a job description split across multiple lines
test("9. Post with job description split across multiple lines: extracts criteria without truncation", () => {
  const multilineText = `
  Hiring Alert: Mobile App Developers (React Native)
  ================================================
  About the Role:
  • Build cross-platform iOS and Android mobile apps
  • Integrate third-party APIs and offline caching
  • Write unit tests and maintain CI/CD pipelines
  
  Candidate Profile:
  • 2+ years hands-on React Native experience
  • Familiar with Redux Toolkit and TypeScript
  
  Compensation & Perks:
  • ₹8,00,000 - ₹12,00,000 per annum
  • Fully remote equipment allowance
  
  How to Apply:
  • Submit your GitHub profile and resume to hiring@appstudio.dev
  `;

  const classification = RedFlagDetector.classifyContentType(multilineText, "linkedin-feed-post");
  assert.strictEqual(classification.isJobRelated, true);
  assert.strictEqual(classification.category, "job_hiring_post");

  const jobData = {
    jobTitle: classification.roleTitle,
    company: "AppStudio",
    companyWebsite: "https://appstudio.dev",
    recruiterEmail: "hiring@appstudio.dev",
    description: multilineText,
    platform: "linkedin",
    contentType: classification.category
  };

  const result = RedFlagDetector.analyzeJobPosting(jobData);
  assert.strictEqual(result.riskScore, 0);
  assert.strictEqual(result.riskCategory, "Low Risk");
});

// 10. An Indeed job detail page
test("10. Indeed job detail page: classified as job_listing and verified against Indeed layout", () => {
  const indeedText = `SOFTWARE DEVELOPER - Fresher
Soranova Technologies Private Limited
Remote
₹3,00,000 - ₹4,50,000 a year - Full-time
Full Job Description:
We are looking for fresh graduates with proficiency in Python or Java.
Immediate joining available.`;

  const classification = RedFlagDetector.classifyContentType(indeedText, "indeed-job-listing");
  assert.strictEqual(classification.isJobRelated, true);
  assert.strictEqual(classification.category, "job_listing");

  const jobData = {
    jobTitle: "SOFTWARE DEVELOPER - Fresher",
    company: "Soranova Technologies Private Limited",
    location: "Remote",
    salary: "₹3,00,000 - ₹4,50,000 a year",
    employmentType: "Full-time",
    description: indeedText,
    platform: "indeed",
    contentType: classification.category
  };

  const result = RedFlagDetector.analyzeJobPosting(jobData);
  assert.strictEqual(result.status, "analyzed");
  assert.ok(result.riskScore < 20, "Legitimate fresher listing should have low risk");
});

// 11. LinkedIn content-search page containing multiple posts
test("11. LinkedIn content search with multiple posts: classifies individual post independently", () => {
  const post1 = `HIRING NOW: HR Intern. Registration fee ₹199 payable after orientation. Send resume to apply.`;
  const post2 = `Looking for freelance graphic designer. Send portfolio to design@studio.co. Hourly rate: $25/hr.`;

  const class1 = RedFlagDetector.classifyContentType(post1, "linkedin-feed-post");
  const class2 = RedFlagDetector.classifyContentType(post2, "linkedin-feed-post");

  assert.strictEqual(class1.category, "internship_post");
  assert.strictEqual(class2.category, "job_hiring_post");

  // Post 1 analyzed alone has high risk; Post 2 analyzed alone has low risk
  const res1 = RedFlagDetector.analyzeJobPosting({ jobTitle: class1.roleTitle, description: post1, platform: "linkedin" });
  const res2 = RedFlagDetector.analyzeJobPosting({ jobTitle: class2.roleTitle, description: post2, platform: "linkedin", recruiterEmail: "design@studio.co" });

  assert.strictEqual(res1.isPaymentWarning, true);
  assert.strictEqual(res2.isPaymentWarning, false);
});

// 12. Post with incomplete company or job information
test("12. Post with incomplete company or job information: analyzes available evidence without crash", () => {
  const incompleteText = `Immediate hiring for telecallers.
Work from home.
Apply now by contacting recruiter on WhatsApp: +91 9123456789.`;

  const classification = RedFlagDetector.classifyContentType(incompleteText, "linkedin-feed-post");
  assert.strictEqual(classification.isJobRelated, true);

  const jobData = {
    jobTitle: classification.roleTitle || "Telecaller",
    description: incompleteText,
    platform: "linkedin",
    contentType: classification.category
  };

  const result = RedFlagDetector.analyzeJobPosting(jobData);
  assert.strictEqual(result.status, "analyzed");
  assert.ok(result.missingInformation.length > 0, "Missing website and recruiter email should be noted in missingInformation");
  assert.ok(result.missingInformation.some(m => m.includes("website")), "Notes missing website");
});

// 13. Post with no scam indicators
test("13. Post with no scam indicators: receives 0 risk score and Low Risk classification", () => {
  const cleanJob = `We are hiring a Lead Mobile Architect.
Join our engineering team at CloudScale Systems.
We are looking for candidates with 8+ years experience in Android and iOS.
Full-time role, hybrid model in Seattle, WA.
Salary: $190,000 - $230,000.
Apply directly at https://cloudscale.io/careers/lead-mobile or email jobs@cloudscale.io.`;

  const classification = RedFlagDetector.classifyContentType(cleanJob, "linkedin-feed-post");
  assert.strictEqual(classification.isJobRelated, true);

  const jobData = {
    jobTitle: "Lead Mobile Architect",
    company: "CloudScale Systems",
    companyWebsite: "https://cloudscale.io",
    recruiterEmail: "jobs@cloudscale.io",
    salary: "$190,000 - $230,000",
    description: cleanJob,
    platform: "linkedin",
    contentType: classification.category
  };

  const result = RedFlagDetector.analyzeJobPosting(jobData);
  assert.strictEqual(result.riskScore, 0);
  assert.strictEqual(result.riskCategory, "Low Risk");
  assert.strictEqual(result.findings.length, 0);
});

// 14. Post containing multiple independent scam indicators
test("14. Post containing multiple independent scam indicators: calculates compound capped score with all findings", () => {
  const scamPost = `Urgent hiring! Guaranteed direct selection without interview!
Data Processing Specialist - Work from home.
Earn ₹80,000 per month with no prior experience.
Mandatory refundable security deposit of ₹1,500 required before offer letter is issued.
Recruitment conducted strictly via Telegram @JobRecruiterOfficial.
Submit your bank account number and UPI PIN for immediate direct deposit setup.`;

  const classification = RedFlagDetector.classifyContentType(scamPost, "linkedin-feed-post");
  assert.strictEqual(classification.isJobRelated, true);

  const jobData = {
    jobTitle: "Data Processing Specialist",
    description: scamPost,
    platform: "linkedin",
    contentType: classification.category
  };

  const result = RedFlagDetector.analyzeJobPosting(jobData);
  assert.strictEqual(result.status, "analyzed");
  assert.ok(result.riskCategory === "Critical Risk" || result.riskCategory === "High Risk", "High or Critical risk expected");
  assert.strictEqual(result.isPaymentWarning, true);

  // Check multiple independent findings
  const ruleIds = result.findings.map(f => f.ruleId);
  assert.ok(ruleIds.includes("RULE_A_PAYMENT_REQUIRED"), "Must detect payment deposit requirement");
  assert.ok(ruleIds.includes("RULE_D_EXCLUSIVE_MESSAGING"), "Must detect Telegram exclusive recruitment");
  assert.ok(ruleIds.includes("RULE_E_AUTOMATIC_SELECTION"), "Must detect guaranteed direct selection without interview");
  assert.ok(ruleIds.includes("RULE_F_UNREALISTIC_COMPENSATION"), "Must detect unrealistic compensation for fresher/data entry");
  assert.ok(ruleIds.includes("RULE_G_SENSITIVE_INFO"), "Must detect sensitive bank/PIN request");

  // Verified capped score
  assert.ok(result.riskScore <= 100, "Score must never exceed 100");
  assert.ok(result.riskScore >= 75, `Expected composite high score >= 75, got ${result.riskScore}`);
});

// ---------------------------------------------------------------------------
// PART 6: COMPREHENSIVE PIPELINE VERIFICATION SUITE (TEST A - TEST H)
// ---------------------------------------------------------------------------

test("PART 6 — TEST A: Legitimate internship (clean, clear responsibilities, low score)", () => {
  const legitPost = `We are hiring a Frontend Engineering Intern at TechCorp.
Responsibilities:
- Build responsive, interactive web components in React and TypeScript.
- Collaborate with product designers and backend engineers.
Qualifications:
- Basic proficiency with HTML, CSS, JavaScript.
- Currently pursuing a degree in Computer Science or related discipline.
To apply, submit your resume through our careers portal at https://techcorp.example.com/careers.`;

  const classification = RedFlagDetector.classifyContentType(legitPost, "linkedin-feed-post");
  assert.strictEqual(classification.isJobRelated, true);
  assert.strictEqual(classification.category, "internship_post");

  const jobData = {
    jobTitle: "Frontend Engineering Intern",
    company: "TechCorp",
    companyWebsite: "https://techcorp.example.com",
    description: legitPost,
    platform: "linkedin",
    contentType: classification.category
  };

  const result = RedFlagDetector.analyzeJobPosting(jobData);
  assert.strictEqual(result.analysisStatus, "complete");
  assert.strictEqual(result.riskScore, 0, "Legitimate internship should receive 0 risk score");
  assert.strictEqual(result.riskCategory, "Low Risk");
  assert.strictEqual(result.matchedIndicators.length, 0);
  assert.strictEqual(result.isPaymentWarning, false);
});

test("PART 6 — TEST B: Internship requesting payment ('Registration Fee: ₹199/-')", () => {
  const feePost = `HR Intern recruitment opportunity.
We are looking for freshers. Paid internship opportunity.
Duration: 3 Months.
Registration Fee: ₹199/-
The registration fee is mandatory to secure your orientation seat.
Send your resume to apply.`;

  const classification = RedFlagDetector.classifyContentType(feePost, "linkedin-feed-post");
  assert.strictEqual(classification.isJobRelated, true);

  const jobData = {
    jobTitle: "HR Intern",
    company: "Campus Placement Partners",
    description: feePost,
    platform: "linkedin",
    contentType: classification.category
  };

  const result = RedFlagDetector.analyzeJobPosting(jobData);
  assert.strictEqual(result.isPaymentWarning, true);
  assert.ok(result.riskScore >= 40, `Expected score >= 40, got ${result.riskScore}`);

  const paymentIndicator = result.matchedIndicators.find(i => i.ruleId === "RULE_A_PAYMENT_REQUIRED");
  assert.ok(paymentIndicator, "Must match RULE_A_PAYMENT_REQUIRED");
  assert.match(paymentIndicator.evidence, /Registration\s+Fee:\s*₹199/i);
  assert.ok(paymentIndicator.explanation.length > 10);
});

test("PART 6 — TEST C: Suspicious remote job (high earnings, security deposit, unverified messaging)", () => {
  const scamJob = `Work from home data entry job!
Earn ₹50,000 per month for simple 2 hours typing work. No experience needed.
Refundable security deposit of ₹2,000 required before orientation.
Contact hr exclusively via WhatsApp at +91-9876543210 to apply now.`;

  const classification = RedFlagDetector.classifyContentType(scamJob, "linkedin-feed-post");
  assert.strictEqual(classification.isJobRelated, true);

  const jobData = {
    jobTitle: "Data Entry Clerk",
    description: scamJob,
    platform: "linkedin",
    contentType: classification.category
  };

  const result = RedFlagDetector.analyzeJobPosting(jobData);
  assert.ok(result.riskScore >= 60, `Expected critical score >= 60, got ${result.riskScore}`);
  assert.strictEqual(result.riskCategory, "Critical Risk");

  const ruleIds = result.matchedIndicators.map(i => i.ruleId);
  assert.ok(ruleIds.includes("RULE_A_PAYMENT_REQUIRED"), "Must detect deposit requirement");
  assert.ok(ruleIds.includes("RULE_D_EXCLUSIVE_MESSAGING"), "Must detect WhatsApp-only recruitment");
  assert.ok(ruleIds.includes("RULE_F_UNREALISTIC_COMPENSATION"), "Must detect unrealistic pay for typing");

  // Ensure no duplicate ruleId entries
  const uniqueRules = new Set(ruleIds);
  assert.strictEqual(ruleIds.length, uniqueRules.size, "Rules must not be duplicated");
});

test("PART 6 — TEST D: Company hiring announcement without formal job listing", () => {
  const companyAnnouncement = `Acme Analytics is hiring!
We are expanding our data team in Bangalore.
Role: Junior Data Analyst
Responsibilities:
- Build SQL queries and maintain automated dashboard pipelines in Metabase.
- Work with senior engineers on ETL workflows.
Send your resume and GitHub profile to jobs@acmeanalytics.com.`;

  const classification = RedFlagDetector.classifyContentType(companyAnnouncement, "linkedin-feed-post");
  assert.strictEqual(classification.isJobRelated, true);
  assert.strictEqual(classification.category, "job_hiring_post");
  assert.match(classification.roleTitle, /Junior Data Analyst|Data Analyst/i);

  const jobData = {
    jobTitle: classification.roleTitle,
    company: "Acme Analytics",
    recruiterEmail: "jobs@acmeanalytics.com",
    description: companyAnnouncement,
    platform: "linkedin",
    contentType: classification.category
  };

  const result = RedFlagDetector.analyzeJobPosting(jobData);
  assert.strictEqual(result.status, "analyzed");
  assert.strictEqual(result.riskCategory, "Low Risk");
  assert.strictEqual(result.isPaymentWarning, false);
});

test("PART 6 — TEST E: Individual recruiter post with hiring info and application instructions", () => {
  const recruiterPost = `I am hiring Software Engineers for my client in Hyderabad.
Position: Backend Developer (Node.js & Go)
Experience: 2–4 years
Looking for engineers with strong microservices background.
DM me your resume or email it to recruiter@talentconsulting.com.`;

  const classification = RedFlagDetector.classifyContentType(recruiterPost, "linkedin-feed-post");
  assert.strictEqual(classification.isJobRelated, true);
  assert.match(classification.roleTitle, /Backend Developer|Software Engineer/i);

  const jobData = {
    jobTitle: classification.roleTitle,
    company: "Talent Consulting",
    recruiterName: "Priya Sharma",
    recruiterEmail: "recruiter@talentconsulting.com",
    description: recruiterPost,
    platform: "linkedin",
    contentType: classification.category
  };

  const result = RedFlagDetector.analyzeJobPosting(jobData);
  assert.strictEqual(result.status, "analyzed");
  assert.strictEqual(result.riskCategory, "Low Risk");
  assert.strictEqual(result.isPaymentWarning, false);
});

test("PART 6 — TEST F: Unrelated LinkedIn discussion mentioning 'job'", () => {
  const discussionPost = `The current job market in tech is undergoing massive shifts.
Many professionals are wondering how AI will impact job stability over the next decade.
In my opinion, continuous upskilling and learning domain fundamentals remains the best career advice.
What are your thoughts on this trend? Let's discuss in the comments below.`;

  const classification = RedFlagDetector.classifyContentType(discussionPost, "linkedin-feed-post");
  assert.strictEqual(classification.isJobRelated, false, "Must not be classified as a job advertisement");
  assert.strictEqual(classification.category, "non_job_content");
});

test("PART 6 — TEST G: Formal LinkedIn job listing with all fields extracted", () => {
  const formalListing = {
    jobTitle: "Full Stack Developer Intern (6-Month Tenure)",
    company: "Ira Hospitality",
    location: "Hyderabad, Telangana, India",
    workplaceType: "On-site",
    employmentType: "Internship",
    stipend: "Stipend-Paid",
    postedDate: "2 months ago",
    applicantActivity: "Over 100 people clicked apply",
    description: `About the job:
Job Description
Type: Full-Time Internship (Stipend-Paid)
Duration: 6 Months
The Role: As a Full Stack Developer Intern, you will work on real-world applications from day one.
Requirements:
- Frontend Development: React.js building dynamic and reusable components.
- Tailwind CSS: Designing modern, responsive interfaces.
- REST API Integration: Consuming and managing data flow.
- Backend & Infrastructure: Node.js & Express.js.`,
    jobUrl: "https://www.linkedin.com/jobs/view/4459763391/",
    platform: "linkedin",
    contentType: "linkedin-job"
  };

  const classification = RedFlagDetector.classifyContentType(formalListing, "linkedin-job-listing");
  assert.strictEqual(classification.isJobRelated, true);

  const result = RedFlagDetector.analyzeJobPosting(formalListing);
  assert.strictEqual(result.analysisStatus, "complete");
  assert.strictEqual(result.extractionStatus, "success");
  assert.strictEqual(result.jobTitle, "Full Stack Developer Intern (6-Month Tenure)");
  assert.strictEqual(result.company, "Ira Hospitality");
  assert.strictEqual(result.riskScore, 0, "Legitimate formal listing without scam signals scores 0/100");
  assert.strictEqual(result.riskCategory, "Low Risk");
  assert.strictEqual(result.isPaymentWarning, false);
});

test("PART 6 — TEST H: Multiple visible posts analyzed independently with separate scores", () => {
  const post1 = {
    jobTitle: "Marketing Intern",
    company: "BrandCraft",
    companyWebsite: "https://brandcraft.example.com",
    description: "Paid marketing internship for summer. Assist with SEO and social media campaigns. Apply at https://brandcraft.example.com",
    platform: "linkedin",
    contentType: "internship_post"
  };

  const post2 = {
    jobTitle: "HR Intern",
    company: "Apex Staffing",
    description: "Urgent hiring! Registration fee: ₹199 payable after orientation to confirm participation. Send resume.",
    platform: "linkedin",
    contentType: "internship_post"
  };

  const result1 = RedFlagDetector.analyzeJobPosting(post1);
  const result2 = RedFlagDetector.analyzeJobPosting(post2);

  assert.strictEqual(result1.riskScore, 0, "Post 1 has no scam indicators and scores 0");
  assert.strictEqual(result1.isPaymentWarning, false);

  assert.ok(result2.riskScore >= 40, "Post 2 requests registration fee and scores >= 40");
  assert.strictEqual(result2.isPaymentWarning, true);

  // Scores and findings must be independent
  assert.notStrictEqual(result1.riskScore, result2.riskScore);
  assert.strictEqual(result1.findings.length, 0);
  assert.ok(result2.findings.some(f => f.ruleId === "RULE_A_PAYMENT_REQUIRED"), "Post 2 must contain Rule A payment finding");
  assert.ok(result2.matchedIndicators.some(i => i.ruleId === "RULE_A_PAYMENT_REQUIRED"));
});

