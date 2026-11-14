CREATE INDEX outbox_pending ON outbox(processed_at,sent_at,created_at);
--> statement-breakpoint
CREATE INDEX notifications_created ON notifications(created_at DESC);
--> statement-breakpoint
CREATE INDEX attachments_incident ON attachments(incident_id,status);
--> statement-breakpoint
CREATE TRIGGER activity_outbox AFTER INSERT ON activity
BEGIN INSERT OR IGNORE INTO outbox(id,kind,payload,created_at) VALUES(NEW.id,'activity',json_object('message',NEW.message,'actor',NEW.actor),NEW.created_at); END;
--> statement-breakpoint
CREATE TRIGGER attachment_limit BEFORE INSERT ON attachments
WHEN (SELECT COUNT(*) FROM attachments WHERE incident_id=NEW.incident_id)>=20 OR COALESCE((SELECT SUM(size) FROM attachments),0)+NEW.size>524288000
BEGIN SELECT RAISE(ABORT,'ATTACHMENT_LIMIT'); END;
