export interface MatchedIndicator {
  rule_id: string;
  rule_name: string;
  category?: string;
  points: number;
  evidence: string;
  explanation: string;
  evidence_strength: string;
  confidence?: string;
  source: string;
  recommendation?: string;
}

export interface FinancialItem {
  amount: string;
  numeric_amount?: number | null;
  minimum_amount?: number | null;
  maximum_amount?: number | null;
  currency: string;
  financial_type: string; // registration_fee, training_fee, security_deposit, stipend, salary, hourly_wage, placement_fee, selection_fee, unknown
  payment_direction: string; // employer_to_candidate, candidate_to_employer, candidate_to_third_party, unknown
  purpose: string;
  mandatory_status: string; // mandatory, optional, conditional, negated, unclear
  mandatory_for_option?: boolean | null;
  option_name?: string | null;
  payment_timing?: string | null;
  timing?: string | null;
  refundability?: string | null;
  payment_conditions?: string | null;
  frequency?: string | null;
  warning?: boolean;
  evidence: string;
  evidence_text?: string | null;
  confidence: string;
}

export interface CompensationDetails {
  type?: string | null;
  minimum_amount?: number | null;
  maximum_amount?: number | null;
  amount_display: string;
  currency: string;
  frequency?: string | null;
  payment_conditions?: string | null;
  payment_direction: string;
  evidence_text?: string | null;
  confidence: number;
}

export interface CandidateFeeDetails {
  type: string;
  amount_display: string;
  amount?: number | null;
  currency: string;
  payment_direction: string;
  mandatory_for_option: boolean;
  option_name?: string | null;
  timing?: string | null;
  evidence_text: string;
  warning: boolean;
}

export interface RiskExplanation {
  risk_summary: string;
  score_cause: string;
  next_steps_summary: string;
  unverified_info: string;
}

export interface MLAnalysisResult {
  available: boolean;
  risk_score?: number | null;
  predicted_class?: string | null;
  confidence?: number | null;
  score_semantics: string;
  model_name?: string | null;
  model_version?: string | null;
  error?: string | null;
}

export interface RuleAnalysisResult {
  available: boolean;
  risk_score: number;
  rules_matched: number;
}

export interface JobData {
  job_title?: string | null;
  company_name?: string | null;
  company_website?: string | null;
  company_profile_url?: string | null;
  location?: string | null;
  workplace_mode?: string | null;
  workplace_type?: string | null;
  employment_type?: string | null;
  duration?: string | null;
  period?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  working_hours?: string | null;
  salary?: string | null;
  salary_currency?: string | null;
  pay_period?: string | null;
  stipend?: string | null;
  compensation_conditions?: string | null;
  compensation?: CompensationDetails | null;
  has_paid_option?: boolean;
  has_unpaid_option?: boolean;
  paid_option_details?: string | null;
  unpaid_option_details?: string | null;
  registration_fee?: string | null;
  training_fee?: string | null;
  security_deposit?: string | null;
  other_fees?: string | null;
  candidate_fees?: CandidateFeeDetails[];
  payment_direction?: string | null;
  payment_timing?: string | null;
  payment_mandatory?: string | null;
  experience?: string | null;
  education?: string | null;
  responsibilities?: string | null;
  qualifications?: string | null;
  benefits?: string | null;
  application_instructions?: string | null;
  application_url?: string | null;
  contact_instructions?: string | null;
  selection_process?: string | null;
  recruiter_name?: string | null;
  recruiter_email?: string | null;
  author_headline?: string | null;
  author_profile_url?: string | null;
  posted_date?: string | null;
  applicant_activity?: string | null;
  description: string;
  original_url?: string | null;
  platform: string;
  content_type: string;
  extraction_source: string;
  unextracted_fields: string[];
  financial_items?: FinancialItem[];
}

export interface AnalysisResult {
  analysis_id?: string | null;
  platform: string;
  content_type: string;
  original_url?: string | null;
  job_data: JobData;
  risk_score: number;
  risk_category: string;
  risk_level: 'low' | 'medium' | 'high' | 'critical' | 'unknown';
  analysis_mode: 'hybrid' | 'rule_only' | 'ml_only' | 'unsupported';
  is_payment_warning: boolean;
  fee_warning_banner?: string | null;
  analysis_status: string;
  extraction_status: string;
  extraction_completeness: number;
  matched_indicators: MatchedIndicator[];
  financial_items?: FinancialItem[];
  ml_analysis?: MLAnalysisResult;
  rule_analysis?: RuleAnalysisResult;
  risk_explanation?: RiskExplanation | null;
  recommendations: string[];
  missing_information: string[];
  verification_steps: string[];
  analysis_limitations: string[];
  disclaimer: string;
  timestamp: number;
}
