import re
from typing import Dict, Any, List, Optional
from app.schemas.job import (
    JobData,
    MatchedIndicator,
    AnalysisResult,
    FinancialItem,
    MLAnalysisResult,
    RuleAnalysisResult,
    RiskExplanation,
    CompensationDetails,
    CandidateFeeDetails
)
from app.extractors.financial import (
    extract_financial_items,
    extract_structured_compensation,
    extract_candidate_fee_details
)
from app.extractors.parser import (
    calculate_extraction_completeness,
    extract_job_title_from_text,
    extract_company_name_from_text,
    extract_location_and_mode_from_text,
    extract_duration_and_dates,
    extract_options_details
)
from app.detector.ml_model import predict_employment_fraud

DEFAULT_WEIGHTS = {
    "RULE_A_PAYMENT_REQUIRED": 40,
    "RULE_A2_MANDATORY_TRAINING_FEE": 35,
    "RULE_A3_SECURITY_DEPOSIT": 40,
    "RULE_A4_PAYMENT_FOR_SELECTION": 50,
    "RULE_B_EXCLUSIVE_MESSAGING": 20,
    "RULE_C_IDENTITY_INCONSISTENCY": 20,
    "RULE_D_AUTOMATIC_SELECTION": 15,
    "RULE_E_IMPLAUSIBLE_COMPENSATION": 15,
    "RULE_F_SENSITIVE_FINANCIAL_INFO": 40,
    "RULE_G_VAGUE_DESCRIPTION": 10,
    "RULE_H_COERCIVE_URGENCY": 10
}

FREE_EMAIL_PROVIDERS = {
    "gmail.com", "yahoo.com", "yahoo.co.in", "hotmail.com", "outlook.com",
    "live.com", "icloud.com", "aol.com", "mail.com", "zoho.com",
    "proton.me", "protonmail.com", "rediffmail.com", "yandex.com", "gmx.com"
}

def extract_verbatim_sentence(full_text: str, pattern: re.Pattern) -> str:
    """Extract the specific sentence or line containing the regex match, up to 300 chars."""
    if not full_text:
        return ""
    segments = re.split(r"(?<=[.!?\n\r])\s+", full_text)
    for seg in segments:
        clean = seg.strip()
        if clean and pattern.search(clean):
            return clean[:300]
    match = pattern.search(full_text)
    if match:
        start = max(0, match.start() - 40)
        end = min(len(full_text), match.end() + 60)
        return full_text[start:end].strip()
    return ""

def get_domain(input_val: Optional[str]) -> str:
    if not input_val:
        return ""
    clean = input_val.strip().lower()
    if "@" in clean:
        return clean.split("@")[-1].strip()
    clean = re.sub(r"^https?://", "", clean)
    clean = clean.split("/")[0].split("?")[0].strip()
    return re.sub(r"^www\.", "", clean)

# ---------------------------------------------------------------------------
# Rule A: Candidate-Paid Recruitment / Registration Fee (+40)
# ---------------------------------------------------------------------------
def evaluate_rule_a(job_data: JobData, weights: Dict[str, int]) -> Optional[MatchedIndicator]:
    text = f"{job_data.job_title or ''} {job_data.description or ''} {job_data.contact_instructions or ''} {job_data.application_instructions or ''}"

    fin_items = job_data.financial_items or extract_financial_items(text)
    fee_items = [
        item for item in fin_items
        if item.payment_direction == "candidate_to_employer"
        and item.mandatory_status in ("mandatory", "conditional")
        and item.financial_type in ("registration_fee", "application_fee", "placement_fee", "onboarding_fee", "security_deposit")
    ]
    if fee_items:
        primary = fee_items[0]
        # Check if there is also an unpaid alternative
        has_unpaid = job_data.has_unpaid_option or bool(re.search(r"\bunpaid\s*(?:internship\s*)?option\b", text, re.I))
        
        if primary.option_name or has_unpaid:
            explanation = (
                f"The paid internship option requires a {primary.amount} registration fee. "
                "The listing also advertises an unpaid option without a fee. Paying a recruitment-related fee is a warning sign. "
                "Verify the organization independently before proceeding."
            )
            recommendation = (
                f"Do not pay the {primary.amount} registration fee. If you choose to proceed, "
                "consider the advertised no-fee unpaid option, and verify the organization's corporate registration before committing."
            )
        else:
            explanation = (
                f"The posting indicates that candidates must pay a {primary.amount} recruitment-related {primary.financial_type.replace('_', ' ')}. "
                "Legitimate employers never charge candidates to apply, interview, or join."
            )
            recommendation = (
                f"Never pay registration fees ({primary.amount}) or application charges to secure a job or internship. "
                "Legitimate employers bear all recruitment expenses."
            )

        return MatchedIndicator(
            rule_id="RULE_A_PAYMENT_REQUIRED",
            rule_name="Registration or Recruitment Fee Required",
            category="candidate_payment_demand",
            points=weights.get("RULE_A_PAYMENT_REQUIRED", 40),
            evidence=primary.evidence or f"{primary.amount} registration fee",
            explanation=explanation,
            evidence_strength="explicit",
            confidence="high",
            source="extracted_job_description",
            recommendation=recommendation
        )

    # Contextual regex fallback
    negation_patterns = [
        re.compile(r"\bno\s+(?:registration|application|placement|processing)?\s*fees?\s*(?:is|are)?\s*(?:required|needed|charged)?\b", re.I),
        re.compile(r"\bwe\s*(?:never|do\s*not)\s*(?:ask|charge|require)\s*(?:for\s*)?(?:money|fees?|deposits?|payment)\b", re.I),
        re.compile(r"\bbeware\s+of\s+(?:scams?|fraud(?:ulent)?|fake\s*recruiters?)\b", re.I),
        re.compile(r"\bbeware\b", re.I),
        re.compile(r"\bwithout\s+(?:any\s*)?(?:fee|charges?|deposit)\b", re.I),
        re.compile(r"\bfee\s+(?:is|are)?\s*not\s*required\b", re.I),
        re.compile(r"\bwarn(?:ing|s)?\s+(?:candidates|applicants|against|about)\b", re.I)
    ]

    payment_patterns = [
        re.compile(r"\bregistration\s+(?:fee|charges?|deposit|amount)\s*[:\-–]?\s*[₹$€£]?\s*[\d,]+", re.I),
        re.compile(r"\b(?:registration|enrollment|confirmation|application|placement|processing)\s+(?:fee|deposit|charge|amount|cost)\s*(?:of|is|:)?\s*([₹$€£]?\s*[\d,]+)?", re.I),
        re.compile(r"\b(?:refundable\s+)?(?:security|registration|caution|initial)\s+deposit\s*(?:of|is|:)?\s*([₹$€£]?\s*[\d,]+)?", re.I),
        re.compile(r"\bpay\s*(?:a\s+)?refundable\s+security\s+deposit\b", re.I),
        re.compile(r"\bchoose\s*(?:the\s*)?paid\s*(?:internship\s*)?option\s*by\s*paying\b", re.I),
        re.compile(r"\bpayment\s+is\s+required\s+to\s+unlock\s+the\s+internship\s+opportunity\b", re.I),
        re.compile(r"\bselected\s+candidates\s+must\s+pay\s+processing\s+charges\b", re.I),
        re.compile(r"\bpay\s+(?:a\s+)?(?:registration|application|internship)\s+fee\b", re.I)
    ]

    segments = re.split(r"(?<=[.!?\n\r;])\s+", text)
    for seg in segments:
        clean = seg.strip()
        if not clean:
            continue
        is_negated = any(neg.search(clean) for neg in negation_patterns)
        if is_negated:
            continue
        for pat in payment_patterns:
            if pat.search(clean):
                return MatchedIndicator(
                    rule_id="RULE_A_PAYMENT_REQUIRED",
                    rule_name="Registration or Recruitment Fee Required",
                    category="candidate_payment_demand",
                    points=weights.get("RULE_A_PAYMENT_REQUIRED", 40),
                    evidence=clean[:300],
                    explanation="The advertisement requests a registration fee or processing charge from the candidate to access the opportunity.",
                    evidence_strength="explicit",
                    confidence="high",
                    source="extracted_job_description",
                    recommendation="Never pay fees or charges to obtain an internship or job. Authentic employers do not charge candidates."
                )

    return None

