import "@/assets/tailwind.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { SignInFrame } from "./SignInFrame"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SignInFrame />
  </StrictMode>
)
