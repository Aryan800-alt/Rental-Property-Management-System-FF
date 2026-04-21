-- ─────────────────────────────────────────────────────────────────────────────
-- FlatFinder — Supabase (PostgreSQL) Schema
-- Version 4 — Cloudinary-integrated + PostgreSQL Syntax
-- ─────────────────────────────────────────────────────────────────────────────

-- ── TRIGGER FUNCTION FOR updated_at ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = CURRENT_TIMESTAMP;
   RETURN NEW;
END;
$$ language 'plpgsql';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. USERS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          UUID          NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(120)  NOT NULL,
  email       VARCHAR(255)  NOT NULL UNIQUE,
  password    VARCHAR(255)  NOT NULL,
  role        TEXT          NOT NULL DEFAULT 'tenant' CHECK (role IN ('tenant','owner','admin')),
  status      TEXT          NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),

  -- Contact / profile fields (owner-facing, shown to tenants)
  phone       VARCHAR(20)   NULL DEFAULT NULL,
  whatsapp    VARCHAR(20)   NULL DEFAULT NULL,
  telegram    VARCHAR(80)   NULL DEFAULT NULL,   -- stored without @
  location    VARCHAR(120)  NULL DEFAULT NULL,   -- e.g. "Pune, Maharashtra"
  languages   VARCHAR(200)  NULL DEFAULT NULL,   -- e.g. "English, Hindi, Marathi"
  bio         TEXT          NULL DEFAULT NULL,   -- shown to tenants on listing

  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. FLATS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flats (
  id          UUID          NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID          NOT NULL,

  -- Basic Details
  title       VARCHAR(200)  NOT NULL,
  city        VARCHAR(100)  NOT NULL,
  address     VARCHAR(300)  NULL DEFAULT NULL,
  rent        DECIMAL(10,2) NOT NULL,
  type        TEXT          NOT NULL CHECK (type IN ('1BHK','2BHK','3BHK','Studio','4BHK+')),
  furnished   SMALLINT      NOT NULL DEFAULT 0,
  available   SMALLINT      NOT NULL DEFAULT 1,
  available_from DATE       NULL DEFAULT NULL,
  deposit     DECIMAL(10,2) NULL DEFAULT NULL,

  -- Property Details
  floor       SMALLINT      NULL DEFAULT NULL,
  total_floors SMALLINT     NULL DEFAULT NULL,
  area_sqft   SMALLINT      NULL DEFAULT NULL,
  bathrooms   VARCHAR(5)    NULL DEFAULT NULL,   -- "1","2","3","4+" — VARCHAR for "4+"
  parking     TEXT          NOT NULL DEFAULT 'none' CHECK (parking IN ('none','bike','car','both')),
  facing      VARCHAR(20)   NULL DEFAULT NULL,

  -- Preferences / Rules
  preferred_tenants TEXT    NOT NULL DEFAULT 'any' CHECK (preferred_tenants IN ('any','family','bachelors','working_women','students')),
  food_preference   TEXT    NOT NULL DEFAULT 'any' CHECK (food_preference IN ('any','veg','nonveg')),
  pets_allowed      SMALLINT NOT NULL DEFAULT 0,
  smoking_allowed   SMALLINT NOT NULL DEFAULT 0,
  visitors_allowed  SMALLINT NOT NULL DEFAULT 0,

  -- Description & Amenities
  description TEXT           NULL DEFAULT NULL,
  amenities   JSONB          NULL DEFAULT NULL,  -- ["WiFi","AC","Lift"]
  landmarks   VARCHAR(400)   NULL DEFAULT NULL,

  -- Media — Cloudinary
  images           JSONB     NULL DEFAULT NULL,  -- ["https://res.cloudinary.com/…","…"]
  image_public_ids JSONB     NULL DEFAULT NULL,  -- ["flatfinder/abc123","flatfinder/def456"]

  -- Owner contact shown on listing
  contact_phone     VARCHAR(20)  NULL DEFAULT NULL,
  contact_whatsapp  VARCHAR(20)  NULL DEFAULT NULL,
  contact_email     VARCHAR(255) NULL DEFAULT NULL,
  contact_telegram  VARCHAR(80)  NULL DEFAULT NULL,
  preferred_contact TEXT         NOT NULL DEFAULT '' CHECK (preferred_contact IN ('','phone','whatsapp','telegram','email')),
  best_time_to_call VARCHAR(40)  NULL DEFAULT NULL,
  owner_note        TEXT         NULL DEFAULT NULL,

  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_flat_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

DROP TRIGGER IF EXISTS update_flats_updated_at ON flats;
CREATE TRIGGER update_flats_updated_at BEFORE UPDATE ON flats FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. LISTINGS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listings (
  id               UUID      NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  flat_id          UUID      NOT NULL UNIQUE,
  owner_id         UUID      NOT NULL,
  status           TEXT      NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  rejection_reason TEXT      NULL DEFAULT NULL,
  submitted_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at      TIMESTAMP NULL DEFAULT NULL,
  reviewed_by      UUID      NULL DEFAULT NULL,

  CONSTRAINT fk_listing_flat     FOREIGN KEY (flat_id)     REFERENCES flats(id)  ON DELETE CASCADE,
  CONSTRAINT fk_listing_owner    FOREIGN KEY (owner_id)    REFERENCES users(id)  ON DELETE CASCADE,
  CONSTRAINT fk_listing_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id)  ON DELETE SET NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. BOOKINGS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id          UUID           NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  flat_id     UUID           NOT NULL,
  tenant_id   UUID           NOT NULL,
  owner_id    UUID           NOT NULL,
  check_in    DATE           NOT NULL,
  check_out   DATE           NOT NULL,
  total_rent  DECIMAL(12,2)  NOT NULL,
  status      TEXT           NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
  created_at  TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_booking_flat   FOREIGN KEY (flat_id)   REFERENCES flats(id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_tenant FOREIGN KEY (tenant_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_owner  FOREIGN KEY (owner_id)  REFERENCES users(id) ON DELETE CASCADE
);

DROP TRIGGER IF EXISTS update_bookings_updated_at ON bookings;
CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. INDEXES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_flats_owner        ON flats(owner_id);
CREATE INDEX IF NOT EXISTS idx_flats_city         ON flats(city);
CREATE INDEX IF NOT EXISTS idx_flats_available    ON flats(available);
CREATE INDEX IF NOT EXISTS idx_flats_type         ON flats(type);
CREATE INDEX IF NOT EXISTS idx_flats_rent         ON flats(rent);
CREATE INDEX IF NOT EXISTS idx_bookings_tenant    ON bookings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bookings_flat      ON bookings(flat_id);
CREATE INDEX IF NOT EXISTS idx_bookings_overlap   ON bookings(flat_id, status, check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_listings_status    ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_owner     ON listings(owner_id);
