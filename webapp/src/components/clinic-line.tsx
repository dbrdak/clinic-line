"use client";

import { useState } from "react";
import { ChevronDown, HeartPulse, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { Language } from "@/lib/protocol";
import { useClinicCall } from "./use-clinic-call";
import { CallCard } from "./call-card";
import { Diagnostics } from "./diagnostics";
import { VerificationForm } from "./verification-form";

export default function ClinicLine() {
  const [language, setLanguage] = useState<Language>("en");
  const controller = useClinicCall(language);
  const { ongoing, form, dismiss } = controller;

  return (
    <div className="shell">
      <header>
        <Link className="brand" href="/" aria-label="ClinicLine">
          <span className="brand-icon">
            <HeartPulse size={22} />
          </span>
          ClinicLine<span className="brand-dot">.</span>
        </Link>
        <div className="header-right">
          <label className="language">
            <span className="sr-only">Call language</span>
            <select
              value={language}
              disabled={ongoing}
              onChange={(event) => setLanguage(event.target.value as Language)}
            >
              <option value="pl">PL · Polish</option>
              <option value="en">EN · English</option>
            </select>
            <ChevronDown size={14} />
          </label>
        </div>
      </header>
      <main className="call-workspace">
        <Diagnostics controller={controller} />
        <aside className="call-panel" aria-label="Call Klara">
          <CallCard controller={controller} />
        </aside>
      </main>
      <footer>
        <span>
          ClinicLine<span className="brand-dot">.</span>
        </span>
        <p>A voice technology demo. This is not a medical service.</p>
        <span>POWERED BY LIVEKIT</span>
      </footer>
      {form && (
        <VerificationForm
          key={form.requestId}
          request={form}
          dismiss={dismiss}
          submit={controller.submit}
        />
      )}
    </div>
  );
}
