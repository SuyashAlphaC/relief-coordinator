CREATE TRIGGER preserve_last_coordinator BEFORE UPDATE OF role ON members
WHEN OLD.role='coordinator' AND NEW.role!='coordinator' AND (SELECT COUNT(*) FROM members WHERE role='coordinator')<=1
BEGIN SELECT RAISE(ABORT,'LAST_COORDINATOR'); END;
