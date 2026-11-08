import re
import json
from typing import Optional, Dict, Any, Tuple, List
from bs4 import BeautifulSoup
from app.schemas.job import JobData, FinancialItem, CompensationDetails, CandidateFeeDetails
from app.detector.classifier import classify_content
from app.extractors.financial import (
    extract_financial_items,
    extract_structured_compensation,
    extract_candidate_fee_details
)

LINKEDIN_BOILERPLATE_PATTERNS = [
    re.compile(r"Join\s+or\s+sign\s+in\s+to\s+find\s+your\s+next\s+job[^\n\r]*", re.I),
    re.compile(r"Join\s+to\s+apply\b[^\n\r]*", re.I),
    re.compile(r"Email\s+or\s+phone\s+Password[^\n\r]*", re.I),
    re.compile(r"New\s+to\s+LinkedIn\??\s+Join\s+now[^\n\r]*", re.I),
    re.compile(r"By\s+clicking\s+Continue\s+to\s+join\s+or\s+sign\s+in[^\n\r]*", re.I),
    re.compile(r"Sign\s+in\s+with\s+Google|Sign\s+in\s+with\s+Apple", re.I),
    re.compile(r"User\s+Agreement,\s*Privacy\s+Policy,\s*and\s*Cookie\s+Policy", re.I),
    re.compile(r"Agree\s*&\s*Join", re.I),
    re.compile(r"Sign\s*in\s*to\s*(?:view|see)\s*more\s*jobs", re.I),
    re.compile(r"Already\s*on\s*LinkedIn\??\s*Sign\s*in", re.I)
]

def clean_text(text: Optional[str]) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip()

def clean_company_name(name: Optional[str]) -> str:
    if not name:
        return ""
    cleaned = re.sub(r"\s+\d(?:\.\d)?\s*(?:★|stars?|out of \d)?\s*$", "", name, flags=re.I).strip()
    cleaned = re.sub(r"\s+(?:is|are)\s+hiring\b.*$", "", cleaned, flags=re.I).strip()
    cleaned = re.sub(r"^(?:join|about|at)\s+", "", cleaned, flags=re.I).strip()
    return cleaned

def strip_auth_and_navigation_boilerplate(raw_text: str) -> Tuple[str, List[str]]:
    """
    Strips authentication prompts, login form text, and navigation boilerplate
    (e.g., LinkedIn login wall text) from job descriptions.
    Returns cleaned text and a list of limitations/warnings if boilerplate was removed.
    """
    if not raw_text:
        return "", []

    warnings = []
    lines = raw_text.splitlines()
    cleaned_lines = []
    boilerplate_detected = False

    for line in lines:
        stripped_line = line.strip()
        if not stripped_line:
            continue
        
        is_bp = any(pat.search(stripped_line) for pat in LINKEDIN_BOILERPLATE_PATTERNS)
        if is_bp:
            boilerplate_detected = True
            continue
        
        # Standalone login form fields
        if re.match(r"^(?:Email\s*or\s*phone|Password|Show|Forgot\s*password\??|Sign\s*in|Join\s*now|Agree\s*&\s*Join)$", stripped_line, re.I):
            boilerplate_detected = True
            continue

        cleaned_lines.append(line)

    result_text = "\n".join(cleaned_lines).strip()
    
    for pat in LINKEDIN_BOILERPLATE_PATTERNS:
        if pat.search(result_text):
            result_text = pat.sub("", result_text).strip()
            boilerplate_detected = True

    if boilerplate_detected:
        warnings.append("LinkedIn authentication and navigation text was detected and excluded from the analyzed job description.")

    return result_text, warnings

