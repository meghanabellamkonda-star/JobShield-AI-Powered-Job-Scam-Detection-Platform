import re
from typing import Dict, Any, Tuple

# Categories:
# formal_job_listing
# hiring_post
# internship_post
# recruiter_announcement
# company_careers_page
# unrelated_content
# insufficient_data

HIRING_PATTERNS = [
    (re.compile(r"\b(?:we\s*are\s*hiring|is\s+hiring|are\s+hiring|hiring\s+now|urgent(?:ly)?\s+hiring|actively\s+hiring|immediate\s+hiring)\b", re.I), 3),
    (re.compile(r"\b(?:expanding\s+(?:our\s+)?(?:team|operations)|growing\s+our\s+team)\b", re.I), 2),
    (re.compile(r"\b(?:hiring\s+(?:for|hr|freshers?|interns?|developers?|engineers?|designers?|graduates?|candidates?|data\s*entry|telecallers?|freelance|remote))\b", re.I), 3),
    (re.compile(r"\b(?:looking\s+for\s+(?:[a-zA-Z\s]{0,25})?(?:candidates|freshers|interns?|graduates?|developers?|engineers?|designers?|freelancers?|students?|applicants?|talent)|join\s+our\s+team)\b", re.I), 3),
    (re.compile(r"\b(?:job\s+opportunity|career\s+opportunity|placement\s+opportunity|internship\s+opportunity|internship\s+program|internship\s+announcement|engineering\s+internship|summer\s+(?:20\d\d\s+)?internship)\b", re.I), 3),
    (re.compile(r"\b(?:multiple\s+vacancies|vacanc(?:y|ies)|openings?|now\s+hiring|recruitment\s+drive|walk-?in\s+interviews?)\b", re.I), 3),
    (re.compile(r"\b(?:we['’]re\s+looking\s+for|open\s+position|opening\s+for|we\s+have\s+(?:an?\s+)?opening)\b", re.I), 2),
    # Additional structural hiring patterns
    (re.compile(r"\b(?:join\s+our\s+\d+[\s-]day|internship\s+details|job\s+details)\b", re.I), 3),
    (re.compile(r"\b(?:eligibility\s*:|qualifications?\s*:|required\s*skills|responsibilities\s*:)\b", re.I), 3),
    (re.compile(r"\b(?:title\s*:\s*(?:intern|engineer|developer|analyst|manager|specialist|associate))\b", re.I), 3),
    (re.compile(r"\b(?:stipend\s*:|salary\s*:|registration\s*fee\s*:)\b", re.I), 3)
]

APPLICATION_PATTERNS = [
    (re.compile(r"\b(?:apply\s+now|apply\s+here|how\s+to\s+apply|click\s+(?:here\s+)?to\s+apply|interested\s+(?:candidates\s+)?can\s+apply)\b", re.I), 3),
    (re.compile(r"\b(?:send\s+(?:your\s+)?(?:cv|resume|portfolio|github|profile)|share\s+(?:your\s+)?(?:cv|resume|portfolio)|submit\s+(?:your\s+)?(?:cv|resume|portfolio)|mail\s+(?:your\s+)?(?:cv|resume|portfolio)|forward\s+(?:your\s+)?(?:cv|resume))\b", re.I), 3),
    (re.compile(r"\b(?:dm\s+(?:me|us)|contact\s+recruiter|whatsapp\s+us|dm\s+to\s+apply|message\s+me\s+to\s+apply)\b", re.I), 3),
    (re.compile(r"\b(?:fill\s+(?:out\s+)?(?:this\s+)?(?:google\s+)?form|link\s+in\s+bio|comment\s+[\"']?interested[\"']?|apply\s+using\s+the\s+advertised)\b", re.I), 3),
    (re.compile(r"\b(?:email\s+(?:your\s+)?(?:profile|application|details)\s+to)\b", re.I), 3),
    (re.compile(r"\b(?:to\s*apply\s*[,:]|how\s*to\s*register)\b", re.I), 2)
]

NON_JOB_DISQUALIFIERS = [
    (re.compile(r"\b(?:i\s+am\s+(?:looking|seeking)\s+for\s+(?:a\s+)?(?:job|opportunity|internship)|open\s+to\s+work|please\s+refer\s+me|help\s+me\s+find\s+a\s+job)\b", re.I), 6),
    (re.compile(r"\b(?:happy\s+to\s+share\s+that\s+i\s+(?:have\s+)?joined|thrilled\s+to\s+announce\s+that\s+i|started\s+a\s+new\s+position\s+at|congratulations\s+to|celebrating\s+my\s+new\s+job)\b", re.I), 5),
    (re.compile(r"\b(?:the\s+job\s+market\s+is|thoughts\s+on\s+the\s+hiring\s+process|why\s+is\s+hiring\s+so\s+broken|in\s+my\s+experience\s+with\s+interviews|career\s+advice|upskilling)\b", re.I), 4)
]

