-- Reconcile the object-only progress constraint already present in production.
-- This is idempotent: applying it to the current database makes no schema change.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.learning_progress'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%jsonb_typeof(progress)%object%'
  ) THEN
    ALTER TABLE public.learning_progress
      ADD CONSTRAINT learning_progress_object
      CHECK (jsonb_typeof(progress) = 'object');
  END IF;
END
$$;
