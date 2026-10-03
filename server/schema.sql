-- ====================================================================
-- HAVILAH BROKS FARM - PRODUCTION POSTGRESQL SCHEMA WITH RLS
-- Integrated Livestock (Layers, Broilers, Cockerels) & Aquaculture (Catfish)
-- ====================================================================

-- 1. EXTENSIONS & ENUMS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE animal_type AS ENUM ('Catfish', 'Layers', 'Broilers', 'Cockerels');
CREATE TYPE user_role AS ENUM ('CEO', 'Manager');
CREATE TYPE batch_status AS ENUM ('Active', 'Closed');
CREATE TYPE transaction_type AS ENUM ('Revenue', 'Expense');
CREATE TYPE finance_category AS ENUM ('Feed Purchase', 'Medication', 'Sales', 'Logistics', 'Salaries', 'General Equipment');

-- 2. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'Manager',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. BATCHES TABLE
CREATE TABLE IF NOT EXISTS batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type animal_type NOT NULL,
    batch_code VARCHAR(100) UNIQUE NOT NULL,
    start_quantity INT NOT NULL CHECK (start_quantity > 0),
    current_quantity INT NOT NULL CHECK (current_quantity >= 0),
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status batch_status NOT NULL DEFAULT 'Active',
    location_tag VARCHAR(150) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. DAILY LOGS TABLE (Manager Operational Input)
CREATE TABLE IF NOT EXISTS daily_logs (
    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    logged_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    feed_consumed_bags DECIMAL(10,2) NOT NULL DEFAULT 0.00 CHECK (feed_consumed_bags >= 0),
    mortality_count INT NOT NULL DEFAULT 0 CHECK (mortality_count >= 0),
    eggs_collected_trays INT DEFAULT NULL CHECK (eggs_collected_trays >= 0),
    damaged_eggs_count INT DEFAULT NULL CHECK (damaged_eggs_count >= 0),
    water_changed BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_biological_threat BOOLEAN DEFAULT FALSE
);

-- 5. FINANCES TABLE (CEO Admin Access Only - Strictly Protected)
CREATE TABLE IF NOT EXISTS finances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,
    recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    type transaction_type NOT NULL,
    category finance_category NOT NULL,
    amount DECIMAL(12,2) NOT NULL CHECK (amount >= 0),
    description TEXT,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ====================================================================
-- INDEXES FOR MAXIMUM QUERY PERFORMANCE
-- ====================================================================
CREATE INDEX idx_daily_logs_batch_date ON daily_logs(batch_id, date);
CREATE INDEX idx_daily_logs_timestamp ON daily_logs(timestamp DESC);
CREATE INDEX idx_finances_date_category ON finances(date DESC, category);
CREATE INDEX idx_batches_status_type ON batches(status, type);

-- ====================================================================
-- AUTOMATIC MORTALITY & BATCH QUANTITY TRIGGER
-- ====================================================================
CREATE OR REPLACE FUNCTION process_daily_log_trigger()
RETURNS TRIGGER AS $$
DECLARE
    batch_pop INT;
    mortality_pct DECIMAL(5,2);
BEGIN
    -- 1. Fetch current quantity of active batch
    SELECT current_quantity INTO batch_pop FROM batches WHERE id = NEW.batch_id;

    IF batch_pop > 0 THEN
        mortality_pct := (NEW.mortality_count::DECIMAL / batch_pop::DECIMAL) * 100.0;
        IF mortality_pct >= 1.50 THEN
            NEW.is_biological_threat := TRUE;
        END IF;
    END IF;

    -- 2. Deduct mortality from batch quantity
    UPDATE batches
    SET current_quantity = GREATEST(0, current_quantity - NEW.mortality_count)
    WHERE id = NEW.batch_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_daily_log_mortality
BEFORE INSERT ON daily_logs
FOR EACH ROW
EXECUTE FUNCTION process_daily_log_trigger();

-- ====================================================================
-- ROW-LEVEL SECURITY (RLS) POLICIES
-- ====================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE finances ENABLE ROW LEVEL SECURITY;

-- CEO RLS Policies (Full CRUD Access)
CREATE POLICY ceo_full_access_finances ON finances
    FOR ALL
    TO authenticated
    USING (current_setting('app.current_user_role', true) = 'CEO');

CREATE POLICY ceo_full_access_logs ON daily_logs
    FOR ALL
    TO authenticated
    USING (true);

CREATE POLICY ceo_full_access_batches ON batches
    FOR ALL
    TO authenticated
    USING (true);

-- Manager RLS Policies (Forbidden on Finances, Daily Logs & Batches Access Allowed)
CREATE POLICY manager_access_logs ON daily_logs
    FOR ALL
    TO authenticated
    USING (current_setting('app.current_user_role', true) IN ('CEO', 'Manager'));

CREATE POLICY manager_access_batches ON batches
    FOR SELECT
    TO authenticated
    USING (true);
