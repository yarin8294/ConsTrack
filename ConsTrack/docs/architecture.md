# ConsTrack — Architecture Overview

**What is ConsTrack?**
ConsTrack is a web application for tracking construction site progress using 3D point cloud scans. Workers upload LiDAR or photogrammetry scans taken at different times (t₁ = early, t₂ = later). The backend computes how much volume has changed between the two scans — revealing how much work has been done. A dashboard shows overall progress, forecasts a completion date, and alerts managers to zones that are lagging behind.

---

## The Big Picture: Two Separate Applications

```
┌─────────────────────────────┐        HTTP / WebSocket        ┌────────────────────────────────┐
│  FRONTEND  (React, port 5173)│ ◄─────────────────────────── │  BACKEND  (Express, port 4000)  │
│  What the user sees          │ ────────────────────────────► │  Business logic + Database      │
└─────────────────────────────┘                                └────────────────────────────────┘
```

Think of it like a restaurant:
- **Frontend** = the dining room. The user interacts with it, sees menus (pages), places orders (API calls).
- **Backend** = the kitchen. It receives orders, talks to storage (MongoDB), runs heavy work (Python scripts), and sends results back.
- **MongoDB** = the pantry. Permanent storage for projects, zones, scans, runs, reports, and users.
- **Python scripts** = specialist chefs. The Node.js backend calls them for point cloud math it cannot do itself.

---

## Backend File Structure

```
backend/src/
├── index.ts          ← Entry point: starts the server
├── app.ts            ← Configures Express + mounts all routes
├── db.ts             ← Connects to MongoDB
├── models.ts         ← Mongoose schemas (Project, Zone, Scan, Run, Report, User)
├── realtime.ts       ← WebSocket pub/sub (notifies browser when a run finishes)
├── reports.ts        ← PDF and Excel report generation
├── middleware/
│   ├── auth.ts       ← JWT token verification
│   └── upload.ts     ← File upload handling (multer)
├── services/
│   ├── email.ts      ← Password reset emails (Brevo)
│   ├── python.ts     ← Runs Python scripts for volume calculation
│   └── pointCloud.ts ← In-memory cache for parsed 3D point data
├── utils/
│   └── calculations.ts ← Progress %, confidence rating, completion forecast
└── routes/
    ├── auth.ts       ← /api/auth/* (register, login, forgot/reset password)
    ├── projects.ts   ← /api/projects
    ├── zones.ts      ← /api/zones
    ├── scans.ts      ← /api/scans
    ├── runs.ts       ← /api/runs (triggers Python computation)
    ├── dashboard.ts  ← /api/dashboard
    ├── reports.ts    ← /api/reports
    ├── ai.ts         ← /api/chat, /api/recommendations (Gemini AI)
    └── schedule.ts   ← /api/schedule/sync, /api/work-diary
```

### `index.ts` — Entry Point (25 lines)

The only thing it does:
1. Call `connectDb()` to connect to MongoDB.
2. Call `createApp()` to get the configured Express server.
3. Call `app.listen(4000)` to start accepting requests.
4. Attach a WebSocket server for real-time browser updates.

Previously this file was 1,194 lines doing everything. Now it is a clean starting point.

### `app.ts` — Express Factory

Creates the Express application and wires everything together:
- Enables CORS (allows the frontend at port 5173 to talk to the backend at port 4000).
- Parses JSON request bodies.
- Mounts every router under `/api/...`.
- Serves downloadable report files from disk.

### `db.ts` — Database Connection

Calls `mongoose.connect()` with the MongoDB URL from `.env`. Mongoose is an Object Document Mapper (ODM) — it lets you work with database records as JavaScript objects instead of raw database queries.

### `models.ts` — Data Shapes

Defines what data looks like in MongoDB using Mongoose schemas:

| Model | What it stores |
|-------|---------------|
| `Project` | Name, description, creation date |
| `Zone` | Name, type (floor/wall/etc), parent zone (for hierarchy), linked project |
| `Scan` | File path, capture date, size, notes, linked zone |
| `Run` | Which two scans were compared, computed volumes, progress %, confidence |
| `Report` | Generated PDF/Excel file path, linked project |
| `User` | Email, hashed password, reset token |

### `middleware/auth.ts` — Who Are You?

Every protected API route calls this first. It:
1. Reads the `Authorization: Bearer <token>` header.
2. Verifies the JWT (JSON Web Token) signature using the secret key.
3. Attaches the user's ID and email to the request so route handlers can use it.
4. Returns `401 Unauthorized` if the token is missing or invalid.

