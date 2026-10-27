-- The audit log is append-only. The only permitted UPDATE is the one-time seal: setting
-- chain_position / prev_hash / hash on a row that has none, with every other column unchanged.
CREATE FUNCTION audit_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_log is append-only: DELETE is not allowed' USING ERRCODE = 'LG002';
  END IF;
  IF OLD.hash IS NOT NULL THEN
    RAISE EXCEPTION 'sealed audit entries are immutable' USING ERRCODE = 'LG002';
  END IF;
  IF NEW.hash IS NULL
     OR (NEW.seq, NEW.occurred_at, NEW.actor_type, NEW.actor_id, NEW.action, NEW.entity_type,
         NEW.entity_id, NEW.credit_account_id, NEW.request_id, NEW.data)
        IS DISTINCT FROM
        (OLD.seq, OLD.occurred_at, OLD.actor_type, OLD.actor_id, OLD.action, OLD.entity_type,
         OLD.entity_id, OLD.credit_account_id, OLD.request_id, OLD.data) THEN
    RAISE EXCEPTION 'audit entries can only be sealed, not edited' USING ERRCODE = 'LG002';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_guard BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_guard();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_forbid_mutation();