def classify_content(text: str, page_context: str = "") -> Tuple[str, bool, str]:
    """
    Classifies input text into a content_type category.
    Returns: (category, is_job_related, role_title)
    """
    clean = (text or "").strip()
    if not clean or len(clean) < 20:
        if "job" in page_context.lower() and len(clean) > 5:
            return "formal_job_listing", True, "Job Listing"
        return "insufficient_data", False, ""

    is_formal_context = page_context in ("linkedin-job-listing", "indeed-job-listing", "job-detail", "formal_job_listing")
    lower = clean.lower()

    # Structural job elements check (handles postings like Zoetis that have structured specifications)
    has_title_header = bool(re.search(r"\b(?:title|role|position)\s*:\s*[^\n\r]+", clean, re.I))
    has_location_header = bool(re.search(r"\b(?:location|mode\s*of\s*working|mode)\s*:\s*[^\n\r]+", clean, re.I))
    has_duration_header = bool(re.search(r"\b(?:duration|working\s*hours)\s*:\s*[^\n\r]+", clean, re.I))
    has_skills_header = bool(re.search(r"\b(?:required\s*skills|qualifications?|responsibilities|eligibility)\s*:\s*", clean, re.I))
    has_financial_header = bool(re.search(r"\b(?:stipend|salary|registration\s*fee|training\s*fee)\s*:\s*", clean, re.I))

    structured_score = sum([has_title_header, has_location_header, has_duration_header, has_skills_header, has_financial_header])

    # Calculate hiring signals
    hiring_score = sum(weight for pat, weight in HIRING_PATTERNS if pat.search(clean))
    app_score = sum(weight for pat, weight in APPLICATION_PATTERNS if pat.search(clean))
    penalty_score = sum(penalty for pat, penalty in NON_JOB_DISQUALIFIERS if pat.search(clean))

    if app_score >= 3 or hiring_score >= 3 or structured_score >= 2:
        penalty_score = max(0, penalty_score - 4)

    total_score = hiring_score + app_score + (structured_score * 2) - penalty_score
    if is_formal_context:
        total_score += 5

    is_internship = bool(re.search(r"\b(intern|internship|trainee|apprentice)\b", clean, re.I))

    # Threshold determination
    is_job_related = (
        (is_formal_context and total_score >= 2) or
        (structured_score >= 2) or
        (hiring_score >= 3 and app_score >= 3) or
        (hiring_score >= 3 and is_internship) or
        (app_score >= 3 and is_internship) or
        (total_score >= 4 and penalty_score < 4) or
        (is_internship and (has_location_header or has_duration_header or has_title_header))
    )

    if not is_job_related:
        return "unrelated_content", False, ""

    # Extract role title if available
    role_title = ""
    role_matches = [
        re.compile(r"(?:title|role|position|profile)\s*:\s*([^\n\r,]{3,60})", re.I),
        re.compile(r"(?:hiring\s+now\s*[|\-–:]\s*)([a-zA-Z0-9\s/–-]+(?:internship|opportunity|developer|engineer|intern|trainee|associate|specialist|manager|executive))", re.I),
        re.compile(r"(?:opportunity\s*[–\-]\s*)([A-Za-z0-9\s/–-]+(?:internship|opportunity|developer|engineer|intern|trainee))", re.I),
        re.compile(r"([A-Za-z0-9\s/–-]+(?:internship|developer|engineer|intern|trainee))\s*opportunity", re.I),
        re.compile(r"(?:hiring\s+(?:for\s+)?)([a-zA-Z0-9\s/–-]+(?:internship|opportunity|developer|engineer|intern|trainee|associate|specialist|manager|executive))", re.I),
        re.compile(r"(?:we(?:'re|\s+are)\s+hiring\s+)([a-zA-Z0-9\s/–-]+(?:internship|opportunity|developer|engineer|intern|trainee|associate|specialist|manager|executive))", re.I)
    ]
    for r in role_matches:
        m = r.search(clean)
        if m and m.group(1):
            cand = m.group(1).strip().rstrip("|:–-").strip()
            # Avoid picking navigation strings
            if not re.search(r"\b(sign\s*in|join\s*to\s*apply|find\s*your\s*next\s*job)\b", cand, re.I):
                role_title = cand
                break

    if is_formal_context:
        category = "formal_job_listing"
    elif is_internship:
        category = "internship_post"
    elif re.search(r"\b(recruiter|talent\s*acquisition|hiring\s*for\s*my\s*client)\b", clean, re.I):
        category = "recruiter_announcement"
    elif re.search(r"\b(careers?|apply\s*on\s*our\s*site|portal)\b", clean, re.I):
        category = "company_careers_page"
    else:
        category = "hiring_post"

    return category, True, role_title
