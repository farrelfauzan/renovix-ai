import { AcceptInvitationScreen } from "@/components/client/accept-invitation/accept-invitation-screen";
import { RenovixLogo } from "@/components/server/renovix-logo";

/** The invitation link's page (RX-95): it draws its own header and cards on the dark page (RNX-333). */
export default function AcceptInvitationPage() {
  return <AcceptInvitationScreen logo={<RenovixLogo layout="mark" tone="on-dark" size={30} />} />;
}
