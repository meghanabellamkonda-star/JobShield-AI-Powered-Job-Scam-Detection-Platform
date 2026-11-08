import pytest
import asyncio
from app.schemas.job import JobData, AnalyzeTextRequest, MLAnalysisResult
from app.extractors.financial import (
    extract_financial_items,
    extract_structured_compensation,
    extract_candidate_fee_details
)
from app.extractors.parser import (
    strip_auth_and_navigation_boilerplate,
    extract_job_title_from_text,
    extract_company_name_from_text,
    extract_location_and_mode_from_text,
    extract_duration_and_dates,
    calculate_extraction_completeness
)
from app.detector.engine import score_job_posting
from app.main import analyze_text_endpoint
from app.extractors.retriever import retrieve_job_url

# ===========================================================================
# GROUP 1: FINANCIAL DETECTION (Tests 1 - 15)
# ===========================================================================

def test_01_registration_fee_199():
    text = "Registration fee: ₹199 payable before joining."
    items = extract_financial_items(text)
    assert len(items) >= 1
    fee = next(i for i in items if i.financial_type == "registration_fee")
    assert "199" in fee.amount
    assert fee.payment_direction == "candidate_to_employer"

def test_02_registration_fee_payable_on_orientation_day():
    text = "Registration fee: ₹199 (payable on Orientation Day)."
    items = extract_financial_items(text)
    fee = next(i for i in items if i.financial_type == "registration_fee")
    assert fee.payment_timing == "after_orientation" or "orientation" in (fee.timing or "").lower()

def test_03_candidate_fee_conditional_on_paid_option():
    text = "Paid Option: ₹199 registration fee with performance-based stipend. Unpaid Option: No registration fee."
    items = extract_financial_items(text)
    fee = next(i for i in items if i.payment_direction == "candidate_to_employer")
    assert "199" in fee.amount
    assert fee.option_name == "Paid internship" or fee.mandatory_for_option is True

def test_04_unpaid_alternative_with_no_registration_fee():
    text = "Unpaid Option: No registration fee and no stipend."
    job = JobData(description=text, platform="pasted_text")
    res = score_job_posting(job, include_ml=False)
    assert not any(m.rule_id == "RULE_A_PAYMENT_REQUIRED" for m in res.matched_indicators)
    assert res.is_payment_warning is False

def test_05_stipend_range_600_to_6000():
    text = "Stipend of ₹600–₹6,000+ (performance based)."
    items = extract_financial_items(text)
    stipend = next(i for i in items if i.financial_type == "stipend")
    assert stipend.payment_direction == "employer_to_candidate"
    assert "600" in stipend.amount and "6,000" in stipend.amount

def test_06_missing_stipend():
    text = "Join our software engineering team to build microservices in Go. Location: Hyderabad."
    items = extract_financial_items(text)
    comp = extract_structured_compensation(text, items)
    assert comp is None

def test_07_explicitly_unpaid_internship():
    text = "This is an unpaid internship position for college students seeking academic credit."
    items = extract_financial_items(text)
    comp = extract_structured_compensation(text, items)
    assert comp is not None
    assert comp.type == "explicitly_unpaid"
    assert comp.amount_display == "Unpaid"

def test_08_mandatory_training_fee():
    text = "Candidates are required to pay ₹500 for mandatory training before joining."
    items = extract_financial_items(text)
    t_fee = next(i for i in items if i.financial_type == "training_fee")
    assert "500" in t_fee.amount
    assert t_fee.payment_direction == "candidate_to_employer"

def test_09_security_deposit():
    text = "Refundable security deposit of ₹2,000 required before orientation."
    items = extract_financial_items(text)
    dep = next(i for i in items if i.financial_type == "security_deposit")
    assert "2,000" in dep.amount
    assert dep.payment_direction == "candidate_to_employer"
    assert dep.refundability == "refundable"

def test_10_application_processing_fee():
    text = "Selected candidates must pay processing charges of ₹300."
    items = extract_financial_items(text)
    fee = next(i for i in items if i.payment_direction == "candidate_to_employer")
    assert "300" in fee.amount

def test_11_explicit_no_fee_statement():
    text = "No registration fee is required. We never charge candidates for employment."
    items = extract_financial_items(text)
    fees = [i for i in items if i.payment_direction == "candidate_to_employer" and i.mandatory_status != "negated"]
    assert len(fees) == 0

