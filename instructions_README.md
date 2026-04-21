# FlatFinder Deployment Guide

This guide covers deploying the FlatFinder monolithic application to **Vercel** (Serverless + Frontend CDN), **Supabase** (PostgreSQL), and **Cloudinary** (Images).

## Project Structure & Architecture Overview

The repository has been recently refactored to cleanly decouple the frontend from the backend, moving away from a monolithic Express architecture to a Jamstack approach perfect for Vercel.

**Key Refactoring Changes:**
- **Frontend as Static Assets (`index.html`, `app.js`, `ff-*.js`)**: Vercel now serves all `.html`, `.css`, and frontend `.js` files via its Edge CDN. We removed the legacy `serveInjectedHtml` logic from the backend. The frontend now fetches variables dynamically on startup.
- **Serverless Backend (`api/index.js`, `vercel.json`, `server.js`)**: 
  - `vercel.json` defines routing that maps any `/api/*` traffic to a single Serverless Function (`api/index.js`).
  - `api/index.js` acts as the serverless entry point, simply exporting the Express application.
  - `server.js` detects the Vercel environment (`process.env.VERCEL`) and gracefully bypasses `app.listen()` and Node.js `cluster` setup, exporting the Express `app` for Serverless invocation.
  - A new `/api/config` endpoint was added to serve Cloudinary properties securely.
- **Supabase Integration (`db.js`, `schema.sql`)**: 
  - The `pg` connection pool logic was updated to seamlessly parse the `DATABASE_URL` standard.
  - Supabase connection pooling requires an SSL connection, so the `db.js` logic was refactored to automatically apply `ssl: { rejectUnauthorized: false }` when a `DATABASE_URL` is detected.

---

## 1. Cloudinary Setup (Images)

1. Sign up / log in to [Cloudinary](https://cloudinary.com/).
2. From the Dashboard, copy your **Cloud Name**, **API Key**, and **API Secret**.
3. Go to **Settings > Upload** and add an **Upload Preset**.
4. Set the **Signing Mode** to **Unsigned** and copy the **Preset Name**.

---

## 2. Supabase Setup (Database)

1. Sign up / log in to [Supabase](https://supabase.com/).
2. Create a new project.
3. Once created, go to **Project Settings > Database**.
4. Find the **Connection string** (URI). Select **Nodejs** and make sure **Use connection pooling** is checked (Transaction mode). Copy the `DATABASE_URL`.
5. **Database Migration**:
   - Go to the **SQL Editor** in the Supabase Dashboard.
   - Click "New query", copy the contents of `schema.sql` from the repository, paste it, and click "Run". This creates all necessary tables, triggers, and constraints.

---

## 3. GitHub & Vercel Deployment

1. **Push to GitHub**: Make sure all changes (including the new `vercel.json` and `api/index.js`) are pushed to your GitHub repository.
2. Sign in to [Vercel](https://vercel.com/) and click **Add New > Project**.
3. Import your GitHub repository.
4. **Environment Variables**: Open the "Environment Variables" section and add the following keys:

| Name | Value | Description |
|------|-------|-------------|
| `NODE_ENV` | `production` | Enables production mode |
| `JWT_SECRET` | *(Generate a 32+ char random string)* | Secret for signing auth tokens |
| `DATABASE_URL` | `postgresql://...` | Supabase Connection string (Connection pooling URL) |
| `CLOUDINARY_CLOUD_NAME` | *(Your Cloudinary Cloud Name)* | Public cloud name |
| `CLOUDINARY_UPLOAD_PRESET`| *(Your Unsigned Preset Name)* | Unsigned upload preset |
| `CLOUDINARY_API_KEY` | *(Your Cloudinary API Key)* | Required for server image deletions |
| `CLOUDINARY_API_SECRET` | *(Your Cloudinary API Secret)* | Required for server image deletions |

5. Click **Deploy**. Vercel will automatically build and route the frontend and backend.

---

## 4. Testing and Verification

1. Navigate to the domain Vercel provides (e.g., `flatfinder-xxx.vercel.app`).
2. **Account Creation**: Try creating a new account (Tenant or Owner) to verify the database connection works.
3. **Image Upload**: Log in as an Owner, navigate to "Add Flat", and try dragging and dropping an image. It should upload to Cloudinary.
4. **API Config Route**: Open `/api/config` in your browser. It should return a JSON object containing your Cloudinary Cloud Name and Preset.

---

## 5. Common Errors and Fixes

### 🔴 Error: `Cannot connect to PostgreSQL / Access Denied`
- **Cause**: Incorrect `DATABASE_URL` or SSL configuration.
- **Fix**: Verify your Supabase `DATABASE_URL` in Vercel. Ensure it uses the connection pooling port (usually 6543) and contains your database password.

### 🔴 Error: `Image uploads are not configured`
- **Cause**: The frontend cannot get Cloudinary keys from the backend.
- **Fix**: Make sure `CLOUDINARY_CLOUD_NAME` and `CLOUDINARY_UPLOAD_PRESET` are set in your Vercel Environment Variables, and that a redeployment was triggered.

### 🔴 Error: `500 Internal Server Error on /api/login`
- **Cause**: Usually missing `JWT_SECRET` or the `users` table doesn't exist.
- **Fix**: Check Vercel function logs. Ensure you ran the `schema.sql` in the Supabase SQL Editor. Make sure `JWT_SECRET` is at least 32 characters long.

### 🔴 Error: `404 Not Found` for static assets
- **Cause**: Vercel failed to find the files.
- **Fix**: Make sure you deployed from the root of the repository, and that `index.html` and `vercel.json` are in the root directory.
