import time
import re
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from app.schemas.job import AnalyzeUrlRequest, AnalyzeTextRequest, AnalysisResult, JobData, RiskExplanation
from app.detector.engine import score_job_posting
from app.detector.classifier import classify_content
from app.extractors.retriever import retrieve_job_url, detect_platform_from_url
from app.extractors.parser import (
    parse_html_job_page,
    clean_text,
    clean_company_name,
    strip_auth_and_navigation_boilerplate,
    extract_job_title_from_text,
    extract_company_name_from_text,
    extract_location_and_mode_from_text,
    extract_duration_and_dates,
    extract_options_details
)
from app.extractors.financial import (
    extract_financial_items,
    extract_structured_compensation,
    extract_candidate_fee_details
)
from app.storage.database import save_analysis, get_analysis_by_id, get_recent_analyses, init_db

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(
    title="JobShield - AI-Powered Job Scam Detection API",
    description="Evidence-based risk detection and analysis engine for job and internship postings.",
    version="2.0.0",
    lifespan=lifespan
)

# Enable CORS for local Vite development and production domains
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
def health_check():
    from app.detector.ml_model import get_ml_status
    ml_stat = get_ml_status()
    return {
        "status": "healthy",
        "service": "jobshield-backend",
        "timestamp": int(time.time()),
        "version": "2.0.0",
        "ml_subsystem": ml_stat
    }

@app.post("/api/analyze-url", response_model=AnalysisResult)
async def analyze_url_endpoint(request: AnalyzeUrlRequest):
    url = (request.url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="Job URL cannot be empty.")

    # Retrieve page content safely
    retrieval = await retrieve_job_url(url)
    platform = detect_platform_from_url(url)

    if not retrieval.success:
        job_data = JobData(
            original_url=url,
            platform=platform,
            content_type="inaccessible",
            description="",
            extraction_source="auto_url"
        )
        return AnalysisResult(
            platform=platform,
            content_type="inaccessible",
            original_url=url,
            job_data=job_data,
            risk_score=0,
            risk_category="Inaccessible",
            risk_level="unknown",
            analysis_mode="unsupported",
            is_payment_warning=False,
            analysis_status=retrieval.status,
            extraction_status="failed",
            extraction_completeness=0.0,
            matched_indicators=[],
            financial_items=[],
            risk_explanation=RiskExplanation(
                risk_summary="The job page could not be fully retrieved because the platform requires sign-in or verification.",
                score_cause="Automated retrieval was blocked by an authentication wall or challenge.",
                next_steps_summary="Copy the job description directly from the website and paste it into the Manual Text Analyzer.",
                unverified_info="All posting fields could not be verified automatically."
            ),
            recommendations=[
                "The job page could not be fully retrieved because LinkedIn requires sign-in. Some details may be missing.",
                "Paste the complete job description to improve the analysis."
            ],
            missing_information=["Full posting text could not be retrieved via automated URL access."],
            verification_steps=[
                "Copy the visible description text from the page and paste it into JobShield.",
                "Verify the employer independently through official business registries."
            ],
            analysis_limitations=[retrieval.message],
            disclaimer="Could not retrieve job content from the provided URL. Paste the job description manually for an instant risk evaluation.",
            timestamp=int(time.time())
        )

    # Parse extracted HTML
    job_data = parse_html_job_page(retrieval.html, url, platform)

    # Classify content
    category, is_job, role = classify_content(job_data.description or job_data.job_title or "", "formal_job_listing")
    job_data.content_type = category
    if role and not job_data.job_title:
        job_data.job_title = role

    # Evaluate using Risk Engine
    analysis = score_job_posting(job_data)
    analysis.timestamp = int(time.time())
    save_analysis(analysis)
    return analysis

