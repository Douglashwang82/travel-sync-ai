import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — TravelSync AI",
};

const EFFECTIVE_DATE = "2026-04-18";
const CONTACT_EMAIL = "privacy@travelsync.ai";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-sm leading-relaxed text-gray-800">
      <h1 className="text-2xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-gray-500 mb-8">Effective date: {EFFECTIVE_DATE}</p>

      <Section title="1. Who we are">
        <p>
          TravelSync AI ("we", "our", "us") operates a LINE Messaging API chatbot and associated
          web services (the "Service") that helps groups plan travel. Our contact email is{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>

      <Section title="2. Data we collect">
        <ul className="list-disc list-inside space-y-1">
          <li>LINE user IDs and display names of group members</li>
          <li>LINE group IDs</li>
          <li>Messages you send to the bot (slash commands and parsed travel mentions)</li>
          <li>Trip planning data: destinations, dates, options, votes, expenses, documents</li>
          <li>Device metadata sent by the LINE platform (IP address, device type)</li>
          <li>Usage events for product analytics (anonymised)</li>
        </ul>
      </Section>

      <Section title="3. How we use your data">
        <ul className="list-disc list-inside space-y-1">
          <li>To provide and improve the trip-planning features of the Service</li>
          <li>To send trip-related notifications to your LINE group</li>
          <li>To calculate expense splits and generate trip summaries</li>
          <li>To detect errors and monitor service health</li>
        </ul>
        <p className="mt-2">
          We do <strong>not</strong> sell your personal data to third parties. We do not use your
          data for targeted advertising.
        </p>
      </Section>

      <Section title="4. Data sharing">
        <p>
          We share data only with the following sub-processors required to operate the Service:
        </p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>Supabase, Inc. — database hosting (US/EU)</li>
          <li>Vercel, Inc. — serverless hosting (US/EU)</li>
          <li>Google LLC — Gemini AI API and Maps API</li>
          <li>LINE Corporation — messaging delivery</li>
          <li>Sentry, Inc. — error monitoring</li>
        </ul>
      </Section>

      <Section title="5. Data retention">
        <ul className="list-disc list-inside space-y-1">
          <li>Active trip data is retained for the duration of the trip plus 12 months</li>
          <li>Analytics events are retained for 24 months</li>
          <li>
            You may request deletion of all your data at any time — see Section 7 below
          </li>
        </ul>
      </Section>

      <Section title="6. Cookies and local storage">
        <p>
          The LIFF web app uses browser local storage to cache your LINE session token. No
          third-party tracking cookies are set.
        </p>
      </Section>

      <Section title="7. Your rights">
        <p>
          You have the right to access, correct, or delete your personal data. To exercise these
          rights, send <code className="bg-gray-100 px-1 rounded">/delete-my-data</code> in any
          group chat where the bot is present, or email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 underline">
            {CONTACT_EMAIL}
          </a>
          . We will process your request within 30 days.
        </p>
      </Section>

      <Section title="8. Security">
        <p>
          All data is transmitted over TLS. Database access uses Row Level Security. Service
          credentials are stored as environment secrets and are never logged or exposed to
          clients.
        </p>
      </Section>

      <Section title="9. Changes to this policy">
        <p>
          We may update this policy. The effective date above will reflect the latest revision.
          Continued use of the Service after changes constitutes acceptance of the updated policy.
        </p>
      </Section>

      <Section title="10. Contact">
        <p>
          Questions about this policy? Contact us at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 underline">
            {CONTACT_EMAIL}
          </a>
          .
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
