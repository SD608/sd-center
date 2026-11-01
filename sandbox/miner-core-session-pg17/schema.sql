-- QA ONLY, disposable PostgreSQL 17; NOT A PRODUCTION MIGRATION.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='miner_issuer_qa') THEN CREATE ROLE miner_issuer_qa NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='miner_client_qa') THEN CREATE ROLE miner_client_qa NOLOGIN; END IF;
END$$;
CREATE SCHEMA miner_session_qa;
REVOKE ALL ON SCHEMA miner_session_qa FROM PUBLIC;
GRANT USAGE ON SCHEMA miner_session_qa TO miner_issuer_qa;
CREATE TABLE miner_session_qa.accounts(uid uuid PRIMARY KEY,status text NOT NULL CHECK(status IN('active','suspended')));
CREATE TABLE miner_session_qa.devices(id uuid PRIMARY KEY,uid uuid REFERENCES miner_session_qa.accounts(uid),link_status text NOT NULL CHECK(link_status IN('active','paused')),revoked_at timestamptz);
CREATE TABLE miner_session_qa.runs(id uuid PRIMARY KEY,status text NOT NULL CHECK(status IN('active','closed')));
CREATE TABLE miner_session_qa.members(run_id uuid REFERENCES miner_session_qa.runs(id),uid uuid REFERENCES miner_session_qa.accounts(uid),status text NOT NULL CHECK(status IN('active','dead','returned')),PRIMARY KEY(run_id,uid));
CREATE TABLE miner_session_qa.builds(digest text PRIMARY KEY CHECK(digest ~ '^[a-f0-9]{64}$'),approved boolean NOT NULL);
CREATE TABLE miner_session_qa.grants(ticket_hash text PRIMARY KEY,uid uuid NOT NULL,device uuid NOT NULL,run_id uuid NOT NULL,build_digest text NOT NULL,issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,consumed_at timestamptz);
REVOKE ALL ON ALL TABLES IN SCHEMA miner_session_qa FROM PUBLIC,miner_issuer_qa,miner_client_qa;
COMMIT;
