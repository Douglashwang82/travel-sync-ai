import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — TravelSync AI",
};

const EFFECTIVE_DATE = "2026-04-18";
const CONTACT_EMAIL = "legal@travelsync.ai";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-sm leading-relaxed text-gray-800">
      <h1 className="text-2xl font-bold mb-2">Terms of Service</h1>
      <p className="text-gray-500 mb-8">Effective date: {EFFECTIVE_DATE}</p>

      <Section title="1. Acceptance">
        <p>
          By adding TravelSync AI to your LINE group or using any of its web interfaces, you agree
          to these Terms of Service ("Terms"). If you do not agree, please remove the bot from
          your group.
        </p>
      </Section>

      <Section title="2. Description of the Service">
        <p>
          TravelSync AI is an AI-assisted trip planning assistant delivered as a LINE chatbot and
          companion web app. It helps groups plan travel, record expenses, vote on options, and
          track documents. The Service is provided "as is" and is intended for personal, non-
          commercial group travel planning.
        </p>
      </Section>

      <Section title="3. Eligibility">
        <p>
          You must be at least 13 years old to use the Service. By using the Service, you confirm
          that you meet this requirement.
        </p>
      </Section>

      <Section title="4. Acceptable use">
        <p>You agree not to:</p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>Use the Service for any illegal purpose</li>
          <li>Attempt to reverse-engineer or scrape the Service</li>
          <li>Submit content that is abusive, harmful, or infringes third-party rights</li>
          <li>Automate interactions with the bot in ways that overload the Service</li>
        </ul>
      </Section>

      <Section title="5. AI-generated content">
        <p>
          The Service uses large language models (Google Gemini) to parse messages and generate
          recommendations. AI output may contain errors. You are responsible for verifying any
          travel-critical information (booking references, document expiry dates, costs) before
          acting on it. We are not liable for losses arising from reliance on AI-generated content.
        </p>
      </Section>

      <Section title="6. Expense splitting">
        <p>
          Expense records and settlement calculations are provided as a convenience tool. They do
          not constitute financial advice or legally binding obligations. Disputes between group
          members regarding expenses are solely between those members.
        </p>
      </Section>

      <Section title="7. Intellectual property">
        <p>
          All rights in the Service (code, design, branding) are owned by TravelSync AI. Content
          you submit (messages, trip data) remains yours; you grant us a limited licence to
          process it solely to provide the Service.
        </p>
      </Section>

      <Section title="8. Disclaimers and limitation of liability">
        <p>
          THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. TO THE MAXIMUM EXTENT
          PERMITTED BY LAW, WE DISCLAIM ALL LIABILITY FOR INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
          DAMAGES ARISING FROM YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY SHALL NOT EXCEED THE
          AMOUNT YOU PAID US IN THE 12 MONTHS PRECEDING THE CLAIM (WHICH FOR A FREE SERVICE IS
          ZERO).
        </p>
      </Section>

      <Section title="9. Termination">
        <p>
          We may suspend or terminate your access to the Service at any time if you breach these
          Terms. You may stop using the Service at any time by removing the bot from your group.
        </p>
      </Section>

      <Section title="10. Governing law">
        <p>
          These Terms are governed by the laws of Taiwan (R.O.C.), without regard to conflict-of-
          law provisions.
        </p>
      </Section>

      <Section title="11. Changes">
        <p>
          We may modify these Terms by posting an updated version. Continued use of the Service
          after changes constitutes acceptance of the revised Terms.
        </p>
      </Section>

      <Section title="12. Contact">
        <p>
          Legal enquiries:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 underline">
            {CONTACT_EMAIL}
          </a>
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-base font-semibold mb-2">{title}</h2>
      {children}
    </section>
  );
}
