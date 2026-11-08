import pytest
import asyncio
from app.schemas.job import JobData, AnalyzeTextRequest
from app.detector.engine import score_job_posting
from app.main import analyze_text_endpoint

ZOETIS_POSTING_WITH_AUTH_BOILERPLATE = """Join or sign in to find your next job
Join to apply for the Intern- Zoetis Tech & Digital role at Zoetis
Email or phone Password Show Forgot password?

Zoetis India Capability Center (ZICC) in Hyderabad.

Title: Intern- Zoetis Tech & Digital.

Location: Hyderabad.

Duration: 6 months (Jan 2027–Jun 2027).

Mode of Working: In-office.

Required Skills & Qualifications: Pursuing B.Tech (4th Year, 2nd Semester) in Computer Science, IT, or related field. Strong understanding of any programming language and OOP concepts. Basic knowledge of SDLC methodologies. Familiarity with databases and version control tools. Good problem-solving and communication skills."""

def test_zoetis_regression_case():
    """
    SECTION 10: ZOETIS REGRESSION CASE
    Tests full extraction, login boilerplate stripping, missing compensation handling,
    proportionate recommendations, and ML statistical warning explanation.
    """
    req = AnalyzeTextRequest(text=ZOETIS_POSTING_WITH_AUTH_BOILERPLATE)
    result = asyncio.run(analyze_text_endpoint(req))

    # 1. Job title: Intern – Zoetis Tech & Digital
    assert result.job_data.job_title is not None
    assert "Intern" in result.job_data.job_title
    assert "Zoetis" in result.job_data.job_title
    assert "Join or sign in" not in result.job_data.job_title

    # 2. Company: Zoetis
    assert result.job_data.company_name == "Zoetis"

    # 3. Location: Hyderabad
    assert result.job_data.location is not None
    assert "Hyderabad" in result.job_data.location

    # 4. Workplace mode: In-office
    assert result.job_data.workplace_mode == "In-office"

    # 5. Employment type: Internship
    assert result.job_data.employment_type == "Internship"

    # 6. Duration: 6 months
    assert result.job_data.duration is not None
    assert "6" in result.job_data.duration and "month" in result.job_data.duration

    # 7. Period: January 2027 – June 2027
    assert result.job_data.period is not None
    assert "January 2027" in result.job_data.period
    assert "June 2027" in result.job_data.period

    # 8. Salary or stipend: Not mentioned in supplied description (NEVER default to 'Paid by employer')
    assert result.job_data.salary is None
    assert result.job_data.stipend is None
    if result.job_data.compensation:
        assert result.job_data.compensation.type in (None, "none_mentioned")
        assert result.job_data.compensation.amount_display == "Not mentioned in the posting"

    # 9. Candidate-paid fees: No fee identified
    assert result.job_data.registration_fee is None
    assert result.job_data.training_fee is None
    assert result.job_data.security_deposit is None
    assert result.is_payment_warning is False
    assert not any(m.rule_id == "RULE_A_PAYMENT_REQUIRED" for m in result.matched_indicators)

    # 10. Login boilerplate excluded from normalized job description
    assert "Join or sign in to find your next job" not in result.job_data.description
    assert "Email or phone Password" not in result.job_data.description
    assert "Required Skills & Qualifications" in result.job_data.description

    # 11. Model elevated prediction is retained without suppressing, but rule score is 0
    assert result.rule_analysis.risk_score == 0
    assert len(result.matched_indicators) == 0

    # 12. Recommendations are proportionate to Zoetis context
    combined_recs = " ".join(result.recommendations)
    assert "Zoetis" in combined_recs or "careers website" in combined_recs
    assert "verify" in combined_recs.lower()
    assert "fee" not in [m.rule_id for m in result.matched_indicators]

