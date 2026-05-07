"use client";

import { useState, useRef, useCallback } from "react";

type Status = "idle" | "processing" | "done" | "error";

function wordCount(text: string): number {
  return (text.match(/\S+/g) || []).length;
}

export default function Home() {
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleHumanize = useCallback(async () => {
    if (!inputText.trim()) return;
    setStatus("processing");
    setOutputText("");
    setErrorMsg("");

    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/humanize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: inputText }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `Błąd serwera: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Brak strumienia odpowiedzi");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const payload = line.slice(6);
            if (payload === "[DONE]") break;
            try {
              const parsed = JSON.parse(payload) as { delta?: string; error?: string };
              if (parsed.error) throw new Error(parsed.error);
              if (parsed.delta) setOutputText((prev) => prev + parsed.delta);
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message !== "Unexpected token") {
                throw parseErr;
              }
            }
          }
        }
      }

      setStatus("done");
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setStatus("idle");
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : "Nieznany błąd");
      setStatus("error");
    }
  }, [inputText]);

  const handleStop = () => {
    abortRef.current?.abort();
    setStatus("idle");
  };

  const handleDownloadDocx = async () => {
    if (!outputText.trim()) return;
    setIsDownloading(true);
    try {
      const res = await fetch("/api/generate-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: outputText }),
      });
      if (!res.ok) throw new Error("Błąd generowania DOCX");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "praca_magisterska_humanizowana.docx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Błąd pobierania pliku");
      setStatus("error");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCopy = async () => {
    if (!outputText) return;
    await navigator.clipboard.writeText(outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => {
    setInputText("");
    setOutputText("");
    setStatus("idle");
    setErrorMsg("");
  };

  const isProcessing = status === "processing";

  return (
    <main className="min-h-screen flex flex-col" style={{ background: "var(--background)" }}>
      {/* Header */}
      <header className="glass sticky top-0 z-10" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0"
            style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
          >
            H
          </div>
          <div>
            <h1 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              Humanizator Akademicki
            </h1>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Humanizacja tekstów naukowych · poziom pracy magisterskiej
            </p>
          </div>
          <div className="ml-auto">
            <span
              className="hidden sm:inline text-xs px-2 py-1 rounded-full"
              style={{
                background: "rgba(16, 185, 129, 0.1)",
                color: "#10b981",
                border: "1px solid rgba(16, 185, 129, 0.2)",
              }}
            >
              claude-sonnet-4-6
            </span>
          </div>
        </div>
        {isProcessing && <div className="progress-bar w-full" />}
      </header>

      {/* Hero */}
      <div
        className="py-8 px-4 text-center"
        style={{
          background: "linear-gradient(180deg, rgba(99,102,241,0.08) 0%, transparent 100%)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <h2
          className="text-2xl font-bold mb-2"
          style={{
            background: "linear-gradient(135deg, #818cf8, #c084fc)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Zhumanizuj swoją pracę magisterską
        </h2>
        <p className="text-sm max-w-xl mx-auto mb-4" style={{ color: "var(--text-muted)" }}>
          Przekształca tekst naukowy w naturalnie brzmiącą pracę magisterską.
          Omija detektory AI. Eksportuje gotowy plik DOCX.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {["Zachowuje formatowanie", "Omija detektory AI", "Eksport DOCX", "Język polski", "Styl akademicki"].map((f) => (
            <span
              key={f}
              className="text-xs px-3 py-1 rounded-full"
              style={{
                background: "rgba(99,102,241,0.1)",
                color: "#818cf8",
                border: "1px solid rgba(99,102,241,0.2)",
              }}
            >
              {f}
            </span>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-4 py-6 flex flex-col gap-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={isProcessing ? handleStop : handleHumanize}
            disabled={!inputText.trim() && !isProcessing}
            className="btn-primary px-5 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            {isProcessing ? (
              <>
                <span className="inline-block w-3 h-3 rounded-sm bg-white" />
                Zatrzymaj
              </>
            ) : (
              <>
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Humanizuj tekst
              </>
            )}
          </button>

          <button
            onClick={handleDownloadDocx}
            disabled={!outputText.trim() || isDownloading}
            className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            {isDownloading ? (
              <>
                <span className="pulse-dot inline-block w-2 h-2 rounded-full bg-indigo-400" />
                Generowanie...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 16l-4-4h3V4h2v8h3l-4 4zm-7 2v2h14v-2H5z" />
                </svg>
                Pobierz DOCX
              </>
            )}
          </button>

          <button
            onClick={handleCopy}
            disabled={!outputText.trim()}
            className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            {copied ? (
              <>
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                  <path d="M5 13l4 4L19 7" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ color: "#10b981" }}>Skopiowano!</span>
              </>
            ) : (
              <>
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                  <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="2" />
                </svg>
                Kopiuj wynik
              </>
            )}
          </button>

          <button
            onClick={handleClear}
            disabled={isProcessing}
            className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium ml-auto"
          >
            Wyczyść
          </button>
        </div>

        {/* Error */}
        {status === "error" && (
          <div
            className="fade-in px-4 py-3 rounded-lg text-sm flex items-center gap-2"
            style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              color: "#fca5a5",
            }}
          >
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="#ef4444" strokeWidth="2" />
              <path d="M12 8v4m0 4h.01" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {errorMsg}
          </div>
        )}

        {/* Panels */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ minHeight: "500px" }}>
          {/* Input */}
          <div
            className="flex flex-col rounded-xl overflow-hidden"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <div
              className="flex items-center justify-between px-4 py-2.5 shrink-0"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                TEKST WEJŚCIOWY
              </span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {wordCount(inputText).toLocaleString("pl")} słów
              </span>
            </div>
            <textarea
              className="flex-1 w-full p-4 text-sm leading-relaxed resize-none focus:outline-none"
              style={{ background: "transparent", color: "var(--text)", caretColor: "#818cf8", minHeight: "460px" }}
              placeholder={"Wklej tutaj tekst pracy magisterskiej lub jej fragmenty...\n\nMożesz wkleić:\n• Całą pracę magisterską\n• Pojedyncze rozdziały lub podrozdziały\n• Dowolne fragmenty tekstu naukowego\n\nProgram zachowa oryginalne formatowanie: nagłówki, akapity, tabele, przypisy i bibliografię."}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isProcessing}
            />
          </div>

          {/* Output */}
          <div
            className="flex flex-col rounded-xl overflow-hidden"
            style={{
              background: "var(--surface)",
              border: `1px solid ${status === "done" ? "rgba(99,102,241,0.4)" : "var(--border)"}`,
              boxShadow: status === "done" ? "0 0 20px rgba(99,102,241,0.08)" : "none",
              transition: "border-color 0.3s, box-shadow 0.3s",
            }}
          >
            <div
              className="flex items-center justify-between px-4 py-2.5 shrink-0"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  TEKST ZHUMANIZOWANY
                </span>
                {isProcessing && (
                  <span className="flex items-center gap-1.5 text-xs" style={{ color: "#818cf8" }}>
                    <span className="pulse-dot inline-block w-1.5 h-1.5 rounded-full bg-indigo-400" />
                    Generowanie...
                  </span>
                )}
                {status === "done" && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-full"
                    style={{
                      background: "rgba(16,185,129,0.1)",
                      color: "#10b981",
                      border: "1px solid rgba(16,185,129,0.2)",
                    }}
                  >
                    Gotowe
                  </span>
                )}
              </div>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {wordCount(outputText).toLocaleString("pl")} słów
              </span>
            </div>

            {outputText ? (
              <textarea
                className="flex-1 w-full p-4 text-sm leading-relaxed resize-none focus:outline-none fade-in"
                style={{ background: "transparent", color: "var(--text)", caretColor: "#818cf8", minHeight: "460px" }}
                value={outputText}
                onChange={(e) => setOutputText(e.target.value)}
                readOnly={isProcessing}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center" style={{ minHeight: "460px" }}>
                {isProcessing ? (
                  <>
                    <div
                      className="w-10 h-10 rounded-full border-2 border-transparent"
                      style={{ borderTopColor: "#818cf8", animation: "spin 0.8s linear infinite" }}
                    />
                    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                      Trwa humanizacja tekstu...
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-muted)", opacity: 0.6 }}>
                      Może potrwać kilka minut dla długich tekstów
                    </p>
                  </>
                ) : (
                  <>
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center"
                      style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.15)" }}
                    >
                      <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                        <path
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          stroke="#6366f1"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                      Tutaj pojawi się zhumanizowany tekst
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-muted)", opacity: 0.6 }}>
                      Wklej tekst po lewej i kliknij „Humanizuj tekst"
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer info */}
        <div
          className="rounded-lg px-4 py-3 flex flex-wrap gap-x-6 gap-y-1 text-xs"
          style={{
            background: "rgba(26,29,46,0.5)",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
          }}
        >
          <span>Model: <span style={{ color: "#818cf8" }}>claude-sonnet-4-6</span></span>
          <span>Detektory: <span style={{ color: "#10b981" }}>ZeroGPT · GPTZero · Turnitin · Originality.ai · Copyleaks · Pangram</span></span>
          <span className="ml-auto">Zachowuje: nagłówki · tabele · przypisy · bibliografię</span>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </main>
  );
}
