"use client";

import { useState } from "react";
import { Check, ChevronDown, HeartPulse, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { Language } from "@/lib/protocol";
import { useClinicCall } from "./use-clinic-call";
import { CallCard } from "./call-card";
import { Diagnostics } from "./diagnostics";
import { VerificationForm } from "./verification-form";

export default function ClinicLine() {
  const [language, setLanguage] = useState<Language>("pl");
  const controller = useClinicCall(language);
  const { ongoing, form, dismiss, t } = controller;

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
          <span className="demo-badge">
            {t("DEMO · OPIEKA NFZ", "DEMO · NFZ CARE")}
          </span>
          <label className="language">
            <span className="sr-only">
              {t("Język rozmowy", "Call language")}
            </span>
            <select
              value={language}
              disabled={ongoing}
              onChange={(event) => setLanguage(event.target.value as Language)}
            >
              <option value="pl">PL · Polski</option>
              <option value="en">EN · English</option>
            </select>
            <ChevronDown size={14} />
          </label>
        </div>
      </header>
      <main>
        <section className="hero">
          <div className="eyebrow">
            <span className="tiny-dot" />
            {t(
              "TWOJA WIZYTA ZACZYNA SIĘ OD ROZMOWY",
              "YOUR APPOINTMENT STARTS WITH A CONVERSATION",
            )}
          </div>
          <h1>
            {t("Mniej czekania.", "Less waiting.")}
            <br />
            <em>{t("Więcej spokoju.", "More peace of mind.")}</em>
          </h1>
          <p className="intro">
            {t(
              "Poznaj Klarę — wirtualną recepcjonistkę przychodni. Znajdź lekarza, umów wizytę lub zmień termin. Po prostu porozmawiaj.",
              "Meet Klara, the clinic’s virtual receptionist. Find a doctor, book an appointment, or change your visit. Just start talking.",
            )}
          </p>
          <div className="benefits">
            <span>
              <Check size={16} />
              {t("Wizyty finansowane przez NFZ", "NFZ-funded appointments")}
            </span>
            <span>
              <Check size={16} />
              {t(
                "Kilku lekarzy, jedna rozmowa",
                "Multiple doctors, one conversation",
              )}
            </span>
            <span>
              <Check size={16} />
              {t(
                "Każda zmiana za Twoją zgodą",
                "Every change needs your confirmation",
              )}
            </span>
          </div>
          <div className="privacy-note">
            <ShieldCheck size={22} />
            <p>
              {t("To przestrzeń do nauki.", "A space for learning.")}
              <small>
                {t(
                  "Używaj wyłącznie fikcyjnych danych. Nie podawaj informacji o zdrowiu ani prawdziwego numeru PESEL.",
                  "Use fictional data only. Do not share health information or a real PESEL number.",
                )}
              </small>
            </p>
          </div>
        </section>
        <CallCard controller={controller} />
        <section className="how">
          <div className="eyebrow">
            {t("PROSTO, KROK PO KROKU", "ONE STEP AT A TIME")}
          </div>
          <div className="steps">
            {[
              [
                "01",
                t("Powiedz, czego potrzebujesz", "Tell Klara what you need"),
                t(
                  "Wybierz lekarza i dogodny termin.",
                  "Choose a doctor and a time that suits you.",
                ),
              ],
              [
                "02",
                t("Potwierdź dane w formularzu", "Verify details in the form"),
                t(
                  "Klara otworzy go, gdy będzie potrzebny.",
                  "Klara opens it when verification is needed.",
                ),
              ],
              [
                "03",
                t("Zatwierdź szczegóły wizyty", "Confirm your appointment"),
                t(
                  "Rezerwacja dopiero po potwierdzeniu z systemu.",
                  "Booked only after the clinic system confirms.",
                ),
              ],
            ].map(([number, title, description]) => (
              <article key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>
        <Diagnostics controller={controller} />
      </main>
      <footer>
        <span>
          ClinicLine<span className="brand-dot">.</span>
        </span>
        <p>
          {t(
            "Demonstracja technologii głosowej. To nie jest usługa medyczna.",
            "A voice technology demo. This is not a medical service.",
          )}
        </p>
        <span>POWERED BY LIVEKIT</span>
      </footer>
      {form && (
        <VerificationForm
          key={form.requestId}
          request={form}
          language={language}
          dismiss={dismiss}
          submit={controller.submit}
        />
      )}
    </div>
  );
}