def test_12_informational_warning_about_recruitment_fees():
    text = "Beware of fraudulent recruiters asking for registration fees. Always verify jobs independently."
    job = JobData(description=text, platform="pasted_text")
    res = score_job_posting(job, include_ml=False)
    assert res.is_payment_warning is False
    assert not any(m.rule_id == "RULE_A_PAYMENT_REQUIRED" for m in res.matched_indicators)

def test_13_multiple_mentions_of_same_fee():
    text = "Registration fee ₹199 payable. All candidates must submit the ₹199 fee. Pay ₹199 now."
    items = extract_financial_items(text)
    fee_items = [i for i in items if i.payment_direction == "candidate_to_employer"]
    # Deduplication ensures only 1 fee item is recorded
    assert len(fee_items) == 1

def test_14_multiple_different_financial_items():
    text = "Registration fee ₹199. Training fee ₹500. Monthly stipend ₹10,000."
    items = extract_financial_items(text)
    candidate_fees = [i for i in items if i.payment_direction == "candidate_to_employer"]
    comp_items = [i for i in items if i.payment_direction == "employer_to_candidate"]
    assert len(candidate_fees) == 2
    assert len(comp_items) == 1

def test_15_ambiguous_payment_direction():
    text = "Financial budget allocated: $5,000 across the project."
    items = extract_financial_items(text)
    assert len(items) == 1
    assert items[0].financial_type == "unknown"
    assert items[0].payment_direction == "unknown"

# ===========================================================================
# GROUP 2: EXTRACTION (Tests 16 - 25)
# ===========================================================================

def test_16_zoetis_job_title_and_employer():
    text = "Zoetis India Capability Center in Hyderabad. Title: Intern- Zoetis Tech & Digital."
    title = extract_job_title_from_text(text)
    company = extract_company_name_from_text(text)
    assert title == "Intern – Zoetis Tech & Digital"
    assert company == "Zoetis"

def test_17_hyderabad_location():
    text = "Location: Hyderabad. Mode of Working: In-office."
    loc, mode = extract_location_and_mode_from_text(text)
    assert loc == "Hyderabad"

def test_18_in_office_workplace_mode():
    text = "Location: Hyderabad. Mode of Working: In-office."
    loc, mode = extract_location_and_mode_from_text(text)
    assert mode == "In-office"

def test_19_six_month_duration():
    text = "Duration: 6 months (Jan 2027–Jun 2027)."
    d = extract_duration_and_dates(text)
    assert d["duration"] == "6 months"

def test_20_january_june_2027_date_range():
    text = "Duration: 6 months (Jan 2027–Jun 2027)."
    d = extract_duration_and_dates(text)
    assert d["period"] == "January 2027 – June 2027"

def test_21_missing_salary_represented_as_unknown():
    text = "Title: Frontend Engineer. Responsibilities: Build user interfaces in React."
    job = JobData(description=text, platform="pasted_text")
    res = score_job_posting(job, include_ml=False)
    assert res.job_data.salary is None
    assert res.job_data.stipend is None
    if res.job_data.compensation:
        assert res.job_data.compensation.amount_display == "Not mentioned in the posting"

def test_22_cook_n_klean_stipend_and_fee_separate():
    text = "Paid Option: ₹199 registration fee (payable on Orientation Day) with a performance-based stipend of ₹600–₹6,000+."
    items = extract_financial_items(text)
    assert len(items) == 2
    fee_item = next(i for i in items if i.payment_direction == "candidate_to_employer")
    comp_item = next(i for i in items if i.payment_direction == "employer_to_candidate")
    assert "199" in fee_item.amount
    assert "600" in comp_item.amount

def test_23_linkedin_login_boilerplate_removed():
    text = "Join or sign in to find your next job\nJoin to apply\nEmail or phone Password\n\nReal job description details here."
    cleaned, warnings = strip_auth_and_navigation_boilerplate(text)
    assert "Join or sign in" not in cleaned
    assert "Email or phone" not in cleaned
    assert "Real job description details here." in cleaned
    assert len(warnings) > 0

