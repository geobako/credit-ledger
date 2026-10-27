-- Ledger invariants, enforced in the database so no application bug can break them:
--   1. Every journal entry has >= 2 postings, one currency, and debits = credits (checked at COMMIT).
--   2. Postings can only be added in the transaction that created their entry.
--   3. Journal entries and postings are append-only (no UPDATE / DELETE / TRUNCATE).
--   4. Cached account balances only change through postings, never directly.
--   5. A posting's currency must match its account's currency.
-- (Non-negative balances are a CHECK constraint on ledger_accounts.)
--
-- Custom SQLSTATEs (class LG) let the application map failures precisely:
--   LG001 unbalanced entry · LG002 immutable row · LG003 currency mismatch
--   LG004 posting outside the entry's transaction

-- (2) + (4) + (5): apply each posting to its account's cached balance.
CREATE FUNCTION ledger_apply_posting() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  acc   ledger_accounts%ROWTYPE;
  delta bigint;
BEGIN
  IF (SELECT created_xid FROM journal_entries WHERE id = NEW.journal_entry_id) <> pg_current_xact_id() THEN
    RAISE EXCEPTION 'postings can only be added in the transaction that created journal entry %', NEW.journal_entry_id
      USING ERRCODE = 'LG004';
  END IF;

  -- NO KEY UPDATE, not UPDATE: the postings FK check already holds KEY SHARE on this row, and
  -- upgrading to FOR UPDATE would deadlock two concurrent postings. NO KEY UPDATE still
  -- serialises writers on the account (it is also what the balance UPDATE below takes).
  SELECT * INTO acc FROM ledger_accounts WHERE id = NEW.account_id FOR NO KEY UPDATE;

  IF acc.currency <> NEW.currency THEN
    RAISE EXCEPTION 'posting currency % does not match account % currency %', NEW.currency, acc.id, acc.currency
      USING ERRCODE = 'LG003';
  END IF;

  -- Debit-normal categories grow with debits, credit-normal ones with credits.
  delta := CASE
    WHEN (acc.category IN ('ASSET', 'EXPENSE')) = (NEW.direction = 'DEBIT') THEN NEW.amount
    ELSE -NEW.amount
  END;

  UPDATE ledger_accounts SET balance = balance + delta, version = version + 1 WHERE id = acc.id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER postings_apply AFTER INSERT ON postings
  FOR EACH ROW EXECUTE FUNCTION ledger_apply_posting();
--> statement-breakpoint

-- (1): checked once per entry at COMMIT, after all its postings are in.
CREATE FUNCTION ledger_check_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  n_postings int;
  debits     numeric;
  credits    numeric;
  currencies int;
BEGIN
  SELECT count(*),
         coalesce(sum(amount) FILTER (WHERE direction = 'DEBIT'), 0),
         coalesce(sum(amount) FILTER (WHERE direction = 'CREDIT'), 0),
         count(DISTINCT currency)
    INTO n_postings, debits, credits, currencies
    FROM postings WHERE journal_entry_id = NEW.id;

  IF n_postings < 2 OR debits <> credits OR currencies <> 1 THEN
    RAISE EXCEPTION 'journal entry % is unbalanced (postings=%, debits=%, credits=%, currencies=%)',
      NEW.id, n_postings, debits, credits, currencies
      USING ERRCODE = 'LG001';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_balanced AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_entry_balanced();
--> statement-breakpoint

-- (3): append-only.
CREATE FUNCTION ledger_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'LG002';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entries_immutable BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER journal_entries_no_truncate BEFORE TRUNCATE ON journal_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER postings_immutable BEFORE UPDATE OR DELETE ON postings
  FOR EACH ROW EXECUTE FUNCTION ledger_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER postings_no_truncate BEFORE TRUNCATE ON postings
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_forbid_mutation();
--> statement-breakpoint

-- (4): an account's identity is fixed and its balance only moves via ledger_apply_posting
-- (trigger depth > 1). A direct "UPDATE ledger_accounts SET balance = ..." is rejected.
CREATE FUNCTION ledger_guard_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger accounts cannot be deleted' USING ERRCODE = 'LG002';
  END IF;
  IF NEW.kind <> OLD.kind OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.category <> OLD.category OR NEW.currency <> OLD.currency THEN
    RAISE EXCEPTION 'ledger account identity is immutable' USING ERRCODE = 'LG002';
  END IF;
  IF (NEW.balance <> OLD.balance OR NEW.version <> OLD.version) AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'ledger balances can only change through postings' USING ERRCODE = 'LG002';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_accounts_guard BEFORE UPDATE OR DELETE ON ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION ledger_guard_account();
--> statement-breakpoint
CREATE TRIGGER ledger_accounts_no_truncate BEFORE TRUNCATE ON ledger_accounts
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_forbid_mutation();
--> statement-breakpoint

-- Idempotency keys are written in the SAME transaction as the effect they protect.
-- The (scope, key) primary key makes a concurrent duplicate block on the first request's
-- uncommitted row; once that commits, the duplicate sees the stored response and replays it.
-- If the first request rolls back, its key disappears with it and the retry runs for real.
COMMENT ON TABLE idempotency_keys IS 'Written in the same transaction as the effect it protects; see 0001_ledger_invariants.sql';
