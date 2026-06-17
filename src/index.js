import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import App from "./App";
import theme from "./theme";
import { LoadScript } from "@react-google-maps/api";

const container = document.getElementById("root");
const root = createRoot(container);

const libraries = ["places"];

root.render(
  <ThemeProvider theme={theme}>
    <LoadScript
      googleMapsApiKey={process.env.REACT_APP_GOOGLE_MAPS_API_KEY}
      libraries={libraries}
    >
      <App />
    </LoadScript>
  </ThemeProvider>
);