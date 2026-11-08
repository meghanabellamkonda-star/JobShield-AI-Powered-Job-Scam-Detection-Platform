import React, { useState } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  CheckCircle2, 
  MapPin, 
  Briefcase, 
  DollarSign, 
  Calendar, 
  ArrowLeft, 
  ExternalLink,
  FileSearch,
  Quote,
  CreditCard,
  Cpu,
  Clock,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  AlertTriangle
} from 'lucide-react';
import type { AnalysisResult } from '../types/job';

interface ResultsViewProps {
  result: AnalysisResult;
  onReset: () => void;
}

export const ResultsView: React.FC<ResultsViewProps> = ({ result, onReset }) => {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  const { 
    job_data, 
    risk_score, 
    risk_category, 
    risk_level, 
    analysis_mode,
    is_payment_warning, 
    fee_warning_banner,
    matched_indicators, 
    ml_analysis,
    rule_analysis,
    risk_explanation,
    recommendations 
  } = result;

  const getScoreBadge = () => {
    switch (risk_level) {
      case 'critical':
        return {
          bg: 'bg-red-600',
          badge: 'bg-red-50 text-red-700 border-red-200',
          border: 'border-red-500',
          text: 'text-red-700',
          glow: 'shadow-red-100',
          icon: ShieldAlert
        };
      case 'high':
        return {
          bg: 'bg-orange-500',
          badge: 'bg-orange-50 text-orange-700 border-orange-200',
          border: 'border-orange-500',
          text: 'text-orange-700',
          glow: 'shadow-orange-100',
          icon: ShieldAlert
        };
      case 'medium':
        return {
          bg: 'bg-amber-500',
          badge: 'bg-amber-50 text-amber-700 border-amber-200',
          border: 'border-amber-500',
          text: 'text-amber-700',
          glow: 'shadow-amber-100',
          icon: ShieldAlert
        };
      default:
        return {
          bg: 'bg-emerald-600',
          badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          border: 'border-emerald-500',
          text: 'text-emerald-700',
          glow: 'shadow-emerald-100',
          icon: ShieldCheck
        };
    }
  };

  const colors = getScoreBadge();

  // Extract candidate-paid fee items
  const candidateFees = job_data.financial_items?.filter(
    item => item.payment_direction === 'candidate_to_employer' && item.mandatory_status !== 'negated'
  ) || [];

  const hasCandidateFee = Boolean(
    job_data.registration_fee || 
    job_data.training_fee || 
    job_data.security_deposit || 
    candidateFees.length > 0 ||
    is_payment_warning
  );

  // Compensation details
  const comp = job_data.compensation;
  const hasCompensation = Boolean(job_data.salary || job_data.stipend || (comp && comp.type !== 'none_mentioned'));

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-200">
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 shadow-xs transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Analyze Another Posting
        </button>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-3 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">
            Mode: {analysis_mode || 'hybrid'}
          </span>
          <span className="text-xs font-semibold px-3 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">
            Extraction: {Math.round(result.extraction_completeness * 100)}%
          </span>
        </div>
      </div>

      {/* 1. Prominent Candidate-Paid Fee Warning Banner (Section 7.2) */}
      {hasCandidateFee && (
        <div className="p-6 rounded-2xl bg-red-600 text-white shadow-xl shadow-red-200 border border-red-700 flex items-start gap-4">
          <ShieldAlert className="w-8 h-8 shrink-0 mt-0.5 text-white" />
          <div className="space-y-1">
            <h3 className="text-lg font-bold tracking-tight">CANDIDATE-PAID FEE DETECTED</h3>
            <p className="text-sm text-red-100 leading-relaxed font-medium">
              {fee_warning_banner || (
                job_data.has_paid_option ? (
                  `The paid internship option asks for a ${job_data.registration_fee || '₹199'} registration fee. This is a significant warning sign. Verify the opportunity independently before paying.`
                ) : (
                  `The posting asks candidates to pay a recruitment-related fee (${job_data.registration_fee || job_data.training_fee || 'fee'}). Legitimate employers never charge candidates to apply, interview, or join.`
                )
              )}
            </p>
          </div>
        </div>
      )}

      {/* 2. Risk Summary Card (Section 7.1) */}
      <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-md flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-6">
          <div className={`w-28 h-28 rounded-2xl ${colors.bg} text-white flex flex-col items-center justify-center shadow-lg ${colors.glow}`}>
            <span className="text-4xl font-extrabold leading-none">{risk_score}</span>
            <span className="text-xs font-bold uppercase tracking-wider opacity-90 mt-1">/ 100</span>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`text-xs font-bold px-2.5 py-0.5 rounded-md border ${colors.badge} uppercase tracking-wider`}>
                {risk_category}
              </span>
              <span className="text-xs text-slate-400">•</span>
              <span className="text-xs font-medium text-slate-500 capitalize">{result.content_type.replace(/_/g, ' ')}</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
              {job_data.job_title || "Job Posting"}
            </h2>
            <p className="text-sm font-semibold text-slate-600 mt-0.5">
              {job_data.company_name || "Company Unspecified"}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
          {result.original_url && (
            <a
              href={result.original_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              View Original URL
            </a>
          )}
        </div>
      </div>

      {/* 3. Four-Question Plain-Language Explanation (Section 6) */}
      {risk_explanation && (
        <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-4">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 pb-2 border-b border-slate-100">
            <HelpCircle className="w-5 h-5 text-indigo-600" />
            Risk Assessment Breakdown
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
              <span className="font-bold text-xs text-slate-500 uppercase tracking-wide">1. How risky does this posting look?</span>
              <p className="text-slate-800 font-medium leading-relaxed">{risk_explanation.risk_summary}</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
              <span className="font-bold text-xs text-slate-500 uppercase tracking-wide">2. What caused the score?</span>
              <p className="text-slate-800 font-medium leading-relaxed">{risk_explanation.score_cause}</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
              <span className="font-bold text-xs text-slate-500 uppercase tracking-wide">3. What should I do next?</span>
              <p className="text-slate-800 font-medium leading-relaxed">{risk_explanation.next_steps_summary}</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
              <span className="font-bold text-xs text-slate-500 uppercase tracking-wide">4. What could not be verified?</span>
              <p className="text-slate-800 font-medium leading-relaxed">{risk_explanation.unverified_info}</p>
            </div>
          </div>
        </div>
      )}

      {/* 4. Structured Job Details Card (Section 7.3) */}
      <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm">
        <h3 className="text-base font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100 flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-slate-500" />
          Extracted Posting Information
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-sm">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="block text-xs font-semibold text-slate-400 uppercase">Job Title</span>
            <span className="font-semibold text-slate-800 mt-1 block">
              {job_data.job_title || "Not mentioned in the posting"}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="block text-xs font-semibold text-slate-400 uppercase">Company</span>
            <span className="font-semibold text-slate-800 mt-1 block">
              {job_data.company_name || "Not mentioned in the posting"}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="block text-xs font-semibold text-slate-400 uppercase">Location</span>
            <span className="font-semibold text-slate-800 mt-1 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              {job_data.location || "Not mentioned in the posting"}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="block text-xs font-semibold text-slate-400 uppercase">Workplace Mode</span>
            <span className="font-semibold text-slate-800 mt-1 block">
              {job_data.workplace_mode || job_data.workplace_type || "Not mentioned in the posting"}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="block text-xs font-semibold text-slate-400 uppercase">Employment Type</span>
            <span className="font-semibold text-slate-800 mt-1 block">
              {job_data.employment_type || "Not mentioned in the posting"}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="block text-xs font-semibold text-slate-400 uppercase">Duration</span>
            <span className="font-semibold text-slate-800 mt-1 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              {job_data.duration || "Not mentioned in the posting"}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="block text-xs font-semibold text-slate-400 uppercase">Period / Dates</span>
            <span className="font-semibold text-slate-800 mt-1 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              {job_data.period || "Not mentioned in the posting"}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <span className="block text-xs font-semibold text-slate-400 uppercase">Working Hours</span>
            <span className="font-semibold text-slate-800 mt-1 block">
              {job_data.working_hours || "Not mentioned in the posting"}
            </span>
          </div>
        </div>
      </div>

      {/* 5. Separate Financial Details Card (Section 7.4) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Direction 1: Money Employer May Pay Candidate */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <DollarSign className="w-5 h-5 text-emerald-600" />
            <div>
              <h3 className="text-base font-bold text-slate-900">Employer-Paid Compensation</h3>
              <p className="text-xs text-slate-500">Money paid by the employer to the candidate</p>
            </div>
          </div>

          {hasCompensation ? (
            <div className="space-y-3 text-sm">
              <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-100">
                <span className="block text-xs font-semibold text-emerald-700 uppercase">Stipend / Salary</span>
                <span className="text-xl font-black text-emerald-900 mt-0.5 block">
                  {job_data.stipend || job_data.salary || comp?.amount_display}
                </span>
                <span className="text-xs text-emerald-700 mt-1 block">Currency: {comp?.currency || 'INR'}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-slate-400 font-semibold block">Frequency:</span>
                  <span className="font-bold text-slate-700">{comp?.frequency || 'Not specified'}</span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-slate-400 font-semibold block">Terms:</span>
                  <span className="font-bold text-slate-700">{comp?.payment_conditions || 'Standard'}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-600 space-y-1">
              <span className="font-semibold text-slate-800 block">Salary / Stipend: Not mentioned in the posting.</span>
              <p className="text-xs text-slate-500">
                The posting does not state compensation details. Do not assume the position pays a stipend or is unpaid without explicit confirmation.
              </p>
            </div>
          )}
        </div>

        {/* Direction 2: Money Candidate Is Asked to Pay */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <CreditCard className="w-5 h-5 text-rose-600" />
            <div>
              <h3 className="text-base font-bold text-slate-900">Candidate-Paid Charges</h3>
              <p className="text-xs text-slate-500">Money requested FROM the candidate</p>
            </div>
          </div>

          {hasCandidateFee ? (
            <div className="space-y-3 text-sm">
              {job_data.registration_fee && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl">
                  <span className="block text-xs font-semibold text-rose-600 uppercase">Registration Fee</span>
                  <span className="text-xl font-black text-rose-950 mt-0.5 block">{job_data.registration_fee}</span>
                  {job_data.has_paid_option && (
                    <span className="text-xs text-rose-700 mt-1 block font-medium">
                      Applies to: Paid internship option ({job_data.payment_timing ? `Payable ${job_data.payment_timing.replace('_', ' ')}` : 'Orientation day'})
                    </span>
                  )}
                </div>
              )}

              {job_data.has_unpaid_option && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700">
                  <span className="font-bold text-slate-800 block">Alternative Option Available:</span>
                  <span>{job_data.unpaid_option_details || 'The listing also advertises an unpaid option with no registration fee.'}</span>
                </div>
              )}

              {job_data.training_fee && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl">
                  <span className="block text-xs font-semibold text-rose-600 uppercase">Training Fee</span>
                  <span className="text-lg font-black text-rose-950 mt-0.5 block">{job_data.training_fee}</span>
                </div>
              )}

              {job_data.security_deposit && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl">
                  <span className="block text-xs font-semibold text-rose-600 uppercase">Security Deposit</span>
                  <span className="text-lg font-black text-rose-950 mt-0.5 block">{job_data.security_deposit}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-600 space-y-1">
              <span className="font-semibold text-slate-800 block">No candidate-paid fee found in the available text.</span>
              <p className="text-xs text-slate-500">
                The supplied content does not request registration fees, deposits, or training charges. Always remain alert for fee demands during interviews.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 6. Matched Indicators & Rule Evidence (Section 7.5) */}
      <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between pb-4 mb-6 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-red-600" />
              Detected Risk Indicators
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Deterministic rule findings verified against the posting text.
            </p>
          </div>
          <span className="text-sm font-bold px-3 py-1 bg-slate-100 text-slate-700 rounded-full">
            {matched_indicators.length} {matched_indicators.length === 1 ? 'Rule Matched' : 'Rules Matched'}
          </span>
        </div>

        {matched_indicators.length === 0 ? (
          <div className="text-center py-8 bg-slate-50 rounded-xl border border-slate-200">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
            <h4 className="text-base font-bold text-slate-800">No Specific Suspicious Indicators Detected</h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
              The rule engine found no registration fees, deposit demands, or unverified contact channels in the supplied text.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {matched_indicators.map((indicator, idx) => (
              <div 
                key={idx}
                className="p-5 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white hover:shadow-md transition-all space-y-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-600 shrink-0" />
                    <h4 className="text-base font-bold text-slate-900">{indicator.rule_name}</h4>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-md bg-red-100 text-red-700 shrink-0">
                    +{indicator.points} pts
                  </span>
                </div>

                {indicator.evidence && (
                  <blockquote className="p-3 rounded-lg bg-amber-50/70 border-l-3 border-amber-500 text-sm font-medium text-amber-900 flex items-start gap-2">
                    <Quote className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>"{indicator.evidence}"</span>
                  </blockquote>
                )}

                <p className="text-sm text-slate-600 leading-relaxed">
                  {indicator.explanation}
                </p>

                {indicator.recommendation && (
                  <div className="p-3 rounded-lg bg-white border border-slate-200 text-xs text-slate-700 flex items-start gap-2">
                    <span className="font-bold text-red-600 shrink-0">Action:</span>
                    <span>{indicator.recommendation}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 7. Actionable Recommendations (Section 7.6) */}
      <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
          What Should You Do Next?
        </h3>

        <ul className="space-y-3">
          {recommendations.map((rec, idx) => (
            <li key={idx} className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-100 text-sm font-medium text-slate-800">
              <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                {idx + 1}
              </span>
              <span className="leading-relaxed">{rec}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* 8. Collapsible Model & Technical Details (Section 7.7) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <button
          onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
          className="w-full px-6 py-4 flex items-center justify-between text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-indigo-500" />
            Technical & Machine Learning Details
          </span>
          {showTechnicalDetails ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {showTechnicalDetails && (
          <div className="p-6 pt-2 border-t border-slate-100 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* ML Subsystem Card */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-500 uppercase">Pretrained ML Classifier</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${ml_analysis?.available ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-slate-200 text-slate-600'}`}>
                    {ml_analysis?.available ? 'Operational (60% weight)' : 'Unavailable'}
                  </span>
                </div>
                {ml_analysis?.available && ml_analysis.risk_score !== null && ml_analysis.risk_score !== undefined ? (
                  <div className="mt-2 space-y-1">
                    <span className="text-2xl font-black text-slate-900">{ml_analysis.risk_score}/100</span>
                    <span className="block text-xs text-slate-600">Predicted Class: <strong className="capitalize">{ml_analysis.predicted_class}</strong></span>
                    <span className="block text-[11px] text-slate-400">Model: {ml_analysis.model_name || 'RandomForest'} ({ml_analysis.score_semantics?.replace(/_/g, ' ')})</span>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500 italic">
                    {ml_analysis?.error || 'Pretrained ML model is offline.'}
                  </p>
                )}
              </div>

              {/* Rule Engine Subsystem Card */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-500 uppercase">Deterministic Rule Engine</span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Operational (40% weight)
                  </span>
                </div>
                <div className="mt-2 space-y-1">
                  <span className="text-2xl font-black text-slate-900">{rule_analysis?.risk_score ?? 0}/100</span>
                  <span className="block text-xs text-slate-600">Matched: <strong>{matched_indicators.length} {matched_indicators.length === 1 ? 'Rule' : 'Rules'}</strong></span>
                  <span className="block text-[11px] text-slate-400">High-severity safeguards active</span>
                </div>
              </div>
            </div>

            {result.analysis_limitations.length > 0 && (
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Extraction Limitations:</span>
                  <ul className="list-disc list-inside mt-0.5">
                    {result.analysis_limitations.map((lim, i) => (
                      <li key={i}>{lim}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 9. Raw Analyzed Description (for verification) */}
      {job_data.description && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
          <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center gap-2">
            <FileSearch className="w-4 h-4 text-slate-500" />
            Analyzed Listing Text
          </h3>
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 max-h-60 overflow-y-auto text-xs text-slate-600 whitespace-pre-wrap leading-relaxed font-mono">
            {job_data.description}
          </div>
        </div>
      )}
    </div>
  );
};
