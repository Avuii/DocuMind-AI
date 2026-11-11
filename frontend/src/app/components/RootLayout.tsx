import { Outlet, NavLink } from "react-router";
import { useEffect, useState } from "react";
import { Brain } from "lucide-react";
import { api, ApiError, sessionExpiredEvent } from "../data/documents";
import { AccountForm } from "./AccountForm";
import type { Account } from "./AccountForm";
import { Button } from "./ui/button";
import { LanguageContext, translate } from "../data/preferences";
import type { Language } from "../data/preferences";
import { demoMode } from "../demo/mode";

export type AccountContext = { account: Account; onSignedOut: () => void; onAccountChanged: (account: Account) => void };

export function RootLayout() {
  const [account, setAccount] = useState<Account | null>();
  const [sessionError, setSessionError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const languageKey = demoMode ? "documind.demo.language" : "documind.language";
  const [deviceLanguage, setDeviceLanguage] = useState<Language>(() =>
    localStorage.getItem(languageKey) === "pl" ? "pl" : "en"
  );
  const language = account?.language ?? deviceLanguage;
  const t = (text: string) => translate(language, text);

  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem(languageKey, language);
    setDeviceLanguage(language);
  }, [language]);

  useEffect(() => {
    const controller = new AbortController();
    const expire = () => setAccount(null);
    window.addEventListener(sessionExpiredEvent, expire);
    api<Account>("/api/auth/session", { signal: controller.signal }).then(setAccount).catch((error) => {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) setAccount(null);
      else setSessionError("Could not check your session. Check that the local API is running.");
    });
    return () => {
      controller.abort();
      window.removeEventListener(sessionExpiredEvent, expire);
    };
  }, [attempt]);

  if (account === null) return <LanguageContext.Provider value={language}>
    <AccountForm onSignedIn={setAccount} />
  </LanguageContext.Provider>;
  if (!account) return (
    <main className="p-8 space-y-3">
      <p role={sessionError ? "alert" : "status"}>{t(sessionError || "Checking your session…")}</p>
      {sessionError && <Button onClick={() => { setSessionError(""); setAttempt(attempt + 1); }}>{t("Retry")}</Button>}
    </main>
  );

  return (
    <LanguageContext.Provider value={language}>
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      {/* Top Navigation */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 border-b border-slate-200/60 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-8">
          <div className="flex flex-wrap items-center justify-between gap-2 py-2 min-h-16">
            {/* Logo */}
            <NavLink to="/" className="flex items-center gap-2.5 group">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow">
                <Brain className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg font-semibold text-slate-900 tracking-tight">
                DocuMind-AI
              </span>
            </NavLink>

            {/* Menu Items */}
            <div className="flex flex-wrap items-center gap-1">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `px-4 py-2 rounded-lg transition-all ${
                    isActive
                      ? "bg-slate-100 text-slate-900 font-medium"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  }`
                }
              >
                {t("Dashboard")}
              </NavLink>
              <NavLink
                to="/documents"
                className={({ isActive }) =>
                  `px-4 py-2 rounded-lg transition-all ${
                    isActive
                      ? "bg-slate-100 text-slate-900 font-medium"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  }`
                }
              >
                {t("Documents")}
              </NavLink>
              <NavLink
                to="/exports"
                className={({ isActive }) =>
                  `px-4 py-2 rounded-lg transition-all ${
                    isActive
                      ? "bg-slate-100 text-slate-900 font-medium"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  }`
                }
              >
                {t("Exports")}
              </NavLink>
              <NavLink
                to="/settings"
                className={({ isActive }) =>
                  `px-4 py-2 rounded-lg transition-all ${
                    isActive
                      ? "bg-slate-100 text-slate-900 font-medium"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  }`
                }
              >
                {t("Settings")}
              </NavLink>
            </div>

          </div>
        </div>
      </nav>
      {demoMode && <aside className="border-b border-blue-100 bg-blue-50 px-6 py-2 text-center text-sm text-blue-950">
        <strong>{t("Interactive demo")}</strong> · {t("Files stay in this browser. OCR and registry results use synthetic examples.")}
      </aside>}

      {/* Main Content */}
      <main>
        <Outlet context={{ account, onSignedOut: () => setAccount(null), onAccountChanged: setAccount } satisfies AccountContext} />
      </main>
    </div>
    </LanguageContext.Provider>
  );
}