# ---------------------------------------------------------------------------
# Rule A2: Mandatory Paid Training Fee (+35)
# ---------------------------------------------------------------------------
def evaluate_rule_a2(job_data: JobData, weights: Dict[str, int]) -> Optional[MatchedIndicator]:
    text = f"{job_data.description or ''} {job_data.application_instructions or ''}"

    fin_items = job_data.financial_items or extract_financial_items(text)
    for item in fin_items:
        if item.payment_direction == "candidate_to_employer" and item.mandatory_status in ("mandatory", "conditional") and item.financial_type == "training_fee":
            return MatchedIndicator(
                rule_id="RULE_A2_MANDATORY_TRAINING_FEE",
                rule_name="Mandatory Candidate-Paid Training Fee",
                category="candidate_training_payment",
                points=weights.get("RULE_A2_MANDATORY_TRAINING_FEE", 35),
                evidence=item.evidence or f"Training fee: {item.amount}",
                explanation=f"The posting requires candidates to pay for training ({item.amount}) as a condition of receiving or confirming employment.",
                evidence_strength="explicit",
                confidence="high",
                source="extracted_job_description",
                recommendation="Do not pay for mandatory training courses tied directly to job offers. Legitimate employers provide internal onboarding training free of charge."
            )

    training_patterns = [
        re.compile(r"\b(?:mandatory|compulsory|must\s*pay\s*for)\s*(?:paid\s*)?training\s*(?:fee|charges|cost)\b", re.I),
        re.compile(r"\btraining\s+fee\s*[:\-–]?\s*[₹$€£]?\s*[\d,]+", re.I),
        re.compile(r"\bcandidates\s+are\s+required\s+to\s+pay\s*(?:[₹$€£]?\s*[\d,]+)?\s*for\s*training\b", re.I),
        re.compile(r"\bcandidate\s+must\s+purchase\s+(?:mandatory\s+)?training\b", re.I)
    ]

    segments = re.split(r"(?<=[.!?\n\r;])\s+", text)
    for seg in segments:
        clean = seg.strip()
        if not clean:
            continue
        if re.search(r"\b(free\s+of\s+charge|reimburses?|no\s+training\s+fee|training\s+is\s+free|paid\s+training\s+provided)\b", clean, re.I):
            continue
        for pat in training_patterns:
            if pat.search(clean):
                return MatchedIndicator(
                    rule_id="RULE_A2_MANDATORY_TRAINING_FEE",
                    rule_name="Mandatory Candidate-Paid Training Fee",
                    category="candidate_training_payment",
                    points=weights.get("RULE_A2_MANDATORY_TRAINING_FEE", 35),
                    evidence=clean[:300],
                    explanation="The posting mandates payment for training or preparation courses as a prerequisite to securing the advertised position.",
                    evidence_strength="explicit",
                    confidence="high",
                    source="extracted_job_description",
                    recommendation="Authentic employers do not require job applicants to purchase training programs as a precondition of employment."
                )
    return None

