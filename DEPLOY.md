# FlatFinder — Complete Railway Deployment Guide

## What Railway Needs from You

| Variable | Where to Get It |
|---|---|
| `JWT_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `MYSQLHOST` | Auto-injected by Railway MySQL plugin |
| `MYSQLPORT` | Auto-injected by Railway MySQL plugin |
| `MYSQLUSER` | Auto-injected by Railway MySQL plugin |
| `MYSQLPASSWORD` | Auto-injected by Railway MySQL plugin |
| `MYSQLDATABASE` | Auto-injected by Railway MySQL plugin |
| `CLOUDINARY_CLOUD_NAME` | From [cloudinary.com](https://cloudinary.com) → Dashboard |
| `CLOUDINARY_UPLOAD_PRESET` | Cloudinary → Settings → Upload → Add Upload Preset (set to **Unsigned**) |
| `CLOUDINARY_API_KEY` | Cloudinary → Dashboard |
| `CLOUDINARY_API_SECRET` | Cloudinary → Dashboard |
| `NODE_ENV` | Set to `production` |

---

## Step-by-Step Railway Deployment

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial FlatFinder deployment"
git remote add origin https://github.com/YOUR_USERNAME/flatfinder.git
git push -u origin main
```

### 2. Create Railway Project
1. Go to [railway.app](https://railway.app) → New Project
2. Click **Deploy from GitHub repo** → Select your repository
3. Railway auto-detects Node.js and uses `railway.json` for config

### 3. Add MySQL Plugin
1. In your Railway project → **+ New** → **Database** → **MySQL**
2. Click on the MySQL service → **Variables** tab — Railway auto-injects `MYSQLHOST`, `MYSQLPORT`, etc. into your app service

### 4. Set Environment Variables
In your app service → **Variables** tab, add:
```
JWT_SECRET    = <your 64-char hex secret>
NODE_ENV      = production
CLOUDINARY_CLOUD_NAME    = your_cloud_name
CLOUDINARY_UPLOAD_PRESET = your_unsigned_preset
CLOUDINARY_API_KEY       = your_api_key
CLOUDINARY_API_SECRET    = your_api_secret
```

### 5. Run Database Schema
1. Railway project → MySQL service → **Query** tab (or use a MySQL client)
2. Run the full contents of `schema.sql`

### 6. Deploy
Railway auto-deploys when you push to GitHub. To manually trigger:
- Railway Dashboard → **Deploy** → **Deploy Now**

### 7. Verify
- Visit your Railway URL: `https://your-app.up.railway.app`
- The app should load the login page
- Check `/api/ping` — should return `{"success":true,"message":"OK — MySQL connected."}`

---

## Health Check
Railway uses `GET /api/ping` (configured in `railway.json`) to verify your deployment is alive. If it returns non-200, Railway will restart the container.

---

## Local Development
```bash
# Windows
double-click start.bat

# Or manually:
cp .env.example .env
# Edit .env with your local MySQL credentials
npm run dev
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| "MySQL not connected" | Check Railway MySQL plugin is linked; verify Variables are injected |
| "JWT_SECRET is not set" | Add `JWT_SECRET` to Railway Variables |
| Images not uploading | Set `CLOUDINARY_CLOUD_NAME` and `CLOUDINARY_UPLOAD_PRESET` (must be **unsigned**) |
| App shows blank page | Open browser DevTools → Console; check for JS errors |
| CORS error | Your frontend URL must match `*.railway.app` or add it to `FRONTEND_ORIGIN` |
| "Too many requests" | Rate limiter is working — wait 15 minutes or reduce test frequency |