A JWT is like a signed wristband at an event — you get it when you log in, and you show it on every future request to prove you belong.

### `middleware/upload.ts` — File Handling

Uses **multer** to:
- Save uploaded point cloud files to `backend/uploads/` on disk.
- Sanitize filenames (strip dangerous characters).
- Validate that uploaded files have a recognized extension (`.las`, `.laz`, `.ply`, etc.).

### `services/email.ts` — Password Reset Emails

Initializes the **Brevo** (formerly Sendinblue) email client using an API key from `.env`. Exposes two functions:
- `sendPasswordResetEmail(to, resetUrl)` — sends the "reset your password" link.
- `sendTestEmail(to)` — used by the `/api/debug-email` route to verify email delivery works.

### `services/python.ts` — Running Python

The backend cannot do 3D point cloud math itself — it delegates to Python scripts:
- `runPythonVolumeDiff(t1Path, t2Path, voxelSize)` — computes how much volume changed between two scans. Returns `{ volumeT1, volumeT2 }`.
- `runPythonExtractPoints(filePath, maxPoints)` — reads a scan file and returns an array of 3D coordinates and colors for visualization.

These functions use Node.js `child_process.spawn` to launch a Python process, wait for it to finish, and parse the JSON it prints to stdout.

### `services/pointCloud.ts` — In-Memory Cache

Parsing large point cloud files takes seconds. This cache stores already-parsed results in RAM for up to 1 hour:
- `addToCache(scanId, points, colors)` — saves parsed data.
- `getFromCache(scanId)` — returns cached data or `null` if expired/missing.
- Max 10 entries; oldest are evicted when full.

### `utils/calculations.ts` — Math Helpers

Pure functions with no side effects:

| Function | What it does |
|----------|-------------|
| `calcOverallProgress(v1, v2)` | Returns 0–100% based on how much volume changed |
| `pickConfidence(volumeChange)` | Returns `"high"`, `"medium"`, or `"low"` based on volume difference magnitude |
| `forecastDateISO(progressPct)` | Extrapolates a completion date from current progress rate |
| `getLeafZones(projectId)` | Returns zones that have no child zones (used for run calculations) |

### `routes/` — API Endpoints

Each file handles one domain. Every handler follows the same pattern:
```
1. Authenticate (middleware)
2. Validate input
3. Read/write MongoDB
4. Return JSON
```

**`routes/runs.ts`** is the most complex — when a run is POSTed:
1. Save a `Run` document with status `"pending"`.
2. Immediately return `202 Accepted` to the browser.
3. In the background: call `runPythonVolumeDiff()`.
4. When Python finishes: update the Run document with results.
5. Publish a `run.done` WebSocket event so the browser refreshes automatically.

### `realtime.ts` — WebSocket

Maintains a list of connected browser clients. When a run finishes, the backend calls `publish("run.done", { projectId })`. Every browser tab listening on that project receives the message and re-fetches its data — no manual page refresh needed.

---

## Frontend File Structure

```
src/
├── main.tsx                    ← React entry point
├── app/
│   ├── routes.tsx              ← Page routing (React Router)
│   ├── format.ts               ← formatBytes(), formatDate()
│   ├── data/
│   │   ├── AppDataProvider.tsx ← God-object context (being phased out gradually)
│   │   ├── useAppData.ts       ← Hook to consume AppDataProvider
│   │   ├── api.ts              ← Typed fetch wrapper
│   │   └── types.ts            ← All TypeScript interfaces
│   ├── project/
│   │   ├── ProjectContext.tsx  ← Active project + project list state
│   │   └── useProject.ts       ← Hook to consume ProjectContext
│   └── realtime/
│       ├── RealtimeProvider.tsx ← WebSocket connection + event pub/sub
│       └── useRealtime.ts       ← Hook to consume RealtimeProvider
├── features/
│   └── scans/
│       ├── hooks/
│       │   └── useScans.ts     ← Facade: exposes only scan-relevant data
│       └── components/
│           ├── ScanCard.tsx    ← Single scan display card
│           ├── ScanList.tsx    ← Grid of all scans
│           └── ScanUploader.tsx ← Upload form
├── pages/
│   ├── scans/UploadComparePage.tsx
│   ├── dashboard/DashboardPage.tsx
│   ├── zones/ZonesPage.tsx
│   ├── model/ModelPage.tsx
│   └── ...
└── components/
    └── ui/
        ├── Card.tsx
        ├── Button.tsx
        ├── Input.tsx
        └── Select.tsx
```

