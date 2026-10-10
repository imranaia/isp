# Independent Structure Platform (ISP)

Campaign platform for Abdurrahman Bashir Haske, APM governorship candidate, Adamawa State (2027).

- **Landing page** (`/`): hero, about, the ADAMAWA First agenda, running mate, 3D gallery. The super admin edits it from the dashboard.
- **Sign in** (`/login`) and **dashboard** (`/dashboard`).
- **Structure**: Super Admin → LGA Agents → Ward Agents → Polling Unit Agents → Supporters.
  Each level can only add the levels below it and only sees the people under it.
- **Locations**: all 21 LGAs. The super admin adds wards and polling units; agents are assigned by picking LGA → ward → polling unit.
- **Uploads**: every agent has their own Excel template (name, role and area on top). Uploads are credited to that agent and wait for the super admin to approve them.
- **Printing**: every table, agent list, upload and LGA can be printed with a header and signature lines.
- **Voter's card verification** with Dojah (VIN → full voter record).
- **Excel**: download a template, fill it, upload it to add many supporters at once. Any table can be exported to Excel.

## Run it

1. Install Node.js 22.13 or newer (nothing else to install).
2. Copy `.env.example` to `.env` and fill in the Dojah keys.
3. Run `npm start` in this folder.
4. Open http://localhost:3001

The first start creates the super admin from `ADMIN_LOGIN` / `ADMIN_PASSWORD` in `.env`.
Change that password after signing in (My Account).

## Going live with Dojah

In `.env`, set `DOJAH_BASE_URL=https://api.dojah.io` and put in the live App ID and secret key.
The sandbox returns the same made-up voter for every VIN.

## Data

Everything is stored in `data/isp.db` (SQLite). Uploaded pictures go in `public/uploads/`.
Back up both folders. Keys stay on the server and are never sent to the browser.
