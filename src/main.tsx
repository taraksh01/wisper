import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import App from "./App";
import { isDev } from "./appConfig";

if (isDev) {
  document.documentElement.setAttribute("data-dev", "true");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