---

## Key Frontend Concepts

### React Components

A component is a function that returns HTML-like JSX. Every piece of UI — a button, a card, a whole page — is a component. Components receive **props** (inputs) and return what to render.

```tsx
function ScanCard({ scan, isT1 }: { scan: Scan; isT1: boolean }) {
  return <div>{scan.name} {isT1 && <span>t₁</span>}</div>;
}
```

### TypeScript

TypeScript adds type annotations to JavaScript. Instead of discovering at runtime that `scan.name` is undefined, TypeScript tells you at compile time. The type definitions live in [src/app/data/types.ts](../src/app/data/types.ts).

### Vite

Vite is the build tool. It:
- Bundles all `.tsx` files into one JavaScript file the browser can run.
- Runs a dev server on port 5173 with hot reload (changes appear instantly without page refresh).
- Proxies `/api` requests to `localhost:4000` so the frontend and backend appear to be one server.

### React Context + Providers

Context is React's built-in global state mechanism. A **Provider** component wraps the app tree and makes data available to any child — without prop drilling.

```tsx
// Provider wraps the app
<ProjectProvider>
  <RealtimeProvider>
    <AppDataProvider>
      <YourPage />
    </AppDataProvider>
  </RealtimeProvider>
</ProjectProvider>
```

Any component inside can call the corresponding hook to access the data:
```tsx
const { activeProjectId } = useProject();
const { subscribe } = useRealtime();
const { data, isLoading } = useAppData();
```

### Provider Hierarchy

```
<ProjectProvider>          ← Which project is active? What projects exist?
  │
  └── <RealtimeProvider>   ← WebSocket: reads activeProjectId from ProjectProvider
        │
        └── <AppDataProvider> ← Loads zones/scans/runs for the active project
                                 Reads from both providers above
```

This order matters. Each provider can only use hooks from providers **above** it in the tree.

### Hooks

Hooks are functions that start with `use`. They let components access state, side effects, and context. The rules:
- Only call hooks at the top level of a component or another hook.
- Never inside `if` statements or loops.

Key hooks used in ConsTrack:

| Hook | What it does |
|------|-------------|
| `useState` | Stores a value that causes a re-render when changed |
| `useEffect` | Runs code after render (data fetching, subscriptions) |
| `useContext` | Reads from a React Context |
| `useCallback` | Memoizes a function so it isn't recreated every render |
| `useRef` | Stores a value without triggering re-renders (e.g., WebSocket instance) |
| `useNavigate` | React Router hook for programmatic navigation |

### Facade Hooks (the `features/` pattern)

Instead of every component calling `useAppData()` and getting the entire god object, feature hooks expose only what their domain needs:

```ts
// src/features/scans/hooks/useScans.ts
export function useScans() {
  const ctx = useAppData();
  return {
    scans: ctx.data.scans,
    isLoading: ctx.isLoading,
    addScan: ctx.addScan,
    removeScan: ctx.removeScan,
    setSelectedT1: ctx.setSelectedT1,
    setSelectedT2: ctx.setSelectedT2,
  };
}
```

`ScanUploader` calls `useScans()` — it has no idea `AppDataProvider` exists. When AppDataProvider is eventually replaced, only `useScans.ts` needs to change, not every scan component.

---

## How a Scan Upload Works End-to-End

**User action:** clicks "Choose file" in ScanUploader, picks a `.las` file.

```
1. ScanUploader.tsx
   └── calls addScan(file, capturedAtISO, notes, zoneId)

2. useScans.ts (facade)
   └── forwards to ctx.addScan (from AppDataProvider)

3. AppDataProvider.tsx
   └── calls api.post("/api/scans/upload", formData)

4. api.ts
   └── fetch("http://localhost:4000/api/scans/upload", { method: "POST", body: formData })
       Includes Authorization header with JWT token

5. backend/src/middleware/auth.ts
   └── verifies JWT → attaches user to request

6. backend/src/middleware/upload.ts
   └── multer saves file to backend/uploads/<sanitized-name>.las

7. backend/src/routes/scans.ts  (POST /api/scans/upload)
   └── creates Scan document in MongoDB
   └── returns { id, name, sizeBytes, capturedAtISO, ... }

8. AppDataProvider.tsx
   └── receives new scan → calls loadAll() to refresh state

9. React re-renders
   └── ScanList shows the new scan card
   └── ScanUploader shows "Upload successful" for 2 seconds
```