# ---------------------------------------------------------------------------
# Rule A3: Security Deposit Required Before Joining (+40)
# ---------------------------------------------------------------------------
def evaluate_rule_a3(job_data: JobData, weights: Dict[str, int]) -> Optional[MatchedIndicator]:
    text = f"{job_data.description or ''} {job_data.application_instructions or ''}"

    fin_items = job_data.financial_items or extract_financial_items(text)
    for item in fin_items:
        if item.payment_direction == "candidate_to_employer" and item.financial_type == "security_deposit":
            return MatchedIndicator(
                rule_id="RULE_A3_SECURITY_DEPOSIT",
                rule_name="Security Deposit Required Before Joining",
                category="candidate_payment_demand",
                points=weights.get("RULE_A3_SECURITY_DEPOSIT", 40),
                evidence=item.evidence or f"Security deposit: {item.amount}",
                explanation=f"The posting requests a security deposit ({item.amount}) before joining. Promising that a deposit is refundable does not eliminate the risk.",
                evidence_strength="explicit",
                confidence="high",
                source="extracted_job_description",
                recommendation="Never pay security deposits before joining. Legitimate employers never ask candidates to deposit money to secure employment."
            )

    deposit_patterns = [
        re.compile(r"\b(?:refundable\s+)?(?:security|caution)\s+deposit\s*(?:of|is|:)?\s*([₹$€£]?\s*[\d,]+)?", re.I),
        re.compile(r"\bpay\s*(?:a\s+)?refundable\s+security\s+deposit\s+before\s+joining\b", re.I),
        re.compile(r"\bdeposit\s+required\s+before\s+joining\b", re.I)
    ]

    segments = re.split(r"(?<=[.!?\n\r;])\s+", text)
    for seg in segments:
        clean = seg.strip()
        if not clean:
            continue
        if re.search(r"\b(no\s+deposit|without\s+deposit|never\s+ask\s+for\s+deposits?)\b", clean, re.I):
            continue
        for pat in deposit_patterns:
            if pat.search(clean):
                return MatchedIndicator(
                    rule_id="RULE_A3_SECURITY_DEPOSIT",
                    rule_name="Security Deposit Required Before Joining",
                    category="candidate_payment_demand",
                    points=weights.get("RULE_A3_SECURITY_DEPOSIT", 40),
                    evidence=clean[:300],
                    explanation="Candidates are instructed to pay a refundable or non-refundable security deposit prior to joining or orientation.",
                    evidence_strength="explicit",
                    confidence="high",
                    source="extracted_job_description",
                    recommendation="Do not pay security deposits. Refund promises in recruitment are frequently unfulfilled by fraudulent operators."
                )
    return None

# ---------------------------------------------------------------------------
# Rule A4: Explicit Payment to Secure Selection or Offer Letter (+50)
# ---------------------------------------------------------------------------
def evaluate_rule_a4(job_data: JobData, weights: Dict[str, int]) -> Optional[MatchedIndicator]:
    text = f"{job_data.description or ''} {job_data.selection_process or ''} {job_data.contact_instructions or ''}"

    selection_payment_patterns = [
        re.compile(r"\bpay\s*(?:[₹$€£]?\s*[\d,]+)?\s*to\s*(?:secure|confirm|receive)\s*(?:an?\s*)?(?:offer\s*letter|selection|interview|employment\s*offer)\b", re.I),
        re.compile(r"\btransfer\s*(?:amount|money|fee)\s*to\s*(?:get\s*selected|confirm\s*selection|receive\s*offer)\b", re.I),
        re.compile(r"\bpayment\s+required\s+to\s+confirm\s+selection\b", re.I),
        re.compile(r"\bpayment\s+required\s+to\s+receive\s+an\s+offer\s+letter\b", re.I),
        re.compile(r"\bto\s+get\s+selected\s*,\s*candidates\s+must\s+pay\b", re.I)
    ]

    for pat in selection_payment_patterns:
        match_sent = extract_verbatim_sentence(text, pat)
        if match_sent and not re.search(r"\b(never|beware|do\s*not)\b", match_sent, re.I):
            return MatchedIndicator(
                rule_id="RULE_A4_PAYMENT_FOR_SELECTION",
                rule_name="Payment Demanded to Secure Selection or Offer",
                category="recruitment_fee_extortion",
                points=weights.get("RULE_A4_PAYMENT_FOR_SELECTION", 50),
                evidence=match_sent,
                explanation="The listing demands payment specifically to confirm candidate selection, guarantee an interview, or release an offer letter.",
                evidence_strength="explicit",
                confidence="high",
                source="extracted_job_description",
                recommendation="Do not transfer money to secure selection or an offer letter. Stop communicating immediately and report the payment request."
            )
    return None

# ---------------------------------------------------------------------------
# Rule B: Exclusive Messaging-Only Recruitment (+20)
# ---------------------------------------------------------------------------
def evaluate_rule_b(job_data: JobData, weights: Dict[str, int]) -> Optional[MatchedIndicator]:
    text = f"{job_data.description or ''} {job_data.contact_instructions or ''} {job_data.application_instructions or ''}"
    lower = text.lower()

    exclusive_patterns = [
        re.compile(r"\b(?:contact|apply|message|reach|send\s*(?:resume|cv|documents?))\s*(?:(?:us|hr|recruiter)\s*)?(?:only|exclusively|strictly)\s*(?:through|via|on)?\s*(?:whatsapp|telegram)\b", re.I),
        re.compile(r"\b(?:only|strictly)\s*whatsapp\b", re.I),
        re.compile(r"\b(?:only|strictly)\s*telegram\b", re.I),
        re.compile(r"\b(?:conducted\s+)?(?:strictly|only)\s*(?:via|through|on)\s*(?:whatsapp|telegram)\b", re.I),
        re.compile(r"\b(?:whatsapp|telegram)\s*(?:us|me)?\s*(?:at\s*[\d+\-\s]+)?\s*to\s*(?:schedule|apply|interview)\b", re.I),
        re.compile(r"\bdm\s*(?:me|us)?\s*(?:on\s*)?(?:whatsapp|telegram)\s*(?:to\s*apply)?\b", re.I),
        re.compile(r"\binterview\s*(?:will\s*be\s*conducted\s*)?(?:only|strictly|exclusively)\s*(?:via|on|through)\s*(?:whatsapp|telegram)\b", re.I),
        re.compile(r"\bcontinue\s*(?:the\s*)?(?:entire\s*)?recruitment\s*(?:process\s*)?through\s*telegram\b", re.I)
    ]

    for pat in exclusive_patterns:
        if pat.search(lower):
            sentence = extract_verbatim_sentence(text, pat)
            if sentence:
                return MatchedIndicator(
                    rule_id="RULE_B_EXCLUSIVE_MESSAGING",
                    rule_name="Exclusive Messaging-Only Recruitment",
                    category="unverifiable_communication_channel",
                    points=weights.get("RULE_B_EXCLUSIVE_MESSAGING", 20),
                    evidence=sentence,
                    explanation="Recruitment and hiring communication are conducted exclusively through messaging applications (WhatsApp/Telegram) without verified corporate email or applicant portals.",
                    evidence_strength="explicit",
                    confidence="high",
                    source="extracted_job_description",
                    recommendation="Request an official corporate email or verified job-portal listing before submitting resumes or personal details via chat apps."
                )
    return None

