-- Sets real passwords (from $POSTGRES_PASSWORD) on the roles this minimal stack
-- actually connects as. (The official template also sets pgbouncer/functions/
-- storage-admin passwords, but those roles don't exist here — we run no pooler,
-- Edge Functions, or Storage service — and ALTER USER on a missing role aborts
-- the rest of this script.)
\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';

-- The base image's own auth-schema bootstrap transfers auth.users/etc. table
-- ownership to supabase_auth_admin but leaves auth.uid()/role()/email() owned by
-- the init connection's role. GoTrue's own startup migration tries to CREATE OR
-- REPLACE those same functions as supabase_auth_admin and fails without this.
ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.email() OWNER TO supabase_auth_admin;