---

## Data Flow: AppDataProvider

AppDataProvider is the current central state store. On mount (and whenever the active project changes):

```
1. setDataLoading(true)
2. loadAll(activeProjectId):
   - GET /api/zones        → data.areas
   - GET /api/scans        → data.scans
   - GET /api/runs         → data.runs
   - GET /api/dashboard    → data.dashboard
   - GET /api/reports      → data.reports
   - GET /api/schedule/work-diary → data.workDiary
3. setDataLoading(false)
```

All data is stored in one `data` object. When any mutation (add, update, delete) completes, `loadAll` is called again to keep the UI in sync with the database.

Real-time updates work via the subscription from `RealtimeProvider`:
```ts
subscribe("run.done", () => loadAll(activeProjectId));
subscribe("run.created", () => loadAll(activeProjectId));
```

---

## Authentication Flow

```
Login page
  └── POST /api/auth/login { email, password }
        └── bcrypt.compare(password, user.passwordHash)
        └── jwt.sign({ userId, email }, SECRET, { expiresIn: "7d" })
        └── returns { token }

Frontend stores token in localStorage["constrack_token"]

Every subsequent API call:
  └── api.ts reads token from localStorage
  └── adds header: Authorization: Bearer <token>
  └── backend middleware verifies → allows or rejects
```

---

## CSS and Theming

ConsTrack uses **Tailwind CSS** with a custom dark/light theme system built on CSS custom properties (variables). The variables are defined in [src/styles/globals.css](../src/styles/globals.css):

```css
:root {
  --bg: #ffffff;
  --surface: #f4f4f5;
  --accent: #18181b;
  ...
}

.dark {
  --bg: #09090b;
  --surface: #18181b;
  --accent: #fafafa;
  ...
}
```

Tailwind utility classes like `bg-app`, `text-app`, `border-app` are mapped to these variables, so switching the `.dark` class on `<html>` instantly changes the whole UI — no component needs to know about the theme.

---

## 3D Visualization

The `/model` page uses **Three.js** to render point clouds in a WebGL canvas:

1. Frontend calls `GET /api/scans/:id/points`.
2. Backend calls `runPythonExtractPoints()` — Python reads the `.las` file and outputs a JSON array of `[x, y, z, r, g, b]` values.
3. Results are cached in `services/pointCloud.ts` for 1 hour.
4. Frontend receives the points, creates a `THREE.Points` object with `THREE.BufferGeometry`, and renders it.

The Python library **laspy** reads LiDAR files; **Open3D** handles PLY/PCD formats.

---

## Where to Start When Something Breaks

| Symptom | Where to look |
|---------|--------------|
| Page shows "Loading…" forever | `AppDataProvider.tsx` → `loadAll()`, check the network tab |
| API returns 401 Unauthorized | `middleware/auth.ts`, check token in localStorage |
| File upload fails | `middleware/upload.ts`, check `backend/uploads/` folder permissions |
| Run shows "pending" forever | `routes/runs.ts` → background job, check Python path in `.env` |
| WebSocket not connecting | `realtime.ts` (backend), `RealtimeProvider.tsx` (frontend) |
| 3D viewer blank | `routes/scans.ts` → `/points` endpoint, check Python output |
| Email not received | `services/email.ts`, check `BREVO_API_KEY` in `.env` |

---

## Environment Variables (`.env` files)

**`backend/.env`**
```
MONGODB_URI=mongodb://localhost:27017/constrack
JWT_SECRET=your-secret-key
BREVO_API_KEY=your-brevo-key
FROM_EMAIL=noreply@example.com
FROM_NAME=ConsTrack
GEMINI_API_KEY=your-gemini-key
UPLOAD_DIR=./uploads
REPORTS_DIR=./downloads/reports
PYTHON_PATH=python
PORT=4000
```

**`frontend/.env` (or `vite.config.ts` proxy)**
```
VITE_API_URL=http://localhost:4000
```

---

*Generated from the ConsTrack codebase — last updated after the backend modularization refactor (index.ts split into 14 files) and the Strangler Fig frontend refactor (Phase 1: ProjectContext, Phase 2: RealtimeProvider, Phase 3a: scans feature).*