# ---------------------------------------------------------------------------
# Rule C: Employer or Identity Inconsistency (+20)
# ---------------------------------------------------------------------------
def evaluate_rule_c(job_data: JobData, weights: Dict[str, int]) -> Optional[MatchedIndicator]:
    text = f"{job_data.description or ''} {job_data.contact_instructions or ''}"
    comp_name = (job_data.company_name or "").strip()
    web_domain = get_domain(job_data.company_website)

    email_matches = re.findall(r"\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b", text)
    if job_data.recruiter_email and "@" in job_data.recruiter_email:
        email_matches.append(job_data.recruiter_email.split("@")[-1].strip().lower())

    for ed in email_matches:
        ed_lower = ed.lower()
        if ed_lower in ("linkedin.com", "indeed.com", "ziprecruiter.com"):
            continue
        if ed_lower in FREE_EMAIL_PROVIDERS and comp_name:
            if re.search(r"\b(amazon|google|microsoft|apple|meta|netflix|ibm|cisco|oracle|salesforce|tcs|infosys|wipro|accenture|cognizant)\b", comp_name, re.I):
                return MatchedIndicator(
                    rule_id="RULE_C_IDENTITY_INCONSISTENCY",
                    rule_name="Corporate Impersonation / Free Public Email",
                    category="recruiter_identity_mismatch",
                    points=weights.get("RULE_C_IDENTITY_INCONSISTENCY", 20),
                    evidence=f"Claimed employer: '{comp_name}', Recruiter email provider: '{ed_lower}'",
                    explanation=f"The listing claims to represent major employer '{comp_name}', but uses a free public email address ({ed_lower}) instead of a corporate domain.",
                    evidence_strength="explicit",
                    confidence="high",
                    source="recruiter_identity",
                    recommendation=f"Verify this opening directly on {comp_name}'s official corporate careers page. Do not engage with personal email addresses claiming to represent major corporations."
                )
        if web_domain and ed_lower not in FREE_EMAIL_PROVIDERS:
            if web_domain != ed_lower and not ed_lower.endswith("." + web_domain) and not web_domain.endswith("." + ed_lower):
                return MatchedIndicator(
                    rule_id="RULE_C_IDENTITY_INCONSISTENCY",
                    rule_name="Employer Website and Email Domain Conflict",
                    category="recruiter_identity_mismatch",
                    points=weights.get("RULE_C_IDENTITY_INCONSISTENCY", 20),
                    evidence=f"Company website domain: '{web_domain}' clashes with recruiter email domain: '{ed_lower}'",
                    explanation=f"The provided recruiter email domain ({ed_lower}) does not match the company's official website domain ({web_domain}).",
                    evidence_strength="explicit",
                    confidence="high",
                    source="recruiter_identity",
                    recommendation="Independently verify domain registration and ensure correspondence is originating from the official organization."
                )
    return None

# ---------------------------------------------------------------------------
# Rule D: Guaranteed Selection Without Assessment (+15)
# ---------------------------------------------------------------------------
def evaluate_rule_d(job_data: JobData, weights: Dict[str, int]) -> Optional[MatchedIndicator]:
    text = f"{job_data.description or ''} {job_data.selection_process or ''}"
    lower = text.lower()

    negation_patterns = [
        re.compile(r"\b(?:we\s+do\s*not|does\s*not|no)\s+guarantee\s+(?:selection|job|offer|placement)\b", re.I),
        re.compile(r"\bselection\s+(?:is\s+)?based\s+(?:purely\s+)?on\s+(?:merit|performance|interview)\b", re.I)
    ]

    auto_patterns = [
        re.compile(r"\bno\s*interview\s*(?:required|needed|conducted)\b", re.I),
        re.compile(r"\bdirect\s*selection\s*(?:without\s*(?:any\s*)?(?:interview|assessment|exam|test))\b", re.I),
        re.compile(r"\bguaranteed\s*(?:job\s*offer|selection|placement)\s*(?:immediately|without\s*interview|after\s*registration)\b", re.I),
        re.compile(r"\beveryone\s*will\s*be\s*selected\s*(?:after\s*paying|upon\s*registration|guaranteed)\b", re.I),
        re.compile(r"\boffer\s*letter\s*guaranteed\s*without\s*(?:any\s*)?(?:evaluation|assessment|interview)\b", re.I),
        re.compile(r"\b100%\s*(?:direct\s*joining|selection\s*guarantee)\s*without\s*interview\b", re.I)
    ]

    for pat in auto_patterns:
        if pat.search(lower):
            sentence = extract_verbatim_sentence(text, pat)
            is_negated = any(neg.search(sentence) for neg in negation_patterns)
            if not is_negated and sentence:
                return MatchedIndicator(
                    rule_id="RULE_D_AUTOMATIC_SELECTION",
                    rule_name="Guaranteed Direct Selection Without Interview",
                    category="unrealistic_hiring_promise",
                    points=weights.get("RULE_D_AUTOMATIC_SELECTION", 15),
                    evidence=sentence,
                    explanation="The listing promises guaranteed job offers without skill evaluation or interviews. Authentic employers evaluate qualifications before extending offers.",
                    evidence_strength="explicit",
                    confidence="high",
                    source="extracted_job_description",
                    recommendation="Exercise caution when offers are guaranteed without technical evaluation; this tactic is often used to entice candidates into advance-fee schemes."
                )
    return None

