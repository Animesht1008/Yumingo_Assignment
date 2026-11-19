-- Revoke unnecessary default privileges from application roles
-- for tables created by postgres in the public schema.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
REVOKE REFERENCES, TRIGGER, TRUNCATE, MAINTAIN
ON TABLES FROM anon, authenticated;
