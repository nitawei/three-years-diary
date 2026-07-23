# The Three Years Journey (三年時光日記)

A premium, private, and minimalist 3-year digital journal designed using Apple Human Interface principles. 

Designed for calm reflection and timeless writing, this app presents a structured grid editor, a non-gamified emotional heatmap, and complete offline capability.

---

## Key Features

- **Apple-inspired Aesthetics**: Soft transitions, custom Outfit/Noto Serif typography, tailored light/dark mode adjustments, and premium rounded corner cards.
- **50-Character Grid Editor**: Standard 10x5 grid reflecting traditional manuscript columns, complete with cursor track highlights for insertions and deletions.
- **Natural Mood Heatmap**: A calm, timelines-centered daily color block that transitions gently over 250ms when the daily journal is completed.
- **Local-First & Privacy Encrypted**: Powered by browser-native IndexedDB. Features AES-GCM encrypted backup exports with password-key derivation (PBKDF2) to keep your thoughts private.
- **PWA & Offline Protection**: A Service Worker caches static assets and external fonts. Includes an automated keystroke draft auto-saver and online retry sync queue to ensure zero data loss.
- **Automated Integration Tests**: Built-in test suite evaluating core components (Unit, DB, Sharing, Permissions, Validation, Cryptography).

---

## Tech Stack

- **Frontend**: Vanilla HTML5, Vanilla CSS3 (custom CSS variables), ES6 JavaScript.
- **Storage**: IndexedDB (browser database) & `localStorage` (session configuration and drafts).
- **Libraries**: Lucide Icons, Google Fonts (Outfit & Noto Serif TC).

---

## Local Setup

### 1. Serve the files
Run a simple HTTP server in the repository directory:
```bash
# Python 3
python3 -m http.server 8080
```

### 2. Access the Application
Open your web browser and navigate to:
[http://localhost:8080](http://localhost:8080)

---

## Running Integration Tests

To run the automated suite directly inside your browser, load the URL with the `run-tests` query parameter:
[http://localhost:8080/?run-tests=true](http://localhost:8080/?run-tests=true)

---

## Project Structure

```
├── index.html            # Main application layout & onboarding flows
├── style.css             # Unified CSS variables (Design System) & page layout
├── app.js                # Page router, event bindings, and sync loops
├── db.js                 # Database wrapper managing local IndexedDB instances
├── crypto-service.js     # AES-GCM symmetric encryption helper routines
├── export-service.js     # Print/PDF layout generator for archives
├── utils.js              # Date formatting, weekdays, and XSS sanitizers
├── sw.js                 # PWA Service Worker for offline asset caching
└── browser-tests.js      # Self-contained integration test suite
```
