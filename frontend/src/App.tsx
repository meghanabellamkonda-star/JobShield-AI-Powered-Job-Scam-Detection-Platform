import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { AnalyzerCard } from './components/AnalyzerCard';
import { ResultsView } from './components/ResultsView';
import type { AnalysisResult } from './types/job';
import { 
  ShieldAlert, 
  CreditCard, 
  MessageSquare, 
  Zap, 
  Lock 
} from 'lucide-react';

export function App() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [initialUrl, setInitialUrl] = useState('');

  useEffect(() => {
    // Check if ?url= parameter was passed from Chrome extension or external link
    const params = new URLSearchParams(window.location.search);
    const queryUrl = params.get('url');
    if (queryUrl) {
      setInitialUrl(queryUrl);
    }
  }, []);

  const handleAnalyzeUrl = async (url: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/analyze-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || 'Failed to analyze job URL.');
      }
      const data: AnalysisResult = await res.json();
      setAnalysisResult(data);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred while communicating with the analysis server.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnalyzeText = async (text: string, title?: string, company?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/analyze-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          job_title: title,
          company_name: company
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || 'Failed to analyze pasted text.');
      }
      const data: AnalysisResult = await res.json();
      setAnalysisResult(data);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred while analyzing the text.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <Header />

      <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full space-y-12">
        {!analysisResult ? (
          <>
            {/* Hero Section */}
            <div className="text-center max-w-3xl mx-auto space-y-4 pt-4">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 text-red-700 text-xs font-bold border border-red-200">
                <ShieldAlert className="w-3.5 h-3.5 text-red-600" />
                AI-Powered Employment Fraud Prevention
              </span>
              <h1 className="text-4xl sm:text-5xl font-black text-slate-900 tracking-tight leading-tight">
                Know the Risk Before You Apply.
              </h1>
              <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-2xl mx-auto">
                Analyze job postings for suspicious upfront registration fees, fake recruiter messaging, implausible salaries, and coercive hiring traps.
              </p>
            </div>

            {/* Analyzer Input Card */}
            <AnalyzerCard 
              onAnalyzeUrl={handleAnalyzeUrl}
              onAnalyzeText={handleAnalyzeText}
              isLoading={isLoading}
              error={error}
              initialUrl={initialUrl}
            />

            {/* Common Employment Scam Warnings */}
            <div id="safety-guidelines" className="pt-6 space-y-6">
              <div className="text-center">
                <h2 className="text-2xl font-bold text-slate-900">Common Job Scam Red Flags</h2>
                <p className="text-sm text-slate-500 mt-1">Our deterministic engine evaluates these critical risk factors in every listing.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-2.5">
                  <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center">
                    <CreditCard className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-sm text-slate-900">Upfront Registration Fees</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Legitimate companies never charge candidates application, training, or deposit fees.
                  </p>
                </div>

                <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-2.5">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-sm text-slate-900">Chat-Only Interviews</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Hiring exclusively via Telegram or unverified WhatsApp accounts without corporate email.
                  </p>
                </div>

                <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-2.5">
                  <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
                    <Zap className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-sm text-slate-900">Guaranteed Selection</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Instant job offers without technical interviews, skill assessment, or background checks.
                  </p>
                </div>

                <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-2.5">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                    <Lock className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-sm text-slate-900">Bank Password Requests</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Demands for net banking credentials, UPI PINs, or debit card CVVs during recruitment.
                  </p>
                </div>
              </div>
            </div>

            {/* How It Works Section */}
            <div id="how-it-works" className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm space-y-6">
              <h2 className="text-xl font-bold text-slate-900">How JobShield Works</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
                <div className="space-y-2">
                  <span className="w-7 h-7 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center justify-center">1</span>
                  <h3 className="font-bold text-slate-800">Paste URL or Description</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Provide a LinkedIn, Indeed, or careers URL. If access requires login, paste the description text directly.
                  </p>
                </div>
                <div className="space-y-2">
                  <span className="w-7 h-7 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center justify-center">2</span>
                  <h3 className="font-bold text-slate-800">Evidence Extraction</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Our backend parses the posting, isolates compensation, contact channels, and payment terms, and handles negations.
                  </p>
                </div>
                <div className="space-y-2">
                  <span className="w-7 h-7 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center justify-center">3</span>
                  <h3 className="font-bold text-slate-800">Transparent Scoring</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    View an explainable 0–100 risk score with verbatim evidence quotes and actionable candidate recommendations.
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <ResultsView 
            result={analysisResult} 
            onReset={() => setAnalysisResult(null)} 
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-8 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 space-y-2">
          <p className="font-semibold text-slate-700">JobShield — AI-Powered Job Scam Detection Platform</p>
          <p>
            Heuristic assessment based on extracted listing evidence, not proof of fraud. Never transfer money for employment.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
