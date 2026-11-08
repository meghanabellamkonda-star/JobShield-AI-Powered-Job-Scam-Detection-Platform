from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

class MatchedIndicator(BaseModel):
    rule_id: str
    rule_name: str
    category: Optional[str] = "financial_or_recruitment_risk"
    points: int
    evidence: str
    explanation: str
    evidence_strength: str = "explicit"  # explicit, inferred, high, medium, low
    confidence: str = "high"             # high, medium, low
    source: str = "extracted_job_description"
    recommendation: Optional[str] = None

class FinancialItem(BaseModel):
    amount: str
    numeric_amount: Optional[float] = None
    minimum_amount: Optional[float] = None
    maximum_amount: Optional[float] = None
    currency: str = "INR"
    financial_type: str  # registration_fee, training_fee, security_deposit, stipend, salary, hourly_wage, placement_fee, selection_fee, unknown
    payment_direction: str  # employer_to_candidate, candidate_to_employer, candidate_to_third_party, unknown
    purpose: str
    mandatory_status: str = "mandatory"  # mandatory, optional, conditional, negated, unclear
    mandatory_for_option: Optional[bool] = None
    option_name: Optional[str] = None  # e.g. "Paid internship", "Paid option"
    payment_timing: Optional[str] = None  # before_joining, after_orientation, after_selection, monthly, annual, unclear
    timing: Optional[str] = None
    refundability: Optional[str] = None   # refundable, non_refundable, unspecified
    payment_conditions: Optional[str] = None  # e.g. "Performance-based"
    frequency: Optional[str] = None  # monthly, annual, hourly, or null
    warning: bool = False
    evidence: str = ""
    evidence_text: Optional[str] = None
    confidence: str = "high"  # high, medium, low

class MLAnalysisResult(BaseModel):
    available: bool = False
    risk_score: Optional[float] = None
    predicted_class: Optional[str] = None  # fraud, legitimate, unknown
    confidence: Optional[float] = None
    score_semantics: str = "uncalibrated_positive_class_probability"
    model_name: Optional[str] = None
    model_version: Optional[str] = None
    error: Optional[str] = None

class RuleAnalysisResult(BaseModel):
    available: bool = True
    risk_score: int = 0
    rules_matched: int = 0

class CompensationDetails(BaseModel):
    type: Optional[str] = None  # stipend, salary, hourly_wage, performance_based, none_mentioned, explicitly_unpaid
    minimum_amount: Optional[float] = None
    maximum_amount: Optional[float] = None
    amount_display: str = "Not mentioned in the posting"
    currency: str = "INR"
    frequency: Optional[str] = None  # Not specified, Monthly, Annual, Hourly
    payment_conditions: Optional[str] = None  # Performance-based, Fixed, etc.
    payment_direction: str = "employer_to_candidate"
    evidence_text: Optional[str] = None
    confidence: float = 0.9

class CandidateFeeDetails(BaseModel):
    type: str = "registration_fee"
    amount_display: str = ""
    amount: Optional[float] = None
    currency: str = "INR"
    payment_direction: str = "candidate_to_employer"
    mandatory_for_option: bool = True
    option_name: Optional[str] = None
    timing: Optional[str] = None
    evidence_text: str = ""
    warning: bool = True

class RiskExplanation(BaseModel):
    risk_summary: str = ""
    score_cause: str = ""
    next_steps_summary: str = ""
    unverified_info: str = ""

class JobData(BaseModel):
    job_title: Optional[str] = None
    company_name: Optional[str] = None
    company_website: Optional[str] = None
    company_profile_url: Optional[str] = None
    location: Optional[str] = None
    workplace_mode: Optional[str] = None  # In-office, Remote, Hybrid, On-site
    workplace_type: Optional[str] = None  # Backward compatibility alias
    employment_type: Optional[str] = None  # Full-time, Internship, Contract, etc.
    
    # Duration and Dates
    duration: Optional[str] = None  # e.g. "6 months", "45 days"
    period: Optional[str] = None    # e.g. "January 2027 – June 2027"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    working_hours: Optional[str] = None  # e.g. "3–4 hours/day"
    
    # Employer-to-Candidate Compensation
    salary: Optional[str] = None
    salary_currency: Optional[str] = None
    pay_period: Optional[str] = None
    stipend: Optional[str] = None
    compensation_conditions: Optional[str] = None
    compensation: Optional[CompensationDetails] = None
    
    # Options (Paid vs Unpaid)
    has_paid_option: bool = False
    has_unpaid_option: bool = False
    paid_option_details: Optional[str] = None
    unpaid_option_details: Optional[str] = None
    
    # Candidate-paid fees extracted separately
    registration_fee: Optional[str] = None
    training_fee: Optional[str] = None
    security_deposit: Optional[str] = None
    other_fees: Optional[str] = None
    candidate_fees: List[CandidateFeeDetails] = Field(default_factory=list)
    payment_direction: Optional[str] = None
    payment_timing: Optional[str] = None
    payment_mandatory: Optional[str] = None
    
    experience: Optional[str] = None
    education: Optional[str] = None
    responsibilities: Optional[str] = None
    qualifications: Optional[str] = None
    benefits: Optional[str] = None
    application_instructions: Optional[str] = None
    application_url: Optional[str] = None
    contact_instructions: Optional[str] = None
    selection_process: Optional[str] = None
    recruiter_name: Optional[str] = None
    recruiter_email: Optional[str] = None
    author_headline: Optional[str] = None
    author_profile_url: Optional[str] = None
    posted_date: Optional[str] = None
    applicant_activity: Optional[str] = None
    description: str = ""
    original_url: Optional[str] = None
    platform: str = "unknown"
    content_type: str = "job_listing"
    extraction_source: str = "auto_url"  # auto_url, manual_text, json_ld, fallback
    unextracted_fields: List[str] = Field(default_factory=list)
    financial_items: List[FinancialItem] = Field(default_factory=list)

class AnalyzeUrlRequest(BaseModel):
    url: str

class AnalyzeTextRequest(BaseModel):
    text: str
    job_title: Optional[str] = None
    company_name: Optional[str] = None
    source_url: Optional[str] = None

class AnalysisResult(BaseModel):
    analysis_id: Optional[str] = None
    platform: str
    content_type: str
    original_url: Optional[str] = None
    job_data: JobData
    risk_score: int
    risk_category: str  # Low Risk, Moderate Risk, High Risk, Critical Risk
    risk_level: str     # low, medium, high, critical
    analysis_mode: str = "hybrid"  # hybrid, rule_only, ml_only, unsupported
    is_payment_warning: bool
    fee_warning_banner: Optional[str] = None
    analysis_status: str  # complete, partial, inaccessible, unsupported, non_job, insufficient_data, failed
    extraction_status: str  # success, partial, failed
    extraction_completeness: float
    matched_indicators: List[MatchedIndicator]
    financial_items: List[FinancialItem] = Field(default_factory=list)
    ml_analysis: MLAnalysisResult = Field(default_factory=MLAnalysisResult)
    rule_analysis: RuleAnalysisResult = Field(default_factory=RuleAnalysisResult)
    risk_explanation: Optional[RiskExplanation] = None
    recommendations: List[str]
    missing_information: List[str]
    verification_steps: List[str]
    analysis_limitations: List[str]
    disclaimer: str
    timestamp: int
