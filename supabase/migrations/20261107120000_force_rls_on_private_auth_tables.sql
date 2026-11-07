-- Apply FORCE RLS to private authentication lookup and throttling tables.
-- The service role and narrowly scoped SECURITY DEFINER functions retain their
-- required access; ordinary API roles have no schema usage or table privileges.
ALTER TABLE private.student_login_lookup FORCE ROW LEVEL SECURITY;
ALTER TABLE private.student_login_attempts FORCE ROW LEVEL SECURITY;
