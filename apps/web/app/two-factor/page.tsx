import { Suspense } from "react";
import { TwoFactorForm } from "../components/TwoFactorForm";

export default function TwoFactorPage() {
  return (
    <Suspense>
      <TwoFactorForm />
    </Suspense>
  );
}
