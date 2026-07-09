import SummitApp from "@/components/summit/SummitApp";

export const metadata = {
  title: "Trusty Sevan — who should you meet next?",
};

/** Trusty Sevan — the event edition of Trusty. A mobile-first networking surface
 *  over the admin-defined "summit" App (its own space; persons shared with the
 *  main app). Recommendations are match-based ("who should I meet next?"), not
 *  trust-based — trust is the final lifecycle stage, not the starting signal. */
export default function SummitPage() {
  return <SummitApp />;
}
