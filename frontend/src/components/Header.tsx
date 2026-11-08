import { ShieldAlert, Info, HelpCircle } from 'lucide-react';

export const Header = () => {
  return (
    <header className="border-b border-slate-200 bg-white sticky top-0 z-40 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-red-600 flex items-center justify-center text-white font-bold shadow-md shadow-red-200">
            🛡️
          </div>
          <div>
            <span className="text-xl font-extrabold tracking-tight text-slate-900">
              Job<span className="text-red-600">Shield</span>
            </span>
            <span className="hidden sm:inline-block ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
              Job Scam Detector
            </span>
          </div>
        </div>

        <nav className="flex items-center space-x-6 text-sm font-medium text-slate-600">
          <a href="#how-it-works" className="hover:text-red-600 transition-colors flex items-center gap-1.5">
            <Info className="w-4 h-4" />
            <span className="hidden sm:inline">How It Works</span>
          </a>
          <a href="#safety-guidelines" className="hover:text-red-600 transition-colors flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-amber-500" />
            <span className="hidden sm:inline">Safety Guidelines</span>
          </a>
          <a href="#about" className="hover:text-red-600 transition-colors flex items-center gap-1.5">
            <HelpCircle className="w-4 h-4" />
            <span className="hidden sm:inline">About</span>
          </a>
        </nav>
      </div>
    </header>
  );
};