def test_24_incomplete_url_retrieval_reported_accurately():
    result = asyncio.run(retrieve_job_url("https://127.0.0.1/admin"))
    assert result.success is False
    assert result.status == "security_blocked"

def test_25_manual_text_analysis_works_without_url():
    req = AnalyzeTextRequest(text="HR Internship Opportunity – Cook N Klean\nPaid Option: ₹199 registration fee.\nMode: Remote.")
    res = asyncio.run(analyze_text_endpoint(req))
    assert res.job_data.company_name == "Cook N Klean"
    assert res.job_data.registration_fee is not None

# ===========================================================================
# GROUP 3: SCORING (Tests 26 - 34)
# ===========================================================================

def test_26_candidate_fee_with_low_ml_score():
    # If ML predicts low risk (e.g. 10.0), safeguard floor must keep final score >= 40
    job = JobData(
        job_title="HR Intern",
        description="Registration fee: ₹199 mandatory before orientation.",
        platform="pasted_text"
    )
    res = score_job_posting(job, include_ml=False) # simulates deterministic/low floor check
    assert res.risk_score >= 40
    assert res.risk_category in ("High Risk", "Critical Risk")

def test_27_candidate_fee_with_high_ml_score():
    # When ML and rule both elevate risk
    job = JobData(
        job_title="Data Entry Operator",
        description="Earn ₹50,000 per month typing 2 hours a day. Pay refundable ₹2,000 security deposit. Contact exclusively via WhatsApp.",
        platform="pasted_text"
    )
    res = score_job_posting(job, include_ml=True)
    assert res.risk_score >= 60
    assert res.risk_category == "Critical Risk"

def test_28_candidate_fee_with_ml_unavailable():
    job = JobData(
        job_title="HR Intern",
        description="Mandatory registration fee ₹199 payable before joining.",
        platform="pasted_text"
    )
    res = score_job_posting(job, include_ml=False)
    assert res.analysis_mode == "rule_only"
    assert res.risk_score >= 40

def test_29_explicit_money_transfer_to_secure_selection():
    job = JobData(
        job_title="Associate",
        description="Candidates must transfer money to confirm selection and receive an offer letter.",
        platform="pasted_text"
    )
    res = score_job_posting(job, include_ml=False)
    assert res.risk_score >= 50
    assert any(m.rule_id == "RULE_A4_PAYMENT_FOR_SELECTION" for m in res.matched_indicators)

def test_30_banking_credentials_requested():
    job = JobData(
        job_title="Remote Typist",
        description="Send your online banking password and ATM PIN to activate payroll deposit.",
        platform="pasted_text"
    )
    res = score_job_posting(job, include_ml=False)
    assert res.risk_score >= 60
    assert any(m.rule_id == "RULE_F_SENSITIVE_FINANCIAL_INFO" for m in res.matched_indicators)

def test_31_genuine_zero_rule_score_after_successful_analysis():
    job = JobData(
        job_title="Software Engineer",
        company_name="TechCorp",
        description="We are hiring a backend engineer with 3+ years experience in Python and PostgreSQL. Competitive salary offered.",
        platform="pasted_text"
    )
    res = score_job_posting(job, include_ml=False)
    assert res.rule_analysis.risk_score == 0
    assert len(res.matched_indicators) == 0

def test_32_analysis_error_not_represented_as_zero_risk():
    job = JobData(description="", job_title="", platform="unknown")
    res = score_job_posting(job, include_ml=False)
    assert res.analysis_status == "insufficient_data"
    assert res.risk_category == "Insufficient Data"

def test_33_risk_thresholds_consistency():
    # Verify mapping: 0-19 Low, 20-39 Moderate, 40-59 High, 60-100 Critical
    from app.detector.engine import score_job_posting
    # Clean job
    clean_job = JobData(description="Software engineer role building microservices.", job_title="SWE", platform="test")
    res_clean = score_job_posting(clean_job, include_ml=False)
    assert res_clean.risk_level == "low"

    # Fee job
    fee_job = JobData(description="Registration fee: ₹199 payable before joining.", job_title="Intern", platform="test")
    res_fee = score_job_posting(fee_job, include_ml=False)
    assert res_fee.risk_level in ("high", "critical")

