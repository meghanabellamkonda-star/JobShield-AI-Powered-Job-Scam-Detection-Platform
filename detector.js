/**
 * JobShield Scam Job Detector Engine
 * Modular, evidence-based heuristic analysis system for job and internship postings.
 * Evaluates extracted posting data against explainable detection rules (Rules A - I).
 * 
 * Works in both browser extensions (window.JobShieldDetector) and Node.js (module.exports).
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    const detector = factory();
    root.JobShieldDetector = detector;
    root.RedFlagDetector = detector; // Backward compatibility
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Configurable Rule Weights (Phase 3)
  const DEFAULT_WEIGHTS = {
    RULE_A_PAYMENT_REQUIRED: 40,
    RULE_B_EMAIL_DOMAIN_MISMATCH: 20,
    RULE_B_EMAIL_DOMAIN_UNVERIFIED: 5,
    RULE_C_WEBSITE_UNVERIFIED: 10,
    RULE_C_WEBSITE_UNREACHABLE: 15,
    RULE_D_EXCLUSIVE_MESSAGING: 20,
    RULE_E_AUTOMATIC_SELECTION: 15,
    RULE_F_UNREALISTIC_COMPENSATION: 15,
    RULE_G_SENSITIVE_INFO: 25,
    RULE_H_VAGUE_DESCRIPTION: 10,
    RULE_I_URGENCY_PRESSURE: 10
  };

  const FREE_EMAIL_PROVIDERS = new Set([
    "gmail.com",
    "yahoo.com",
    "yahoo.co.in",
    "hotmail.com",
    "outlook.com",
    "live.com",
    "icloud.com",
    "aol.com",
    "mail.com",
    "zoho.com",
    "proton.me",
    "protonmail.com",
    "rediffmail.com",
    "yandex.com",
    "gmx.com"
  ]);

  /**
   * Extract verbatim sentence containing pattern from text
   */
  function extractVerbatimSentence(fullText, regex) {
    if (!fullText) return "";
    // Split text into sentences or lines
    const segments = fullText.split(/(?<=[.!?\n\r])\s+/);
    for (const segment of segments) {
      const cleanSeg = segment.trim();
      if (cleanSeg && regex.test(cleanSeg)) {
        return cleanSeg.slice(0, 300); // Limit length of quote to 300 chars
      }
    }
    // Fallback: window around match
    const match = fullText.match(regex);
    if (match && typeof match.index === "number") {
      const start = Math.max(0, match.index - 40);
      const end = Math.min(fullText.length, match.index + match[0].length + 60);
      return fullText.slice(start, end).trim();
    }
    return "";
  }

  /**
   * Helper: extract domain from URL or email
   */
  function getDomain(input) {
    if (!input) return "";
    let clean = input.trim().toLowerCase();
    if (clean.includes("@")) {
      return clean.split("@")[1].trim();
    }
    try {
      if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
        clean = "https://" + clean;
      }
      const parsed = new URL(clean);
      return parsed.hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  // -------------------------------------------------------------------------
  // RULE A: Payment Required for Employment
  // -------------------------------------------------------------------------
  function evaluateRuleA(jobData, weights) {
    const text = `${jobData.jobTitle || ""} ${jobData.description || ""} ${jobData.contactInstructions || ""} ${jobData.applicationInstructions || ""}`;
    const descLower = text.toLowerCase();

    // Distinguish employer fee demands from legitimate benefits/salaries or optional courses
    // Legitimate phrases to exclude
    const legitimateExclusions = [
      /tuition reimbursement/i,
      /we pay for your training/i,
      /paid training provided/i,
      /paid training will be given/i,
      /fully paid training/i,
      /company pays/i,
      /stipend of/i,
      /salary of/i,
      /no fees? required/i,
      /no registration fee/i,
      /we never ask for money/i,
      /beware of fraudulent/i
    ];

    const paymentPatterns = [
      {
        regex: /\b(?:registration|enrollment|confirmation|application|placement|processing|orientation|onboarding)\s+(?:fee|deposit|charge|amount|cost)\s*(?:of|is|:)?\s*([₹$€£]?\s*[\d,]+)?/i,
        label: "Registration or placement fee requirement",
        strength: "explicit"
      },
      {
        regex: /\b(?:fee|amount|charges?)\s+(?:is\s+)?payable\s+(?:after|before|during|for)\s+(?:the\s+)?(?:orientation|training|interview|selection|joining|onboarding)/i,
        label: "Fee payable for orientation or onboarding",
        strength: "explicit"
      },
      {
        regex: /\bpay\s+(?:₹|rs\.?|\$|€|£)?\s*[\d,]+\s*(?:to\s*confirm|for\s*registration|for\s*offer\s*letter|to\s*get\s*selected|before\s*joining|as\s*deposit|after\s*the\s*orientation)/i,
        label: "Direct payment demand to confirm position",
        strength: "explicit"
      },
      {
        regex: /\b(?:refundable\s+)?(?:security|registration|training|caution|initial)\s+deposit\b/i,
        label: "Mandatory security deposit",
        strength: "explicit"
      },
      {
        regex: /\b(?:security|refundable|initial)\s+(?:security\s+)?deposit\s*(?:of|is|:)?\s*([₹$€£]?\s*[\d,]+)?/i,
        label: "Mandatory security deposit",
        strength: "explicit"
      },
      {
        regex: /\b(?:mandatory|compulsory|must\s*pay\s*for)\s*(?:paid\s*)?training\s*(?:fee|charges|cost)\b/i,
        label: "Mandatory paid training required for employment",
        strength: "explicit"
      },
      {
        regex: /\bpay\s*(?:fees?|amount|money)\s*to\s*receive\s*(?:the\s*)?(?:offer\s*letter|appointment\s*letter|selection\s*kit)\b/i,
        label: "Payment required to receive offer letter",
        strength: "explicit"
      },
      {
        regex: /\bpay\s*(?:fees?|charges?|money)\s*(?:for|to\s*attend)\s*(?:the\s*)?interview\b/i,
        label: "Payment demanded to secure an interview",
        strength: "explicit"
      },
      {
        regex: /\b(?:internship|job)\s*(?:confirmation|joining|training)\s*fee\b/i,
        label: "Job or internship confirmation fee",
        strength: "explicit"
      },
      {
        regex: /\bregistration\s+fee\s*[:\-–]?\s*[₹$€£]?\s*[\d,]+/i,
        label: "Registration fee for role or internship",
        strength: "explicit"
      },
      {
        regex: /\bregistration\s+(?:fee|charges?|deposit|amount)\s+(?:required|mandatory|needed|payable)/i,
        label: "Mandatory registration fee requirement",
        strength: "explicit"
      },
      {
        regex: /\b(?:pay|deposit)\s+(?:a\s+)?(?:registration|application|internship)\s+fee\b/i,
        label: "Direct demand to pay registration fee",
        strength: "explicit"
      },
      {
        regex: /\b(?:internship|training|joining|placement)\s+fee\s*[:\-–]?\s*[₹$€£]?\s*[\d,]+/i,
        label: "Fee demanded for internship participation",
        strength: "explicit"
      },
      {
        regex: /\bfee\s*:\s*[₹$€£]\s*[\d,]+/i,
        label: "Explicit fee specified in job details",
        strength: "explicit"
      }
    ];

    for (const item of paymentPatterns) {
      if (item.regex.test(descLower)) {
        // Verify not in an exclusion context
        const sentence = extractVerbatimSentence(text, item.regex);
        const isExcluded = legitimateExclusions.some((ex) => ex.test(sentence));
        if (!isExcluded && sentence) {
          return {
            triggered: true,
            ruleId: "RULE_A_PAYMENT_REQUIRED",
            ruleName: "Payment Demanded for Employment",
            riskPoints: weights.RULE_A_PAYMENT_REQUIRED || 40,
            isPaymentWarning: true,
            exactText: sentence,
            explanation: "The posting explicitly demands that candidates pay money (such as a registration fee, training charge, or security deposit) to secure a position or offer letter. Legitimate employers pay their workers and never charge candidates to work.",
            evidenceStrength: item.strength,
            recommendation: "Never pay any money, deposit, or training charge to obtain a job or internship. Legitimate companies cover training and onboarding expenses."
          };
        }
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // RULE B: Unverified or Mismatched Email Domain
  // -------------------------------------------------------------------------
  function evaluateRuleB(jobData, weights) {
    const text = `${jobData.description || ""} ${jobData.contactInstructions || ""} ${jobData.applicationInstructions || ""}`;
    // Extract emails from text or jobData.recruiterEmail
    const emailRegex = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
    const foundEmails = new Set();

    if (jobData.recruiterEmail) {
      const directList = Array.isArray(jobData.recruiterEmail) ? jobData.recruiterEmail : [jobData.recruiterEmail];
      for (const e of directList) {
        if (typeof e === "string" && e.includes("@")) foundEmails.add(e.trim().toLowerCase());
      }
    }

    let match;
    while ((match = emailRegex.exec(text)) !== null) {
      const email = match[0].toLowerCase();
      // Ignore platform system emails
      if (!email.endsWith("indeed.com") && !email.endsWith("linkedin.com") && !email.includes("noreply") && !email.includes("donotreply")) {
        foundEmails.add(email);
      }
    }

    if (foundEmails.size === 0) {
      return null; // No email extracted
    }

    const emailList = Array.from(foundEmails);
    const primaryEmail = emailList[0];
    const emailDomain = primaryEmail.split("@")[1];
    const isFreeEmail = FREE_EMAIL_PROVIDERS.has(emailDomain);

    const companyWebDomain = getDomain(jobData.companyWebsite);
    const companyName = (jobData.company || "").trim();

    // Scenario 1: Both corporate website domain and recruiter email domain exist
    if (companyWebDomain) {
      // Subdomain and root domain matching:
      // e.g. careers.google.com and google.com match
      const isDomainMatch =
        emailDomain === companyWebDomain ||
        emailDomain.endsWith("." + companyWebDomain) ||
        companyWebDomain.endsWith("." + emailDomain);

      if (isDomainMatch) {
        return null; // Matches verified corporate domain
      }

      // If recruiter email uses a free provider (e.g. gmail/yahoo) while company has a corporate website:
      // Check if the company is an established enterprise (in which case a free email is an impersonation/mismatch)
      const isCorporateImpersonation =
        /\b(amazon|aws|google|microsoft|apple|meta|netflix|ibm|cisco|oracle|salesforce|tcs|infosys|wipro|accenture|cognizant)\b/i.test(companyName) ||
        /\b(amazon|google|microsoft|apple|meta|oracle|salesforce|cisco|ibm)\.com/i.test(companyWebDomain);

      if (isFreeEmail && !isCorporateImpersonation) {
        const sentence = extractVerbatimSentence(text, new RegExp(primaryEmail.replace(".", "\\."), "i")) || `Recruiter email: ${primaryEmail}`;
        return {
          triggered: true,
          ruleId: "RULE_B_EMAIL_DOMAIN_UNVERIFIED",
          ruleName: "Recruiter Email Uses Free Provider",
          riskPoints: weights.RULE_B_EMAIL_DOMAIN_UNVERIFIED || 5,
          isPaymentWarning: false,
          exactText: sentence,
          explanation: `The recruiter uses a free public email address (${primaryEmail}) rather than an address on the company's domain ("${companyWebDomain}"). While smaller businesses often use free email services, verify the listing on official channels.`,
          evidenceStrength: "inferred",
          recommendation: `Verify this recruiter's affiliation through the official ${companyWebDomain} website.`
        };
      }

      // Custom domain mismatch or enterprise corporate impersonation
      const domainWithoutTld = companyWebDomain.split(".")[0];
      const emailDomainWithoutTld = emailDomain.split(".")[0];
      const isLookalike = emailDomain.includes(domainWithoutTld) || domainWithoutTld.includes(emailDomainWithoutTld);
      const sentence = extractVerbatimSentence(text, new RegExp(primaryEmail.replace(".", "\\."), "i")) || `Recruiter email: ${primaryEmail}`;

      return {
        triggered: true,
        ruleId: "RULE_B_EMAIL_DOMAIN_MISMATCH",
        ruleName: isLookalike ? "Suspicious Email Domain Typo / Lookalike" : "Recruiter Email Domain Mismatch",
        riskPoints: weights.RULE_B_EMAIL_DOMAIN_MISMATCH || 20,
        isPaymentWarning: false,
        exactText: sentence,
        explanation: `The recruiter uses an email address (${primaryEmail}) from domain "${emailDomain}", which does not match the company's official domain ("${companyWebDomain}").`,
        evidenceStrength: "explicit",
        recommendation: `Verify the recruiter's identity through the official ${companyWebDomain} corporate directory or official website before replying.`
      };
    }

    // Scenario 2: Company website domain is not provided/verified
    if (isFreeEmail) {
      const sentence = extractVerbatimSentence(text, new RegExp(primaryEmail.replace(".", "\\."), "i")) || `Recruiter email: ${primaryEmail}`;
      return {
        triggered: true,
        ruleId: "RULE_B_EMAIL_DOMAIN_UNVERIFIED",
        ruleName: "Recruiter Email Uses Free Provider (Unverified Domain)",
        riskPoints: weights.RULE_B_EMAIL_DOMAIN_UNVERIFIED || 5,
        isPaymentWarning: false,
        exactText: sentence,
        explanation: `Recruiter uses a free public email provider (${emailDomain}) and the company's official corporate email domain could not be independently verified. While small businesses or early-stage startups may legitimately use free email addresses, established companies typically utilize corporate email domains.`,
        evidenceStrength: "inferred",
        recommendation: "Cross-check the employer's official registered website and verify the recruiter's identity through official corporate channels."
      };
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // RULE C: Missing or Unverified Company Website
  // -------------------------------------------------------------------------
  function evaluateRuleC(jobData, weights) {
    const rawWebsite = (jobData.companyWebsite || "").trim();

    if (!rawWebsite) {
      // Website not provided in posting
      return {
        triggered: true,
        ruleId: "RULE_C_WEBSITE_MISSING",
        ruleName: "Company Website Not Provided",
        riskPoints: 0, // Informational caution, do NOT treat absence of website alone as proof of fraud
        isPaymentWarning: false,
        exactText: jobData.company ? `Company: "${jobData.company}"` : "Employer identity in listing",
        explanation: "No official company website was provided in the listing. Independent verification of the employer's business registration is recommended.",
        evidenceStrength: "inferred",
        recommendation: "Search business registries or official web directories to verify that this employer has an established operational presence."
      };
    }

    // If website format is broken or invalid URL
    const domain = getDomain(rawWebsite);
    if (!domain || !domain.includes(".")) {
      return {
        triggered: true,
        ruleId: "RULE_C_WEBSITE_UNREACHABLE",
        ruleName: "Invalid or Malformed Company Website Link",
        riskPoints: weights.RULE_C_WEBSITE_UNREACHABLE || 15,
        isPaymentWarning: false,
        exactText: `Website link: "${rawWebsite}"`,
        explanation: "The company website link provided in the posting is invalid, unreachable, or malformed.",
        evidenceStrength: "explicit",
        recommendation: "Do not visit untrusted or malformed URLs."
      };
    }

    // If website exists but company identity remains unverified
    if (jobData.companyVerified === false) {
      return {
        triggered: true,
        ruleId: "RULE_C_WEBSITE_UNVERIFIED",
        ruleName: "Company Identity Unverified",
        riskPoints: weights.RULE_C_WEBSITE_UNVERIFIED || 10,
        isPaymentWarning: false,
        exactText: `Company website: "${rawWebsite}"`,
        explanation: "A website is provided, but the company's identity has not been independently verified.",
        evidenceStrength: "inferred",
        recommendation: "Independently verify domain registration age and business filings."
      };
    }

    return null; // Verified or normal
  }

  // -------------------------------------------------------------------------
  // RULE D: WhatsApp or Telegram Recruitment
  // -------------------------------------------------------------------------
  function evaluateRuleD(jobData, weights) {
    const text = `${jobData.description || ""} ${jobData.contactInstructions || ""} ${jobData.applicationInstructions || ""}`;
    const descLower = text.toLowerCase();

    // Differentiate exclusive messaging recruitment from optional contact method
    const exclusivePatterns = [
      /\b(?:contact|apply|message|reach|send\s*(?:resume|cv|documents?))\s*(?:(?:us|hr|recruiter)\s*)?(?:only|exclusively|strictly)\s*(?:through|via|on)?\s*(?:whatsapp|telegram)\b/i,
      /\b(?:only|strictly)\s*whatsapp\b/i,
      /\b(?:only|strictly)\s*telegram\b/i,
      /\b(?:conducted\s+)?(?:strictly|only)\s*(?:via|through|on)\s*(?:whatsapp|telegram)\b/i,
      /\b(?:communication|hiring|recruitment|interviews?)\s*(?:[a-zA-Z\s]{0,25})?(?:via|through|on)\s*(?:whatsapp|telegram)\b/i,
      /\b(?:whatsapp|telegram)\s*(?:us|me)?\s*(?:at\s*[\d+\-\s]+)?\s*to\s*(?:schedule|apply|interview)\b/i,
      /\bdm\s*(?:me|us)?\s*(?:on\s*)?(?:whatsapp|telegram)\s*(?:to\s*apply)?\b/i,
      /\b(?:only|strictly)\s*(?:whatsapp|telegram)\s*(?:no\s*calls|for\s*interview|to\s*apply|messages?)\b/i,
      /\b(?:whatsapp|telegram)\s*only\b/i,
      /\binterview\s*(?:will\s*be\s*conducted\s*)?(?:only|strictly|exclusively)\s*(?:via|on|through)\s*(?:whatsapp|telegram)\b/i,
      /\b(?:message|chat\s*with)\s*(?:this\s*)?(?:whatsapp|telegram)\s*(?:number\s*)?to\s*(?:get\s*selected|confirm\s*job|receive\s*offer)\b/i,
      /\bcontinue\s*(?:the\s*)?(?:entire\s*)?recruitment\s*(?:process\s*)?through\s*telegram\b/i,
      /\bsend\s*(?:your\s*)?(?:id|documents?|bank\s*details|aadhaar)\s*to\s*(?:personal\s*)?(?:whatsapp|telegram)\b/i,
      /\bdo\s*not\s*apply\s*(?:here|on\s*this\s*portal)?\.?\s*(?:send|message|whatsapp)\b/i
    ];

    for (const pat of exclusivePatterns) {
      if (pat.test(descLower)) {
        const sentence = extractVerbatimSentence(text, pat);
        if (sentence) {
          return {
            triggered: true,
            ruleId: "RULE_D_EXCLUSIVE_MESSAGING",
            ruleName: "Exclusive WhatsApp / Telegram Recruitment",
            riskPoints: weights.RULE_D_EXCLUSIVE_MESSAGING || 20,
            isPaymentWarning: false,
            exactText: sentence,
            explanation: "The listing mandates that recruitment, interviews, or hiring communication occur exclusively through personal chat apps (WhatsApp/Telegram). Legitimate organizations maintain formal applicant tracking systems and verified corporate channels.",
            evidenceStrength: "explicit",
            recommendation: "Do not send sensitive personal documents over messaging apps. Require an official corporate email or verified interview platform."
          };
        }
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // RULE E: No Formal Interview or Automatic Selection
  // -------------------------------------------------------------------------
  function evaluateRuleE(jobData, weights) {
    const text = `${jobData.description || ""} ${jobData.selectionProcess || ""}`;
    const descLower = text.toLowerCase();

    // Do NOT assume no interview merely because unmentioned!
    // Must look for EXPLICIT statements of automatic/guaranteed selection or no assessment
    const automaticPatterns = [
      /\bno\s*interview\s*(?:required|needed|conducted)\b/i,
      /\bdirect\s*selection\s*(?:without\s*(?:any\s*)?(?:interview|assessment|exam|test))\b/i,
      /\bguaranteed\s*(?:job\s*offer|selection|placement)\s*(?:immediately|without\s*interview|after\s*registration)\b/i,
      /\beveryone\s*will\s*be\s*selected\s*(?:after\s*paying|upon\s*registration|guaranteed)\b/i,
      /\boffer\s*letter\s*guaranteed\s*without\s*(?:any\s*)?(?:evaluation|assessment|interview)\b/i,
      /\b100%\s*(?:direct\s*joining|selection\s*guarantee)\s*without\s*interview\b/i
    ];

    for (const pat of automaticPatterns) {
      if (pat.test(descLower)) {
        const sentence = extractVerbatimSentence(text, pat);
        if (sentence) {
          return {
            triggered: true,
            ruleId: "RULE_E_AUTOMATIC_SELECTION",
            ruleName: "No Interview / Guaranteed Automatic Selection",
            riskPoints: weights.RULE_E_AUTOMATIC_SELECTION || 15,
            isPaymentWarning: false,
            exactText: sentence,
            explanation: "The listing explicitly claims candidates will receive a guaranteed job offer or direct selection without an interview or evaluation. Genuine employers evaluate candidate suitability before extending job offers.",
            evidenceStrength: "explicit",
            recommendation: "Be cautious of offers made without technical or behavioral evaluation, as this is a frequent tactic to lure candidates into paying registration fees."
          };
        }
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // RULE F: Unrealistic Compensation
  // -------------------------------------------------------------------------
  function evaluateRuleF(jobData, weights) {
    const text = `${jobData.jobTitle || ""} ${jobData.salary || ""} ${jobData.description || ""}`;
    const descLower = text.toLowerCase();

    // Do NOT flag a salary as fraudulent based on its amount alone!
    // Combine high pay with minimal work, zero requirements, or low-skill roles
    const lowSkillKeywords = /\b(data\s*entry|data\s*processing|copy\s*paste|sms\s*sending|typing|form\s*filling|captcha|simple\s*tasks|no\s*skills?\s*required|anyone\s*can\s*do|minimal\s*effort)\b/i;
    const extremePayPatterns = [
      /\b(?:earn|pay|salary|stipend|income)\s*(?:of|is|:)?\s*(?:₹|rs\.?)\s*(?:[3-9][\d,]{3,}|\d{4,})\s*(?:per\s*day|daily|a\s*day|per\s*hour|hourly)\b/i,
      /\b(?:earn|pay|salary|stipend|income)\s*(?:of|is|:)?\s*(?:₹|rs\.?)\s*(?:[5-9][\d,]{4,}|\d{5,})\s*(?:per\s*month|monthly|a\s*month)\b/i,
      /\b(?:earn|pay|salary|income)\s*(?:of|is|:)?\s*\$\s*(?:[5-9]\d{2,}|\d{4,})\s*(?:per\s*day|daily|a\s*day)\b/i,
      /\b(?:earn|pay|salary|income)\s*(?:of|is|:)?\s*\$\s*[2-9][\d,]{3,}\s*(?:per\s*week|weekly|a\s*week)\b/i,
      /\b(?:earn|make)\s*(?:up\s*to\s*)?\$\s*(?:100|[2-9]\d{2,})\s*(?:per\s*hour|hourly)\s*(?:for\s*simple|typing|data\s*entry)\b/i,
      /\bguaranteed\s*(?:daily|weekly)\s*income\s*of\s*[\$₹€£]\s*[\d,]+\s*(?:for|with)\s*(?:no|minimal)\s*(?:experience|qualification|work)\b/i,
      /\b\$\s*[2-9][\d,]{3,}\s*(?:a|per)\s*week\b/i
    ];

    const hasLowSkillRequirement = lowSkillKeywords.test(descLower) || /\b(no\s*experience|fresher\s*can\s*earn\s*huge)\b/i.test(descLower);

    for (const pat of extremePayPatterns) {
      if (pat.test(descLower) && hasLowSkillRequirement) {
        const sentence = extractVerbatimSentence(text, pat);
        if (sentence) {
          return {
            triggered: true,
            ruleId: "RULE_F_UNREALISTIC_COMPENSATION",
            ruleName: "Implausible Compensation for Minimal Requirements",
            riskPoints: weights.RULE_F_UNREALISTIC_COMPENSATION || 15,
            isPaymentWarning: false,
            exactText: sentence,
            explanation: "The posting promises extraordinarily high daily or hourly compensation for low-skill, minimal, or unspecified work. Implausible compensation promises are frequently used to entice job seekers into advance-fee or task scams.",
            evidenceStrength: "explicit",
            recommendation: "Compare the offered compensation with typical industry benchmarks for similar roles and responsibilities."
          };
        }
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // RULE G: Sensitive Information Requests
  // -------------------------------------------------------------------------
  function evaluateRuleG(jobData, weights) {
    const text = `${jobData.description || ""} ${jobData.applicationInstructions || ""} ${jobData.contactInstructions || ""}`;
    const descLower = text.toLowerCase();

    // Legitimate employers request bank details for direct deposit during formal onboarding AFTER an offer
    const legitimateOnboardingExclusions = [
      /upon\s*(?:hire|acceptance|offer|joining)/i,
      /after\s*(?:hiring|receiving\s*an\s*offer|joining)/i,
      /formal\s*onboarding/i,
      /post-hire\s*document/i,
      /form\s*i-9/i,
      /w-4/i,
      /for\s*payroll\s*setup\s*upon\s*joining/i,
      /direct\s*deposit\s*authorization\s*upon\s*employment/i
    ];

    const sensitivePatterns = [
      /\b(?:provide|send|submit|share|upload|enter)\s*(?:your\s*)?(?:online\s*banking|net\s*banking|bank\s*(?:account|login|credentials)|atm\s*pin|cvv|credit\s*card)\b/i,
      /\b(?:online|net)\s*banking\s*(?:login|credentials|password)\b/i,
      /\b(?:bank\s*login\s*details|bank\s*credentials)\b/i,
      /\b(?:ssn|social\s*security\s*number|aadhaar|pan\s*card)\s*(?:copy|number|photo)?\s*(?:during\s*preliminary|in\s*the\s*application|to\s*apply|before\s*interview|for\s*initial|for\s*screening)/i,
      /\b(?:crypto\s*wallet\s*address|seed\s*phrase|receive\s*and\s*forward\s*funds)\b/i
    ];

    for (const pat of sensitivePatterns) {
      if (pat.test(descLower)) {
        const sentence = extractVerbatimSentence(text, pat);
        const isOnboarding = legitimateOnboardingExclusions.some((ex) => ex.test(sentence));
        if (!isOnboarding && sentence) {
          return {
            triggered: true,
            ruleId: "RULE_G_SENSITIVE_INFO",
            ruleName: "Premature Sensitive Information Request",
            riskPoints: weights.RULE_G_SENSITIVE_INFO || 25,
            isPaymentWarning: false,
            exactText: sentence,
            explanation: "The posting requests highly sensitive personal identification or banking details prematurely before any formal interview, written offer, or verified employment contract.",
            evidenceStrength: "explicit",
            recommendation: "Never provide banking credentials, debit card CVV, or government ID scans prior to an official, verified job offer."
          };
        }
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // RULE H: Vague Job Description
  // -------------------------------------------------------------------------
  function evaluateRuleH(jobData, weights) {
    const desc = (jobData.description || "").trim();

    // Do NOT automatically treat a short job description as fraudulent
    if (!desc) return null;

    // Check if the description lacks any substantive responsibilities or is entirely buzzwords/cliché
    const dutyKeywords = /\b(responsibilit(?:y|ies)|duties|requirements?|qualifications?|skills?|experience|role\s*overview|you\s*will|key\s*tasks|requirements|technologies)\b/i;
    const hasDuties = dutyKeywords.test(desc);

    // If description is very short AND contains zero job responsibilities
    if (desc.length < 120 && !hasDuties) {
      return {
        triggered: true,
        ruleId: "RULE_H_VAGUE_DESCRIPTION",
        ruleName: "Vague or Incomplete Job Details",
        riskPoints: weights.RULE_H_VAGUE_DESCRIPTION || 10,
        isPaymentWarning: false,
        exactText: `Job description snippet: "${desc.slice(0, 150)}..."`,
        explanation: "The job description lacks specific role responsibilities, qualifications, and employment terms. Authentic job listings generally outline day-to-day duties and required competencies.",
        evidenceStrength: "inferred",
        recommendation: "Request an explicit written job specification before providing personal contact information."
      };
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // RULE I: Urgency and Pressure
  // -------------------------------------------------------------------------
  function evaluateRuleI(jobData, weights) {
    const text = `${jobData.description || ""} ${jobData.applicationInstructions || ""}`;
    const descLower = text.toLowerCase();

    // Distinguish normal application deadlines from coercive pressure to pay or act instantly
    const urgencyPatterns = [
      /\b(?:hurry|act\s*now|urgent)\s*[,!.]?\s*(?:only|last)\s*\d+\s*(?:seats?|spots?|vacanc(?:y|ies))\s*left\s*(?:pay\s*now|before\s*they\s*fill)\b/i,
      /\bpay\s*(?:immediately|today|within\s*\d+\s*hours?)\s*or\s*(?:lose\s*your\s*seat|offer\s*will\s*be\s*cancelled|seat\s*given\s*to\s*other)\b/i,
      /\bimmediate\s*joining\s*within\s*\d+\s*hours?\s*send\s*(?:fee|money|deposit)\s*now\b/i,
      /\btransfer\s*(?:amount|money)\s*within\s*\d+\s*(?:minutes?|hours?)\s*to\s*reserve\b/i
    ];

    for (const pat of urgencyPatterns) {
      if (pat.test(descLower)) {
        const sentence = extractVerbatimSentence(text, pat);
        if (sentence) {
          return {
            triggered: true,
            ruleId: "RULE_I_URGENCY_PRESSURE",
            ruleName: "Coercive Urgency and High-Pressure Demands",
            riskPoints: weights.RULE_I_URGENCY_PRESSURE || 10,
            isPaymentWarning: false,
            exactText: sentence,
            explanation: "The posting applies aggressive artificial urgency, pressuring candidates to act or transfer money immediately to avoid losing a position. Scammers use urgency to prevent victims from doing due diligence.",
            evidenceStrength: "explicit",
            recommendation: "Take time to independently research the employer. Authentic opportunities do not vanish in hours over fee demands."
          };
        }
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Master Evaluation Coordinator (Phase 3 & 4)
  // -------------------------------------------------------------------------
  function analyzeJobPosting(jobData, options = {}) {
    if (!jobData || typeof jobData !== "object") {
      return {
        status: "insufficient_data",
        riskScore: 0,
        riskCategory: "Unknown",
        riskLevel: "unknown",
        isPaymentWarning: false,
        findings: [],
        missingInformation: ["Entire job posting data is unavailable."],
        verificationSteps: ["Ensure a job listing is active and selected in the browser."],
        disclaimer: "Insufficient data to perform a risk assessment."
      };
    }

    // Check if extraction is incomplete or missing essential core info
    const title = (jobData.jobTitle || "").trim();
    const desc = (jobData.description || "").trim();

    if ((!title && !desc) || (desc.length < 25 && (!title || title.length < 5))) {
      return {
        status: "insufficient_data",
        riskScore: 0,
        riskCategory: "Insufficient Data",
        riskLevel: "unknown",
        isPaymentWarning: false,
        findings: [],
        missingInformation: ["Posting text is too brief or incomplete to evaluate scam indicators reliably."],
        verificationSteps: ["Select a complete job listing or post with detailed description."],
        disclaimer: "Insufficient data to perform a risk assessment. JobShield will not manufacture assumptions without listing content."
      };
    }

    const weights = Object.assign({}, DEFAULT_WEIGHTS, options.weights || {});

    // Collect findings from all 9 rules
    const potentialFindings = [
      evaluateRuleA(jobData, weights),
      evaluateRuleB(jobData, weights),
      evaluateRuleC(jobData, weights),
      evaluateRuleD(jobData, weights),
      evaluateRuleE(jobData, weights),
      evaluateRuleF(jobData, weights),
      evaluateRuleG(jobData, weights),
      evaluateRuleH(jobData, weights),
      evaluateRuleI(jobData, weights)
    ].filter(Boolean);

    // Deduplicate findings by ruleId (Phase 3 requirement: Avoid double-counting repeated phrases for the same issue)
    const uniqueFindingsMap = new Map();
    let hasPaymentWarning = false;

    for (const finding of potentialFindings) {
      if (finding.isPaymentWarning) {
        hasPaymentWarning = true;
      }
      if (!finding.evidence && finding.exactText) {
        finding.evidence = finding.exactText;
      }
      if (!finding.exactText && finding.evidence) {
        finding.exactText = finding.evidence;
      }
      if (finding.riskPoints != null && finding.score == null) {
        finding.score = finding.riskPoints;
      }
      if (!uniqueFindingsMap.has(finding.ruleId)) {
        uniqueFindingsMap.set(finding.ruleId, finding);
      }
    }

    const findings = Array.from(uniqueFindingsMap.values());

    // Calculate score
    let totalScore = findings.reduce((acc, f) => acc + (f.riskPoints || 0), 0);
    totalScore = Math.min(100, Math.max(0, totalScore));

    // Phase 3 Categories:
    // 0–19: Low risk
    // 20–39: Moderate risk
    // 40–59: High risk
    // 60–100: Critical risk
    let riskCategory = "Low Risk";
    let riskLevel = "low";

    if (totalScore >= 60) {
      riskCategory = "Critical Risk";
      riskLevel = "critical";
    } else if (totalScore >= 40) {
      riskCategory = "High Risk";
      riskLevel = "high";
    } else if (totalScore >= 20) {
      riskCategory = "Moderate Risk";
      riskLevel = "medium";
    } else {
      riskCategory = "Low Risk";
      riskLevel = "low";
    }

    // Identify missing or unverified fields (Phase 1 & 5)
    const missingInfo = [];
    if (!jobData.companyWebsite) {
      missingInfo.push("Company website was not provided in this listing.");
    } else if (jobData.companyVerified === false) {
      missingInfo.push(`Website "${jobData.companyWebsite}" is provided, but company identity is unverified.`);
    }

    if (!jobData.salary) {
      missingInfo.push("Salary or stipend details are not specified.");
    }

    if (!jobData.recruiterEmail) {
      missingInfo.push("No direct recruiter email address found in the posting.");
    }

    if (jobData.unextractedFields && Array.isArray(jobData.unextractedFields)) {
      for (const field of jobData.unextractedFields) {
        if (!missingInfo.some((m) => m.toLowerCase().includes(field.toLowerCase()))) {
          missingInfo.push(`Field "${field}" could not be extracted from the active layout.`);
        }
      }
    }

    // Recommended verification steps (Phase 5)
    const verificationSteps = [
      "Independently search the company's official corporate website.",
      "Check company registration in national corporate databases (e.g., MCA in India, SEC/State registries in US, Companies House in UK).",
      "Verify the recruiter's identity on LinkedIn or through official corporate switchboard numbers.",
      "Never pay any application, registration, or placement fees for an employment or internship opportunity."
    ];

    if (hasPaymentWarning) {
      verificationSteps.unshift("DO NOT TRANSFER FUNDS: Legitimate employers never charge candidates for jobs or internships.");
    }

    const matchedIndicators = findings.map((f) => ({
      ruleId: f.ruleId,
      points: f.riskPoints != null ? f.riskPoints : (f.score || 0),
      evidence: f.exactText || f.evidence || "",
      explanation: f.explanation || ""
    }));

    return {
      status: "analyzed",
      analysisStatus: "complete",
      extractionStatus: "success",
      platform: jobData.platform || "unknown",
      contentType: jobData.contentType || "job_listing",
      jobTitle: jobData.jobTitle || "",
      company: jobData.company || "",
      author: jobData.recruiterName || "",
      description: jobData.description || "",
      riskScore: totalScore,
      riskCategory: riskCategory,
      riskLevel: riskLevel,
      isPaymentWarning: hasPaymentWarning,
      findings: findings,
      matchedIndicators: matchedIndicators,
      missingInformation: missingInfo,
      verificationSteps: verificationSteps,
      disclaimer: "This assessment is an explainable heuristic analysis based on verified extracted listing data, not a mathematical probability or definitive guarantee of fraud or legitimacy.",
      timestamp: Date.now()
    };
  }

  /**
   * Classify content to determine if it is job/internship/recruitment-related.
   * Identifies content types:
   * - job_listing
   * - job_hiring_post
   * - internship_post
   * - recruitment_post
   * - non_job_content
   * - insufficient_data
   */
  function classifyContentType(input, pageContext = "") {
    let text = "";
    if (typeof input === "string") {
      text = input;
    } else if (input && typeof input === "object") {
      text = [
        input.jobTitle || "",
        input.description || "",
        input.applicationInstructions || "",
        input.contactInstructions || ""
      ].filter(Boolean).join("\n");
    }

    const cleanText = (text || "").trim();
    if (!cleanText || cleanText.length < 20) {
      if (pageContext.includes("job-listing") && cleanText.length > 5) {
        return {
          isJobRelated: true,
          category: "job_listing",
          confidence: 0.8,
          signals: ["formal_job_page_context"],
          roleTitle: (typeof input === "object" ? input.jobTitle : "") || "Job Listing",
          reason: "Formal job listing page context"
        };
      }
      return {
        isJobRelated: false,
        category: "insufficient_data",
        confidence: 0,
        signals: [],
        roleTitle: "",
        reason: "Content text is too short or empty to reliably evaluate"
      };
    }

    // Formal job listing contexts
    const isFormalJobContext = pageContext === "linkedin-job-listing" || 
                               pageContext === "indeed-job-listing" ||
                               pageContext === "job-detail";

    const descLower = cleanText.toLowerCase();

    // Signal Groups
    const hiringIntentPatterns = [
      { pattern: /\b(?:we\s*are\s*hiring|is\s+hiring|are\s+hiring|hiring\s+now|urgent(?:ly)?\s+hiring|actively\s+hiring|immediate\s+hiring)\b/i, weight: 3, name: "active_hiring_statement" },
      { pattern: /\b(?:expanding\s+(?:our\s+)?(?:team|operations)|growing\s+our\s+team)\b/i, weight: 2, name: "team_expansion" },
      { pattern: /\b(?:hiring\s+(?:for|hr|freshers?|interns?|developers?|engineers?|designers?|graduates?|candidates?|data\s*entry|telecallers?|freelance|remote))\b/i, weight: 3, name: "hiring_role_declaration" },
      { pattern: /\b(?:looking\s+for\s+(?:[a-zA-Z\s]{0,25})?(?:candidates|freshers|interns?|graduates?|developers?|engineers?|designers?|freelancers?|students?|applicants?|talent)|join\s+our\s+team)\b/i, weight: 3, name: "looking_for_talent" },
      { pattern: /\b(?:job\s+opportunity|career\s+opportunity|placement\s+opportunity|internship\s+opportunity|internship\s+program|internship\s+announcement|engineering\s+internship|summer\s+(?:20\d\d\s+)?internship)\b/i, weight: 3, name: "opportunity_announcement" },
      { pattern: /\b(?:multiple\s+vacancies|vacanc(?:y|ies)|openings?|now\s+hiring|recruitment\s+drive|walk-?in\s+interviews?)\b/i, weight: 3, name: "vacancies_or_walkin" },
      { pattern: /\b(?:we['’]re\s+looking\s+for|open\s+position|opening\s+for|we\s+have\s+(?:an?\s+)?opening)\b/i, weight: 2, name: "open_position" }
    ];

    const applicationPatterns = [
      { pattern: /\b(?:apply\s+now|apply\s+here|how\s+to\s+apply|click\s+(?:here\s+)?to\s+apply|interested\s+(?:candidates\s+)?can\s+apply)\b/i, weight: 3, name: "apply_call_to_action" },
      { pattern: /\b(?:send\s+(?:your\s+)?(?:cv|resume|portfolio|github|profile)|share\s+(?:your\s+)?(?:cv|resume|portfolio)|submit\s+(?:your\s+)?(?:cv|resume|portfolio)|mail\s+(?:your\s+)?(?:cv|resume|portfolio)|forward\s+(?:your\s+)?(?:cv|resume))\b/i, weight: 3, name: "resume_submission" },
      { pattern: /\b(?:dm\s+(?:me|us)|contact\s+recruiter|whatsapp\s+us|dm\s+to\s+apply|message\s+me\s+to\s+apply)\b/i, weight: 3, name: "direct_contact_application" },
      { pattern: /\b(?:fill\s+(?:out\s+)?(?:this\s+)?(?:google\s+)?form|link\s+in\s+bio|comment\s+["']?interested["']?)\b/i, weight: 2, name: "form_or_comment_application" },
      { pattern: /\b(?:email\s+(?:your\s+)?(?:profile|application|details)\s+to)\b/i, weight: 3, name: "email_application" }
    ];

    const compensationPatterns = [
      { pattern: /\b(?:salary|stipend|ctc|lpa|per\s+month|p\.m\.|hourly\s+rate|compensation)\s*[:\-–]?\s*[₹$€£]?\s*[\d,]+/i, weight: 2, name: "explicit_compensation" },
      { pattern: /\b(?:paid\s+internship|unpaid\s+internship|performance-?based\s+stipend)\b/i, weight: 2, name: "internship_compensation_mode" },
      { pattern: /\b(?:registration|enrollment|training|processing)\s+fee\b/i, weight: 2, name: "fee_mention" },
      { pattern: /\b(?:earn\s+[₹$€£]?\s*[\d,]+(?:\s*(?:per|\/)\s*(?:month|day|week))?)\b/i, weight: 2, name: "earning_claim" }
    ];

    const structurePatterns = [
      { pattern: /\b(?:work\s+from\s+home|wfh|remote\s+job|full-?time|part-?time|working\s+hours\s*:|duration\s*:)\b/i, weight: 2, name: "job_mode_or_schedule" },
      { pattern: /\b(?:freshers?|experienced\s+candidates?|0-?[1-5]\s*years?(?:\s*of)?\s*exp(?:erience)?|eligibility|requirements?|qualifications?)\b/i, weight: 2, name: "candidate_eligibility" },
      { pattern: /\b(?:roles?\s*(?:&|and)\s*responsibilities|job\s+description|about\s+the\s+role|key\s+skills)\b/i, weight: 2, name: "job_description_structure" },
      { pattern: /\b(?:immediate\s+join(?:ing|ers?)|notice\s+period)\b/i, weight: 2, name: "joining_timeline" }
    ];

    const internshipIndicators = [
      /\b(?:internships?|interns?|trainee|graduate\s+trainee)\b/i
    ];

    const recruitmentIndicators = [
      /\b(?:recruitment\s+drive|recruiter|staffing|hiring\s+partner|talent\s+acquisition|walk-?in\s+interviews?|multiple\s+vacancies|placement\s+opportunity)\b/i
    ];

    // Non-job context indicators (e.g., job seeker searching for jobs, news, opinions, celebrations)
    const nonJobDisqualifiers = [
      { pattern: /\b(?:i\s+am\s+(?:looking|seeking)\s+for\s+(?:a\s+)?(?:job|opportunity|internship)|open\s+to\s+work|please\s+refer\s+me|help\s+me\s+find\s+a\s+job)\b/i, penalty: 6, name: "job_seeker_seeking_work" },
      { pattern: /\b(?:happy\s+to\s+share\s+that\s+i\s+(?:have\s+)?joined|thrilled\s+to\s+announce\s+that\s+i|started\s+a\s+new\s+position\s+at|congratulations\s+to|celebrating\s+my\s+new\s+job)\b/i, penalty: 5, name: "career_milestone_celebration" },
      { pattern: /\b(?:the\s+job\s+market\s+is|thoughts\s+on\s+the\s+hiring\s+process|why\s+is\s+hiring\s+so\s+broken|in\s+my\s+experience\s+with\s+interviews)\b/i, penalty: 4, name: "industry_opinion_commentary" }
    ];

    // Calculate Scores
    let totalScore = 0;
    const detectedSignals = [];

    // Check Hiring Intent
    let hiringScore = 0;
    for (const item of hiringIntentPatterns) {
      if (item.pattern.test(cleanText)) {
        hiringScore += item.weight;
        detectedSignals.push(item.name);
      }
    }
    totalScore += Math.min(hiringScore, 6);

    // Check Application CTA
    let appScore = 0;
    for (const item of applicationPatterns) {
      if (item.pattern.test(cleanText)) {
        appScore += item.weight;
        detectedSignals.push(item.name);
      }
    }
    totalScore += Math.min(appScore, 6);

    // Check Compensation
    let compScore = 0;
    for (const item of compensationPatterns) {
      if (item.pattern.test(cleanText)) {
        compScore += item.weight;
        detectedSignals.push(item.name);
      }
    }
    totalScore += Math.min(compScore, 4);

    // Check Structure
    let structScore = 0;
    for (const item of structurePatterns) {
      if (item.pattern.test(cleanText)) {
        structScore += item.weight;
        detectedSignals.push(item.name);
      }
    }
    totalScore += Math.min(structScore, 4);

    // Context boost for formal job listing
    if (isFormalJobContext) {
      totalScore += 5;
      detectedSignals.push("formal_job_context");
    }

    // Apply Non-Job Penalties
    let penaltyScore = 0;
    for (const disq of nonJobDisqualifiers) {
      if (disq.pattern.test(cleanText)) {
        penaltyScore += disq.penalty;
        detectedSignals.push(`disqualifier_${disq.name}`);
      }
    }

    // If strong application instructions or explicit hiring phrases exist, reduce penalty impact
    if (appScore >= 3 || hiringScore >= 3) {
      penaltyScore = Math.max(0, penaltyScore - 3);
    }
    totalScore = Math.max(0, totalScore - penaltyScore);

    // Extract Role Title if present
    let roleTitle = "";
    if (typeof input === "object" && input.jobTitle && input.jobTitle !== "LinkedIn Post" && input.jobTitle !== "Job Opportunity") {
      roleTitle = input.jobTitle;
    } else {
      // Try to extract role title from the first lines or common patterns
      const titleMatches = [
        /(?:hiring\s+now\s*[|\-–:]\s*)([a-zA-Z0-9\s/]+(?:internship|opportunity|developer|engineer|intern|trainee|associate|specialist|manager|executive))/i,
        /(?:urgent(?:ly)?\s+hiring\s+for\s+)([a-zA-Z0-9\s/]+(?:developers?|engineers?|interns?|executives?|freshers?))/i,
        /(?:hiring\s+)([a-zA-Z0-9\s/]+(?:interns?|freshers?|developers?|engineers?|trainees?))/i,
        /(?:looking\s+for\s+)([a-zA-Z0-9\s/]+(?:interns?|freshers?|developers?|engineers?|trainees?))/i,
        /(?:role\s*[:\-–]\s*)([^\n\r,.]+)/i,
        /(?:position\s*[:\-–]\s*)([^\n\r,.]+)/i
      ];
      for (const tm of titleMatches) {
        const m = cleanText.match(tm);
        if (m && m[1]) {
          roleTitle = m[1].trim().replace(/[|:–\-]+$/, "").trim();
          break;
        }
      }
    }

    // Determine Internship flag
    const isInternship = internshipIndicators.some(r => r.test(cleanText));
    const isRecruitmentDrive = recruitmentIndicators.some(r => r.test(cleanText));

    // Threshold Check:
    // A post is job-related if:
    // 1. Formal job context with totalScore >= 2
    // 2. Both Hiring Intent (>=3) AND Application CTA (>=3)
    // 3. Hiring Intent (>=3) AND (Structure >=2 OR Comp >=2 OR Internship)
    // 4. Application CTA (>=3) AND (Structure >=2 OR Internship OR Comp >=2)
    // 5. Total Score >= 5 (and no disqualifier domination)
    const isJobRelated = (
      (isFormalJobContext && totalScore >= 2) ||
      (hiringScore >= 3 && appScore >= 3) ||
      (hiringScore >= 3 && (structScore >= 2 || compScore >= 2 || isInternship)) ||
      (appScore >= 3 && (structScore >= 2 || isInternship || compScore >= 2)) ||
      (totalScore >= 5 && penaltyScore < 4)
    );

    if (!isJobRelated) {
      return {
        isJobRelated: false,
        category: "non_job_content",
        confidence: Math.max(0.2, (10 - totalScore) / 10),
        signals: detectedSignals,
        roleTitle: "",
        reason: "Content does not contain sufficient verified hiring, role, or application criteria"
      };
    }

    // Categorization
    let category = "job_hiring_post";
    if (isFormalJobContext) {
      category = "job_listing";
    } else if (isInternship) {
      category = "internship_post";
    } else if (isRecruitmentDrive) {
      category = "recruitment_post";
    }

    if (!roleTitle) {
      roleTitle = isInternship ? "Internship Opportunity" : "Job Hiring Opportunity";
    }

    return {
      isJobRelated: true,
      category: category,
      confidence: Math.min(1.0, totalScore / 8),
      signals: detectedSignals,
      roleTitle: roleTitle,
      reason: `Detected verified job signals: ${detectedSignals.slice(0, 3).join(", ")}`
    };
  }

  return {
    DEFAULT_WEIGHTS,
    FREE_EMAIL_PROVIDERS,
    extractVerbatimSentence,
    getDomain,
    evaluateRuleA,
    evaluateRuleB,
    evaluateRuleC,
    evaluateRuleD,
    evaluateRuleE,
    evaluateRuleF,
    evaluateRuleG,
    evaluateRuleH,
    evaluateRuleI,
    classifyContentType,
    analyzeJobPosting
  };
});
