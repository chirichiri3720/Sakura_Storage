import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import SakurazakaStorage from "./sakurazaka46_storage.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SakurazakaStorage />
  </StrictMode>
);