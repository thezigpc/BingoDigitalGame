import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ErrorBoundary, VenueAnnouncement } from "@bargames/gamekit/client";
import { AdminPage } from "./pages/AdminPage";
import { HomePage } from "./pages/HomePage";
import { RoomPage } from "./pages/RoomPage";
import { useIsSharedScreen } from "./sharedScreen";
import { useVenue } from "./useVenue";
import "./index.css";

/**
 * Bar Games: keeps the venue theme applied everywhere, and shows the staff's
 * announcement on every phone page (landing, join, room, admin). Never on a TV or
 * shared screen: a Table, the host's own big-screen board, or a ?as=table link that's
 * about to join as one. Off a box it renders nothing.
 */
function Venue() {
  const venue = useVenue();
  const shared = useIsSharedScreen();
  const { search } = useLocation();
  const tableLink = new URLSearchParams(search).get("as") === "table";
  return <VenueAnnouncement ctx={venue} hidden={shared || tableLink} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Venue />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/join/:code" element={<HomePage />} />
          <Route path="/room/:code" element={<RoomPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