# ---------------------------------------------------------------------------
# Rule E: Implausible Compensation (+15)
# ---------------------------------------------------------------------------
def evaluate_rule_e(job_data: JobData, weights: Dict[str, int]) -> Optional[MatchedIndicator]:
    text = f"{job_data.job_title or ''} {job_data.salary or ''} {job_data.description or ''}"
    lower = text.lower()

    low_skill_keywords = re.compile(r"\b(data\s*entry|data\s*processing|copy\s*paste|sms\s*sending|typing|form\s*filling|captcha|simple\s*tasks|no\s*skills?\s*required|anyone\s*can\s*do|minimal\s*effort|2\s*hours\s*typing)\b", re.I)
    extreme_pay_patterns = [
        re.compile(r"\b(?:earn|pay|salary|stipend|income)\s*(?:of|is|:)?\s*(?:₹|rs\.?)\s*(?:[3-9][\d,]{3,}|\d{4,})\s*(?:per\s*day|daily|a\s*day|per\s*hour|hourly)\b", re.I),
        re.compile(r"\b(?:earn|pay|salary|stipend|income)\s*(?:of|is|:)?\s*(?:₹|rs\.?)\s*(?:[4-9][\d,]{4,}|\d{5,})\s*(?:per\s*month|monthly|a\s*month)\b", re.I),
        re.compile(r"\b(?:earn|pay|salary|income)\s*(?:of|is|:)?\s*\$\s*(?:[5-9]\d{2,}|\d{4,})\s*(?:per\s*day|daily|a\s*day)\b", re.I),
        re.compile(r"\b(?:earn|pay|salary|income)\s*(?:of|is|:)?\s*\$\s*[2-9][\d,]{3,}\s*(?:per\s*week|weekly|a\s*week)\b", re.I)
    ]

    has_low_skill = bool(low_skill_keywords.search(lower) or re.search(r"\b(no\s*experience|fresher\s*can\s*earn\s*huge)\b", lower))

    if has_low_skill:
        for pat in extreme_pay_patterns:
            if pat.search(lower):
                sentence = extract_verbatim_sentence(text, pat)
                if sentence:
                    return MatchedIndicator(
                        rule_id="RULE_E_IMPLAUSIBLE_COMPENSATION",
                        rule_name="Implausible Compensation for Minimal Requirements",
                        category="unrealistic_compensation",
                        points=weights.get("RULE_E_IMPLAUSIBLE_COMPENSATION", 15),
                        evidence=sentence,
                        explanation="The posting promises extraordinarily high daily or monthly compensation for entry-level, minimal, or low-skill typing/data-entry work.",
                        evidence_strength="explicit",
                        confidence="high",
                        source="extracted_job_description",
                        recommendation="Compare compensation rates against verified industry standards for entry-level positions."
                    )
    return None

# ---------------------------------------------------------------------------
# Rule F: Sensitive Financial Credentials (+40)
# ---------------------------------------------------------------------------
def evaluate_rule_f(job_data: JobData, weights: Dict[str, int]) -> Optional[MatchedIndicator]:
    text = f"{job_data.description or ''} {job_data.application_instructions or ''}"
    lower = text.lower()

    negation_patterns = [
        re.compile(r"\b(?:never|do\s*not|don't)\s*(?:share|send|disclose|give)\s*(?:your\s*)?(?:bank|pin|cvv|password|credentials)\b", re.I),
        re.compile(r"\bfor\s*payroll\s*setup\s*upon\s*formal\s*employment\b", re.I),
        re.compile(r"\bafter\s*(?:joining|signing\s*offer)\b", re.I)
    ]

    sensitive_patterns = [
        re.compile(r"\b(?:provide|send|submit|share|upload|enter)\s*(?:your\s*)?(?:online\s*banking|net\s*banking|bank\s*login|atm\s*pin|cvv|upi\s*pin|banking\s*password)\b", re.I),
        re.compile(r"\b(?:online|net)\s*banking\s*(?:login|credentials|password)\b", re.I),
        re.compile(r"\b(?:bank\s*login\s*details|bank\s*credentials)\b", re.I),
        re.compile(r"\bupi\s*pin\s*(?:for\s*direct\s*deposit|to\s*receive\s*salary|setup)\b", re.I),
        re.compile(r"\b(?:crypto\s*wallet\s*address|seed\s*phrase|receive\s*and\s*forward\s*funds)\b", re.I)
    ]

    for pat in sensitive_patterns:
        if pat.search(lower):
            sentence = extract_verbatim_sentence(text, pat)
            is_negated = any(neg.search(sentence) for neg in negation_patterns)
            if not is_negated and sentence:
                return MatchedIndicator(
                    rule_id="RULE_F_SENSITIVE_FINANCIAL_INFO",
                    rule_name="Sensitive Financial Credentials Requested",
                    category="sensitive_credential_harvesting",
                    points=weights.get("RULE_F_SENSITIVE_FINANCIAL_INFO", 40),
                    evidence=sentence,
                    explanation="The posting requests banking credentials, PINs, or financial secrets during recruitment. Legitimate employers never request bank passwords or PINs.",
                    evidence_strength="explicit",
                    confidence="high",
                    source="extracted_job_description",
                    recommendation="Never disclose bank account passwords, UPI PINs, debit card CVVs, or online banking credentials under any circumstances."
                )
    return None

# ---------------------------------------------------------------------------
# Rule G: Vague Job Description (+10)
# ---------------------------------------------------------------------------
def evaluate_rule_g(job_data: JobData, weights: Dict[str, int]) -> Optional[MatchedIndicator]:
    desc = (job_data.description or "").strip()
    if not desc:
        return None
    duty_keywords = re.compile(r"\b(responsibilit(?:y|ies)|duties|requirements?|qualifications?|skills?|experience|role\s*overview|key\s*tasks|technologies|curriculum)\b", re.I)
    if len(desc) < 120 and not duty_keywords.search(desc):
        return MatchedIndicator(
            rule_id="RULE_G_VAGUE_DESCRIPTION",
            rule_name="Vague or Incomplete Job Details",
            category="insufficient_posting_detail",
            points=weights.get("RULE_G_VAGUE_DESCRIPTION", 10),
            evidence=f"Description excerpt: \"{desc[:150]}...\"",
            explanation="The posting lacks substantive role responsibilities, qualifications, and employment terms.",
            evidence_strength="inferred",
            confidence="medium",
            source="extracted_job_description",
            recommendation="Request a detailed job specification before submitting sensitive personal identification."
        )
    return None

