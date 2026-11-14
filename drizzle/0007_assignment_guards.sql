-- Additive rollout: legacy incidents stay manual and keep all existing assignments.
CREATE INDEX incidents_active_team ON incidents(team_id,status);
--> statement-breakpoint
CREATE INDEX incidents_assignment_backlog ON incidents(assignment_state,assignment_checked_at,created_at);
--> statement-breakpoint
CREATE TRIGGER assignment_team_guard_insert BEFORE INSERT ON incidents
WHEN NEW.team_id IS NOT NULL AND NEW.status!='resolved'
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM teams WHERE id=NEW.team_id AND available=1) THEN RAISE(ABORT,'TEAM_UNAVAILABLE') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM incidents WHERE team_id=NEW.team_id AND status!='resolved') THEN RAISE(ABORT,'TEAM_BUSY') END;
END;
--> statement-breakpoint
CREATE TRIGGER assignment_team_guard_update BEFORE UPDATE OF team_id,status ON incidents
WHEN NEW.team_id IS NOT NULL AND NEW.status!='resolved' AND (OLD.team_id IS NOT NEW.team_id OR OLD.status='resolved')
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM teams WHERE id=NEW.team_id AND available=1) THEN RAISE(ABORT,'TEAM_UNAVAILABLE') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM incidents WHERE team_id=NEW.team_id AND status!='resolved' AND id!=NEW.id) THEN RAISE(ABORT,'TEAM_BUSY') END;
END;
--> statement-breakpoint
CREATE TRIGGER assignment_audit AFTER UPDATE OF team_id ON incidents
WHEN OLD.team_id IS NOT NEW.team_id AND NEW.team_id IS NOT NULL AND NEW.assignment_state='assigned'
BEGIN
  INSERT INTO activity(id,actor,message,created_at) VALUES('assignment:'||NEW.id||':'||NEW.version,'Automatic dispatcher','Assigned '||(SELECT name FROM teams WHERE id=NEW.team_id)||' to '||NEW.title||' ('||printf('%.1f',NEW.assignment_distance_km)||' km straight-line)',NEW.assigned_at);
  INSERT INTO notifications(id,kind,title,body,entity_id,created_at) VALUES('assignment:'||NEW.id||':'||NEW.version,'assignment','Nearest response team assigned',(SELECT name FROM teams WHERE id=NEW.team_id)||' assigned to '||NEW.title||' · '||printf('%.1f',NEW.assignment_distance_km)||' km straight-line',NEW.id,NEW.assigned_at);
END;
--> statement-breakpoint
CREATE TRIGGER team_location_guard_insert BEFORE INSERT ON teams
WHEN (NEW.lat IS NULL)!=(NEW.lng IS NULL) OR NEW.lat NOT BETWEEN -90 AND 90 OR NEW.lng NOT BETWEEN -180 AND 180 OR NEW.available NOT IN (0,1)
BEGIN SELECT RAISE(ABORT,'INVALID_TEAM_LOCATION'); END;
--> statement-breakpoint
CREATE TRIGGER team_location_guard_update BEFORE UPDATE OF lat,lng,available ON teams
WHEN (NEW.lat IS NULL)!=(NEW.lng IS NULL) OR NEW.lat NOT BETWEEN -90 AND 90 OR NEW.lng NOT BETWEEN -180 AND 180 OR NEW.available NOT IN (0,1)
BEGIN SELECT RAISE(ABORT,'INVALID_TEAM_LOCATION'); END;
