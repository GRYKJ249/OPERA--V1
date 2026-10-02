-- Existing Opera defaults, without accounts, passwords, or example contact details.
-- Safe to repeat: existing settings and permissions are preserved.
BEGIN;

INSERT INTO roles (name, description_ar, description_en, is_system) VALUES
 ('admin', 'مدير كامل الصلاحيات', 'Full administrator', 1),
 ('editor', 'محرر المحتوى', 'Content editor', 1),
 ('support', 'دعم ورسائل التواصل', 'Support & messages', 1),
 ('user', 'مستخدم عادي', 'Regular user', 1)
ON CONFLICT DO NOTHING;

INSERT INTO permissions (code, description) VALUES
 ('users.read','View users'),('users.write','Edit users'),('users.delete','Delete users'),
 ('roles.manage','Manage roles'),('projects.read','View projects'),('projects.write','Edit projects'),
 ('projects.publish','Publish projects'),('projects.delete','Delete projects'),('media.upload','Upload media'),
 ('comments.moderate','Moderate comments'),('messages.read','Read contact messages'),
 ('messages.reply','Reply to messages'),('settings.manage','Manage site settings'),
 ('audit.read','Read audit log'),('apikeys.manage','Manage API keys'),('chat.use','Use chat')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'admin'
   OR (r.name = 'editor' AND p.code IN ('projects.read','projects.write','projects.publish','media.upload','comments.moderate','chat.use'))
   OR (r.name = 'support' AND p.code IN ('messages.read','messages.reply','comments.moderate','users.read','chat.use'))
   OR (r.name = 'user' AND p.code = 'chat.use')
ON CONFLICT DO NOTHING;

INSERT INTO site_settings (key, value, type, is_public) VALUES
 ('site.name','Opera','string',1),
 ('site.default_locale','ar','string',1),
 ('security.single_owner','false','boolean',0),
 ('auth.registration_open','true','boolean',1),
 ('auth.require_email_verification','true','boolean',0),
 ('auth.session_days','7','number',0),
 ('auth.max_failed_logins','5','number',0),
 ('auth.lockout_minutes','15','number',0),
 ('auth.password_min_length','10','number',1),
 ('features.chat','true','boolean',1),
 ('features.comments','true','boolean',1)
ON CONFLICT DO NOTHING;

COMMIT;