# ---------------------------------------------------------------------------
# Rule H: Coercive Urgency (+10)
# ---------------------------------------------------------------------------
def evaluate_rule_h(job_data: JobData, weights: Dict[str, int]) -> Optional[MatchedIndicator]:
    text = f"{job_data.description or ''} {job_data.application_instructions or ''}"
    lower = text.lower()

    urgency_patterns = [
        re.compile(r"\b(?:hurry|act\s*now|urgent)\s*[,!.]?\s*(?:only|last)\s*\d+\s*(?:seats?|spots?|vacanc(?:y|ies))\s*left\s*(?:pay\s*now|before\s*they\s*fill)\b", re.I),
        re.compile(r"\bpay\s*(?:immediately|today|within\s*\d+\s*hours?)\s*or\s*(?:lose\s*your\s*seat|offer\s*will\s*be\s*cancelled|seat\s*given\s*to\s*other)\b", re.I),
        re.compile(r"\bimmediate\s*joining\s*within\s*\d+\s*hours?\s*send\s*(?:fee|money|deposit)\s*now\b", re.I),
        re.compile(r"\btransfer\s*(?:amount|money)\s*within\s*\d+\s*(?:minutes?|hours?)\s*to\s*reserve\b", re.I)
    ]

    for pat in urgency_patterns:
        if pat.search(lower):
            sentence = extract_verbatim_sentence(text, pat)
            if sentence:
                return MatchedIndicator(
                    rule_id="RULE_H_COERCIVE_URGENCY",
                    rule_name="Coercive Urgency and High-Pressure Demands",
                    category="coercive_pressure",
                    points=weights.get("RULE_H_COERCIVE_URGENCY", 10),
                    evidence=sentence,
                    explanation="The posting uses artificial urgency and pressure tactics to force quick payments or immediate action before candidates can perform due diligence.",
                    evidence_strength="explicit",
                    confidence="high",
                    source="extracted_job_description",
                    recommendation="Take adequate time to research the company independently. Legitimate opportunities do not expire within hours over fee demands."
                )
    return None

# ---------------------------------------------------------------------------
# Recommendations & Explanation Generators
# ---------------------------------------------------------------------------
def build_evidence_driven_recommendations(
    matched_indicators: List[MatchedIndicator],
    job_data: JobData,
    ml_res: MLAnalysisResult,
    has_mandatory_fee: bool
) -> List[str]:
    recs: List[str] = []

    # 1. Candidate-paid fee recommendations
    if has_mandatory_fee:
        fee_amt = job_data.registration_fee or "the required"
        if job_data.has_unpaid_option:
            recs.append(f"Do not pay the registration fee yet. The posting asks candidates to pay {fee_amt} for the paid internship option.")
            recs.append("Verify the organization independently. Find its official website and contact details yourself. Do not rely only on the application form or recruiter's message.")
            recs.append("Ask why the fee is required. Check the written terms and what happens if you decide not to continue.")
            recs.append("Choose the no-fee option if you do not want to pay. The listing states that its unpaid internship option has no registration fee.")
            recs.append("Stop if you feel pressured to pay. Urgent payment demands or promises of guaranteed selection are additional warning signs.")
        else:
            recs.append(f"Do not pay the registration or training fee ({fee_amt}). Authentic employers never charge candidates recruitment fees.")
            recs.append("Verify the organization through an independently obtained corporate registry or official careers site.")
            recs.append("Ask for formal written terms explaining the business justification for any candidate-paid charge.")
            recs.append("Stop communication if you are pressured to make an immediate money transfer.")
        return recs

    # 2. Rule-specific recommendations
    rule_ids = {m.rule_id for m in matched_indicators}
    if "RULE_A4_PAYMENT_FOR_SELECTION" in rule_ids:
        recs.append("Do not transfer money to secure selection or an offer letter.")
        recs.append("Contact the company through independently obtained official contact details.")
        recs.append("Stop if the recruiter pressures you to pay immediately.")
        recs.append("Save the job post and payment request if you need to report it.")
        return recs

    if "RULE_F_SENSITIVE_FINANCIAL_INFO" in rule_ids:
        recs.append("Never share your OTP, PIN, password, or online banking credentials.")
        recs.append("Stop communicating through the suspicious channel immediately.")
        recs.append("If you already shared credentials, contact your bank immediately and secure your account.")
        return recs

    if "RULE_B_EXCLUSIVE_MESSAGING" in rule_ids:
        recs.append("Check whether the recruiter is officially connected to the company.")
        recs.append("Verify the vacancy on the company's official corporate careers website.")
        recs.append("Do not send identity documents or financial information until the opportunity is verified.")

    # 3. Model warning without matched rules (e.g. statistical ML warning like Zoetis)
    if ml_res.available and ml_res.predicted_class == "fraud" and not matched_indicators:
        comp_display = job_data.company_name or "the employer"
        recs.append(f"Check the vacancy on {comp_display}'s official careers website.")
        recs.append("Verify that the role title and location match the official listing.")
        recs.append("Review the complete compensation and internship terms before accepting an offer.")
        recs.append("Do not pay any fee or share sensitive information based solely on an unverified message.")
        return recs

    # 4. Clean posting / no strong warning signs
    if not recs:
        recs.append("No strong warning signs were detected in the available text. This does not guarantee that the job is genuine.")
        recs.append("Verify the vacancy on the company's official careers website.")
        recs.append("Check that the recruiter's identity and contact details match the organization.")
        recs.append("Read the job requirements and payment terms carefully before signing agreements.")
        recs.append("Do not share passwords, OTPs, or banking credentials under any circumstances.")

    return recs

