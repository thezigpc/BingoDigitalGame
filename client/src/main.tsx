import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { basePath, ErrorBoundary, VenueAnnouncement } from "@bargames/gamekit/client";
import { AdminPage } from "./pages/AdminPage";
import { HomePage } from "./pages/HomePage";
import { RoomPage } from "./pages/RoomPage";
import { useVenue } from "./useVenue";
import "./index.css";

/**
 * Bar Games: keeps the venue theme applied everywhere, and shows the staff's
 * announcement on every phone page (landing, join, room, admin). Never on a TV or
 * shared screen: the room page marks those (the SDK's tableMode / markSharedScreen) and
 * the strip hides itself there; a ?as=table link that's about to join as one is hidden
 * here. Off a box it renders nothing.
 */
function Venue() {
  const venue = useVenue();
  const { search } = useLocation();
  // A ?as=table link is about to join as a TV; the room page marks the screen once it has.
  const tableLink = new URLSearchParams(search).get("as") === "table";
  // SDK 0.11.0: the strip follows the staff's "show" (everywhere / phones / TVs) and
  // "position" (top / bottom). It's mounted here for every page, TV views included; the
  // layout makes room for it through --bargames-announcement-top/-bottom (kit 0.7.2).
  return <VenueAnnouncement ctx={venue} hidden={tableLink} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {/* basePath(): "/bingo" under a path prefix, "" at the root. */}
      <BrowserRouter basename={basePath()}>
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
