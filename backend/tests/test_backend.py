import pytest
from app.schemas.job import JobData
from app.detector.engine import score_job_posting
from app.detector.classifier import classify_content
from app.security.ssrf import validate_url_security

# FIXTURE A: Legitimate internship
def test_legitimate_internship():
    text = """We are hiring a Frontend Engineering Intern at TechCorp.
Responsibilities:
- Build responsive, interactive web components in React and TypeScript.
- Collaborate with product designers and backend engineers.
Qualifications:
- Basic proficiency with HTML, CSS, JavaScript.
- Currently pursuing a degree in Computer Science or related discipline.
To apply, submit your resume through our careers portal at https://techcorp.example.com/careers."""
    
    cat, is_job, role = classify_content(text, "internship_post")
    assert is_job is True
    assert cat == "internship_post"

    job = JobData(
        job_title="Frontend Engineering Intern",
        company_name="TechCorp",
        company_website="https://techcorp.example.com",
        description=text,
        platform="linkedin",
        content_type=cat
    )
    result = score_job_posting(job)
    assert result.rule_analysis.risk_score == 0
    assert result.is_payment_warning is False
    assert len(result.matched_indicators) == 0

# FIXTURE B: Internship requiring payment
def test_internship_with_registration_fee():
    text = """HR Intern recruitment opportunity.
We are looking for freshers. Paid internship opportunity.
Duration: 3 Months.
Registration Fee: ₹199/-
The registration fee is mandatory to secure your orientation seat.
Send your resume to apply."""

    cat, is_job, role = classify_content(text, "linkedin-feed-post")
    assert is_job is True

    job = JobData(
        job_title="HR Intern",
        company_name="Campus Placement Partners",
        description=text,
        platform="linkedin",
        content_type=cat
    )
    result = score_job_posting(job)
    assert result.is_payment_warning is True
    assert result.risk_score >= 40
    rule_ids = [m.rule_id for m in result.matched_indicators]
    assert "RULE_A_PAYMENT_REQUIRED" in rule_ids
    indicator = next(m for m in result.matched_indicators if m.rule_id == "RULE_A_PAYMENT_REQUIRED")
    assert "199" in indicator.evidence

# FIXTURE C: Suspicious remote job
def test_suspicious_remote_job():
    text = """Work from home data entry job!
Earn ₹50,000 per month for simple 2 hours typing work. No experience needed.
Refundable security deposit of ₹2,000 required before orientation.
Contact hr exclusively via WhatsApp at +91-9876543210 to apply now."""

    job = JobData(
        job_title="Data Entry Clerk",
        description=text,
        platform="linkedin",
        content_type="job_hiring_post"
    )
    result = score_job_posting(job)
    assert result.risk_score >= 60
    assert result.risk_category == "Critical Risk"
    rule_ids = [m.rule_id for m in result.matched_indicators]
    assert "RULE_A_PAYMENT_REQUIRED" in rule_ids
    assert "RULE_B_EXCLUSIVE_MESSAGING" in rule_ids
    assert "RULE_E_IMPLAUSIBLE_COMPENSATION" in rule_ids
    assert len(rule_ids) == len(set(rule_ids)) # No duplicate rule IDs
    assert result.risk_score <= 100 # Capped

# FIXTURE D: Company hiring announcement
def test_company_hiring_announcement():
    text = """Acme Analytics is hiring!
We are expanding our data team in Bangalore.
Role: Junior Data Analyst
Responsibilities:
- Build SQL queries and maintain automated dashboard pipelines in Metabase.
- Work with senior engineers on ETL workflows.
Send your resume and GitHub profile to jobs@acmeanalytics.com."""

    cat, is_job, role = classify_content(text, "linkedin-feed-post")
    assert is_job is True
    assert cat in ("hiring_post", "job_hiring_post")

    job = JobData(
        job_title=role or "Junior Data Analyst",
        company_name="Acme Analytics",
        description=text,
        platform="linkedin",
        content_type=cat
    )
    result = score_job_posting(job)
    assert result.rule_analysis.risk_score == 0
    assert result.is_payment_warning is False

# FIXTURE E: Individual recruiter post
def test_individual_recruiter_post():
    text = """I am hiring Software Engineers for my client in Hyderabad.
Position: Backend Developer (Node.js & Go)
Experience: 2–4 years
Looking for engineers with strong microservices background.
DM me your resume or email it to recruiter@talentconsulting.com."""

    cat, is_job, role = classify_content(text, "linkedin-feed-post")
    assert is_job is True
    assert "Backend Developer" in role or "Software Engineer" in role

# FIXTURE F: Unrelated LinkedIn discussion
def test_unrelated_linkedin_discussion():
    text = """The current job market in tech is undergoing massive shifts.
Many professionals are wondering how AI will impact job stability over the next decade.
In my opinion, continuous upskilling and learning domain fundamentals remains the best career advice.
What are your thoughts on this trend? Let's discuss in the comments below."""

    cat, is_job, role = classify_content(text, "linkedin-feed-post")
    assert is_job is False
    assert cat == "unrelated_content"

# FIXTURE G: Negated payment statement
def test_negated_payment_statement():
    text = """We are hiring customer support specialists.
Please note: No registration fee or payment is required to apply.
We never ask for deposits or fees from candidates.
Apply directly at our verified portal: https://legitcorp.example.com/apply."""

    job = JobData(
        job_title="Customer Support Specialist",
        company_name="LegitCorp",
        company_website="https://legitcorp.example.com",
        description=text,
        platform="linkedin",
        content_type="job_listing"
    )
    result = score_job_posting(job)
    assert result.is_payment_warning is False
    rule_ids = [m.rule_id for m in result.matched_indicators]
    assert "RULE_A_PAYMENT_REQUIRED" not in rule_ids
    assert result.rule_analysis.risk_score == 0

# FIXTURE H: SSRF Security Tests
def test_ssrf_blocking():
    # Loopback
    safe, err = validate_url_security("http://127.0.0.1/admin")
    assert safe is False
    # Localhost
    safe, err = validate_url_security("http://localhost:8000/api")
    assert safe is False
    # AWS Metadata
    safe, err = validate_url_security("http://169.254.169.254/latest/meta-data/")
    assert safe is False
    # Non-HTTP
    safe, err = validate_url_security("file:///etc/passwd")
    assert safe is False
    # Legitimate public URL
    safe, err = validate_url_security("https://www.linkedin.com/jobs/view/1234567890/")
    assert safe is True