def extract_job_title_from_text(text: str) -> Optional[str]:
    """Extracts job title from explicit headers, title statements, or leading role lines."""
    if not text:
        return None

    # Check for explicit Title/Role line: e.g. "Title: Intern- Zoetis Tech & Digital."
    m_title = re.search(r"(?:^|\b)(?:Title|Job\s*Title|Role|Position)\s*:\s*([^\n\r,;]+?)(?:\.[\s\n\r]|\.$|[\n\r]|$)", text, re.I)
    if m_title:
        title = m_title.group(1).strip().rstrip(".")
        # Clean up hyphen separator: e.g. "Intern- Zoetis" -> "Intern – Zoetis"
        title = re.sub(r"\s*-\s*", " – ", title)
        return title

    # Check for opportunity headers: "HR Internship Opportunity – Cook N Klean"
    m_opp = re.search(r"\b([A-Za-z0-9\s/–-]+?)\s+(?:Internship\s+Opportunity|Internship)\s*[–\-]\s*[A-Za-z0-9&.,\s]+", text, re.I)
    if m_opp:
        prefix = m_opp.group(1).strip()
        return f"{prefix} Intern"

    # Check for "HIRING NOW | HR PAID INTERNSHIP OPPORTUNITY" or similar
    m_hiring = re.search(r"\b(?:hiring\s+now|urgent\s+hiring)\s*[|–\-:]\s*([A-Za-z0-9\s/–-]+(?:internship|opportunity|intern|developer|engineer))\b", text, re.I)
    if m_hiring:
        cand = m_hiring.group(1).strip()
        if re.search(r"\bhr\b", cand, re.I) and "intern" in cand.lower():
            return "HR Intern"
        cand = re.sub(r"\bpaid\s+internship\s+opportunity\b", "Intern", cand, flags=re.I)
        cand = re.sub(r"\binternship\s+opportunity\b", "Intern", cand, flags=re.I)
        cand = re.sub(r"\binternship\b", "Intern", cand, flags=re.I).strip()
        return cand

    # Check for "looking for enthusiastic and motivated HR Interns"
    m_looking = re.search(r"\b(?:looking\s+for|seeking)\s+(?:[a-zA-Z\s]{0,25})?\b([A-Za-z0-9\s/–-]+(?:Interns?|Developers?|Engineers?|Specialists?|Managers?))\b", text, re.I)
    if m_looking:
        cand = m_looking.group(1).strip()
        if cand.lower().endswith("s") and not cand.lower().endswith("ss"):
            cand = cand[:-1]
        return cand

    # General opportunity header
    m_gen = re.search(r"\b([A-Za-z0-9\s/–-]+(?:Intern|Developer|Engineer|Specialist|Manager))\s+Opportunity\b", text, re.I)
    if m_gen:
        return m_gen.group(1).strip()

    return None

def extract_company_name_from_text(text: str) -> Optional[str]:
    """Extracts company/employer name from description context or structured headers."""
    if not text:
        return None

    # Pattern: "<Company> India Capability Center (ZICC)" or "<Company> Capability Center"
    m_icc = re.search(r"\b([A-Z][A-Za-z0-9&.,\s]{1,30}?)\s+(?:India\s+)?Capability\s+Center\b", text)
    if m_icc:
        name = m_icc.group(1).strip()
        if name and not re.match(r"^(the|join|our)$", name, re.I):
            return clean_company_name(name)

    # Pattern: "Opportunity – Cook N Klean" or "Internship – Cook N Klean"
    m_dash = re.search(r"(?:Opportunity|Internship|Hiring)\s*[–\-]\s*([A-Z][A-Za-z0-9&.,\s]{1,30}?)(?:\n|$|\.)", text)
    if m_dash:
        cand = m_dash.group(1).strip()
        if cand and not re.match(r"^(we|everyone|company|team|our)$", cand, re.I):
            return clean_company_name(cand)

    # Pattern: "Join Zoetis" or "Join Cook N Klean"
    m_join = re.search(r"\bjoin\s+([A-Z][A-Za-z0-9&.,\s]{1,30}?)(?:\s+(?:today|our\s+team|India|\.|\n|$))", text, re.I)
    if m_join:
        name = m_join.group(1).strip()
        if name and not re.match(r"^(our|the|us|a|an)$", name, re.I):
            return clean_company_name(name)

    # Pattern: "role at Zoetis" or "job at Zoetis"
    m_at = re.search(r"\b(?:role|position|job|internship)\s+at\s+([A-Z][A-Za-z0-9&.,\s]{1,30}?)(?:[.,\n]|$)", text, re.I)
    if m_at:
        return clean_company_name(m_at.group(1).strip())

    # Pattern: "Cook N Klean is looking for" or "Cook N Klean is hiring"
    m_hiring = re.search(r"\b([A-Z][A-Za-z0-9&.,\s]{1,30}?)\s+(?:is|are)\s+(?:looking\s+for|hiring|seeking)\b", text)
    if m_hiring:
        cand = m_hiring.group(1).strip()
        if cand and not re.match(r"^(we|everyone|company|team|who)$", cand, re.I):
            return clean_company_name(cand)

    return None

