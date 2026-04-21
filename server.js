// server.js — FlatFinder API Server
// Industry-grade Express + MySQL + JWT backend
// Railway-ready: reads MYSQLHOST/MYSQLUSER/MYSQLPASSWORD/MYSQLDATABASE/MYSQLPORT
// ─────────────────────────────────────────────────────────────────
import express      from 'express';
import cors         from 'cors';
import helmet       from 'helmet';
import cookieParser from 'cookie-parser';
import bcrypt       from 'bcryptjs';
import jwt          from 'jsonwebtoken';
import dotenv       from 'dotenv';
import path         from 'path';
import fs           from 'fs';
import crypto       from 'crypto';
import cluster      from 'cluster';
import os           from 'os';
import compression  from 'compression';
import rateLimit    from 'express-rate-limit';
import morgan       from 'morgan';
import { fileURLToPath } from 'url';
import { LRUCache } from 'lru-cache';
import logger from './utils/logger.js';
import { validateBody, signupSchema, loginSchema, addFlatSchema, bookingSchema } from './utils/validators.js';
import { pool, query, queryOne, validateConnection } from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app         = express();
const PORT        = parseInt(process.env.PORT || '3000', 10);
const SECRET      = process.env.JWT_SECRET;
const SALT_ROUNDS = 12;
const IS_PROD     = process.env.NODE_ENV === 'production';

