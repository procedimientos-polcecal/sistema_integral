import { ConfirmProvider } from "@/components/ConfirmProvider";

export default function AdministracionLayout({ children }: { children: React.ReactNode }) {
  return <ConfirmProvider>{children}</ConfirmProvider>;
}