@app.post("/api/analyze-text", response_model=AnalysisResult)
async def analyze_text_endpoint(request: AnalyzeTextRequest):
    raw_text = (request.text or "").strip()
    if not raw_text or len(raw_text) < 15:
        raise HTTPException(
            status_code=400,
            detail="Job text is too brief to analyze. Please paste at least a couple of sentences of the job posting."
        )

    # Strip LinkedIn authentication & navigation boilerplate
    cleaned_text, bp_warnings = strip_auth_and_navigation_boilerplate(raw_text)
    effective_text = cleaned_text if len(cleaned_text) >= 15 else raw_text

    # Classify content
    category, is_job, role = classify_content(effective_text, "")

    # Only treat as non-job if clearly unrelated AND has no job indicators/fees
    fin_items = extract_financial_items(effective_text)
    has_candidate_fee = any(item.payment_direction == "candidate_to_employer" for item in fin_items)

    if not is_job and not has_candidate_fee:
        job_data = JobData(
            job_title=request.job_title or "Discussion Post",
            company_name=request.company_name,
            description=effective_text,
            original_url=request.source_url,
            platform="pasted_text",
            content_type="unrelated_content",
            extraction_source="manual_text"
        )
        return AnalysisResult(
            platform="pasted_text",
            content_type="unrelated_content",
            original_url=request.source_url,
            job_data=job_data,
            risk_score=0,
            risk_category="Non-Job Content",
            risk_level="low",
            analysis_mode="unsupported",
            is_payment_warning=False,
            analysis_status="unrelated",
            extraction_status="success",
            extraction_completeness=0.2,
            matched_indicators=[],
            financial_items=[],
            risk_explanation=RiskExplanation(
                risk_summary="The submitted text appears to be general professional commentary or advice.",
                score_cause="No hiring vacancies, skill requirements, or compensation terms were identified.",
                next_steps_summary="Paste active job vacancy details to perform a risk assessment.",
                unverified_info="Hiring criteria and job specifications were not detected."
            ),
            recommendations=["The submitted text appears to be general professional commentary, advice, or celebration rather than an active job advertisement."],
            missing_information=["Active hiring role criteria not detected."],
            verification_steps=["Ensure you copy and paste text from an active job opening or hiring announcement."],
            analysis_limitations=["Analyzed text was classified as general content rather than a job vacancy."],
            disclaimer="Content did not meet the threshold of a job advertisement or hiring offer.",
            timestamp=int(time.time())
        )

    # Structured field extraction from cleaned text
    job_title = request.job_title or extract_job_title_from_text(effective_text) or role
    if not job_title:
        lines = [l.strip() for l in effective_text.splitlines() if l.strip()]
        if lines and len(lines[0]) <= 60 and not re.search(r"\b(hello|hi|dear|greetings)\b", lines[0], re.I):
            job_title = lines[0]
        else:
            job_title = "Internship Opportunity" if category == "internship_post" else "Job Opportunity"

    # Company name
    company_name = request.company_name or extract_company_name_from_text(effective_text)

    # Location & Workplace Mode
    location, workplace_mode = extract_location_and_mode_from_text(effective_text)

    # Duration and Dates
    dur_info = extract_duration_and_dates(effective_text)

    # Multi-tier Options
    opts = extract_options_details(effective_text)

    # Employment type
    employment_type = "Internship" if category == "internship_post" or "intern" in (job_title or "").lower() else None
    if not employment_type:
        et_m = re.search(r"\b(Full-time|Part-time|Contract|Temporary|Internship|Volunteer|Apprenticeship)\b", effective_text, re.I)
        if et_m:
            employment_type = et_m.group(0).capitalize()

    # Compensation & Candidate Fees
    compensation = extract_structured_compensation(effective_text, fin_items)
    candidate_fees = extract_candidate_fee_details(effective_text, fin_items)

    registration_fee = None
    training_fee = None
    security_deposit = None
    other_fees = None
    stipend = None
    salary = None
    payment_direction = None
    payment_timing = None
    payment_mandatory = None

    for item in fin_items:
        if item.payment_direction == "candidate_to_employer" and item.mandatory_status in ("mandatory", "conditional"):
            if item.financial_type == "registration_fee" and not registration_fee:
                registration_fee = item.amount
                payment_direction = "candidate_to_employer"
                payment_timing = item.payment_timing
                payment_mandatory = "mandatory"
            elif item.financial_type == "training_fee" and not training_fee:
                training_fee = item.amount
                payment_direction = "candidate_to_employer"
                payment_timing = item.payment_timing
            elif item.financial_type == "security_deposit" and not security_deposit:
                security_deposit = item.amount
                payment_direction = "candidate_to_employer"
                payment_timing = item.payment_timing
            elif not other_fees:
                other_fees = f"{item.financial_type.replace('_', ' ').capitalize()}: {item.amount}"
        elif item.payment_direction == "employer_to_candidate":
            if item.financial_type == "stipend" and not stipend:
                stipend = item.amount
            elif item.financial_type in ("salary", "hourly_wage") and not salary:
                salary = item.amount

    job_data = JobData(
        job_title=job_title,
        company_name=company_name,
        location=location,
        workplace_mode=workplace_mode,
        workplace_type=workplace_mode,
        employment_type=employment_type,
        duration=dur_info.get("duration"),
        period=dur_info.get("period"),
        start_date=dur_info.get("start_date"),
        end_date=dur_info.get("end_date"),
        working_hours=dur_info.get("working_hours"),
        has_paid_option=opts["has_paid_option"],
        has_unpaid_option=opts["has_unpaid_option"],
        paid_option_details=opts["paid_option_details"],
        unpaid_option_details=opts["unpaid_option_details"],
        salary=salary,
        stipend=stipend,
        compensation=compensation,
        candidate_fees=candidate_fees,
        registration_fee=registration_fee,
        training_fee=training_fee,
        security_deposit=security_deposit,
        other_fees=other_fees,
        payment_direction=payment_direction,
        payment_timing=payment_timing,
        payment_mandatory=payment_mandatory,
        description=effective_text,
        original_url=request.source_url,
        platform="pasted_text",
        content_type=category,
        extraction_source="manual_text",
        financial_items=fin_items,
        unextracted_fields=bp_warnings
    )

    analysis = score_job_posting(job_data)
    analysis.timestamp = int(time.time())
    save_analysis(analysis)
    return analysis

@app.get("/api/analyses/recent")
def list_recent():
    return {"analyses": get_recent_analyses(10)}

@app.get("/api/analyses/{analysis_id}", response_model=AnalysisResult)
def get_analysis(analysis_id: str):
    res = get_analysis_by_id(analysis_id)
    if not res:
        raise HTTPException(status_code=404, detail="Analysis record not found.")
    return res