// ── WINSTON OVERRIDE ──────────────────────────────────────────────
console.log   = (...args) => logger.info(args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '));
console.error = (...args) => logger.error(args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '));
console.warn  = (...args) => logger.warn(args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '));

// ── CACHE ─────────────────────────────────────────────────────────
const flatCache = new LRUCache({ max: 500, ttl: 1000 * 60 });

// ── GUARD: JWT_SECRET must be set and strong in production ───────────────
if (!SECRET) {
  logger.error('[server.js] ❌ JWT_SECRET is not set. Add it to your .env / Railway Variables.');
  process.exit(1);
}
if (IS_PROD && SECRET.length < 32) {
  logger.error('[server.js] ❌ JWT_SECRET is too short for production. Use at least 32 characters.');
  process.exit(1);
}

// ── PROCESS-LEVEL SAFETY NETS ──────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  logger.error('[Process] Unhandled Rejection at:', { promise, reason });
});
process.on('uncaughtException', (err) => {
  logger.error('[Process] Uncaught Exception:', err);
  process.exit(1); // Let the cluster restart the worker
});

// ── CONSTANTS ─────────────────────────────────────────────────────
const VALID_ROLES    = ['tenant', 'owner', 'admin'];
const VALID_TYPES    = ['1BHK', '2BHK', '3BHK', 'Studio', '4BHK+'];
const VALID_STATUSES = {
  booking: ['confirmed', 'cancelled'],
  listing: ['approved', 'rejected'],
  user:    ['active', 'suspended'],
};

// ── CLOUDINARY (server-side, for image deletion only) ─────────────
// Loaded lazily to avoid crashing if the package is not installed.
let cloudinaryApi = null;
(async () => {
  const { CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME } = process.env;
  if (CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET && CLOUDINARY_CLOUD_NAME) {
    try {
      const { v2: cloudinary } = await import('cloudinary');
      cloudinary.config({
        cloud_name: CLOUDINARY_CLOUD_NAME,
        api_key:    CLOUDINARY_API_KEY,
        api_secret: CLOUDINARY_API_SECRET,
      });
      cloudinaryApi = cloudinary;
      console.log('[server.js] ✅ Cloudinary SDK configured for server-side deletions.');
    } catch (_) {
      console.warn('[server.js] ⚠️  cloudinary npm package not installed — images will NOT be deleted from Cloudinary on flat removal.');
      console.warn('[server.js]    Run: npm install cloudinary');
    }
  } else {
    console.warn('[server.js] ⚠️  Cloudinary API credentials missing — image deletion from Cloudinary disabled.');
    console.warn('[server.js]    Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in Railway Variables.');
  }
})();

// ── CORS ──────────────────────────────────────────────────────────
// Allow:
//   • explicit origins listed in FRONTEND_ORIGIN (comma-separated)
//   • any localhost / 127.0.0.1 origin (dev)
//   • any *.railway.app subdomain (Railway deployments)
//   • same-origin requests (no Origin header, e.g. Postman / curl)
const ALLOWED_ORIGINS   = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const LOCAL_ORIGIN_RE   = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const RAILWAY_ORIGIN_RE = /^https?:\/\/[\w-]+\.up\.railway\.app$/;

app.use(cors({
  origin: (origin, cb) => {
    // Same-origin or no-origin requests (server-to-server, curl, Postman)
    if (!origin || (origin === 'null' && !IS_PROD)) return cb(null, true); // (1g fix) Guard null origin
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    if (LOCAL_ORIGIN_RE.test(origin))     return cb(null, true);
    if (RAILWAY_ORIGIN_RE.test(origin))   return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── TRUST PROXY ───────────────────────────────────────────────────
// Required for express-rate-limit when running behind Railway's load balancer
app.set('trust proxy', 1);

// ── MIDDLEWARE ───────────────────────────────────────────────────────
app.disable('x-powered-by'); // Don't reveal Express version
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'"],
      styleSrc:       ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
      fontSrc:        ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:         ["'self'", 'data:', 'https://res.cloudinary.com', 'https://*.cloudinary.com'],
      connectSrc:     ["'self'", 'https://api.cloudinary.com'],
      frameSrc:       ["'none'"],
      objectSrc:      ["'none'"],
      upgradeInsecureRequests: IS_PROD ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false, // Allow Cloudinary embeds
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(compression());
app.use(morgan(IS_PROD ? 'combined' : 'dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

// ── RATE LIMITING ─────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each IP to 200 requests per `window`
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // Limit each IP to 30 auth requests per hour
  message: { success: false, message: 'Too many authentication attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);
app.use('/api/login',  authLimiter);
app.use('/api/signup', authLimiter);


// ── CLOUDINARY CONFIG API ─────────────────────────────────────────
const CLOUD_NAME    = (process.env.CLOUDINARY_CLOUD_NAME    || '').replace(/^["']|["']$/g, '');
const UPLOAD_PRESET = (process.env.CLOUDINARY_UPLOAD_PRESET || '').replace(/^["']|["']$/g, '');

// ── RESPONSE HELPERS ──────────────────────────────────────────────
const ok   = (res, data, message = 'OK', code = 200) =>
  res.status(code).json({ success: true,  data,         message });
const fail = (res, message = 'Error', code = 400)    =>
  res.status(code).json({ success: false, data: null,   message });
const strip = ({ password, ...u }) => u;

app.get('/api/config', (req, res) => {
  return ok(res, {
    cloudName: CLOUD_NAME,
    uploadPreset: UPLOAD_PRESET
  });
});

// ── JWT HELPERS ───────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    SECRET,
    { expiresIn: '7d' }
  );
}

function setTokenCookie(res, token) {
  res.cookie('ff_token', token, {
    httpOnly: true,
    secure:   IS_PROD,
    sameSite: IS_PROD ? 'none' : 'lax',  // 'none' required for cross-origin on Railway
    maxAge:   7 * 24 * 60 * 60 * 1000,
  });
}

// ── VALIDATION HELPERS ────────────────────────────────────────────
const isValidEmail    = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
const isValidPassword = (p) => typeof p === 'string' && p.length >= 6;

// ── AUTH MIDDLEWARE ───────────────────────────────────────────────
function authenticate(req, res, next) {
  const token =
    req.cookies?.ff_token ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null);

  if (!token) return fail(res, 'Unauthorized — please log in.', 401);

  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (err) {
    const msg =
      err.name === 'TokenExpiredError'
        ? 'Session expired. Please log in again.'
        : 'Invalid session. Please log in again.';
    return fail(res, msg, 401);
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role))
      return fail(res, 'Forbidden — insufficient permissions.', 403);
    next();
  };
}

// ── DB ERROR HANDLER ──────────────────────────────────────────────
function handleDbError(res, err, context) {
  console.error(`[${context}]`, err.code || '', err.message);
  if (err.code === '42P01' || err.code === '3D000')
    return fail(res, 'Database tables not found. Run schema.sql against your Supabase PostgreSQL first.', 503);
  if (err.code === 'ECONNREFUSED' || err.code === '28P01' || err.code === '28000')
    return fail(res, 'Cannot connect to PostgreSQL. Check DATABASE_URL in Environment Variables.', 503);
  return fail(res, 'Server error.', 500);
}

// ─────────────────────────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────────────────────────

app.post('/api/signup', validateBody(signupSchema), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const normalEmail = email.toLowerCase();
    const existing    = await queryOne('SELECT id FROM users WHERE email = ?', [normalEmail]);
    if (existing) return fail(res, 'An account with this email already exists.', 409);

    const hashed = await bcrypt.hash(password, SALT_ROUNDS);
    await query(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name.trim(), normalEmail, hashed, role]
    );

    const user  = await queryOne('SELECT * FROM users WHERE email = ?', [normalEmail]);
    const token = signToken(user);
    setTokenCookie(res, token);
    return ok(res, { user: strip(user), token }, 'Account created successfully.', 201);
  } catch (err) {
    return handleDbError(res, err, 'POST /api/signup');
  }
});

app.post('/api/login', validateBody(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalEmail = email.toLowerCase();
    const user        = await queryOne('SELECT * FROM users WHERE email = ?', [normalEmail]);

    // Timing-safe: always run bcrypt even on miss
    if (!user) {
      await bcrypt.compare(password, '$2a$12$invalidhashfortimingprotection0000000000000');
      return fail(res, 'Invalid email or password.', 401);
    }
    if (user.status === 'suspended')
      return fail(res, 'Your account has been suspended. Contact support.', 403);

    const match = await bcrypt.compare(password, user.password);
    if (!match) return fail(res, 'Invalid email or password.', 401);

    const token = signToken(user);
    setTokenCookie(res, token);
    return ok(res, { user: strip(user), token }, 'Welcome back!');
  } catch (err) {
    return handleDbError(res, err, 'POST /api/login');
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('ff_token', {
    httpOnly: true,
    sameSite: IS_PROD ? 'none' : 'lax',
    secure:   IS_PROD,
  });
  return ok(res, null, 'Logged out successfully.');
});

app.get('/api/me', authenticate, async (req, res) => {
  try {
    const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user)                       return fail(res, 'User not found.', 404);
    if (user.status === 'suspended') return fail(res, 'Account suspended.', 403);
    return ok(res, strip(user));
  } catch (err) {
    return handleDbError(res, err, 'GET /api/me');
  }
});

app.patch('/api/me', authenticate, async (req, res) => {
  try {
    const { name, email, password, phone, whatsapp, telegram, location, languages, bio } = req.body ?? {};

    if (name     !== undefined && !name?.trim())              return fail(res, 'Name cannot be empty.');
    if (email    !== undefined && !isValidEmail(email))       return fail(res, 'A valid email address is required.');
    if (password !== undefined && !isValidPassword(password)) return fail(res, 'Password must be at least 6 characters.');

    const current = await queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!current) return fail(res, 'User not found.', 404);

    if (email && email.trim().toLowerCase() !== current.email) {
      const taken = await queryOne(
        'SELECT id FROM users WHERE email = ? AND id != ?',
        [email.trim().toLowerCase(), req.user.id]
      );
      if (taken) return fail(res, 'That email is already in use by another account.', 409);
    }

    const updates = {
      name:      name?.trim()                                              ?? current.name,
      email:     email?.trim().toLowerCase()                               ?? current.email,
      phone:     phone     !== undefined ? (phone     || null)             : current.phone,
      whatsapp:  whatsapp  !== undefined ? (whatsapp  || null)             : current.whatsapp,
      telegram:  telegram  !== undefined ? (telegram?.replace(/^@/, '') || null) : current.telegram,
      location:  location  !== undefined ? (location  || null)             : current.location,
      languages: languages !== undefined ? (languages || null)             : current.languages,
      bio:       bio       !== undefined ? (bio       || null)             : current.bio,
    };

    if (password) updates.password = await bcrypt.hash(password, SALT_ROUNDS);

    // (1a, 1h fix) updated_at is deliberately excluded from updates object
    // and handled strictly by the query string below to prevent caller spoofing.
    const fields = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), req.user.id];
    await query(`UPDATE users SET ${fields}, updated_at = NOW() WHERE id = ?`, values);

    const updated = await queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
    return ok(res, strip(updated), 'Profile updated successfully.');
  } catch (err) {
    return handleDbError(res, err, 'PATCH /api/me');
  }
});