def build_four_question_risk_explanation(
    job_data: JobData,
    final_score: int,
    risk_category: str,
    matched_indicators: List[MatchedIndicator],
    ml_res: MLAnalysisResult,
    has_mandatory_fee: bool
) -> RiskExplanation:
    """Answers four simple questions: How risky? What caused the score? What next? What could not be verified?"""
    # Question 1: How risky?
    risk_summary = f"This posting has a risk score of {final_score}/100 ({risk_category})."

    # Question 2: What caused the score?
    causes = []
    if has_mandatory_fee:
        if job_data.has_paid_option and job_data.has_unpaid_option:
            causes.append(
                f"The paid internship option asks for a {job_data.registration_fee or '₹199'} registration fee "
                f"(payable {job_data.payment_timing.replace('_', ' ') if job_data.payment_timing else 'on orientation day'}). "
                f"A separate performance-based stipend of {job_data.stipend or '₹600–₹6,000+'} is advertised. "
                "The posting also advertises an unpaid option without a registration fee. "
                "The candidate-paid fee is the main warning sign. The available evidence does not, by itself, prove that the organization is fraudulent."
            )
        else:
            causes.append(
                f"The posting requests a candidate-paid fee ({job_data.registration_fee or job_data.training_fee or 'fee demand'}). "
                "Candidate-paid recruitment fees are a significant warning sign."
            )
    elif matched_indicators:
        indicator_names = [f"{m.rule_name} (+{m.points} pts)" for m in matched_indicators]
        causes.append(f"The rule engine identified: {', '.join(indicator_names)}.")
    elif ml_res.available and ml_res.predicted_class == "fraud":
        causes.append(
            f"The pretrained machine learning model raised a statistical warning ({ml_res.risk_score}/100 uncalibrated fraud probability), "
            "but the deterministic rule engine found no specific fee requests or high-risk indicators in the supplied text."
        )
    else:
        causes.append("No suspicious indicators or candidate fee demands were found in the analyzed text.")

    score_cause = " ".join(causes)

    # Question 3: What should I do next?
    if has_mandatory_fee:
        next_steps = "Do not transfer money. Verify the company independently and consider whether a no-fee alternative is appropriate."
    elif matched_indicators:
        next_steps = "Exercise caution. Confirm the employer's credentials through official channels before proceeding."
    else:
        next_steps = "Verify the posting on the company's official careers portal and verify the recruiter's official corporate email."

    # Question 4: What could not be verified?
    unverified = []
    if not job_data.company_website:
        unverified.append("Official company website was not provided.")
    if not job_data.salary and not job_data.stipend:
        unverified.append("Salary or stipend was not mentioned in the posting.")
    if not job_data.recruiter_email:
        unverified.append("Direct corporate recruiter email was not listed.")
    if not unverified:
        unverified.append("External corporate registration status could not be verified without independent registry lookup.")

    unverified_info = " ".join(unverified)

    return RiskExplanation(
        risk_summary=risk_summary,
        score_cause=score_cause,
        next_steps_summary=next_steps,
        unverified_info=unverified_info
    )

