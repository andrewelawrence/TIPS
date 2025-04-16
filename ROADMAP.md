# TIPS Extension Roadmap

This document outlines the planned development stages for the TIPS browser extension.

## Version 0.4.1 (Completed)

**Goal:** Refocused on core interpretation functionality with improved context handling via user interaction (context menus, session storage), and enhanced usability through a welcome page and updated popup UI. Version bump to 0.4.1 for minor fixes/cleanup.

## Future Versions (Tentative)

*   **V0.5.0: Refinements & User Feedback**
    *   User feedback mechanism on interpretation quality (e.g., simple thumbs up/down in popup sending data to background).
    *   More robust error handling and display (e.g., showing specific API errors in popup).
    *   Code refactoring and further optimization.
*   **V0.6.0: Advanced Features / Logging**
    *   Optional, anonymous usage data logging (with consent) to a backend service (e.g., MongoDB Atlas via a simple proxy) for analysis.
    *   Revisit Preview/Suggest features based on feasibility and user interest.
    *   User settings/preferences page (e.g., API key input, model selection?).

## Removed Features (Post v0.3.x)
*   Removed due to time constraints.
    *   **Preview ('P'):** Removed in v0.4.0 for simplification.
    *   **Suggest ('S'):** Removed in v0.4.0 for simplification.
    *   **Automatic Context Extraction (`Readability`/DOM):** Replaced by user-driven "Add to Context" and simpler DOM fallback in v0.4.1.