// ─────────────────────────────────────────────────────────────────
// USER ROUTES
// ─────────────────────────────────────────────────────────────────

app.get('/api/users', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { search, role, status } = req.query;
    let sql    = 'SELECT id, name, email, role, status, created_at FROM users WHERE 1=1';
    const args = [];

    if (search?.trim()) {
      const s = `%${search.trim()}%`;
      sql += ' AND (name LIKE ? OR email LIKE ?)';
      args.push(s, s);
    }
    if (role   && VALID_ROLES.includes(role))           { sql += ' AND role = ?';   args.push(role); }
    if (status && VALID_STATUSES.user.includes(status)) { sql += ' AND status = ?'; args.push(status); }
    sql += ' ORDER BY created_at DESC';

    return ok(res, await query(sql, args));
  } catch (err) {
    return handleDbError(res, err, 'GET /api/users');
  }
});

app.patch('/api/users/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { id }     = req.params;
    const { status } = req.body ?? {};

    if (!VALID_STATUSES.user.includes(status))
      return fail(res, 'Status must be active or suspended.');
    if (String(id) === String(req.user.id))
      return fail(res, 'You cannot change your own account status.');

    const target = await queryOne('SELECT id FROM users WHERE id = ?', [id]);
    if (!target) return fail(res, 'User not found.', 404);

    await query('UPDATE users SET status = ? WHERE id = ?', [status, id]);
    return ok(res, { id, status }, `User ${status === 'active' ? 'activated' : 'suspended'} successfully.`);
  } catch (err) {
    return handleDbError(res, err, 'PATCH /api/users/:id');
  }
});

