import pytest
import asyncio
from app.schemas.job import JobData, AnalyzeTextRequest
from app.detector.engine import score_job_posting
from app.main import analyze_text_endpoint

COOK_N_KLEAN_POSTING = """HIRING NOW | HR PAID INTERNSHIP OPPORTUNITY
Cook N Klean is looking for enthusiastic and motivated HR Interns who want to gain practical experience in Recruitment & Human Resource Management!
INTERNSHIP DETAILS
Duration: 45 Days
Working Hours: 2–3 Hours/Day | Flexible Hours
Working Days: Monday–Saturday | Sunday Off
Mode: Remote / Work From Home
Stipend: 600–6000+ (performance based)
Training: Training will be provided before the internship begins
Registration Fee: ₹199/-
Registration fee is payable only after the orientation session.
Responsibilities include sourcing and screening candidates, drafting job descriptions, scheduling interviews, and maintaining records.
Certificates and learning perks are offered.
Eligible candidates include college students and recent graduates.
Apply by sending a résumé to rifahashmi710@gmail.com."""

COOK_N_KLEAN_SECTION_9_POSTING = """HR Internship Opportunity – Cook N Klean

Join our 45-day remote HR Internship and gain practical experience in recruitment, candidate screening, job posting, interview coordination, and LinkedIn profile optimization.

Mode: Remote / Work From Home.

Working Hours: 3–4 hours/day.

Paid Option: ₹199 registration fee (payable on Orientation Day) with a performance-based stipend of ₹600–₹6,000+.

Unpaid Option: No registration fee and no stipend.

Learning benefits include practical HR experience, certificates, a letter of recommendation subject to applicable criteria, résumé-building, professional communication skills, and LinkedIn profile optimization.

Eligibility: College students and fresh graduates; HR background preferred.

Apply using the advertised Google Form."""

def test_cook_n_klean_regression_hybrid():
    """
    REQUIRED REGRESSION CASE: COOK N KLEAN INTERNSHIP
    Tests end-to-end extraction, fee isolation, rule matching,
    hybrid scoring with pretrained model, and minimum floor safeguard.
    """
    job = JobData(
        job_title="HR Intern",
        company_name="Cook N Klean",
        description=COOK_N_KLEAN_POSTING,
        platform="pasted_text"
    )

    result = score_job_posting(job, include_ml=True)

    # 1. Registration fee extracted separately from stipend
    assert result.job_data.registration_fee is not None
    assert "199" in result.job_data.registration_fee
    assert result.job_data.payment_direction == "candidate_to_employer"
    assert result.job_data.payment_timing == "after_orientation"

    # 2. Stipend isolated
    assert result.job_data.stipend is not None or any(item.financial_type == "stipend" for item in result.financial_items)
    assert not (result.job_data.stipend and "199" in result.job_data.stipend)

    # 3. Rule matching: Must match candidate fee rule with verbatim evidence
    rule_ids = [m.rule_id for m in result.matched_indicators]
    assert "RULE_A_PAYMENT_REQUIRED" in rule_ids
    rule_a = next(m for m in result.matched_indicators if m.rule_id == "RULE_A_PAYMENT_REQUIRED")
    assert "199" in rule_a.evidence or "Registration Fee" in rule_a.evidence
    assert result.is_payment_warning is True

    # 4. Hybrid score and safeguard:
    assert result.risk_score >= 40
    assert result.risk_category in ("High Risk", "Critical Risk")
    assert result.risk_level in ("high", "critical")

    # 5. Hybrid metadata present
    if result.analysis_mode == "hybrid":
        assert result.ml_analysis.available is True
        assert result.ml_analysis.risk_score is not None

def test_cook_n_klean_rule_only_fallback():
    """Tests Cook N Klean evaluation when ML analysis is disabled/unavailable."""
    job = JobData(
        job_title="HR Intern",
        company_name="Cook N Klean",
        description=COOK_N_KLEAN_POSTING,
        platform="pasted_text"
    )

    result = score_job_posting(job, include_ml=False)

    assert result.analysis_mode == "rule_only"
    assert result.risk_score >= 40
    assert result.is_payment_warning is True
    assert "RULE_A_PAYMENT_REQUIRED" in [m.rule_id for m in result.matched_indicators]

