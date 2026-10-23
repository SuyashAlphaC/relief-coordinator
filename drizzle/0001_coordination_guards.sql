CREATE INDEX incidents_status ON incidents(status);
--> statement-breakpoint
CREATE INDEX activity_created ON activity(created_at DESC);
--> statement-breakpoint
CREATE INDEX requests_status ON requests(status);
--> statement-breakpoint
CREATE TRIGGER request_active BEFORE INSERT ON requests
WHEN NOT EXISTS (SELECT 1 FROM incidents WHERE id=NEW.incident_id AND status!='resolved')
BEGIN SELECT RAISE(ABORT, 'INCIDENT_RESOLVED'); END;
--> statement-breakpoint
CREATE TRIGGER fulfill_stock BEFORE UPDATE OF status ON requests
WHEN NEW.status='fulfilled' AND OLD.status='pending'
BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM incidents WHERE id=NEW.incident_id AND status!='resolved') THEN RAISE(ABORT,'INCIDENT_RESOLVED') END;
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM resources WHERE id=NEW.resource_id AND quantity>=NEW.quantity) THEN RAISE(ABORT,'INSUFFICIENT_STOCK') END;
 UPDATE resources SET quantity=quantity-NEW.quantity,version=version+1 WHERE id=NEW.resource_id;
END;
--> statement-breakpoint
CREATE TRIGGER resource_nonnegative BEFORE UPDATE OF quantity ON resources
WHEN NEW.quantity<0 OR NEW.quantity>1000000
BEGIN SELECT RAISE(ABORT,'INVALID_STOCK'); END;
--> statement-breakpoint
CREATE TRIGGER resolve_pending BEFORE UPDATE OF status ON incidents
WHEN NEW.status='resolved' AND EXISTS (SELECT 1 FROM requests WHERE incident_id=NEW.id AND status='pending')
BEGIN SELECT RAISE(ABORT,'PENDING_REQUESTS'); END;