def extract_location_and_mode_from_text(text: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Extracts location (city/state/region) and workplace mode (In-office, Remote, Hybrid, On-site).
    Returns (location, workplace_mode).
    """
    if not text:
        return None, None

    location = None
    workplace_mode = None

    # Check for explicit Workplace Mode line
    m_mode = re.search(r"\b(?:Mode\s*of\s*Working|Workplace\s*Mode|Work\s*Mode|Mode)\s*:\s*([^\n\r,.;]+(?:\s*/\s*[^\n\r,.;]+)?)", text, re.I)
    if m_mode:
        raw_mode = m_mode.group(1).strip().rstrip(".")
        if re.search(r"\bin[\s-]office\b", raw_mode, re.I):
            workplace_mode = "In-office"
        elif re.search(r"\bon[\s-]site\b", raw_mode, re.I):
            workplace_mode = "On-site"
        elif re.search(r"\bremote\b|\bwork\s*from\s*home\b|\bwfh\b", raw_mode, re.I):
            workplace_mode = "Remote"
            location = "Remote / Work From Home"
        elif re.search(r"\bhybrid\b", raw_mode, re.I):
            workplace_mode = "Hybrid"
        else:
            workplace_mode = raw_mode

    # Check for explicit Location line: stop at period, semicolon, newline, or next header
    m_loc = re.search(r"\b(?:Location|Job\s*Location)\s*:\s*([^\n\r;.]+)", text, re.I)
    if m_loc:
        raw_loc = m_loc.group(1).strip().rstrip(".")
        location = raw_loc

    # Fallback contextual extraction for major cities
    if not location:
        city_m = re.search(r"\b(Hyderabad|Bengaluru|Bangalore|Mumbai|Delhi|Pune|Chennai|Gurgaon|Gurugram|Noida|Kolkata)\b", text, re.I)
        if city_m:
            location = city_m.group(1).capitalize()

    if not workplace_mode:
        if re.search(r"\b(?:remote\s*/\s*work\s*from\s*home|work\s*from\s*home|remote\s*internship|fully\s*remote)\b", text, re.I):
            workplace_mode = "Remote"
            if not location:
                location = "Remote / Work From Home"
        elif re.search(r"\bin[\s-]office\b", text, re.I):
            workplace_mode = "In-office"
        elif re.search(r"\bhybrid\b", text, re.I):
            workplace_mode = "Hybrid"

    return location, workplace_mode

def extract_duration_and_dates(text: str) -> Dict[str, Optional[str]]:
    """
    Extracts duration, period, start date, end date, and working hours from text.
    Handles '45 days', '6 months (Jan 2027–Jun 2027)', '3–4 hours/day'.
    """
    res = {
        "duration": None,
        "period": None,
        "start_date": None,
        "end_date": None,
        "working_hours": None
    }
    if not text:
        return res

    # Explicit duration header
    dur_m = re.search(r"\bduration\s*:\s*([^\n\r;,]+(?:\([^\)]+\))?)", text, re.I)
    if dur_m:
        raw_dur = dur_m.group(1).strip().rstrip(".")
        paren_m = re.search(r"\(([^)]+)\)", raw_dur)
        if paren_m:
            period_raw = paren_m.group(1).strip()
            res["period"] = normalize_date_range(period_raw)
            clean_dur = re.sub(r"\s*\([^)]+\)", "", raw_dur).strip()
            res["duration"] = clean_dur.lower()
        else:
            res["duration"] = raw_dur.lower()

    # Inline duration (e.g. "Join our 45-day remote HR Internship")
    if not res["duration"]:
        dur_inline_days = re.search(r"\b(\d+)[\s-]days?\b", text, re.I)
        if dur_inline_days:
            res["duration"] = f"{dur_inline_days.group(1)} days"
        else:
            dur_inline_mo = re.search(r"\b(\d+)[\s-]months?\b", text, re.I)
            if dur_inline_mo:
                res["duration"] = f"{dur_inline_mo.group(1)} months"

    # Working hours: e.g. "Working Hours: 3–4 hours/day"
    wh_m = re.search(r"\bworking\s*hours\s*:\s*([^\n\r;|]+)", text, re.I)
    if wh_m:
        res["working_hours"] = wh_m.group(1).strip().rstrip(".").lower()
    else:
        wh_inline = re.search(r"\b(\d+[-–]\d+\s*hours?\s*/\s*day)\b", text, re.I)
        if wh_inline:
            res["working_hours"] = wh_inline.group(1).lower()

    return res

def normalize_date_range(period_str: str) -> str:
    """Normalizes 'Jan 2027–Jun 2027' or 'Jan 2027 - Jun 2027' to 'January 2027 – June 2027'."""
    month_map = {
        "jan": "January", "feb": "February", "mar": "March", "apr": "April",
        "may": "May", "jun": "June", "jul": "July", "aug": "August",
        "sep": "September", "oct": "October", "nov": "November", "dec": "December"
    }
    norm = period_str
    for abbr, full in month_map.items():
        norm = re.sub(rf"\b{abbr}\b", full, norm, flags=re.I)
    norm = re.sub(r"\s*[-–—]\s*", " – ", norm)
    return norm.strip()

def extract_options_details(text: str) -> Dict[str, Any]:
    """
    Extracts details for multi-tier options like:
    Paid Option: ₹199 registration fee with stipend
    Unpaid Option: No registration fee and no stipend
    """
    res = {
        "has_paid_option": False,
        "has_unpaid_option": False,
        "paid_option_details": None,
        "unpaid_option_details": None
    }
    if not text:
        return res

    paid_m = re.search(r"\bpaid\s*option\s*:\s*([^\n\r]+)", text, re.I)
    if paid_m:
        res["has_paid_option"] = True
        res["paid_option_details"] = paid_m.group(1).strip()

    unpaid_m = re.search(r"\bunpaid\s*option\s*:\s*([^\n\r]+)", text, re.I)
    if unpaid_m:
        res["has_unpaid_option"] = True
        res["unpaid_option_details"] = unpaid_m.group(1).strip()

    return res

def calculate_extraction_completeness(job: JobData) -> float:
    """
    Calculates extraction completeness based on actual relevant job fields,
    excluding boilerplate text and without falsely punishing postings lacking compensation.
    """
    evaluated_fields = [
        bool(job.job_title),
        bool(job.company_name),
        bool(job.description and len(job.description) > 30),
        bool(job.location),
        bool(job.workplace_mode or job.workplace_type),
        bool(job.employment_type),
        bool(job.duration or job.period),
        bool(job.application_instructions or job.contact_instructions or job.recruiter_email or re.search(r"\b(apply|send|resume|form)\b", job.description, re.I))
    ]
    if job.salary or job.stipend or (job.compensation and job.compensation.type != "none_mentioned"):
        evaluated_fields.append(True)

    score = sum(1 for f in evaluated_fields if f) / len(evaluated_fields)
    return round(score, 2)

def parse_html_job_page(html_content: str, url: str, platform: str) -> JobData:
    soup = BeautifulSoup(html_content, "html.parser")
    data = JobData(platform=platform, original_url=url, extraction_source="auto_url")

    # Remove authentication forms, navs, headers, footers from DOM
    for unwanted in soup.find_all(["form", "nav", "footer", "header"]):
        unwanted.decompose()
    for auth_elem in soup.find_all(class_=re.compile(r"authwall|login|join-form|sign-in", re.I)):
        auth_elem.decompose()

    # 1. JSON-LD structured data
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            raw = script.string or script.get_text()
            if not raw:
                continue
            parsed = json.loads(raw)
            items = parsed if isinstance(parsed, list) else (parsed.get("@graph", [parsed]) if isinstance(parsed, dict) else [])
            for item in items:
                if isinstance(item, dict) and "JobPosting" in str(item.get("@type", "")):
                    data.job_title = clean_text(item.get("title"))
                    org = item.get("hiringOrganization")
                    if isinstance(org, dict):
                        data.company_name = clean_company_name(clean_text(org.get("name")))
                        data.company_website = org.get("sameAs") or org.get("url")
                    elif isinstance(org, str):
                        data.company_name = clean_company_name(clean_text(org))
                    
                    loc = item.get("jobLocation")
                    if isinstance(loc, dict):
                        addr = loc.get("address", {})
                        if isinstance(addr, dict):
                            parts = [addr.get("addressLocality"), addr.get("addressRegion"), addr.get("addressCountry")]
                            data.location = ", ".join(p for p in parts if p)
                    elif isinstance(loc, str):
                        data.location = clean_text(loc)
                    
                    if not data.location and (item.get("jobLocationType") == "TELECOMMUTE" or item.get("applicantLocationRequirements")):
                        data.location = "Remote"
                        data.workplace_mode = "Remote"
                        data.workplace_type = "Remote"
                    
                    data.employment_type = clean_text(item.get("employmentType"))
                    data.description = clean_text(item.get("description"))
                    data.extraction_source = "json_ld"
                    break
        except Exception:
            continue

    # 2. DOM selectors for title, company, location, badges
    if not data.job_title:
        title_tag = soup.find(["h1", "h2"], class_=re.compile(r"job-title|topcard__title|JobInfoHeader-title|title", re.I))
        if title_tag:
            data.job_title = clean_text(title_tag.get_text())

    if not data.job_title and soup.title:
        raw_title = soup.title.get_text()
        parts = re.split(r"\s+[|•·]\s+|\s+-\s+", raw_title)
        if len(parts) >= 2 and parts[0].strip().lower() not in ("linkedin", "jobs", "indeed"):
            data.job_title = clean_text(parts[0])
            if not data.company_name and parts[1] and "linkedin" not in parts[1].lower():
                data.company_name = clean_company_name(parts[1])

    if not data.company_name:
        comp_tag = soup.find(["a", "span", "div"], class_=re.compile(r"company-name|topcard__org-name|companyLocation|CompanyInfo", re.I))
        if comp_tag:
            data.company_name = clean_company_name(clean_text(comp_tag.get_text()))

    if not data.location:
        loc_tag = soup.find(["span", "div"], class_=re.compile(r"primary-description|companyLocation|job-location|bullet", re.I))
        if loc_tag:
            loc_text = clean_text(loc_tag.get_text())
            parts = [p.strip() for p in re.split(r"[·•|]", loc_text) if p.strip()]
            for p in parts:
                if re.search(r"\b(ago|posted|reposted|applied)\b", p, re.I):
                    data.posted_date = p
                elif not data.location and not re.search(r"responses managed", p, re.I):
                    data.location = p

    # Workplace Mode & Badges
    badge_tags = soup.find_all(class_=re.compile(r"ui-pill|job-insight|workplace-type|badge", re.I))
    for b in badge_tags:
        bt = clean_text(b.get_text())
        wp_m = re.search(r"\b(On-site|Remote|Hybrid|In-office)\b", bt, re.I)
        if wp_m and not data.workplace_mode:
            data.workplace_mode = wp_m.group(0).capitalize()
            data.workplace_type = data.workplace_mode
        et_m = re.search(r"\b(Full-time|Part-time|Contract|Temporary|Internship|Volunteer)\b", bt, re.I)
        if et_m and not data.employment_type:
            data.employment_type = et_m.group(0)

    # Description
    if not data.description or len(data.description) < 30:
        desc_tag = soup.find(["div", "article", "section"], id=re.compile(r"job-details|jobDescriptionText", re.I)) or \
                   soup.find(["div", "article", "section"], class_=re.compile(r"jobs-description|jobDescriptionText", re.I))
        if desc_tag:
            data.description = clean_text(desc_tag.get_text())

    # Fallback to structured text parsing on description
    if data.description:
        cleaned_desc, bp_warnings = strip_auth_and_navigation_boilerplate(data.description)
        data.description = cleaned_desc
        if bp_warnings:
            data.unextracted_fields.extend(bp_warnings)

        if not data.job_title:
            data.job_title = extract_job_title_from_text(data.description)
        if not data.company_name:
            data.company_name = extract_company_name_from_text(data.description)
        
        loc_fallback, mode_fallback = extract_location_and_mode_from_text(data.description)
        if not data.location:
            data.location = loc_fallback
        if not data.workplace_mode:
            data.workplace_mode = mode_fallback
            data.workplace_type = mode_fallback

        dur_info = extract_duration_and_dates(data.description)
        data.duration = dur_info.get("duration")
        data.period = dur_info.get("period")
        data.start_date = dur_info.get("start_date")
        data.end_date = dur_info.get("end_date")
        data.working_hours = dur_info.get("working_hours")

        opts = extract_options_details(data.description)
        data.has_paid_option = opts["has_paid_option"]
        data.has_unpaid_option = opts["has_unpaid_option"]
        data.paid_option_details = opts["paid_option_details"]
        data.unpaid_option_details = opts["unpaid_option_details"]

        # Financial extraction
        fin_items = extract_financial_items(data.description)
        data.financial_items = fin_items
        data.compensation = extract_structured_compensation(data.description, fin_items)
        data.candidate_fees = extract_candidate_fee_details(data.description, fin_items)

        for item in fin_items:
            if item.payment_direction == "candidate_to_employer" and item.mandatory_status in ("mandatory", "conditional"):
                if item.financial_type == "registration_fee" and not data.registration_fee:
                    data.registration_fee = item.amount
                    data.payment_direction = "candidate_to_employer"
                    data.payment_timing = item.payment_timing
                    data.payment_mandatory = "mandatory"
                elif item.financial_type == "training_fee" and not data.training_fee:
                    data.training_fee = item.amount
                    data.payment_direction = "candidate_to_employer"
                    data.payment_timing = item.payment_timing
                elif item.financial_type == "security_deposit" and not data.security_deposit:
                    data.security_deposit = item.amount
                    data.payment_direction = "candidate_to_employer"
                    data.payment_timing = item.payment_timing
            elif item.payment_direction == "employer_to_candidate":
                if item.financial_type == "stipend" and not data.stipend:
                    data.stipend = item.amount
                elif item.financial_type in ("salary", "hourly_wage") and not data.salary:
                    data.salary = item.amount

    # Classify content type
    cat, is_job, role = classify_content(data.description or data.job_title or "", "formal_job_listing")
    data.content_type = cat

    return data
