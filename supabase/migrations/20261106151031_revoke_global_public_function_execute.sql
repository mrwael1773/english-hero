-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default.
-- Revoke that global default for functions created by the app-owned postgres role.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