def test_cook_n_klean_section_9_comprehensive():
    """
    SECTION 9 COMPREHENSIVE REGRESSION:
    Tests the 17 specific expected behaviors on the actual Cook N Klean posting.
    """
    req = AnalyzeTextRequest(text=COOK_N_KLEAN_SECTION_9_POSTING)
    result = asyncio.run(analyze_text_endpoint(req))

    # 1. Extract Cook N Klean as the stated employer
    assert result.job_data.company_name == "Cook N Klean"

    # 2. Extract HR Intern as the role
    assert "HR Intern" in (result.job_data.job_title or "")

    # 3. Extract remote work
    assert "Remote" in (result.job_data.workplace_mode or "") or "Remote" in (result.job_data.location or "")

    # 4. Extract the 45-day duration
    assert result.job_data.duration is not None
    assert "45" in result.job_data.duration and "day" in result.job_data.duration

    # 5. Extract the working-hours statement
    assert result.job_data.working_hours is not None
    assert "3" in result.job_data.working_hours and "4" in result.job_data.working_hours

    # 6. Extract the paid and unpaid options separately
    assert result.job_data.has_paid_option is True
    assert result.job_data.has_unpaid_option is True
    assert result.job_data.paid_option_details is not None
    assert result.job_data.unpaid_option_details is not None
    assert "199" in result.job_data.paid_option_details
    assert "no registration fee" in result.job_data.unpaid_option_details.lower()

    # 7. Extract the ₹199 registration fee
    assert result.job_data.registration_fee is not None
    assert "199" in result.job_data.registration_fee

    # 8. Identify that the fee applies to the paid option
    paid_fee_items = [
        item for item in result.job_data.financial_items
        if item.payment_direction == "candidate_to_employer" and "199" in item.amount
    ]
    assert len(paid_fee_items) >= 1
    assert paid_fee_items[0].option_name == "Paid internship" or paid_fee_items[0].mandatory_for_option is True

    # 9. Extract the ₹600–₹6,000+ performance-based stipend
    assert result.job_data.stipend is not None or (result.job_data.compensation and result.job_data.compensation.amount_display)
    stipend_str = result.job_data.stipend or result.job_data.compensation.amount_display
    assert "600" in stipend_str and "6,000" in stipend_str

    # 10. Do not invent a payment frequency
    if result.job_data.compensation:
        assert result.job_data.compensation.frequency in (None, "Not specified")

    # 11. Match the candidate-paid registration-fee rule
    rule_ids = [m.rule_id for m in result.matched_indicators]
    assert "RULE_A_PAYMENT_REQUIRED" in rule_ids

    # 12. Give the fee rule the configured points (>= 40)
    rule_a = next(m for m in result.matched_indicators if m.rule_id == "RULE_A_PAYMENT_REQUIRED")
    assert rule_a.points >= 40

    # 13. Ensure the final score is at least 40/100
    assert result.risk_score >= 40

    # 14. Display High Risk under current thresholds (40–59)
    assert result.risk_category in ("High Risk", "Critical Risk")
    assert result.risk_level in ("high", "critical")

    # 15. Provide recommendations specific to the fee and alternative unpaid option
    combined_recs = " ".join(result.recommendations)
    assert "registration fee" in combined_recs.lower()
    assert "unpaid" in combined_recs.lower() or "no-fee" in combined_recs.lower()

    # 16. Never display "No suspicious indicators detected"
    assert "No strong scam indicators were identified" not in combined_recs
    assert "No suspicious indicators" not in combined_recs

    # 17. Do not declare the organization conclusively fraudulent
    assert "conclusively fraudulent" not in combined_recs.lower()
    assert "proven fraudulent" not in combined_recs.lower()