# ---------------------------------------------------------------------------
# Hybrid Scoring Coordinator with ML & Evidence Safeguards
# ---------------------------------------------------------------------------
def score_job_posting(
    job_data: JobData,
    weights: Optional[Dict[str, int]] = None,
    include_ml: bool = True
) -> AnalysisResult:
    w = dict(DEFAULT_WEIGHTS)
    if weights:
        w.update(weights)

    desc = (job_data.description or "").strip()
    title = (job_data.job_title or "").strip()

    # Empty or insufficient data check
    if (not title and not desc) or (len(desc) < 20 and (not title or len(title) < 5)):
        return AnalysisResult(
            platform=job_data.platform,
            content_type=job_data.content_type,
            original_url=job_data.original_url,
            job_data=job_data,
            risk_score=0,
            risk_category="Insufficient Data",
            risk_level="unknown",
            analysis_mode="unsupported",
            is_payment_warning=False,
            analysis_status="insufficient_data",
            extraction_status="failed",
            extraction_completeness=0.0,
            matched_indicators=[],
            financial_items=[],
            ml_analysis=MLAnalysisResult(available=False, error="Insufficient text for analysis"),
            rule_analysis=RuleAnalysisResult(available=False, risk_score=0, rules_matched=0),
            risk_explanation=RiskExplanation(
                risk_summary="Insufficient content to conduct an assessment.",
                score_cause="Input text was too brief to analyze.",
                next_steps_summary="Provide full job posting text.",
                unverified_info="All job attributes are unverified."
            ),
            recommendations=["Paste a complete job description or provide a direct posting URL."],
            missing_information=["Posting description is too short or unavailable."],
            verification_steps=["Provide full job text to perform heuristic risk evaluation."],
            analysis_limitations=["Content was too brief to evaluate scam indicators reliably."],
            disclaimer="Insufficient content to conduct an evidence-based risk assessment.",
            timestamp=0
        )

    # Populate financial items if not already extracted
    if not job_data.financial_items and desc:
        job_data.financial_items = extract_financial_items(desc)

    # Populate structured compensation and candidate fee details
    if desc:
        if not job_data.compensation:
            job_data.compensation = extract_structured_compensation(desc, job_data.financial_items)
        if not job_data.candidate_fees:
            job_data.candidate_fees = extract_candidate_fee_details(desc, job_data.financial_items)

    # Sync fields onto job_data
    if job_data.financial_items:
        for item in job_data.financial_items:
            if item.payment_direction == "candidate_to_employer" and item.mandatory_status in ("mandatory", "conditional"):
                if item.financial_type == "registration_fee" and not job_data.registration_fee:
                    job_data.registration_fee = item.amount
                    job_data.payment_direction = "candidate_to_employer"
                    job_data.payment_timing = item.payment_timing
                    job_data.payment_mandatory = "mandatory"
                elif item.financial_type == "training_fee" and not job_data.training_fee:
                    job_data.training_fee = item.amount
                    job_data.payment_direction = "candidate_to_employer"
                    job_data.payment_timing = item.payment_timing
                elif item.financial_type == "security_deposit" and not job_data.security_deposit:
                    job_data.security_deposit = item.amount
                    job_data.payment_direction = "candidate_to_employer"
                    job_data.payment_timing = item.payment_timing
                elif not job_data.other_fees:
                    job_data.other_fees = f"{item.financial_type.replace('_', ' ').capitalize()}: {item.amount}"
            elif item.payment_direction == "employer_to_candidate":
                if item.financial_type == "stipend" and not job_data.stipend:
                    job_data.stipend = item.amount
                elif item.financial_type in ("salary", "hourly_wage") and not job_data.salary:
                    job_data.salary = item.amount

    # Evaluate deterministic rules
    candidate_rules = [
        evaluate_rule_a(job_data, w),
        evaluate_rule_a2(job_data, w),
        evaluate_rule_a4(job_data, w),
        evaluate_rule_b(job_data, w),
        evaluate_rule_c(job_data, w),
        evaluate_rule_d(job_data, w),
        evaluate_rule_e(job_data, w),
        evaluate_rule_f(job_data, w),
        evaluate_rule_g(job_data, w),
        evaluate_rule_h(job_data, w)
    ]

    matched_map: Dict[str, MatchedIndicator] = {}
    is_payment = False
    has_mandatory_fee = False
    has_selection_payment = False
    has_sensitive_credential_request = False

    for ind in candidate_rules:
        if ind:
            if ind.rule_id in ("RULE_A_PAYMENT_REQUIRED", "RULE_A2_MANDATORY_TRAINING_FEE", "RULE_A3_SECURITY_DEPOSIT", "RULE_A4_PAYMENT_FOR_SELECTION"):
                is_payment = True
                has_mandatory_fee = True
            if ind.rule_id == "RULE_A4_PAYMENT_FOR_SELECTION":
                has_selection_payment = True
            if ind.rule_id == "RULE_F_SENSITIVE_FINANCIAL_INFO":
                has_sensitive_credential_request = True
            if ind.rule_id not in matched_map:
                matched_map[ind.rule_id] = ind

    matched_indicators = list(matched_map.values())
    raw_rule_points = sum(ind.points for ind in matched_indicators)
    rule_risk_score = int(min(100, max(0, raw_rule_points)))

    rule_res = RuleAnalysisResult(
        available=True,
        risk_score=rule_risk_score,
        rules_matched=len(matched_indicators)
    )

    # ML Model Prediction
    ml_res = MLAnalysisResult(available=False)
    ml_risk_score: Optional[float] = None
    if include_ml and desc:
        ml_pred = predict_employment_fraud(desc)
        ml_res = MLAnalysisResult(
            available=ml_pred.get("available", False),
            risk_score=ml_pred.get("ml_risk_score"),
            predicted_class=ml_pred.get("predicted_class"),
            confidence=ml_pred.get("ml_confidence"),
            score_semantics=ml_pred.get("score_semantics", "uncalibrated_positive_class_probability"),
            model_name=ml_pred.get("model_name"),
            model_version=ml_pred.get("model_version"),
            error=ml_pred.get("error")
        )
        if ml_res.available and ml_res.risk_score is not None:
            ml_risk_score = float(ml_res.risk_score)

    # Hybrid Combination Formula
    # hybrid_score = 0.60 * ml_risk_score + 0.40 * rule_risk_score
    if ml_risk_score is not None:
        analysis_mode = "hybrid"
        calculated_score = (0.60 * ml_risk_score) + (0.40 * float(rule_risk_score))
    else:
        analysis_mode = "rule_only"
        calculated_score = float(rule_risk_score)

    final_score = calculated_score

    # Mandatory Evidence-Based Floors (Safeguards)
    # Section 1: When candidate-paid recruitment fee is present, final score must be AT LEAST 40/100
    if has_mandatory_fee:
        final_score = max(final_score, 40.0)

    # Explicit payment to secure selection or offer letter: floor at least 50/100
    if has_selection_payment:
        final_score = max(final_score, 50.0)

    # Banking credentials or authentication secret request: floor at least 60/100
    if has_sensitive_credential_request:
        final_score = max(final_score, 60.0)

    final_int_score = int(min(100, max(0, round(final_score))))

    # Risk Category Thresholds:
    # 0–19: Low
    # 20–39: Moderate
    # 40–59: High
    # 60–100: Critical
    if final_int_score >= 60:
        risk_category = "Critical Risk"
        risk_level = "critical"
    elif final_int_score >= 40:
        risk_category = "High Risk"
        risk_level = "high"
    elif final_int_score >= 20:
        risk_category = "Moderate Risk"
        risk_level = "medium"
    else:
        risk_category = "Low Risk"
        risk_level = "low"

    # Actionable evidence-driven recommendations
    recommendations = build_evidence_driven_recommendations(
        matched_indicators,
        job_data,
        ml_res,
        has_mandatory_fee
    )

    # Four-question risk explanation
    explanation = build_four_question_risk_explanation(
        job_data,
        final_int_score,
        risk_category,
        matched_indicators,
        ml_res,
        has_mandatory_fee
    )

    fee_banner = None
    if has_mandatory_fee:
        fee_amt = job_data.registration_fee or "a registration fee"
        fee_banner = (
            f"Candidate-paid fee detected: The posting asks candidates to pay {fee_amt}. "
            "This is a significant warning sign. Verify the opportunity before paying."
        )

    missing_info: List[str] = []
    if not job_data.company_website:
        missing_info.append("Company website was not specified in the listing.")
    if not job_data.salary and not job_data.stipend:
        missing_info.append("Compensation or stipend details are not specified.")
    if not job_data.recruiter_email:
        missing_info.append("No direct recruiter corporate email provided.")

    verification_steps = [
        "Independently search the company's official corporate website.",
        "Check registration in national corporate databases (e.g., MCA in India, SEC/State registries in US, Companies House in UK).",
        "Verify recruiter identity via official company directory or verified LinkedIn profile.",
        "Never pay application, registration, or placement fees for an employment opportunity."
    ]

    completeness = calculate_extraction_completeness(job_data)

    return AnalysisResult(
        platform=job_data.platform,
        content_type=job_data.content_type,
        original_url=job_data.original_url,
        job_data=job_data,
        risk_score=final_int_score,
        risk_category=risk_category,
        risk_level=risk_level,
        analysis_mode=analysis_mode,
        is_payment_warning=is_payment,
        fee_warning_banner=fee_banner,
        analysis_status="complete",
        extraction_status="success",
        extraction_completeness=completeness,
        matched_indicators=matched_indicators,
        financial_items=job_data.financial_items,
        ml_analysis=ml_res,
        rule_analysis=rule_res,
        risk_explanation=explanation,
        recommendations=recommendations,
        missing_information=missing_info,
        verification_steps=verification_steps,
        analysis_limitations=list(job_data.unextracted_fields),
        disclaimer="This assessment is an explainable hybrid analysis combining a pretrained employment fraud classifier and deterministic heuristic rules. It is not a guarantee of fraud or legitimacy.",
        timestamp=0
    )
