"use client";

import { useEffect, useState } from "react";
import { clientApiUrl } from "../lib/client-api";

type DemoStep = { title: string; body: string; preview: string };
type Guide = { role: string; languages: { en: DemoStep[]; hi: DemoStep[] } };

function roleLabel(role: string) {
  return role.replaceAll("_", " ");
}

export function DemoButton() {
  const [guide, setGuide] = useState<Guide | null>(null);
  const [language, setLanguage] = useState<"en" | "hi">("en");
  const [stepIndex, setStepIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState("");

  async function openGuide() {
    setError("");
    if (!guide) {
      try {
        const response = await fetch(clientApiUrl + "/demo-guides/current", { credentials: "include" });
        if (response.ok) {
          const nextGuide = await response.json();
          setGuide(nextGuide);
          setStepIndex(0);
        } else {
          setError("Could not load the walkthrough. Check that the API server is running.");
        }
      } catch {
        setError("Could not reach the API server. Start npm run dev:api and try again.");
      }
    }
    setOpen(true);
  }

  const steps = guide?.languages[language] ?? [];

  useEffect(() => {
    if (!isPlaying || !open || steps.length === 0) return;

    const timer = window.setInterval(() => {
      setStepIndex((value) => {
        if (value >= steps.length - 1) {
          setIsPlaying(false);
          return value;
        }
        return value + 1;
      });
    }, 2400);

    return () => window.clearInterval(timer);
  }, [isPlaying, open, steps.length]);

  function togglePlay() {
    if (steps.length === 0) return;
    if (stepIndex >= steps.length - 1) setStepIndex(0);
    setIsPlaying((value) => !value);
  }

  const activeStep = steps[Math.min(stepIndex, Math.max(0, steps.length - 1))];
  const currentStep = steps.length > 0 ? Math.min(stepIndex + 1, steps.length) : 0;

  return (
    <>
      <button className="sidebar-action" type="button" onClick={openGuide}>Guide</button>
      {open ? (
        <div className="demo-backdrop" role="dialog" aria-modal="true">
          <div className="demo-panel demo-panel-wide">
            <div className="demo-head">
              <div>
                <span className="eyebrow">Role walkthrough</span>
                <h2>{guide ? roleLabel(guide.role) : "Guide"}</h2>
              </div>
              <button className="ghost-button" type="button" onClick={() => { setIsPlaying(false); setOpen(false); }}>Close</button>
            </div>

            {guide && activeStep ? (
              <div className="demo-layout">
                <div className="demo-preview" aria-label="Guide preview">
                  <div className="preview-browser">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="preview-shell">
                    <aside>
                      <strong>Rishi Fabrics</strong>
                      <span>Control Tower</span>
                      <em>{activeStep.preview}</em>
                    </aside>
                    <section>
                      <div className="preview-title">{activeStep.preview}</div>
                      <div className="preview-bars">
                        <span />
                        <span />
                        <span />
                      </div>
                      <div className="preview-card-row">
                        <div />
                        <div />
                        <div />
                      </div>
                      <button type="button" className="preview-play" onClick={togglePlay}>{isPlaying ? "Pause" : "Play"}</button>
                    </section>
                  </div>
                  <div className="preview-progress"><span style={{ width: ((currentStep / steps.length) * 100) + "%" }} /></div>
                </div>

                <div className="demo-copy">
                  <div className="segmented">
                    <button className={language === "en" ? "active" : ""} type="button" onClick={() => { setLanguage("en"); setStepIndex(0); setIsPlaying(false); }}>English</button>
                    <button className={language === "hi" ? "active" : ""} type="button" onClick={() => { setLanguage("hi"); setStepIndex(0); setIsPlaying(false); }}>हिन्दी</button>
                  </div>

                  <span className="demo-step-count">Step {currentStep} of {steps.length}</span>
                  <h3>{activeStep.title}</h3>
                  <p>{activeStep.body}</p>

                  <div className="demo-dots">
                    {steps.map((step, index) => (
                      <button
                        key={step.title}
                        className={index === stepIndex ? "active" : ""}
                        type="button"
                        aria-label={"Go to step " + (index + 1)}
                        onClick={() => { setStepIndex(index); setIsPlaying(false); }}
                      />
                    ))}
                  </div>

                  <div className="demo-actions">
                    <button type="button" className="ghost-button" disabled={stepIndex === 0} onClick={() => { setIsPlaying(false); setStepIndex((value) => Math.max(0, value - 1)); }}>Previous</button>
                    <button type="button" onClick={() => { setIsPlaying(false); setStepIndex((value) => Math.min(steps.length - 1, value + 1)); }}>Next</button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="form-error">{error || "Walkthrough is not available right now."}</div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
