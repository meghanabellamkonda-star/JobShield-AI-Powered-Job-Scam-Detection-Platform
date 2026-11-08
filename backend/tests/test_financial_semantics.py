import pytest
from app.schemas.job import JobData, AnalyzeTextRequest
from app.detector.engine import score_job_posting
from app.detector.classifier import classify_content
from app.extractors.financial import extract_financial_items

# ===========================================================================
# Group A: Payment Direction Tests (Never classify fee as stipend)
# ===========================================================================

def test_registration_fee_not_in_stipend():
    text = "Registration fee: ₹199 payable after orientation session. Send resume to apply."
    fin_items = extract_financial_items(text)
    assert len(fin_items) >= 1
    fee_item = next((i for i in fin_items if i.financial_type == "registration_fee"), None)
    assert fee_item is not None
    assert fee_item.amount == "₹199"
    assert fee_item.payment_direction == "candidate_to_employer"
    assert fee_item.mandatory_status == "mandatory"
    assert fee_item.payment_timing == "after_orientation"
    
    # Assert NO stipend was identified
    stipend_item = next((i for i in fin_items if i.financial_type == "stipend"), None)
    assert stipend_item is None

def test_monthly_stipend_paid_to_intern():
    text = "Monthly stipend of ₹12,000 paid to the selected intern upon joining."
    fin_items = extract_financial_items(text)
    assert len(fin_items) >= 1
    stipend_item = next((i for i in fin_items if i.financial_type == "stipend"), None)
    assert stipend_item is not None
    assert "12,000" in stipend_item.amount
    assert stipend_item.payment_direction == "employer_to_candidate"
    
    # Assert NO candidate fee was identified
    fee_item = next((i for i in fin_items if i.payment_direction == "candidate_to_employer"), None)
    assert fee_item is None

def test_registration_fee_plus_monthly_stipend():
    text = "Registration fee: ₹499. Selected interns will receive a monthly stipend of ₹10,000."
    fin_items = extract_financial_items(text)
    assert len(fin_items) == 2
    
    fee_item = next((i for i in fin_items if i.payment_direction == "candidate_to_employer"), None)
    assert fee_item is not None
    assert "499" in fee_item.amount
    assert fee_item.financial_type == "registration_fee"
    
    comp_item = next((i for i in fin_items if i.payment_direction == "employer_to_candidate"), None)
    assert comp_item is not None
    assert "10,000" in comp_item.amount
    assert comp_item.financial_type == "stipend"

def test_training_fee_plus_stipend():
    text = "Training fee ₹999 required for software package. Monthly stipend ₹8,000."
    fin_items = extract_financial_items(text)
    assert len(fin_items) == 2
    
    training_item = next((i for i in fin_items if i.financial_type == "training_fee"), None)
    assert training_item is not None
    assert "999" in training_item.amount
    assert training_item.payment_direction == "candidate_to_employer"

    comp_item = next((i for i in fin_items if i.financial_type == "stipend"), None)
    assert comp_item is not None
    assert "8,000" in comp_item.amount
    assert comp_item.payment_direction == "employer_to_candidate"

def test_refundable_security_deposit_plus_stipend():
    text = "₹499 refundable security deposit required before joining, followed by a monthly stipend of ₹10,000."
    fin_items = extract_financial_items(text)
    assert len(fin_items) == 2
    
    dep_item = next((i for i in fin_items if i.financial_type == "security_deposit"), None)
    assert dep_item is not None
    assert dep_item.refundability == "refundable"
    assert dep_item.payment_direction == "candidate_to_employer"

    comp_item = next((i for i in fin_items if i.financial_type == "stipend"), None)
    assert comp_item is not None
    assert "10,000" in comp_item.amount

# ===========================================================================
# Group B: Semantic Variations in Fee Terminology
# ===========================================================================

def test_semantic_fee_variations():
    variations = [
        "A one-time registration charges of ₹250 applies.",
        "Enrollment fee of ₹500 is payable before joining.",
        "Candidate must purchase mandatory training of ₹1,200 to start.",
        "Processing charges of ₹300 are payable after orientation.",
        "Caution deposit of ₹1,000 required to confirm seat."
    ]
    for text in variations:
        job = JobData(description=text, platform="pasted_text")
        result = score_job_posting(job)
        assert result.risk_score >= 35, f"Failed on: {text}"
        assert result.is_payment_warning is True

# ===========================================================================
# Group C: Negation & Context Handling
# ===========================================================================

def test_no_registration_fee_required():
    text = "No registration fee is required to apply for this software engineer position. Stipend is ₹15,000."
    job = JobData(description=text, platform="pasted_text")
    result = score_job_posting(job)
    assert result.is_payment_warning is False
    assert not any(m.rule_id == "RULE_A_PAYMENT_REQUIRED" for m in result.matched_indicators)

def test_beware_of_scams_warning_clause():
    text = "Beware of scams asking applicants to pay registration fees. We never charge any money."
    job = JobData(description=text, platform="pasted_text")
    result = score_job_posting(job)
    assert result.is_payment_warning is False
    assert not any(m.rule_id == "RULE_A_PAYMENT_REQUIRED" for m in result.matched_indicators)

def test_training_free_but_security_deposit_required():
    text = "Training is free, but a ₹499 security deposit is required before joining."
    job = JobData(description=text, platform="pasted_text")
    result = score_job_posting(job)
    # The deposit must still trigger Rule A!
    assert result.is_payment_warning is True
    assert any(m.rule_id == "RULE_A_PAYMENT_REQUIRED" for m in result.matched_indicators)

def test_reimbursed_training_not_flagged():
    text = "The employer reimburses the candidate's training costs up to ₹5,000 upon successful completion."
    job = JobData(description=text, platform="pasted_text")
    result = score_job_posting(job)
    assert not any(m.rule_id in ("RULE_A_PAYMENT_REQUIRED", "RULE_A2_MANDATORY_TRAINING_FEE") for m in result.matched_indicators)

def test_repeated_fee_does_not_multiply_score():
    text = """Registration fee: ₹199 payable after orientation.
    Please note that the registration fee of ₹199 must be paid via UPI.
    All candidates must pay the ₹199 fee."""
    job = JobData(description=text, platform="pasted_text")
    result = score_job_posting(job)
    # Rule A must trigger exactly ONCE (+40)
    rule_a_matches = [m for m in result.matched_indicators if m.rule_id == "RULE_A_PAYMENT_REQUIRED"]
    assert len(rule_a_matches) == 1
    assert result.rule_analysis.risk_score == 40
    assert result.risk_score >= 40
