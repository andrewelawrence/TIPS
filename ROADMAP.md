# TIPS Extension Roadmap

This document outlines the planned development stages for the TIPS browser
extension.


## Next steps (v0.6.0)

*   **Optimization / Error Handling**
    *   More robust error handling and display.
    *   Code refactoring and further optimization.
*   **Track User Interactions**
    *   Link a MongoBD Atlas table to the extension. For each interaction with the extension, log all data passthrough.
    *   User feedback mechanism on interpretation quality (e.g., simple thumbs
        up/down in popup) that are stored in the DB.

## Removed Features (Post v0.3.x)
*   Removed due to complexity/scope changes.
    *   **Preview ('P')**
    *   **Suggest ('S')**
    *   **Automatic Context Extraction (`Readability`/DOM):** Replaced by
        screenshot context (v0.4.2) and manual context (v0.5.0).