app.delete('/api/users/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (String(id) === String(req.user.id))
      return fail(res, 'You cannot delete your own account.');

    const target = await queryOne('SELECT id FROM users WHERE id = ?', [id]);
    if (!target) return fail(res, 'User not found.', 404);

    await query('DELETE FROM users WHERE id = ?', [id]);
    return ok(res, { deleted: id }, 'User deleted successfully.');
  } catch (err) {
    return handleDbError(res, err, 'DELETE /api/users/:id');
  }
});

// ─────────────────────────────────────────────────────────────────
// FLAT ROUTES
// ─────────────────────────────────────────────────────────────────

app.get('/api/flats', authenticate, async (req, res) => {
  try {
    const page   = parseInt(req.query.page, 10) || 1;
    const limit  = parseInt(req.query.limit, 10) || 20;
    const offset = (page - 1) * limit;

    const { city, type, furnished, min_rent, max_rent, owner_id } = req.query;
    
    // LRU Cache Key (only cache tenant searches)
    const cacheKey = req.user.role === 'tenant' ? `flats:${JSON.stringify({ ...req.query, page, limit })}` : null;
    if (cacheKey && flatCache.has(cacheKey)) {
      return res.json(flatCache.get(cacheKey));
    }

    let sql      = `SELECT f.*, u.name AS owner_name FROM flats f JOIN users u ON u.id = f.owner_id WHERE 1=1`;
    let countSql = `SELECT COUNT(*) as total FROM flats f JOIN users u ON u.id = f.owner_id WHERE 1=1`;
    const args = [];

    if (city?.trim()) { 
      sql += ' AND f.city LIKE ?'; 
      countSql += ' AND f.city LIKE ?'; 
      args.push(`%${city.trim()}%`); 
    }
    if (type && VALID_TYPES.includes(type)) { 
      sql += ' AND f.type = ?'; 
      countSql += ' AND f.type = ?'; 
      args.push(type); 
    }
    if (furnished !== undefined && furnished !== '') {
      sql += ' AND f.furnished = ?';
      countSql += ' AND f.furnished = ?';
      args.push(furnished === '1' || furnished === 'true' ? 1 : 0);
    }
    if (min_rent && !isNaN(min_rent)) { 
      sql += ' AND f.rent >= ?'; 
      countSql += ' AND f.rent >= ?'; 
      args.push(parseFloat(min_rent)); 
    }
    if (max_rent && !isNaN(max_rent)) { 
      sql += ' AND f.rent <= ?'; 
      countSql += ' AND f.rent <= ?'; 
      args.push(parseFloat(max_rent)); 
    }

    if (req.user.role === 'owner') {
      sql += ' AND f.owner_id = ?'; 
      countSql += ' AND f.owner_id = ?'; 
      args.push(owner_id || req.user.id);
    } else if (req.user.role === 'tenant') {
      const tenantCond = ` AND f.available = 1 AND EXISTS (SELECT 1 FROM listings l WHERE l.flat_id = f.id AND l.status = 'approved')`;
      sql += tenantCond;
      countSql += tenantCond;
    }

    sql += ' ORDER BY f.created_at DESC LIMIT ? OFFSET ?';
    const finalArgs = [...args, limit, offset];

    const [rows, countRows] = await Promise.all([
      query(sql, finalArgs),
      queryOne(countSql, args)
    ]);

    const safe = rows.map(({ image_public_ids, ...f }) => {
      try { if (typeof f.amenities === 'string') f.amenities = JSON.parse(f.amenities); } catch { f.amenities = []; }
      try { if (typeof f.images    === 'string') f.images    = JSON.parse(f.images);    } catch { f.images    = []; }
      return f;
    });

    const total = countRows.total;
    const responseData = { success: true, data: safe, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
    
    if (cacheKey) flatCache.set(cacheKey, responseData);

    return res.json(responseData);
  } catch (err) {
    return handleDbError(res, err, 'GET /api/flats');
  }
});

app.get('/api/flats/:id', authenticate, async (req, res) => {
  try {
    const flat = await queryOne(
      `SELECT f.*,
              u.name      AS owner_name,
              u.phone     AS owner_phone,
              u.whatsapp  AS owner_whatsapp,
              u.telegram  AS owner_telegram,
              u.email     AS owner_email,
              u.bio       AS owner_bio
       FROM flats f
       JOIN users u ON u.id = f.owner_id
       WHERE f.id = ?`,
      [req.params.id]
    );
    if (!flat) return fail(res, 'Flat not found.', 404);

    try { if (typeof flat.amenities === 'string') flat.amenities = JSON.parse(flat.amenities); } catch { flat.amenities = []; }
    try { if (typeof flat.images    === 'string') flat.images    = JSON.parse(flat.images);    } catch { flat.images    = []; }

    delete flat.image_public_ids; // never expose to client
    return ok(res, flat);
  } catch (err) {
    return handleDbError(res, err, 'GET /api/flats/:id');
  }
});

app.post('/api/flats', authenticate, authorize('owner', 'admin'), validateBody(addFlatSchema), async (req, res) => {
  try {
    const {
      title, description, city, address, rent, type, furnished,
      amenities, images, image_public_ids,
      available_from, deposit, floor, total_floors, area_sqft,
      bathrooms, parking, facing, preferred_tenants, food_preference,
      pets_allowed, smoking_allowed, visitors_allowed, landmarks,
      contact_phone, contact_whatsapp, contact_email, contact_telegram,
      preferred_contact, best_time_to_call, owner_note,
    } = req.body;

    const ownerId = req.user.role === 'admin'
      ? (req.body.owner_id || req.user.id)
      : req.user.id;

    const parkingVal     = ['none','bike','car','both'].includes(parking)                                      ? parking          : 'none';
    const prefTenantsVal = ['any','family','bachelors','working_women','students'].includes(preferred_tenants) ? preferred_tenants : 'any';
    const foodPrefVal    = ['any','veg','nonveg'].includes(food_preference)                                    ? food_preference   : 'any';
    const prefContactVal = ['','phone','whatsapp','telegram','email'].includes(preferred_contact)              ? (preferred_contact || '') : '';

    const flatId = crypto.randomUUID(); // (1j fix) Avoid race conditions

    await query(
      `INSERT INTO flats (
         id, owner_id, title, description, city, address, rent, type, furnished,
         amenities, images, image_public_ids,
         available_from, deposit, floor, total_floors, area_sqft,
         bathrooms, parking, facing, preferred_tenants, food_preference,
         pets_allowed, smoking_allowed, visitors_allowed, landmarks,
         contact_phone, contact_whatsapp, contact_email, contact_telegram,
         preferred_contact, best_time_to_call, owner_note
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        flatId,
        ownerId,
        title.trim(),
        description?.trim()  || '',
        city.trim(),
        address?.trim()      || '',
        parseFloat(rent),
        type,
        (furnished == 1 || furnished === 'true' || furnished === true) ? 1 : 0,
        JSON.stringify(Array.isArray(amenities)          ? amenities          : []),
        JSON.stringify(Array.isArray(images)             ? images             : []),
        JSON.stringify(Array.isArray(image_public_ids)   ? image_public_ids   : []),
        available_from || null, // (1e fix) falsy empty string '' naturally resolves to null
        deposit      ? parseFloat(deposit)        : null, // (1e fix) guards against empty string 
        floor        ? parseInt(floor, 10)        : null, // (1e fix) guards against empty string
        total_floors ? parseInt(total_floors, 10) : null, // (1e fix) guards against empty string
        area_sqft    ? parseInt(area_sqft, 10)    : null, // (1e fix) guards against empty string
        bathrooms    || null,
        parkingVal,
        facing       || null,
        prefTenantsVal,
        foodPrefVal,
        pets_allowed     ? 1 : 0,
        smoking_allowed  ? 1 : 0,
        visitors_allowed ? 1 : 0,
        landmarks?.trim()             || null,
        contact_phone?.trim()         || null,
        contact_whatsapp?.trim()      || null,
        contact_email?.trim()         || null,
        contact_telegram?.trim().replace(/^@/, '') || null,
        prefContactVal,
        best_time_to_call             || null,
        owner_note?.trim()            || null,
      ]
    );

    const flat = await queryOne(
      'SELECT * FROM flats WHERE id = ?',
      [flatId]
    );
    await query('INSERT INTO listings (flat_id, owner_id) VALUES (?, ?)', [flat.id, ownerId]);

    delete flat.image_public_ids;
    return ok(res, flat, 'Flat submitted for review. An admin will approve it shortly.', 201);
  } catch (err) {
    return handleDbError(res, err, 'POST /api/flats');
  }
});

app.delete('/api/flats/:id', authenticate, authorize('owner', 'admin'), async (req, res) => {
  try {
    const flat = await queryOne('SELECT * FROM flats WHERE id = ?', [req.params.id]);
    if (!flat) return fail(res, 'Flat not found.', 404);
    // (1d fix) Coerce to String() because mysql2 returns UUID CHAR(36) as a string and user.id might vary in type
    if (req.user.role === 'owner' && String(flat.owner_id) !== String(req.user.id))
      return fail(res, 'Forbidden — this is not your flat.', 403);

    // Attempt Cloudinary image cleanup (non-fatal if it fails)
    if (cloudinaryApi) {
      try {
        const rawIds = typeof flat.image_public_ids === 'string'
          ? JSON.parse(flat.image_public_ids)
          : (Array.isArray(flat.image_public_ids) ? flat.image_public_ids : []);
        if (rawIds.length) {
          await cloudinaryApi.api.delete_resources(rawIds);
          console.log(`[server.js] Deleted ${rawIds.length} Cloudinary image(s) for flat ${req.params.id}`);
        }
      } catch (cdnErr) {
        console.warn('[server.js] Cloudinary deletion error (non-fatal):', cdnErr.message);
      }
    }

    await query('DELETE FROM flats WHERE id = ?', [req.params.id]);
    return ok(res, { deleted: req.params.id }, 'Flat deleted.');
  } catch (err) {
    return handleDbError(res, err, 'DELETE /api/flats/:id');
  }
});

// ─────────────────────────────────────────────────────────────────
// LISTING ROUTES
// ─────────────────────────────────────────────────────────────────

app.get('/api/listings', authenticate, authorize('admin', 'owner'), async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `SELECT l.*,
                 f.id    AS flat_id,
                 f.title AS flat_title, f.city, f.rent, f.type, f.images,
                 u.name  AS owner_name,
                 r.name  AS reviewer_name
               FROM listings l
               JOIN flats f ON f.id = l.flat_id
               JOIN users  u ON u.id = l.owner_id
               LEFT JOIN users r ON r.id = l.reviewed_by
               WHERE 1=1`;
    const args = [];

    if (req.user.role === 'owner') { sql += ' AND l.owner_id = ?'; args.push(req.user.id); }
    if (status && ['pending', ...VALID_STATUSES.listing].includes(status)) {
      sql += ' AND l.status = ?'; args.push(status);
    }
    sql += ' ORDER BY l.submitted_at DESC LIMIT 100';
    const rows = await query(sql, args);
    const safe = rows.map((l) => {
      // (1i, 6d fix) safely parse images from joined flat
      try { if (typeof l.images === 'string') l.images = JSON.parse(l.images); } catch { l.images = []; }
      return l;
    });
    return ok(res, safe);
  } catch (err) {
    return handleDbError(res, err, 'GET /api/listings');
  }
});

app.patch('/api/listings/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { status } = req.body ?? {};
    if (!VALID_STATUSES.listing.includes(status))
      return fail(res, 'Status must be approved or rejected.');

    const listing = await queryOne('SELECT * FROM listings WHERE id = ?', [req.params.id]);
    if (!listing) return fail(res, 'Listing not found.', 404);

    await query(
      'UPDATE listings SET status = ?, reviewed_at = NOW(), reviewed_by = ? WHERE id = ?',
      [status, req.user.id, req.params.id]
    );
    await query(
      'UPDATE flats SET available = ? WHERE id = ?',
      [status === 'approved' ? 1 : 0, listing.flat_id]
    );

    return ok(res, { id: req.params.id, status }, `Listing ${status} successfully.`);
  } catch (err) {
    return handleDbError(res, err, 'PATCH /api/listings/:id');
  }
});

// ─────────────────────────────────────────────────────────────────
// BOOKING ROUTES
// ─────────────────────────────────────────────────────────────────

app.get('/api/bookings', authenticate, async (req, res) => {
  try {
    let sql = `SELECT b.*,
                 f.title AS flat_title, f.city, f.type, f.rent,
                 t.name  AS tenant_name, t.email AS tenant_email,
                 o.name  AS owner_name
               FROM bookings b
               JOIN flats f ON f.id = b.flat_id
               JOIN users  t ON t.id = b.tenant_id
               JOIN users  o ON o.id = b.owner_id
               WHERE 1=1`;
    const args = [];

    if (req.user.role === 'tenant') { sql += ' AND b.tenant_id = ?'; args.push(req.user.id); }
    if (req.user.role === 'owner')  { sql += ' AND b.owner_id  = ?'; args.push(req.user.id); }
    sql += ' ORDER BY b.created_at DESC';

    return ok(res, await query(sql, args));
  } catch (err) {
    return handleDbError(res, err, 'GET /api/bookings');
  }
});

app.post('/api/bookings', authenticate, authorize('tenant'), validateBody(bookingSchema), async (req, res) => {
  try {
    const { flat_id, check_in, check_out } = req.body;

    const checkInDate  = new Date(check_in);
    const checkOutDate = new Date(check_out);
    const today        = new Date(); today.setHours(0, 0, 0, 0);

    if (isNaN(checkInDate.getTime()))  return fail(res, 'Invalid check-in date.');
    if (isNaN(checkOutDate.getTime())) return fail(res, 'Invalid check-out date.');
    if (checkInDate < today)           return fail(res, 'Check-in date cannot be in the past.');
    if (checkOutDate <= checkInDate)   return fail(res, 'Check-out must be after check-in.');

    const flat = await queryOne(
      `SELECT f.* FROM flats f
       WHERE f.id = ? AND f.available = 1
         AND EXISTS (SELECT 1 FROM listings l WHERE l.flat_id = f.id AND l.status = 'approved')`,
      [flat_id]
    );
    if (!flat) return fail(res, 'Flat is not available for booking.');

    const overlap = await queryOne(
      `SELECT id FROM bookings
       WHERE flat_id = ? AND status != 'cancelled' AND check_in < ? AND check_out > ?`,
      [flat_id, check_out, check_in]
    );
    if (overlap) return fail(res, 'Flat is already booked for these dates.', 409);

    const days      = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
    const totalRent = parseFloat((parseFloat(flat.rent) / 30 * days).toFixed(2));

    await query(
      'INSERT INTO bookings (flat_id, tenant_id, owner_id, check_in, check_out, total_rent) VALUES (?,?,?,?,?,?)',
      [flat_id, req.user.id, flat.owner_id, check_in, check_out, totalRent]
    );

    const booking = await queryOne(
      'SELECT * FROM bookings WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1',
      [req.user.id]
    );
    return ok(res, booking, 'Booking submitted. Awaiting owner confirmation.', 201);
  } catch (err) {
    return handleDbError(res, err, 'POST /api/bookings');
  }
});

app.patch('/api/bookings/:id', authenticate, async (req, res) => {
  try {
    const { status } = req.body ?? {};
    if (!VALID_STATUSES.booking.includes(status))
      return fail(res, 'Status must be confirmed or cancelled.');

    const booking = await queryOne('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
    if (!booking) return fail(res, 'Booking not found.', 404);

    const isOwner  = req.user.role === 'owner'  && String(booking.owner_id)  === String(req.user.id);
    const isTenant = req.user.role === 'tenant' && String(booking.tenant_id) === String(req.user.id);
    const isAdmin  = req.user.role === 'admin';

    if (!isOwner && !isTenant && !isAdmin) return fail(res, 'Forbidden.', 403);
    if (isTenant && status === 'confirmed') return fail(res, 'Tenants cannot confirm bookings.', 403);

    await query('UPDATE bookings SET status = ? WHERE id = ?', [status, req.params.id]);

    // (1b fix) Reset flat to available = 1 if all its bookings are cancelled
    if (status === 'cancelled') {
      const activeBookings = await queryOne(
        `SELECT id FROM bookings WHERE flat_id = ? AND status != 'cancelled' LIMIT 1`,
        [booking.flat_id]
      );
      if (!activeBookings) {
        await query(`UPDATE flats SET available = 1 WHERE id = ?`, [booking.flat_id]);
      }
    }

    return ok(res, { id: req.params.id, status }, `Booking ${status}.`);
  } catch (err) {
    return handleDbError(res, err, 'PATCH /api/bookings/:id');
  }
});

// ── HEALTH CHECK ──────────────────────────────────────────────────
app.get('/api/ping', async (req, res) => {
  try {
    await query('SELECT 1');
    return res.json({ success: true, message: 'OK — MySQL connected.' });
  } catch (err) {
    return res.status(503).json({ success: false, message: 'MySQL not connected: ' + err.message });
  }
});

// ── 404 HANDLER ───────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return fail(res, `Route ${req.method} ${req.path} not found.`, 404);
  }
  return res.status(404).send('Not Found');
});

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Unhandled Error]', err);
  if (res.headersSent) return _next(err); // (1f fix)
  return fail(res, IS_PROD ? 'Internal server error.' : err.message, 500);
});

// ── START (CLUSTERED) ─────────────────────────────────────────────
if (!process.env.VERCEL) {
  if (cluster.isPrimary && IS_PROD) {
    const numCPUs = os.cpus().length;
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log(`║  🏠  FlatFinder API  —  port ${PORT}              ║`);
    console.log(`║  ENV: ${IS_PROD ? 'production ' : 'development'}                        ║`);
    console.log(`║  CLUSTERING: Active (${numCPUs} Workers)                ║`);
    console.log('╚══════════════════════════════════════════════╝');
    console.log(`[server.js] Cloudinary cloud : ${CLOUD_NAME || "❌ NOT SET"}`);
    console.log(`[server.js] Cloudinary preset: ${UPLOAD_PRESET || "❌ NOT SET"}`);
    console.log('');
    console.log(`[Master] Primary ${process.pid} is running`);

    for (let i = 0; i < numCPUs; i++) {
      cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
      console.warn(`[Master] Worker ${worker.process.pid} died. Restarting...`);
      cluster.fork();
    });

    const shutdown = () => {
      console.log('[Master] Shutting down workers gracefully...');
      for (const id in cluster.workers) {
        cluster.workers[id].process.kill('SIGTERM');
      }
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } else {
    const server = app.listen(PORT, '0.0.0.0', async () => {
      // Only log and validate DB on first worker (or in single-process dev mode)
      const isFirstWorker = !cluster.isWorker || cluster.worker?.id === 1;
      if (isFirstWorker) {
        if (!IS_PROD) {
          console.log('');
          console.log('╭────────────────────────────────────────────╮');
          console.log(`│  🏠  FlatFinder API  —  http://localhost:${PORT}  │`);
          console.log('╰────────────────────────────────────────────╯');
          logger.info(`Cloudinary cloud : ${CLOUD_NAME || '❌ NOT SET'}`);
          logger.info(`Cloudinary preset: ${UPLOAD_PRESET || '❌ NOT SET'}`);
        }
        await validateConnection();
        if (IS_PROD) {
          logger.info(`Worker ${process.pid} ready on port ${PORT}`);
        }
      }
    }); // end app.listen callback

    const gracefulExit = () => {
      logger.info(`[Worker ${process.pid}] Shutting down gracefully...`);
      server.close(async () => {
        logger.info(`[Worker ${process.pid}] Closed HTTP connections.`);
        try {
          await pool.end();
          logger.info(`[Worker ${process.pid}] Closed MySQL pool.`);
        } catch (err) {
          logger.error(`[Worker ${process.pid}] Error closing MySQL pool: ${err.message}`);
        }
        process.exit(0);
      });

      // Force exit if graceful close takes too long (Railway SIGTERM timeout is 10s)
      setTimeout(() => {
        logger.warn(`[Worker ${process.pid}] Forced shutdown after timeout.`);
        process.exit(1);
      }, 8000);
    };
    process.on('SIGINT',  gracefulExit);
    process.on('SIGTERM', gracefulExit);
  }
}

export default app;