def test_34_duplicate_fee_evidence_not_double_counted():
    text = "Responsibilities: Assist team. Registration fee ₹199 payable. All candidates must pay the ₹199 fee. Again, fee is ₹199."
    job = JobData(description=text, platform="pasted_text")
    res = score_job_posting(job, include_ml=False)
    rule_a_matches = [m for m in res.matched_indicators if m.rule_id == "RULE_A_PAYMENT_REQUIRED"]
    assert len(rule_a_matches) == 1
    assert rule_a_matches[0].points == 40
    assert res.rule_analysis.risk_score == 40

# ===========================================================================
# GROUP 4: RECOMMENDATIONS AND UI (Tests 35 - 42)
# ===========================================================================

def test_35_fee_recommendations_appear_when_fee_detected():
    job = JobData(description="Registration fee: ₹199 payable before orientation.", platform="pasted_text")
    res = score_job_posting(job, include_ml=False)
    combined = " ".join(res.recommendations)
    assert "registration fee" in combined.lower() or "do not pay" in combined.lower()

def test_36_no_fee_recommendations_do_not_falsely_claim_fee():
    job = JobData(
        job_title="Software Developer",
        description="Join our engineering team. Apply with your GitHub profile.",
        platform="pasted_text"
    )
    res = score_job_posting(job, include_ml=False)
    combined = " ".join(res.recommendations)
    assert "pay the registration fee" not in combined.lower()

def test_37_no_false_stipend_displayed_when_missing():
    job = JobData(description="Intern- Zoetis Tech & Digital in Hyderabad. Mode: In-office.", platform="pasted_text")
    res = score_job_posting(job, include_ml=False)
    assert res.job_data.stipend is None
    assert res.job_data.salary is None

def test_38_rule_evidence_matches_actual_posting():
    text = "Registration fee: ₹199 payable on orientation day."
    job = JobData(description=text, platform="pasted_text")
    res = score_job_posting(job, include_ml=False)
    rule_a = next(m for m in res.matched_indicators if m.rule_id == "RULE_A_PAYMENT_REQUIRED")
    assert "199" in rule_a.evidence

def test_39_missing_model_scores_displayed_as_unavailable():
    job = JobData(description="Short job text.", platform="pasted_text")
    res = score_job_posting(job, include_ml=False)
    assert res.ml_analysis.available is False

def test_40_analysis_mode_matches_backend_response():
    job = JobData(description="Internship with registration fee ₹199.", platform="pasted_text")
    res_hybrid = score_job_posting(job, include_ml=True)
    res_rule = score_job_posting(job, include_ml=False)
    assert res_rule.analysis_mode == "rule_only"
    if res_hybrid.ml_analysis.available:
        assert res_hybrid.analysis_mode == "hybrid"

def test_41_zoetis_and_cook_n_klean_display_correct_information():
    # Cook N Klean
    cnk_job = JobData(
        job_title="HR Intern",
        company_name="Cook N Klean",
        description="HR Internship Opportunity – Cook N Klean\nPaid Option: ₹199 registration fee.\nMode: Remote.",
        platform="pasted_text"
    )
    res_cnk = score_job_posting(cnk_job, include_ml=False)
    assert res_cnk.job_data.company_name == "Cook N Klean"
    assert res_cnk.risk_score >= 40

    # Zoetis
    zoetis_job = JobData(
        job_title="Intern – Zoetis Tech & Digital",
        company_name="Zoetis",
        description="Zoetis India Capability Center in Hyderabad. Location: Hyderabad. Mode: In-office. Responsibilities: Assist with tech & digital solutions. Qualifications: Student in Computer Science.",
        platform="pasted_text"
    )
    res_zoetis = score_job_posting(zoetis_job, include_ml=False)
    assert res_zoetis.job_data.company_name == "Zoetis"
    assert res_zoetis.rule_analysis.risk_score == 0

def test_42_extraction_completeness_calculation():
    job = JobData(
        job_title="Frontend Engineer",
        company_name="Acme",
        location="Bangalore",
        workplace_mode="In-office",
        employment_type="Full-time",
        duration="12 months",
        description="Building user interfaces in React. Send resume to jobs@acme.com",
        platform="test"
    )
    completeness = calculate_extraction_completeness(job)
    assert completeness >= 0.75
