import React, { useState } from 'react';
import { Search, FileText, ArrowRight, Loader2, Link2, Sparkles, AlertCircle } from 'lucide-react';

interface AnalyzerProps {
  onAnalyzeUrl: (url: string) => Promise<void>;
  onAnalyzeText: (text: string, title?: string, company?: string) => Promise<void>;
  isLoading: boolean;
  error?: string | null;
  initialUrl?: string;
}

export const AnalyzerCard: React.FC<AnalyzerProps> = ({
  onAnalyzeUrl,
  onAnalyzeText,
  isLoading,
  error,
  initialUrl = ''
}) => {
  const [activeTab, setActiveTab] = useState<'url' | 'text'>('url');
  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');

  React.useEffect(() => {
    if (initialUrl) {
      setUrl(initialUrl);
    }
  }, [initialUrl]);

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    onAnalyzeUrl(url.trim());
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onAnalyzeText(text.trim(), jobTitle.trim() || undefined, companyName.trim() || undefined);
  };

  const handlePasteExample = (exampleUrl: string) => {
    setUrl(exampleUrl);
    setActiveTab('url');
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 overflow-hidden">
      {/* Tab Switcher */}
      <div className="flex border-b border-slate-200 bg-slate-50/50">
        <button
          type="button"
          onClick={() => setActiveTab('url')}
          className={`flex-1 py-4 px-6 text-sm font-semibold flex items-center justify-center gap-2 border-b-2 transition-all ${
            activeTab === 'url'
              ? 'border-red-600 text-red-600 bg-white'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Link2 className="w-4 h-4" />
          Analyze Posting URL
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('text')}
          className={`flex-1 py-4 px-6 text-sm font-semibold flex items-center justify-center gap-2 border-b-2 transition-all ${
            activeTab === 'text'
              ? 'border-red-600 text-red-600 bg-white'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileText className="w-4 h-4" />
          Paste Job Text / Fallback
        </button>
      </div>

      <div className="p-6 sm:p-8">
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" />
            <div>
              <p className="font-semibold text-sm">Analysis Note</p>
              <p className="text-sm mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {activeTab === 'url' ? (
          <form onSubmit={handleUrlSubmit} className="space-y-4">
            <div>
              <label htmlFor="url-input" className="block text-sm font-semibold text-slate-700 mb-2">
                Job Posting URL
              </label>
              <div className="relative">
                <input
                  id="url-input"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste a LinkedIn, Indeed, or other job-posting URL"
                  className="w-full px-4 py-3.5 pl-11 rounded-xl border border-slate-300 focus:border-red-500 focus:ring-3 focus:ring-red-100 outline-none text-slate-900 transition-all font-mono text-sm placeholder:font-sans placeholder:text-slate-400"
                  required
                  disabled={isLoading}
                />
                <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                {url && (
                  <button
                    type="button"
                    onClick={() => setUrl('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400 hover:text-slate-600 px-2 py-1 bg-slate-100 rounded-md"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="text-xs text-slate-500 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Supports LinkedIn, Indeed, and direct company careers URLs</span>
              </div>
              <button
                type="submit"
                disabled={isLoading || !url.trim()}
                className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white font-semibold flex items-center justify-center gap-2 shadow-lg shadow-red-200 transition-all"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analyzing Posting...
                  </>
                ) : (
                  <>
                    Analyze Job
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>

            {/* Quick Example URLs */}
            <div className="pt-4 border-t border-slate-100 mt-6 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-semibold text-slate-600">Sample URL formats:</span>
              <button
                type="button"
                onClick={() => handlePasteExample('https://www.linkedin.com/jobs/view/4459763391/')}
                className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[11px] transition-colors"
              >
                LinkedIn Job /jobs/view/
              </button>
              <button
                type="button"
                onClick={() => handlePasteExample('https://in.indeed.com/viewjob?jk=example123')}
                className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[11px] transition-colors"
              >
                Indeed Viewjob
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleTextSubmit} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="text-input" className="block text-sm font-semibold text-slate-700">
                  Job Description or Post Text
                </label>
                <span className="text-xs text-slate-400">Pasted text fallback analyzer</span>
              </div>
              <textarea
                id="text-input"
                rows={6}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste the full job description, WhatsApp message, recruiter email, or LinkedIn hiring post text here..."
                className="w-full p-4 rounded-xl border border-slate-300 focus:border-red-500 focus:ring-3 focus:ring-red-100 outline-none text-slate-900 transition-all text-sm placeholder:text-slate-400"
                required
                disabled={isLoading}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Job Title <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="e.g. Full Stack Developer Intern"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:border-red-500 focus:ring-2 focus:ring-red-100 outline-none text-sm"
                  disabled={isLoading}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Company Name <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Ira Hospitality"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:border-red-500 focus:ring-2 focus:ring-red-100 outline-none text-sm"
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isLoading || !text.trim()}
                className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white font-semibold flex items-center justify-center gap-2 shadow-lg shadow-red-200 transition-all"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analyzing Text...
                  </>
                ) : (
                  <>
                    Analyze Pasted Text
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
