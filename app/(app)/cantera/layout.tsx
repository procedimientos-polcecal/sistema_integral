import { ConfirmProvider } from "@/components/ConfirmProvider";

export default function CanteraLayout({ children }: { children: React.ReactNode }) {
  return <ConfirmProvider>{children}</ConfirmProvider>;
}
