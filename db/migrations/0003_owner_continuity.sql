-- Protect owner continuity even when concurrent admins change each other's access.
CREATE TRIGGER IF NOT EXISTS hub_keep_last_owner BEFORE UPDATE OF role,active ON hub_members
WHEN OLD.role='super_admin' AND OLD.active=1 AND (NEW.role<>'super_admin' OR NEW.active<>1)
AND (SELECT COUNT(*) FROM hub_members WHERE workspace_id=OLD.workspace_id AND role='super_admin' AND active=1)=1
BEGIN SELECT RAISE(ABORT,'The workspace needs an active super admin.'); END;
CREATE UNIQUE INDEX IF NOT EXISTS hub_provider_account ON social_connections(workspace_id,provider,label);
